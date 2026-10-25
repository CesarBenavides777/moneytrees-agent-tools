# frozen_string_literal: true

require "json"
require "net/http"
require "securerandom"
require "uri"

module MoneyTrees
  DEFAULT_BASE_URL = "https://moneytrees.ai"

  class Error < StandardError
    attr_reader :status, :code, :docs_url, :url

    def initialize(message, status: nil, code: nil, docs_url: nil, url: nil)
      super(message)
      @status = status
      @code = code
      @docs_url = docs_url
      @url = url
    end
  end

  def self.tool_text(result)
    Array(result["content"]).map { |part| part["type"] == "text" ? part["text"].to_s : JSON.generate(part) }.join("\n")
  end

  class Client
    attr_reader :base_url, :sandbox

    def initialize(api_key: nil, base_url: nil, sandbox: false, timeout: 30)
      @api_key = api_key || ENV["MONEYTREES_TOKEN"]
      @api_key = nil if @api_key == ""
      @base_url = (base_url || ENV["MONEYTREES_BASE_URL"] || DEFAULT_BASE_URL).sub(%r{/+\z}, "")
      @sandbox = sandbox
      @timeout = timeout
      @rpc_id = 0
    end

    def index
      json(api(""))
    end

    def movers(limit: nil)
      json(api("/movers"), query: { limit: limit })
    end

    def search_tickers(query)
      json(api("/tickers"), query: { q: query })["results"]
    end

    def ticker(symbol)
      json(api("/tickers/#{escape(symbol)}"))
    end

    def signals(symbol: nil, source: nil, limit: nil, cursor: nil)
      json(api("/signals"), query: { symbol: symbol, source: source, limit: limit, cursor: cursor })
    end

    def each_signal(symbol: nil, source: nil, limit: nil)
      return enum_for(:each_signal, symbol: symbol, source: source, limit: limit) unless block_given?

      cursor = nil
      loop do
        page = signals(symbol: symbol, source: source, limit: limit, cursor: cursor)
        page["data"].each { |signal| yield signal }
        cursor = page["nextCursor"]
        break if cursor.nil? || cursor.empty?
      end
    end

    def batch(requests)
      items = requests.map { |r| r.is_a?(String) ? { method: "GET", path: r } : { method: "GET" }.merge(r) }
      json(api("/batch"), method: :post, body: { requests: items })["responses"]
    end

    def me
      json("/api/v1/me", auth: true)
    end

    def create_sandbox_order(order, idempotency_key: nil)
      headers = { "Idempotency-Key" => idempotency_key || SecureRandom.uuid }
      json(api("/orders", sandbox: true), method: :post, body: order, headers: headers)
    end

    def create_sandbox_backtest(params)
      response = send_request(api("/backtests", sandbox: true), method: :post, body: params)
      body = response.body.to_s.empty? ? {} : JSON.parse(response.body)
      location = response["Location"].to_s
      body.merge("id" => body["id"] || location.split("/").last, "location" => location)
    end

    def sandbox_job(id)
      json(api("/jobs/#{escape(id)}", sandbox: true))
    end

    def ask(text)
      json("/ask", method: :post, body: { query: { text: text } })
    end

    def list_tools(server: :docs)
      rpc(server, "tools/list")["tools"]
    end

    def call_tool(name, arguments = {}, server: :docs)
      rpc(server, "tools/call", { name: name, arguments: arguments })
    end

    def search_docs(query)
      call_tool("search_docs", { query: query })
    end

    def read_doc(path)
      call_tool("read_doc", { path: path })
    end

    def list_docs
      call_tool("list_docs", {})
    end

    private

    def api(path, sandbox: @sandbox)
      "/api/v1#{sandbox ? '/sandbox' : ''}#{path}"
    end

    def escape(value)
      URI.encode_www_form_component(value.to_s).gsub("+", "%20")
    end

    def json(path, **options)
      response = send_request(path, **options)
      response.body.to_s.empty? ? {} : JSON.parse(response.body)
    rescue JSON::ParserError
      raise Error.new("#{path} did not answer JSON", status: response.code.to_i, code: "invalid_json")
    end

    def send_request(path, method: :get, query: {}, body: nil, headers: {}, auth: false)
      uri = URI(@base_url + path)
      params = query.reject { |_, v| v.nil? || v == "" }
      uri.query = URI.encode_www_form(params) unless params.empty?

      request = (method == :post ? Net::HTTP::Post : Net::HTTP::Get).new(uri)
      request["Accept"] = "application/json"
      request["User-Agent"] = "moneytrees-ruby/#{VERSION}"
      headers.each { |key, value| request[key] = value }
      if body
        request["Content-Type"] = "application/json"
        request.body = JSON.generate(body)
      end
      if auth
        unless @api_key
          raise Error.new("#{path} needs an OAuth access token. Pass api_key: or set MONEYTREES_TOKEN. " \
                          "See #{@base_url}/auth.md", code: "missing_token", url: uri.to_s)
        end
        request["Authorization"] = "Bearer #{@api_key}"
      end

      response = begin
        Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https",
                                            open_timeout: @timeout, read_timeout: @timeout) do |http|
          http.request(request)
        end
      rescue SocketError, SystemCallError, Net::OpenTimeout, Net::ReadTimeout => e
        raise Error.new("Could not reach #{uri}: #{e.message}", code: "network_error", url: uri.to_s)
      end
      raise_for(response, uri) unless response.is_a?(Net::HTTPSuccess)
      response
    end

    def raise_for(response, uri)
      envelope = begin
        JSON.parse(response.body.to_s)["error"] || {}
      rescue JSON::ParserError, TypeError, NoMethodError
        {}
      end
      envelope = {} unless envelope.is_a?(Hash)
      raise Error.new(envelope["message"] || "#{uri} answered #{response.code}",
                      status: response.code.to_i, code: envelope["code"],
                      docs_url: envelope["docs_url"], url: uri.to_s)
    end

    def rpc(server, method, params = nil)
      path = server.to_sym == :account ? "/api/mcp" : "/api/mcp/docs"
      @rpc_id += 1
      message = { jsonrpc: "2.0", id: @rpc_id, method: method }
      message[:params] = params if params
      response = send_request(path, method: :post, body: message, auth: server.to_sym == :account,
                                    headers: { "Accept" => "application/json, text/event-stream" })
      text = response.body.to_s
      answer = response["Content-Type"].to_s.include?("text/event-stream") ? last_event(text) : JSON.parse(text)
      if answer["error"]
        raise Error.new(answer["error"]["message"].to_s, code: answer["error"]["code"].to_s, url: @base_url + path)
      end

      answer["result"]
    end

    def last_event(text)
      data = text.gsub("\r\n", "\n").split("\n\n").map do |event|
        event.lines.map(&:chomp).select { |line| line.start_with?("data:") }.map { |line| line[5..-1].lstrip }.join("\n")
      end
      JSON.parse(data.reject(&:empty?).last || "{}")
    end
  end
end
