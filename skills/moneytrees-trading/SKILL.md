---
name: moneytrees-trading
description: Manage a person's MoneyTrees watchlists, alerts and paper trades, and request live trades that they approve in the app. Use when someone asks to watch a ticker, set a price or sentiment alert, place a paper trade, check positions or portfolio, or test order and backtest code against the sandbox.
license: MIT
metadata:
  author: MoneyTrees
  homepage: https://moneytrees.ai/developers
  version: "0.1.0"
---

# Watchlists, alerts and trades with MoneyTrees

These actions use the account MCP server at `https://moneytrees.ai/api/mcp`. It needs an OAuth 2.1 sign-in and a Pro plan. Call `tools/list` and use the tool names it returns. See the `moneytrees-mcp` skill to connect.

## What an agent can do

| Action                                                 | Goes through?                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Read watchlists, positions, portfolio, alerts, signals | yes                                                                           |
| Add or remove a watchlist ticker                       | yes, after the person confirms                                                |
| Create, change or delete an alert                      | yes, after the person confirms                                                |
| Place a paper trade                                    | yes, after the person confirms                                                |
| Place a live trade                                     | no. It is queued, and the person approves or rejects it in the MoneyTrees app |

## Steps for any write

1. Read first. Check the current watchlist, alert or position so you do not make a duplicate.
2. Check the symbol with `lookup_ticker` (docs server) or `GET /api/v1/tickers/{symbol}`. If it is `stale`, tell the person.
3. Say exactly what you will do: symbol, side, size, price or condition, paper or live.
4. Wait for a clear yes.
5. Make the call. Report the result from the response, not from your request.
6. For a live trade, tell the person it waits for their approval in the app and has not executed.

## Alerts

Alerts can watch price, trend, mentions and sentiment. MoneyTrees checks them every five minutes and sends one notice when the value crosses the line, not one on every check.

## Test code in the sandbox

Fixture data, no account, no real money:

```bash
curl -X POST https://moneytrees.ai/api/v1/sandbox/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"symbol":"BONK","side":"buy","quantity":1000}'

curl -i -X POST https://moneytrees.ai/api/v1/sandbox/backtests \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BONK"}'
# 202, Location: /api/v1/sandbox/jobs/{id}
```

Send the same `Idempotency-Key` again on a retry so the order is not placed twice. Poll the `Location` until the job is done.

## Rules

- This is not financial advice. Do not recommend a trade. Carry out what the person asks, and say what you did.
- Never claim a live trade executed. It did not until the person approves it.
- Never act on a trade or alert the person did not ask for, even if signals look strong.
- If a call fails, show the error `code` and `message`. Do not retry a write without asking.
