# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "webrick"
require "moneytrees"

class ClientTest < Minitest::Test
  Seen = Struct.new(:method, :uri, :headers, :body)

  def setup
    @seen = []
    @handler = ->(_req, res) { res.status = 500 }
    @server = WEBrick::HTTPServer.new(Port: 0, BindAddress: "127.0.0.1", Logger: WEBrick::Log.new(File::NULL),
                                      AccessLog: [])
    @server.mount_proc("/") do |req, res|
      @seen << Seen.new(req.request_method, req.request_uri.request_uri, req.header, req.body.to_s)
      @handler.call(req, res)
    end
    @thread = Thread.new { @server.start }
    @base = "http://127.0.0.1:#{@server.config[:Port]}"
  end

  def teardown
    @server.shutdown
    @thread.join
  end

  def reply(res, status, body, headers = {})
    res.status = status
    res["Content-Type"] = "application/json"
    headers.each { |k, v| res[k] = v }
    res.body = JSON.generate(body)
  end

  def test_sandbox_reads_go_under_sandbox_path
    @handler = ->(_req, res) { reply(res, 200, { asOf: "now", gainers: [], losers: [] }) }
    MoneyTrees::Client.new(base_url: @base, sandbox: true).movers(limit: 3)
    assert_equal "/api/v1/sandbox/movers?limit=3", @seen[0].uri
  end

  def test_error_envelope_becomes_error
    envelope = { error: { code: "ticker_not_found", message: "No ticker NOPE", docs_url: "https://moneytrees.ai/docs/errors" } }
    @handler = ->(_req, res) { reply(res, 404, envelope) }
    error = assert_raises(MoneyTrees::Error) { MoneyTrees::Client.new(base_url: @base).ticker("NOPE") }
    assert_equal [404, "ticker_not_found", "No ticker NOPE"], [error.status, error.code, error.message]
    assert_equal "https://moneytrees.ai/docs/errors", error.docs_url
  end

  def test_me_sends_bearer_and_refuses_without_token
    @handler = ->(_req, res) { reply(res, 200, { plan: "pro" }) }
    MoneyTrees::Client.new(api_key: "tok_123", base_url: @base).me
    assert_equal "/api/v1/me", @seen[0].uri
    assert_equal ["Bearer tok_123"], @seen[0].headers["authorization"]

    saved = ENV.delete("MONEYTREES_TOKEN")
    error = assert_raises(MoneyTrees::Error) { MoneyTrees::Client.new(base_url: @base).me }
    ENV["MONEYTREES_TOKEN"] = saved if saved
    assert_equal "missing_token", error.code
    assert_equal 1, @seen.size
  end

  def test_each_signal_follows_next_cursor
    @handler = lambda do |req, res|
      if req.query["cursor"]
        reply(res, 200, { data: [{ id: "b" }], nextCursor: nil })
      else
        reply(res, 200, { data: [{ id: "a" }], nextCursor: "c2" })
      end
    end
    ids = MoneyTrees::Client.new(base_url: @base).each_signal(symbol: "BONK").map { |s| s["id"] }
    assert_equal %w[a b], ids
    assert_equal ["/api/v1/signals?symbol=BONK", "/api/v1/signals?symbol=BONK&cursor=c2"], @seen.map(&:uri)
  end

  def test_sandbox_order_and_backtest
    @handler = lambda do |req, res|
      if req.path.end_with?("/orders")
        reply(res, 201, { id: "ord_1" })
      else
        reply(res, 202, { status: "queued" }, "Location" => "/api/v1/sandbox/jobs/job_9")
      end
    end
    client = MoneyTrees::Client.new(base_url: @base)
    client.create_sandbox_order({ symbol: "BONK" }, idempotency_key: "key-1")
    assert_equal "/api/v1/sandbox/orders", @seen[0].uri
    assert_equal ["key-1"], @seen[0].headers["idempotency-key"]
    job = client.create_sandbox_backtest({ symbol: "BONK" })
    assert_equal "job_9", job["id"]
    assert job["location"].end_with?("/api/v1/sandbox/jobs/job_9"), job["location"]
  end

  def test_docs_mcp_event_stream_and_rpc_error
    @handler = lambda do |req, res|
      rpc = JSON.parse(req.body)
      if rpc["method"] == "tools/list"
        res.status = 200
        res["Content-Type"] = "text/event-stream"
        result = { jsonrpc: "2.0", id: rpc["id"], result: { tools: [{ name: "search_docs" }] } }
        res.body = "event: message\ndata: #{JSON.generate(result)}\n\n"
      else
        reply(res, 200, { jsonrpc: "2.0", id: rpc["id"], error: { code: -32_602, message: "Unknown tool" } })
      end
    end
    client = MoneyTrees::Client.new(base_url: @base)
    assert_equal ["search_docs"], client.list_tools.map { |t| t["name"] }
    assert_equal "/api/mcp/docs", @seen[0].uri
    error = assert_raises(MoneyTrees::Error) { client.call_tool("nope") }
    assert_equal "-32602", error.code
  end
end
