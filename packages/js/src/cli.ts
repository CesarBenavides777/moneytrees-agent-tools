#!/usr/bin/env node
import {
  MoneyTrees,
  MoneyTreesError,
  VERSION,
  toolText,
  type Mover,
  type McpServer,
  type McpToolResult,
} from "./index.js";

const HELP = `moneytrees ${VERSION}: market data and signals from https://moneytrees.ai

Usage: moneytrees <command> [options]

Commands:
  movers [--limit n]                 Top gainers and losers over 24h
  ticker <symbol>                    One ticker: price, 24h change, market cap, volume
  search <query>                     Find tickers by symbol or name
  signals [--symbol s] [--source s]  The signal feed, newest first
          [--limit n] [--cursor c]
  batch <path>...                    Several GET reads in one request
  ask "<question>"                   Ask about MoneyTrees in plain words
  docs search <query>                Search the docs
  docs read <path>                   Read one doc page
  docs list                          List the doc pages
  mcp tools [--account]              List MCP tools (docs server by default)
  mcp call <tool> --json '{...}'     Call an MCP tool with JSON arguments
  me                                 Your account summary (needs MONEYTREES_TOKEN)
  index                              Every API endpoint

Options:
  --json             Print the raw JSON response
  --sandbox          Use fixture data from /api/v1/sandbox
  --account          Use the account MCP server (OAuth token, Pro plan)
  --base-url <url>   Talk to another origin (or set MONEYTREES_BASE_URL)
  -h, --help         Show this help
  -v, --version      Show the version

MoneyTrees data is market information, not financial advice.`;

interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
}

const VALUE_FLAGS = new Set(["limit", "symbol", "source", "cursor", "base-url", "args"]);

function parse(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h") flags.help = true;
    else if (arg === "-v") flags.version = true;
    else if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      const next = argv[i + 1];
      if (inline !== undefined) flags[name] = inline;
      else if (VALUE_FLAGS.has(name) && next !== undefined) flags[name] = argv[++i]!;
      else if (name === "json" && next !== undefined && /^\s*[[{]/.test(next))
        flags.args = argv[++i]!;
      else flags[name] = true;
    } else positional.push(arg);
  }
  return { positional, flags };
}

