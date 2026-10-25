import { randomUUID } from "node:crypto";

export const VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://moneytrees.ai";

export interface Mover {
  symbol: string;
  name: string;
  price: number;
  change24hPct: number;
  marketCap: number | null;
  volume24h: number | null;
}

export interface Movers {
  asOf: string;
  gainers: Mover[];
  losers: Mover[];
}

export interface TickerMatch {
  symbol: string;
  name: string;
  type: string;
}

export interface Ticker {
  symbol: string;
  name: string;
  type: string;
  price: number;
  change24hPct: number;
  marketCap: number | null;
  volume24h: number | null;
  updatedAt: string;
  stale: boolean;
}

export interface Signal {
  id: string;
  source: string;
  content: string;
  url: string | null;
  author: string | null;
  sentiment: number | string | null;
  tickers: string[];
  engagement: number | Record<string, number> | null;
  at: string;
}

export interface SignalPage {
  data: Signal[];
  nextCursor: string | null;
}

export interface SignalsQuery {
  symbol?: string;
  source?: string;
  limit?: number;
  cursor?: string;
}

export interface BatchRequest {
  method?: "GET";
  path: string;
}

export interface BatchResponse<T = unknown> {
  status: number;
  body: T;
}

export interface Job {
  id: string;
  location: string;
  [key: string]: unknown;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface McpToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export type McpServer = "docs" | "account";

export interface MoneyTreesOptions {
  /** OAuth access token. Only `me()` and the account MCP server need one. */
  apiKey?: string;
  baseUrl?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class MoneyTreesError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly docsUrl: string | undefined;
  readonly url: string | undefined;

  constructor(
    message: string,
    details: { status?: number; code?: string; docsUrl?: string; url?: string } = {},
  ) {
    super(message);
    this.name = "MoneyTreesError";
    this.status = details.status;
    this.code = details.code;
    this.docsUrl = details.docsUrl;
    this.url = details.url;
  }
}

type Query = Record<string, string | number | undefined>;

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
}

function readEnv(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value ? value : undefined;
}

function parseEventStream(text: string): unknown {
  let last: unknown;
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) last = JSON.parse(data);
  }
  return last;
}

export class MoneyTrees {
  readonly baseUrl: string;
  readonly sandbox: boolean;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private rpcId = 0;

  readonly docs = {
    search: (query: string, options: { limit?: number } = {}) =>
      this.callTool("search_docs", { query, ...options }),
    read: (path: string) => this.callTool("read_doc", { path }),
    list: () => this.callTool("list_docs", {}),
  };

  readonly mcp = {
    tools: (server: McpServer = "docs") => this.listTools(server),
    call: (name: string, args: Record<string, unknown> = {}, server: McpServer = "docs") =>
      this.callTool(name, args, server),
  };

