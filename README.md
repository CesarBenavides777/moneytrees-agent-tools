# MoneyTrees agent tools

Agent skills, MCP config, a CLI and SDKs for [MoneyTrees](https://moneytrees.ai): trading signals for meme coins, stocks and prediction markets.

```bash
npx moneytrees movers
npx moneytrees ticker BONK
npx moneytrees signals --symbol BONK
```

The public API and the docs MCP server need no account. MoneyTrees data is market information, not financial advice.

## What is here

| Path                                                                 | What it is                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md), [`.cursorrules`](.cursorrules)             | Instructions for coding agents                                                     |
| [`skills/`](skills)                                                  | Agent skills: `moneytrees-mcp`, `moneytrees-ticker-research`, `moneytrees-trading` |
| [`plugin.json`](plugin.json), [`mcp.json`](mcp.json)                 | [Agent Plugins](https://agent-plugins.org) 1.0.0 manifest and its MCP servers      |
| [`.claude-plugin/`](.claude-plugin), [`.mcp.json`](.mcp.json)        | Claude Code plugin and marketplace                                                 |
| [`.cursor/mcp.json`](.cursor/mcp.json)                               | Cursor MCP config                                                                  |
| [`server.json`](server.json), [`server.docs.json`](server.docs.json) | MCP registry entries for the two servers                                           |
| [`packages/js`](packages/js)                                         | npm `moneytrees`: CLI and TypeScript SDK                                           |
| [`python`](python)                                                   | PyPI `moneytrees`                                                                  |
| [`go`](go)                                                           | `github.com/CesarBenavides777/moneytrees-agent-tools/go`                           |
| [`ruby`](ruby)                                                       | gem `moneytrees`                                                                   |

## MCP servers

| Server                                                                        | URL                                  | Auth                |
| ----------------------------------------------------------------------------- | ------------------------------------ | ------------------- |
| Docs and public market data                                                   | `https://moneytrees.ai/api/mcp/docs` | none                |
| Your account: watchlists, positions, portfolio, alerts, signals, paper trades | `https://moneytrees.ai/api/mcp`      | OAuth 2.1, Pro plan |

Both use streamable HTTP.

```bash
claude mcp add --transport http moneytrees-docs https://moneytrees.ai/api/mcp/docs
claude mcp add --transport http moneytrees https://moneytrees.ai/api/mcp
```

In Claude or ChatGPT, add either URL as a custom connector. In Cursor, copy [`.cursor/mcp.json`](.cursor/mcp.json) into your project or `~/.cursor/mcp.json`.

Live trades are never placed by an agent. They are queued, and you approve them in the MoneyTrees app.

## Install the Claude Code plugin

```bash
claude plugin marketplace add CesarBenavides777/moneytrees-agent-tools
claude plugin install moneytrees@moneytrees
```

This adds both MCP servers and the three skills.

## Install a skill

```bash
bunx skills add CesarBenavides777/moneytrees-agent-tools --list
bunx skills add CesarBenavides777/moneytrees-agent-tools --skill moneytrees-ticker-research
```

- `moneytrees-mcp`: connect an MCP client and pick the right tool.
- `moneytrees-ticker-research`: research a ticker with movers, lookup and signals.
- `moneytrees-trading`: watchlists, alerts, paper trades, and live trades that need approval in the app.

A skill adds instructions to your agent. It does not give access to a MoneyTrees account.

## REST API

Base `https://moneytrees.ai/api/v1`. No auth except `/me`.

```bash
curl "https://moneytrees.ai/api/v1/movers?limit=5"
curl "https://moneytrees.ai/api/v1/tickers?q=bonk"
curl "https://moneytrees.ai/api/v1/tickers/BONK"
curl "https://moneytrees.ai/api/v1/signals?symbol=BONK&limit=20"
```

Fixture data with no account: the same paths under `/api/v1/sandbox/`. See [AGENTS.md](AGENTS.md) for every endpoint, and [openapi.json](https://moneytrees.ai/openapi.json) for the schema.

## SDKs

```ts
import { MoneyTrees } from "moneytrees";
const bonk = await new MoneyTrees().ticker("BONK");
```

```python
from moneytrees import MoneyTrees
bonk = MoneyTrees().ticker("BONK")
```

```go
bonk, err := moneytrees.New().Ticker(ctx, "BONK")
```

```ruby
bonk = MoneyTrees::Client.new.ticker("BONK")
```

All four read `MONEYTREES_TOKEN` (an OAuth access token, only for `/me` and the account MCP server) and `MONEYTREES_BASE_URL`.

## Development

```bash
cd packages/js && bun install && bun run test
cd python && python -m unittest discover -s tests
cd go && go test ./...
cd ruby && bundle install && bundle exec rake test
```

Each test runs against a local stub server, not moneytrees.ai.

## Publishing

Nothing publishes from CI.

```bash
cd packages/js && npm publish --access public
cd python && uv build && uvx twine upload dist/*
cd ruby && gem build moneytrees.gemspec && gem push moneytrees-0.1.0.gem
git tag go/v0.1.0 && git push origin go/v0.1.0
```

## License

MIT
