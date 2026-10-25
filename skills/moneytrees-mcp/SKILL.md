---
name: moneytrees-mcp
description: Connect an MCP client to MoneyTrees and pick the right tool for the job. Use when a task needs live meme coin, stock or prediction market data, the MoneyTrees docs, or a person's own MoneyTrees watchlists, positions, alerts or paper trades through MCP.
license: MIT
metadata:
  author: MoneyTrees
  homepage: https://moneytrees.ai/developers
  version: "0.1.0"
---

# MoneyTrees over MCP

MoneyTrees has two MCP servers. Both use streamable HTTP and JSON-RPC 2.0.

| Server            | URL                                  | Auth                | What it has                 |
| ----------------- | ------------------------------------ | ------------------- | --------------------------- |
| `moneytrees-docs` | `https://moneytrees.ai/api/mcp/docs` | none                | docs and public market data |
| `moneytrees`      | `https://moneytrees.ai/api/mcp`      | OAuth 2.1, Pro plan | one person's account        |

## Connect

```bash
claude mcp add --transport http moneytrees-docs https://moneytrees.ai/api/mcp/docs
claude mcp add --transport http moneytrees https://moneytrees.ai/api/mcp
```

Claude and ChatGPT take either URL as a custom connector. The account server starts an OAuth consent screen with dynamic client registration. Cursor reads the same URLs from `.cursor/mcp.json`.

To check the docs server without a client:

```bash
npx moneytrees mcp tools
npx moneytrees mcp call search_docs --json '{"query":"alerts"}'
```

## Which tool for which job

Docs server, no account:

- `get_top_movers`: what is moving now. Start here for "what is hot" questions.
- `search_tickers`: turn a name ("bonk", "trump coin") into a symbol.
- `lookup_ticker`: price, 24h change, market cap, volume and the `stale` flag for one symbol.
- `get_recent_signals`: recent posts and market events for a symbol or a source.
- `search_docs`, `read_doc`, `list_docs`: how MoneyTrees works, the API, pricing, limits.

Account server, signed in: call `tools/list` first and use the names it returns. It covers watchlists, positions, portfolio, alerts and signals for the signed-in person. Its writes are watchlist changes, alerts and paper trades.

## Rules

- Use the docs server for public data, even when the person is signed in. It needs no token.
- Every account tool reads or writes the signed-in person's data only.
- Confirm with the person before any write.
- A live trade is not placed by the tool. It is queued and the person approves it in the MoneyTrees app. Tell them so.
- A tool failure comes back as a result with `isError` set. Read its text.
- A `401` from the account server means no token or an expired one. A `403` that names the plan means the account is not on Pro.
- Never present the data as financial advice.

## Docs

- https://moneytrees.ai/developers
- https://moneytrees.ai/auth.md