function str(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function int(value: string | true | undefined): number | undefined {
  const text = str(value);
  if (text === undefined) return undefined;
  const n = Number.parseInt(text, 10);
  if (Number.isNaN(n))
    throw new MoneyTreesError(`Expected a number, got "${text}"`, { code: "bad_argument" });
  return n;
}

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows
    .map((row) =>
      row
        .map((cell, col) => cell.padEnd(widths[col]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

function moverRows(movers: Mover[]): string[][] {
  return movers.map((m) => [
    m.symbol,
    m.name,
    money(m.price),
    pct(m.change24hPct),
    money(m.volume24h),
  ]);
}

function needArg(value: string | undefined, usage: string): string {
  if (!value) throw new MoneyTreesError(`Usage: moneytrees ${usage}`, { code: "bad_argument" });
  return value;
}

async function run(argv: string[]): Promise<string> {
  const { positional, flags } = parse(argv);
  const [command, ...rest] = positional;
  if (flags.version) return VERSION;
  if (flags.help || !command || command === "help") return HELP;

  const client = new MoneyTrees({
    sandbox: flags.sandbox === true,
    baseUrl: str(flags["base-url"]),
  });
  const raw = flags.json === true;
  const out = (value: unknown) => JSON.stringify(value, null, 2);
  const server: McpServer = flags.account === true ? "account" : "docs";

  switch (command) {
    case "movers": {
      const movers = await client.movers({ limit: int(flags.limit) });
      if (raw) return out(movers);
      const head = ["SYMBOL", "NAME", "PRICE", "24H", "VOLUME"];
      return [
        `Gainers (as of ${movers.asOf})`,
        table([head, ...moverRows(movers.gainers)]),
        "",
        "Losers",
        table([head, ...moverRows(movers.losers)]),
      ].join("\n");
    }
    case "ticker": {
      const t = await client.ticker(needArg(rest[0], "ticker <symbol>"));
      if (raw) return out(t);
      return [
        `${t.symbol}  ${t.name} (${t.type})`,
        `price       ${money(t.price)}`,
        `24h         ${pct(t.change24hPct)}`,
        `market cap  ${money(t.marketCap)}`,
        `volume 24h  ${money(t.volume24h)}`,
        `updated     ${t.updatedAt}${t.stale ? "  (stale)" : ""}`,
      ].join("\n");
    }
    case "search": {
      const results = await client.searchTickers(needArg(rest.join(" "), "search <query>"));
      if (raw) return out({ results });
      if (results.length === 0) return "No tickers found.";
      return table([["SYMBOL", "NAME", "TYPE"], ...results.map((r) => [r.symbol, r.name, r.type])]);
    }
    case "signals": {
      const page = await client.signals({
        symbol: str(flags.symbol),
        source: str(flags.source),
        limit: int(flags.limit),
        cursor: str(flags.cursor),
      });
      if (raw) return out(page);
      const lines = page.data.map((s) => {
        const text = s.content.replace(/\s+/g, " ").slice(0, 160);
        return `${s.at}  ${s.source}  ${s.tickers.join(",")}\n  ${text}${s.url ? `\n  ${s.url}` : ""}`;
      });
      if (page.nextCursor) lines.push(`\nMore: --cursor ${page.nextCursor}`);
      return lines.length ? lines.join("\n") : "No signals.";
    }
    case "batch": {
      if (rest.length === 0) needArg(undefined, "batch <path>...");
      return out(await client.batch(rest));
    }
    case "ask": {
      const answer = await client.ask(needArg(rest.join(" "), 'ask "<question>"'));
      if (raw) return out(answer);
      const results = answer.results as Array<Record<string, unknown>> | undefined;
      if (typeof answer.answer === "string") return answer.answer;
      if (!Array.isArray(results)) return out(answer);
      return results
        .map((r) =>
          [r.name ?? r.title, r.url, r.description ?? r.snippet].filter(Boolean).join("\n  "),
        )
        .join("\n\n");
    }
    case "docs": {
      const [sub, ...words] = rest;
      let result: McpToolResult | undefined;
      if (sub === "search")
        result = await client.docs.search(needArg(words.join(" "), "docs search <query>"));
      else if (sub === "read")
        result = await client.docs.read(needArg(words[0], "docs read <path>"));
      else if (sub === "list") result = await client.docs.list();
      else needArg(undefined, "docs <search|read|list>");
      return raw ? out(result) : toolText(result!);
    }
    case "mcp": {
      const [sub, tool] = rest;
      if (sub === "tools") {
        const tools = await client.mcp.tools(server);
        if (raw) return out(tools);
        return tools.map((t) => `${t.name}\n  ${(t.description ?? "").split("\n")[0]}`).join("\n");
      }
      if (sub === "call") {
        const name = needArg(tool, "mcp call <tool> --json '{...}'");
        const text = str(flags.args) ?? "{}";
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new MoneyTreesError(`--json is not valid JSON: ${text}`, { code: "bad_argument" });
        }
        const result = await client.mcp.call(name, args, server);
        if (result.isError) process.exitCode = 1;
        return raw ? out(result) : toolText(result);
      }
      return needArg(undefined, "mcp <tools|call>");
    }
    case "me":
      return out(await client.me());
    case "index":
      return out(await client.index());
    default:
      throw new MoneyTreesError(`Unknown command "${command}". Run moneytrees --help.`, {
        code: "bad_argument",
      });
  }
}

run(process.argv.slice(2)).then(
  (output) => {
    if (output) console.log(output);
  },
  (error: unknown) => {
    if (error instanceof MoneyTreesError) {
      console.error(`moneytrees: ${error.message}${error.code ? ` (${error.code})` : ""}`);
      if (error.docsUrl) console.error(`See ${error.docsUrl}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  },
);
