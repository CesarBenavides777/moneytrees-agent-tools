# MoneyTrees for agents

> MoneyTrees gives trading signals for meme coins, stocks and prediction markets. It reads X, 4chan /biz/, Polymarket, Kalshi, Truth Social and congressional filings, and scores them into ranked ticker momentum. The signal feed and alerts are free. Pro ($19/mo) adds leaderboards, trading agents and the account MCP server. Trader ($49/mo) is the full desk.

MoneyTrees data is market information, not financial advice. Say so when you show it to a person.

## Start here

The public API needs no credential, so this runs as-is:

```bash
curl https://moneytrees.ai/api/v1/movers?limit=5
```

The docs MCP server needs no credential either:

```bash
curl -X POST https://moneytrees.ai/api/mcp/docs \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Or use the CLI (Node 18 or newer):

```bash
npx moneytrees movers
npx moneytrees ticker BONK
npx moneytrees docs search "alerts"
```

## Endpoints

Public REST API, no auth, base `https://moneytrees.ai/api/v1`:

- `GET /api/v1`: every endpoint
- `GET /api/v1/movers?limit=`: top gainers and losers over 24h
- `GET /api/v1/tickers?q=`: search tickers by symbol or name
- `GET /api/v1/tickers/{symbol}`: one ticker: price, 24h change, market cap, volume, `stale` flag. `404` if unknown
- `GET /api/v1/signals?symbol=&source=&limit=&cursor=`: the signal feed, newest first, paged with `nextCursor`
- `POST /api/v1/batch`: several GET reads in one round trip, each answered with its own `status` and `body`
- `GET /api/v1/me`: the account summary. Needs `Authorization: Bearer <OAuth access token>`

Errors come back as `{"error":{"code","message","docs_url"}}`.

Sandbox, fixture data, no account: the same paths under `https://moneytrees.ai/api/v1/sandbox/`, plus

- `POST /api/v1/sandbox/orders`: place a fake order. Send an `Idempotency-Key` header
- `POST /api/v1/sandbox/backtests`: start a backtest. Answers `202` with `Location: /api/v1/sandbox/jobs/{id}`
- `GET /api/v1/sandbox/jobs/{id}`: poll a job

MCP servers, streamable HTTP, JSON-RPC 2.0:

- `https://moneytrees.ai/api/mcp/docs`: no auth. `search_docs`, `read_doc`, `list_docs`, `get_top_movers`, `search_tickers`, `lookup_ticker`, `get_recent_signals`
- `https://moneytrees.ai/api/mcp`: OAuth 2.1, Pro plan. Watchlists, positions, portfolio, alerts and signals. Writes: watchlist, alerts and paper trades. A live trade is queued and the person approves it in the app

Other:

- `GET|POST https://moneytrees.ai/ask`: a question in plain words (NLWeb, `query.text`)
- `https://moneytrees.ai/llms.txt`: the site for language models
- `https://moneytrees.ai/auth.md`: how an agent gets a credential
- `https://moneytrees.ai/openapi.json`: the REST API as OpenAPI
- `https://moneytrees.ai/developers` and `https://moneytrees.ai/docs`: the docs

## Authentication

Only `/api/v1/me` and the account MCP server need a credential. Both take an OAuth 2.1 access token as `Authorization: Bearer <token>`. MCP clients that support dynamic client registration (Claude, ChatGPT, Cursor) get one from the consent screen. [auth.md](https://moneytrees.ai/auth.md) has the full flow.

## When to use it

- Find what is moving now in meme coins, stocks or prediction markets.
- Look up one ticker: price, 24h change, market cap, volume.
- Read what people say about a ticker on X, 4chan /biz/, Polymarket, Kalshi or Truth Social.
- Test an order or a backtest against fixture data before you write code against a real account.
- With a person's Pro account: read their watchlists, positions and alerts, add to a watchlist, set an alert, place a paper trade.

## Rules for agents

- Never present MoneyTrees data as financial advice or as a prediction.
- Confirm with the person before any write on the account server.
- You cannot place a live trade. A live trade request is queued and the person approves it in the MoneyTrees app. Tell them that.
- Check `stale` on a ticker before you quote its price.
- Use the sandbox for tests and examples, not a real account.

## In this repo

- `plugin.json`, `mcp.json`: the [Agent Plugins](https://agent-plugins.org) 1.0.0 manifest and its MCP servers
- `.claude-plugin/`, `.mcp.json`: the Claude Code plugin
- `.cursor/mcp.json`: Cursor
- `server.json`, `server.docs.json`: MCP registry entries
- `skills/`: agent skills
- `packages/js`: npm `moneytrees`, the CLI and the TypeScript SDK
- `python/`, `go/`, `ruby/`: SDKs for the same endpoints