  constructor(options: MoneyTreesOptions = {}) {
    this.baseUrl = (options.baseUrl ?? readEnv("MONEYTREES_BASE_URL") ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.apiKey = options.apiKey ?? readEnv("MONEYTREES_TOKEN");
    this.sandbox = options.sandbox ?? false;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private apiPath(path: string, sandbox = this.sandbox): string {
    return `/api/v1${sandbox ? "/sandbox" : ""}${path}`;
  }

  private async send(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `moneytrees-js/${VERSION}`,
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.auth) {
      if (!this.apiKey) {
        throw new MoneyTreesError(
          `${path} needs an OAuth access token. Pass apiKey or set MONEYTREES_TOKEN. See ${this.baseUrl}/auth.md`,
          { code: "missing_token", url: url.toString() },
        );
      }
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new MoneyTreesError(`Could not reach ${url}: ${(cause as Error).message}`, {
        code: "network_error",
        url: url.toString(),
      });
    }

    if (!response.ok) {
      const text = await response.text();
      let error: { code?: string; message?: string; docs_url?: string } | undefined;
      try {
        error = (JSON.parse(text) as { error?: typeof error }).error;
      } catch {
        error = undefined;
      }
      throw new MoneyTreesError(error?.message ?? `${url} answered ${response.status}`, {
        status: response.status,
        code: error?.code,
        docsUrl: error?.docs_url,
        url: url.toString(),
      });
    }
    return response;
  }

  private async json<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);
    const text = await response.text();
    try {
      return (text ? JSON.parse(text) : {}) as T;
    } catch {
      throw new MoneyTreesError(
        `${path} answered ${response.headers.get("content-type") ?? "no content type"} instead of JSON`,
        { status: response.status, code: "invalid_json" },
      );
    }
  }

  index(): Promise<Record<string, unknown>> {
    return this.json(this.apiPath(""));
  }

  movers(options: { limit?: number } = {}): Promise<Movers> {
    return this.json(this.apiPath("/movers"), { query: { limit: options.limit } });
  }

  async searchTickers(q: string): Promise<TickerMatch[]> {
    const body = await this.json<{ results: TickerMatch[] }>(this.apiPath("/tickers"), {
      query: { q },
    });
    return body.results;
  }

  ticker(symbol: string): Promise<Ticker> {
    return this.json(this.apiPath(`/tickers/${encodeURIComponent(symbol)}`));
  }

  signals(query: SignalsQuery = {}): Promise<SignalPage> {
    return this.json(this.apiPath("/signals"), { query: { ...query } });
  }

  async *allSignals(query: Omit<SignalsQuery, "cursor"> = {}): AsyncGenerator<Signal> {
    let cursor: string | undefined;
    do {
      const page = await this.signals({ ...query, cursor });
      yield* page.data;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async batch<T = unknown>(requests: Array<BatchRequest | string>): Promise<BatchResponse<T>[]> {
    const body = await this.json<{ responses: BatchResponse<T>[] }>(this.apiPath("/batch"), {
      method: "POST",
      body: {
        requests: requests.map((request) =>
          typeof request === "string"
            ? { method: "GET", path: request }
            : { method: "GET", ...request },
        ),
      },
    });
    return body.responses;
  }

  me(): Promise<Record<string, unknown>> {
    return this.json(this.apiPath("", false) + "/me", { auth: true });
  }

  createSandboxOrder(
    order: Record<string, unknown>,
    options: { idempotencyKey?: string } = {},
  ): Promise<Record<string, unknown>> {
    return this.json(this.apiPath("/orders", true), {
      method: "POST",
      body: order,
      headers: { "Idempotency-Key": options.idempotencyKey ?? randomUUID() },
    });
  }

  async createSandboxBacktest(params: Record<string, unknown>): Promise<Job> {
    const response = await this.send(this.apiPath("/backtests", true), {
      method: "POST",
      body: params,
    });
    const text = await response.text();
    const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    const location = response.headers.get("location") ?? "";
    const id = (body.id as string | undefined) ?? location.split("/").pop() ?? "";
    return { ...body, id, location };
  }

  sandboxJob(id: string): Promise<Record<string, unknown>> {
    return this.json(this.apiPath(`/jobs/${encodeURIComponent(id)}`, true));
  }

  ask(text: string): Promise<Record<string, unknown>> {
    return this.json("/ask", { method: "POST", body: { query: { text } } });
  }

  private mcpPath(server: McpServer): string {
    return server === "docs" ? "/api/mcp/docs" : "/api/mcp";
  }

  private async rpc<T>(server: McpServer, method: string, params?: unknown): Promise<T> {
    const response = await this.send(this.mcpPath(server), {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream" },
      body: { jsonrpc: "2.0", id: ++this.rpcId, method, ...(params ? { params } : {}) },
      auth: server === "account",
    });
    const text = await response.text();
    const isStream = (response.headers.get("content-type") ?? "").includes("text/event-stream");
    const answer = (isStream ? parseEventStream(text) : JSON.parse(text)) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (answer?.error) {
      throw new MoneyTreesError(answer.error.message, {
        code: String(answer.error.code),
        url: this.baseUrl + this.mcpPath(server),
      });
    }
    return answer.result as T;
  }

  async listTools(server: McpServer = "docs"): Promise<McpTool[]> {
    const result = await this.rpc<{ tools: McpTool[] }>(server, "tools/list");
    return result.tools;
  }

  callTool(
    name: string,
    args: Record<string, unknown> = {},
    server: McpServer = "docs",
  ): Promise<McpToolResult> {
    return this.rpc(server, "tools/call", { name, arguments: args });
  }
}

export function toolText(result: McpToolResult): string {
  return (result.content ?? [])
    .map((part) => (part.type === "text" ? (part.text ?? "") : JSON.stringify(part)))
    .join("\n");
}
