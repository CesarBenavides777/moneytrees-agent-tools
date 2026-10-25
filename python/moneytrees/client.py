from __future__ import annotations

import itertools
import json
import os
import uuid
from typing import Any, Dict, Iterator, List, Optional, Union
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

VERSION = "0.1.0"
DEFAULT_BASE_URL = "https://moneytrees.ai"

Json = Dict[str, Any]


class MoneyTreesError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        code: Optional[str] = None,
        docs_url: Optional[str] = None,
        url: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.docs_url = docs_url
        self.url = url


class _Response:
    def __init__(self, status: int, headers: Any, body: bytes) -> None:
        self.status = status
        self.headers = headers
        self.body = body

    def json(self) -> Any:
        return json.loads(self.body) if self.body else {}


def _parse_event_stream(text: str) -> Any:
    last = None
    for event in text.replace("\r\n", "\n").split("\n\n"):
        data = "\n".join(line[5:].lstrip() for line in event.split("\n") if line.startswith("data:"))
        if data:
            last = json.loads(data)
    return last


def tool_text(result: Json) -> str:
    parts = result.get("content") or []
    return "\n".join(p.get("text", "") if p.get("type") == "text" else json.dumps(p) for p in parts)


class MoneyTrees:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        sandbox: bool = False,
        timeout: float = 30.0,
    ) -> None:
        self.api_key = api_key or os.environ.get("MONEYTREES_TOKEN") or None
        self.base_url = (base_url or os.environ.get("MONEYTREES_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.sandbox = sandbox
        self.timeout = timeout
        self._rpc_ids = itertools.count(1)

    def _api(self, path: str, sandbox: Optional[bool] = None) -> str:
        use_sandbox = self.sandbox if sandbox is None else sandbox
        return "/api/v1" + ("/sandbox" if use_sandbox else "") + path

    def _send(
        self,
        path: str,
        *,
        method: str = "GET",
        query: Optional[Dict[str, Any]] = None,
        body: Any = None,
        headers: Optional[Dict[str, str]] = None,
        auth: bool = False,
    ) -> _Response:
        url = self.base_url + path
        params = {k: v for k, v in (query or {}).items() if v is not None and v != ""}
        if params:
            url += "?" + urlencode(params)
        all_headers = {"Accept": "application/json", "User-Agent": "moneytrees-python/" + VERSION}
        all_headers.update(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            all_headers["Content-Type"] = "application/json"
        if auth:
            if not self.api_key:
                raise MoneyTreesError(
                    f"{path} needs an OAuth access token. Pass api_key or set MONEYTREES_TOKEN. "
                    f"See {self.base_url}/auth.md",
                    code="missing_token",
                    url=url,
                )
            all_headers["Authorization"] = "Bearer " + self.api_key

        request = Request(url, data=data, headers=all_headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return _Response(response.status, response.headers, response.read())
        except HTTPError as error:
            raw = error.read()
            try:
                envelope = json.loads(raw).get("error") or {}
            except (ValueError, AttributeError):
                envelope = {}
            raise MoneyTreesError(
                envelope.get("message") or f"{url} answered {error.code}",
                status=error.code,
                code=envelope.get("code"),
                docs_url=envelope.get("docs_url"),
                url=url,
            ) from None
        except URLError as error:
            raise MoneyTreesError(f"Could not reach {url}: {error.reason}", code="network_error", url=url) from None

    def _json(self, path: str, **kwargs: Any) -> Any:
        response = self._send(path, **kwargs)
        try:
            return response.json()
        except ValueError:
            raise MoneyTreesError(f"{path} did not answer JSON", status=response.status, code="invalid_json") from None

    def index(self) -> Json:
        return self._json(self._api(""))

    def movers(self, limit: Optional[int] = None) -> Json:
        return self._json(self._api("/movers"), query={"limit": limit})

    def search_tickers(self, q: str) -> List[Json]:
        return self._json(self._api("/tickers"), query={"q": q})["results"]

    def ticker(self, symbol: str) -> Json:
        return self._json(self._api("/tickers/" + quote(symbol, safe="")))

    def signals(
        self,
        symbol: Optional[str] = None,
        source: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Json:
        query = {"symbol": symbol, "source": source, "limit": limit, "cursor": cursor}
        return self._json(self._api("/signals"), query=query)

    def iter_signals(
        self, symbol: Optional[str] = None, source: Optional[str] = None, limit: Optional[int] = None
    ) -> Iterator[Json]:
        cursor = None
        while True:
            page = self.signals(symbol=symbol, source=source, limit=limit, cursor=cursor)
            yield from page["data"]
            cursor = page.get("nextCursor")
            if not cursor:
                return

    def batch(self, requests: List[Union[str, Json]]) -> List[Json]:
        items = [{"method": "GET", "path": r} if isinstance(r, str) else {"method": "GET", **r} for r in requests]
        return self._json(self._api("/batch"), method="POST", body={"requests": items})["responses"]

    def me(self) -> Json:
        return self._json("/api/v1/me", auth=True)

    def create_sandbox_order(self, order: Json, idempotency_key: Optional[str] = None) -> Json:
        headers = {"Idempotency-Key": idempotency_key or str(uuid.uuid4())}
        return self._json(self._api("/orders", sandbox=True), method="POST", body=order, headers=headers)

    def create_sandbox_backtest(self, params: Json) -> Json:
        response = self._send(self._api("/backtests", sandbox=True), method="POST", body=params)
        body = response.json()
        location = response.headers.get("Location") or ""
        return {**body, "id": body.get("id") or location.rsplit("/", 1)[-1], "location": location}

    def sandbox_job(self, job_id: str) -> Json:
        return self._json(self._api("/jobs/" + quote(job_id, safe=""), sandbox=True))

    def ask(self, text: str) -> Json:
        return self._json("/ask", method="POST", body={"query": {"text": text}})

    def _rpc(self, server: str, method: str, params: Optional[Json] = None) -> Any:
        path = "/api/mcp/docs" if server == "docs" else "/api/mcp"
        message: Json = {"jsonrpc": "2.0", "id": next(self._rpc_ids), "method": method}
        if params is not None:
            message["params"] = params
        response = self._send(
            path,
            method="POST",
            body=message,
            headers={"Accept": "application/json, text/event-stream"},
            auth=server == "account",
        )
        text = response.body.decode()
        is_stream = "text/event-stream" in (response.headers.get("Content-Type") or "")
        answer = _parse_event_stream(text) if is_stream else json.loads(text)
        if answer.get("error"):
            error = answer["error"]
            raise MoneyTreesError(error.get("message", "MCP error"), code=str(error.get("code")), url=self.base_url + path)
        return answer.get("result")

    def list_tools(self, server: str = "docs") -> List[Json]:
        return self._rpc(server, "tools/list")["tools"]

    def call_tool(self, name: str, arguments: Optional[Json] = None, server: str = "docs") -> Json:
        return self._rpc(server, "tools/call", {"name": name, "arguments": arguments or {}})

    def search_docs(self, query: str, limit: Optional[int] = None) -> Json:
        args: Json = {"query": query}
        if limit is not None:
            args["limit"] = limit
        return self.call_tool("search_docs", args)

    def read_doc(self, path: str) -> Json:
        return self.call_tool("read_doc", {"path": path})

    def list_docs(self) -> Json:
        return self.call_tool("list_docs", {})
