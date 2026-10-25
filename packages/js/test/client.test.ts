import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { MoneyTrees, MoneyTreesError } from "../src/index.ts";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (req: Seen, res: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let seen: Seen[] = [];
let handler: Handler = (_req, res) => res.writeHead(500).end();

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res
    .writeHead(status, { "Content-Type": "application/json", ...headers })
    .end(JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const entry = { method: req.method!, url: req.url!, headers: req.headers, body };
      seen.push(entry);
      handler(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  seen = [];
});

test("sandbox reads go under /api/v1/sandbox with the query string", async () => {
  handler = (_req, res) => json(res, 200, { asOf: "now", gainers: [], losers: [] });
  await new MoneyTrees({ baseUrl, sandbox: true }).movers({ limit: 3 });
  expect(seen[0]!.url).toBe("/api/v1/sandbox/movers?limit=3");
});

test("an error envelope becomes a MoneyTreesError with code and docs_url", async () => {
  handler = (_req, res) =>
    json(res, 404, {
      error: {
        code: "ticker_not_found",
        message: "No ticker NOPE",
        docs_url: "https://moneytrees.ai/docs/errors",
      },
    });
  const error = await new MoneyTrees({ baseUrl }).ticker("NOPE").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(MoneyTreesError);
  expect(error).toMatchObject({
    status: 404,
    code: "ticker_not_found",
    message: "No ticker NOPE",
    docsUrl: "https://moneytrees.ai/docs/errors",
  });
  expect(seen[0]!.url).toBe("/api/v1/tickers/NOPE");
});

test("me() sends the bearer token, and refuses to send a request without one", async () => {
  handler = (_req, res) => json(res, 200, { plan: "pro" });
  await new MoneyTrees({ baseUrl, apiKey: "tok_123" }).me();
  expect(seen[0]!.url).toBe("/api/v1/me");
  expect(seen[0]!.headers.authorization).toBe("Bearer tok_123");

  const saved = process.env.MONEYTREES_TOKEN;
  delete process.env.MONEYTREES_TOKEN;
  const error = await new MoneyTrees({ baseUrl }).me().catch((e: unknown) => e);
  if (saved !== undefined) process.env.MONEYTREES_TOKEN = saved;
  expect(error).toMatchObject({ code: "missing_token" });
  expect(seen).toHaveLength(1);
});

test("allSignals follows nextCursor until it is null", async () => {
  handler = (req, res) => {
    const cursor = new URL(req.url, baseUrl).searchParams.get("cursor");
    if (!cursor) json(res, 200, { data: [{ id: "a" }], nextCursor: "c2" });
    else json(res, 200, { data: [{ id: "b" }], nextCursor: null });
  };
  const ids: string[] = [];
  for await (const signal of new MoneyTrees({ baseUrl }).allSignals({ symbol: "BONK" }))
    ids.push(signal.id);
  expect(ids).toEqual(["a", "b"]);
  expect(seen.map((s) => s.url)).toEqual([
    "/api/v1/signals?symbol=BONK",
    "/api/v1/signals?symbol=BONK&cursor=c2",
  ]);
});

test("sandbox orders carry an Idempotency-Key, backtests return the job id from Location", async () => {
  handler = (req, res) => {
    if (req.url.endsWith("/orders")) json(res, 201, { id: "ord_1" });
    else json(res, 202, { status: "queued" }, { Location: "/api/v1/sandbox/jobs/job_9" });
  };
  const client = new MoneyTrees({ baseUrl });
  await client.createSandboxOrder({ symbol: "BONK" }, { idempotencyKey: "key-1" });
  expect(seen[0]!.url).toBe("/api/v1/sandbox/orders");
  expect(seen[0]!.headers["idempotency-key"]).toBe("key-1");

  const job = await client.createSandboxBacktest({ symbol: "BONK" });
  expect(job.id).toBe("job_9");
  expect(job.location).toBe("/api/v1/sandbox/jobs/job_9");
});

test("docs MCP replies sent as an event stream are parsed, and JSON-RPC errors throw", async () => {
  handler = (req, res) => {
    const rpc = JSON.parse(req.body) as { id: number; method: string };
    if (rpc.method === "tools/list") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "search_docs" }] } })}\n\n`,
      );
    } else {
      json(res, 200, {
        jsonrpc: "2.0",
        id: rpc.id,
        error: { code: -32602, message: "Unknown tool" },
      });
    }
  };
  const client = new MoneyTrees({ baseUrl });
  expect((await client.mcp.tools()).map((t) => t.name)).toEqual(["search_docs"]);
  expect(seen[0]!.url).toBe("/api/mcp/docs");
  await expect(client.mcp.call("nope")).rejects.toMatchObject({
    code: "-32602",
    message: "Unknown tool",
  });
});

test("the built CLI passes --json arguments to the tool and prints its text", async () => {
  handler = (req, res) => {
    const rpc = JSON.parse(req.body) as { id: number; params: unknown };
    json(res, 200, {
      jsonrpc: "2.0",
      id: rpc.id,
      result: { content: [{ type: "text", text: "found 2 pages" }] },
    });
  };
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const stdout = await new Promise<string>((resolve, reject) =>
    execFile(
      "node",
      [cli, "mcp", "call", "search_docs", "--json", '{"query":"alerts"}'],
      { env: { ...process.env, MONEYTREES_BASE_URL: baseUrl } },
      (error, out) => (error ? reject(error) : resolve(out)),
    ),
  );
  expect(stdout.trim()).toBe("found 2 pages");
  expect(JSON.parse(seen[0]!.body).params).toEqual({
    name: "search_docs",
    arguments: { query: "alerts" },
  });
});
