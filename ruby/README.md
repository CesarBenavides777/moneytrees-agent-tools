# moneytrees for Ruby

Ruby client for [MoneyTrees](https://moneytrees.ai): trading signals for meme coins, stocks and prediction markets.

Ruby 2.6 or newer. Standard library only.

```bash
gem install moneytrees
```

```ruby
require "moneytrees"

mt = MoneyTrees::Client.new
movers = mt.movers(limit: 5)
bonk = mt.ticker("BONK")
page = mt.signals(symbol: "BONK", limit: 20)

mt.each_signal(symbol: "BONK") { |signal| puts signal["source"], signal["content"] }

responses = mt.batch(["/api/v1/tickers/BONK", "/api/v1/tickers/WIF"])
hits = mt.search_docs("rate limits")
tools = mt.list_tools
```

`MoneyTrees::Client.new(api_key: nil, base_url: nil, sandbox: false, timeout: 30)`

- `api_key` is an OAuth access token. Only `me` and the account MCP server (`list_tools(server: :account)`) need it. It defaults to `MONEYTREES_TOKEN`. See [auth.md](https://moneytrees.ai/auth.md).
- `sandbox: true` sends REST reads to `/api/v1/sandbox`. `ask`, `me` and MCP are not affected.
- `MONEYTREES_BASE_URL` changes the origin.

Sandbox writes, fixture data only:

```ruby
order = mt.create_sandbox_order({ symbol: "BONK", side: "buy", quantity: 1000 })
job = mt.create_sandbox_backtest({ symbol: "BONK" })
status = mt.sandbox_job(job["id"])
```

Every failure raises `MoneyTrees::Error` with `status`, `code`, `docs_url` and `url`.

MoneyTrees data is market information, not financial advice.

Source: https://github.com/CesarBenavides777/moneytrees-agent-tools (MIT)
