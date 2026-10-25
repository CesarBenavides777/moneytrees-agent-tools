# moneytrees

CLI and TypeScript SDK for [MoneyTrees](https://moneytrees.ai): trading signals for meme coins, stocks and prediction markets.

Node 18 or newer. No runtime dependencies.

```bash
npx moneytrees movers
npx moneytrees ticker BONK
npx moneytrees signals --symbol BONK --limit 10
npx moneytrees docs search "alerts"
```

MoneyTrees data is market information, not financial advice.

## Commands

| Command                                                                 | What it does                                       | Credential         |
| ----------------------------------------------------------------------- | -------------------------------------------------- | ------------------ |
| `moneytrees movers [--limit n]`                                         | Top gainers and losers over 24h                    | none               |
| `moneytrees ticker <symbol>`                                            | Price, 24h change, market cap, volume, last update | none               |
| `moneytrees search <query>`                                             | Find tickers by symbol or name                     | none               |
| `moneytrees signals [--symbol s] [--source s] [--limit n] [--cursor c]` | The signal feed, newest first                      | none               |
| `moneytrees batch <path>...`                                            | Several GET reads in one request                   | none               |
| `moneytrees ask "<question>"`                                           | A question about MoneyTrees in plain words         | none               |
| `moneytrees docs search <query>` / `read <path>` / `list`               | The docs, over the docs MCP server                 | none               |
| `moneytrees mcp tools`                                                  | List the docs MCP server tools                     | none               |
| `moneytrees mcp call <tool> --json '{...}'`                             | Call one MCP tool                                  | none               |
| `moneytrees me`                                                         | Your account summary                               | `MONEYTREES_TOKEN` |
| `moneytrees index`                                                      | Every API endpoint                                 | none               |

Options:

- `--json` prints the raw JSON response.
- `--sandbox` reads fixture data from `/api/v1/sandbox`.
- `--account` points `mcp tools` and `mcp call` at the account MCP server. It needs `MONEYTREES_TOKEN` and a Pro plan.
- `--base-url <url>` or `MONEYTREES_BASE_URL` changes the origin.

## SDK

```ts
import { MoneyTrees } from "moneytrees";

const mt = new MoneyTrees();
const { gainers } = await mt.movers({ limit: 5 });
const bonk = await mt.ticker("BONK");
const page = await mt.signals({ symbol: "BONK", limit: 20 });

for await (const signal of mt.allSignals({ symbol: "BONK" })) {
  console.log(signal.source, signal.content);
}

const [a, b] = await mt.batch(["/api/v1/tickers/BONK", "/api/v1/tickers/WIF"]);
const hits = await mt.docs.search("rate limits");
const tools = await mt.mcp.tools();
```

Options: `new MoneyTrees({ apiKey, baseUrl, sandbox, timeoutMs, fetch })`.

- `apiKey` is an OAuth access token. Only `me()` and the account MCP server (`mt.mcp.tools("account")`) need it. It defaults to `MONEYTREES_TOKEN`. See [auth.md](https://moneytrees.ai/auth.md).
- `sandbox: true` sends REST reads to `/api/v1/sandbox`. `/ask`, `me()` and MCP are not affected.

Sandbox writes, fixture data only:

```ts
const order = await mt.createSandboxOrder({ symbol: "BONK", side: "buy", quantity: 1000 });
const job = await mt.createSandboxBacktest({ symbol: "BONK" });
const status = await mt.sandboxJob(job.id);
```

`createSandboxOrder` sends a random `Idempotency-Key` unless you pass `{ idempotencyKey }`. Pass the same key when you retry.

Every failure throws `MoneyTreesError` with `status`, `code`, `docsUrl` and `url`. Branch on `code`.

## Source

https://github.com/CesarBenavides777/moneytrees-agent-tools (MIT). The same repo has the agent skills, the MCP config files and SDKs for Python, Go and Ruby.
