import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from moneytrees import MoneyTrees, MoneyTreesError

SEEN = []
ROUTE = {"handler": None}


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode() if length else ""
        SEEN.append({"method": self.command, "path": self.path, "headers": dict(self.headers), "body": body})
        status, payload, headers = ROUTE["handler"](self.path, body)
        raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", headers.pop("Content-Type", "application/json"))
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    do_GET = _handle
    do_POST = _handle


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        SEEN.clear()

    def test_sandbox_reads_go_under_sandbox_path(self):
        ROUTE["handler"] = lambda path, body: (200, {"asOf": "now", "gainers": [], "losers": []}, {})
        MoneyTrees(base_url=self.base, sandbox=True).movers(limit=3)
        self.assertEqual(SEEN[0]["path"], "/api/v1/sandbox/movers?limit=3")

    def test_error_envelope_becomes_moneytrees_error(self):
        envelope = {"error": {"code": "ticker_not_found", "message": "No ticker NOPE", "docs_url": "https://moneytrees.ai/docs/errors"}}
        ROUTE["handler"] = lambda path, body: (404, envelope, {})
        with self.assertRaises(MoneyTreesError) as caught:
            MoneyTrees(base_url=self.base).ticker("NOPE")
        error = caught.exception
        self.assertEqual((error.status, error.code, error.message), (404, "ticker_not_found", "No ticker NOPE"))
        self.assertEqual(error.docs_url, "https://moneytrees.ai/docs/errors")

    def test_me_sends_bearer_and_refuses_without_token(self):
        ROUTE["handler"] = lambda path, body: (200, {"plan": "pro"}, {})
        MoneyTrees(api_key="tok_123", base_url=self.base).me()
        self.assertEqual(SEEN[0]["path"], "/api/v1/me")
        self.assertEqual(SEEN[0]["headers"]["Authorization"], "Bearer tok_123")

        saved = os.environ.pop("MONEYTREES_TOKEN", None)
        try:
            with self.assertRaises(MoneyTreesError) as caught:
                MoneyTrees(base_url=self.base).me()
        finally:
            if saved is not None:
                os.environ["MONEYTREES_TOKEN"] = saved
        self.assertEqual(caught.exception.code, "missing_token")
        self.assertEqual(len(SEEN), 1)

    def test_iter_signals_follows_next_cursor(self):
        def handler(path, body):
            cursor = parse_qs(urlparse(path).query).get("cursor")
            if not cursor:
                return 200, {"data": [{"id": "a"}], "nextCursor": "c2"}, {}
            return 200, {"data": [{"id": "b"}], "nextCursor": None}, {}

        ROUTE["handler"] = handler
        ids = [s["id"] for s in MoneyTrees(base_url=self.base).iter_signals(symbol="BONK")]
        self.assertEqual(ids, ["a", "b"])
        self.assertEqual([s["path"] for s in SEEN], ["/api/v1/signals?symbol=BONK", "/api/v1/signals?symbol=BONK&cursor=c2"])

    def test_sandbox_order_and_backtest(self):
        def handler(path, body):
            if path.endswith("/orders"):
                return 201, {"id": "ord_1"}, {}
            return 202, {"status": "queued"}, {"Location": "/api/v1/sandbox/jobs/job_9"}

        ROUTE["handler"] = handler
        client = MoneyTrees(base_url=self.base)
        client.create_sandbox_order({"symbol": "BONK"}, idempotency_key="key-1")
        self.assertEqual(SEEN[0]["path"], "/api/v1/sandbox/orders")
        self.assertEqual(SEEN[0]["headers"]["Idempotency-Key"], "key-1")
        job = client.create_sandbox_backtest({"symbol": "BONK"})
        self.assertEqual((job["id"], job["location"]), ("job_9", "/api/v1/sandbox/jobs/job_9"))

    def test_docs_mcp_event_stream_and_rpc_error(self):
        def handler(path, body):
            rpc = json.loads(body)
            if rpc["method"] == "tools/list":
                result = {"jsonrpc": "2.0", "id": rpc["id"], "result": {"tools": [{"name": "search_docs"}]}}
                return 200, ("event: message\ndata: %s\n\n" % json.dumps(result)).encode(), {"Content-Type": "text/event-stream"}
            return 200, {"jsonrpc": "2.0", "id": rpc["id"], "error": {"code": -32602, "message": "Unknown tool"}}, {}

        ROUTE["handler"] = handler
        client = MoneyTrees(base_url=self.base)
        self.assertEqual([t["name"] for t in client.list_tools()], ["search_docs"])
        self.assertEqual(SEEN[0]["path"], "/api/mcp/docs")
        with self.assertRaises(MoneyTreesError) as caught:
            client.call_tool("nope")
        self.assertEqual(caught.exception.code, "-32602")


if __name__ == "__main__":
    unittest.main()
