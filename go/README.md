# moneytrees for Go

Go client for [MoneyTrees](https://moneytrees.ai): trading signals for meme coins, stocks and prediction markets.

Go 1.21 or newer. Standard library only.

```bash
go get github.com/CesarBenavides777/moneytrees-agent-tools/go
```

```go
import moneytrees "github.com/CesarBenavides777/moneytrees-agent-tools/go"

client := moneytrees.New()
ctx := context.Background()

movers, err := client.Movers(ctx, 5)
bonk, err := client.Ticker(ctx, "BONK")
page, err := client.Signals(ctx, moneytrees.SignalsQuery{Symbol: "BONK", Limit: 20})

err = client.AllSignals(ctx, moneytrees.SignalsQuery{Symbol: "BONK"}, func(s moneytrees.Signal) bool {
	fmt.Println(s.Source, s.Content)
	return true
})

responses, err := client.Batch(ctx, "/api/v1/tickers/BONK", "/api/v1/tickers/WIF")
hits, err := client.SearchDocs(ctx, "rate limits")
tools, err := client.ListTools(ctx, moneytrees.DocsServer)
```

`New()` reads `MONEYTREES_BASE_URL` and `MONEYTREES_TOKEN`. You can also build a `&moneytrees.Client{...}` directly.

- `APIKey` is an OAuth access token. Only `Me` and `AccountServer` need it. See [auth.md](https://moneytrees.ai/auth.md).
- `Sandbox: true` sends REST reads to `/api/v1/sandbox`. `Ask`, `Me` and MCP are not affected.

Sandbox writes, fixture data only:

```go
order, err := client.CreateSandboxOrder(ctx, map[string]any{"symbol": "BONK", "side": "buy", "quantity": 1000}, "")
job, err := client.CreateSandboxBacktest(ctx, map[string]any{"symbol": "BONK"})
status, err := client.SandboxJob(ctx, job.ID)
```

An empty idempotency key gets a random one. Pass the same key when you retry.

Every failure is a `*moneytrees.Error` with `Status`, `Code`, `DocsURL` and `URL`. Use `errors.As`.

MoneyTrees data is market information, not financial advice.

Source: https://github.com/CesarBenavides777/moneytrees-agent-tools (MIT)
