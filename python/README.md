# moneytrees for Python

Python client for [MoneyTrees](https://moneytrees.ai): trading signals for meme coins, stocks and prediction markets.

Python 3.9 or newer. Standard library only.

```bash
pip install moneytrees
```

```python
from moneytrees import MoneyTrees, MoneyTreesError

mt = MoneyTrees()
movers = mt.movers(limit=5)
bonk = mt.ticker("BONK")
page = mt.signals(symbol="BONK", limit=20)

for signal in mt.iter_signals(symbol="BONK"):
    print(signal["source"], signal["content"])

responses = mt.batch(["/api/v1/tickers/BONK", "/api/v1/tickers/WIF"])
hits = mt.search_docs("rate limits")
tools = mt.list_tools()
```

`MoneyTrees(api_key=None, base_url=None, sandbox=False, timeout=30.0)`

- `api_key` is an OAuth access token. Only `me()` and the account MCP server (`list_tools(server="account")`) need it. It defaults to `MONEYTREES_TOKEN`. See [auth.md](https://moneytrees.ai/auth.md).
- `sandbox=True` sends REST reads to `/api/v1/sandbox`. `ask()`, `me()` and MCP are not affected.
- `MONEYTREES_BASE_URL` changes the origin.

Sandbox writes, fixture data only:

```python
order = mt.create_sandbox_order({"symbol": "BONK", "side": "buy", "quantity": 1000})
job = mt.create_sandbox_backtest({"symbol": "BONK"})
status = mt.sandbox_job(job["id"])
```

Every failure raises `MoneyTreesError` with `status`, `code`, `docs_url` and `url`.

MoneyTrees data is market information, not financial advice.

Source: https://github.com/CesarBenavides777/moneytrees-agent-tools (MIT)
