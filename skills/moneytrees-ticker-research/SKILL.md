---
name: moneytrees-ticker-research
description: Research one ticker or find what is moving with MoneyTrees public data (movers, ticker lookup, the signal feed). Use when someone asks about a meme coin, stock or prediction market, wants to know why something is moving, or asks what is hot right now. No account needed.
license: MIT
metadata:
  author: MoneyTrees
  homepage: https://moneytrees.ai/developers
  version: "0.1.0"
---

# Research a ticker with MoneyTrees

Everything here is public. Use the docs MCP server tools if they are connected, or the REST API, or the CLI. They return the same data.

| Step            | MCP tool (docs server) | REST                                       | CLI                                    |
| --------------- | ---------------------- | ------------------------------------------ | -------------------------------------- |
| What is moving  | `get_top_movers`       | `GET /api/v1/movers?limit=10`              | `npx moneytrees movers`                |
| Name to symbol  | `search_tickers`       | `GET /api/v1/tickers?q=bonk`               | `npx moneytrees search bonk`           |
| One ticker      | `lookup_ticker`        | `GET /api/v1/tickers/BONK`                 | `npx moneytrees ticker BONK`           |
| What people say | `get_recent_signals`   | `GET /api/v1/signals?symbol=BONK&limit=20` | `npx moneytrees signals --symbol BONK` |

REST base: `https://moneytrees.ai/api/v1`. Add `--json` to any CLI command for raw JSON.

## Steps

1. If you have a name and not a symbol, search first. Do not guess the symbol: many meme coins share names.
2. Look up the ticker. If `stale` is `true`, say the price may be old and give `updatedAt`.
3. Read the signals for the symbol. Each has a `source` (for example X, 4chan /biz/, Polymarket, Kalshi, Truth Social), a `sentiment`, `engagement` and a link. Page with `cursor` if you need more.
4. To compare several symbols, use `POST /api/v1/batch` with one GET per symbol instead of many calls.
5. Report what the data shows: price, 24h change, volume, how many signals and from where, the main themes, and links to the posts you used.

## Rules

- Quote numbers from the response. Do not round a price into a different claim.
- Give sources: link the signals you summarize.
- Separate what the data shows from your reading of it.
- Do not tell the person to buy or sell. MoneyTrees data is not financial advice. Say so when you give a summary.
- A `404` on a ticker means MoneyTrees does not track it. Say that; do not fill in from memory.
