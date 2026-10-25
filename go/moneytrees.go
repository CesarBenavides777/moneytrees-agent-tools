// Package moneytrees is a client for MoneyTrees (https://moneytrees.ai): market movers,
// ticker lookup, the signal feed, the sandbox, NLWeb /ask and the MCP servers.
package moneytrees

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const Version = "0.1.0"

const DefaultBaseURL = "https://moneytrees.ai"

type Error struct {
	Message string
	Status  int
	Code    string
	DocsURL string
	URL     string
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("moneytrees: %s (%s)", e.Message, e.Code)
	}
	return "moneytrees: " + e.Message
}

type Mover struct {
	Symbol       string   `json:"symbol"`
	Name         string   `json:"name"`
	Price        float64  `json:"price"`
	Change24hPct float64  `json:"change24hPct"`
	MarketCap    *float64 `json:"marketCap"`
	Volume24h    *float64 `json:"volume24h"`
}

type Movers struct {
	AsOf    string  `json:"asOf"`
	Gainers []Mover `json:"gainers"`
	Losers  []Mover `json:"losers"`
}

type TickerMatch struct {
	Symbol string `json:"symbol"`
	Name   string `json:"name"`
	Type   string `json:"type"`
}

type Ticker struct {
	Symbol       string   `json:"symbol"`
	Name         string   `json:"name"`
	Type         string   `json:"type"`
	Price        float64  `json:"price"`
	Change24hPct float64  `json:"change24hPct"`
	MarketCap    *float64 `json:"marketCap"`
	Volume24h    *float64 `json:"volume24h"`
	UpdatedAt    string   `json:"updatedAt"`
	Stale        bool     `json:"stale"`
}

type Signal struct {
	ID         string          `json:"id"`
	Source     string          `json:"source"`
	Content    string          `json:"content"`
	URL        string          `json:"url"`
	Author     string          `json:"author"`
	Sentiment  json.RawMessage `json:"sentiment"`
	Tickers    []string        `json:"tickers"`
	Engagement json.RawMessage `json:"engagement"`
	At         string          `json:"at"`
}

type SignalPage struct {
	Data       []Signal `json:"data"`
	NextCursor *string  `json:"nextCursor"`
}

type SignalsQuery struct {
	Symbol string
	Source string
	Limit  int
	Cursor string
}

type BatchRequest struct {
	Method string `json:"method"`
	Path   string `json:"path"`
}

type BatchResponse struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

type Job struct {
	ID       string
	Location string
	Body     map[string]any
}

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type ToolResult struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	StructuredContent json.RawMessage `json:"structuredContent"`
	IsError           bool            `json:"isError"`
}

func (r *ToolResult) Text() string {
	parts := make([]string, 0, len(r.Content))
	for _, part := range r.Content {
		parts = append(parts, part.Text)
	}
	return strings.Join(parts, "\n")
}

type Server string

const (
	DocsServer    Server = "docs"
	AccountServer Server = "account"
)

type Client struct {
	BaseURL    string
	APIKey     string
	Sandbox    bool
	HTTPClient *http.Client
	rpcID      atomic.Int64
}

func New() *Client {
	return &Client{BaseURL: os.Getenv("MONEYTREES_BASE_URL"), APIKey: os.Getenv("MONEYTREES_TOKEN")}
}

func (c *Client) base() string {
	if c.BaseURL == "" {
		return DefaultBaseURL
	}
	return strings.TrimRight(c.BaseURL, "/")
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func (c *Client) api(path string, sandbox bool) string {
	if sandbox {
		return "/api/v1/sandbox" + path
	}
	return "/api/v1" + path
}

type call struct {
	method  string
	path    string
	query   url.Values
	body    any
	headers map[string]string
	auth    bool
}

func (c *Client) send(ctx context.Context, r call) (*http.Response, []byte, error) {
	target := c.base() + r.path
	if len(r.query) > 0 {
		target += "?" + r.query.Encode()
	}
	var reader io.Reader
	if r.body != nil {
		encoded, err := json.Marshal(r.body)
		if err != nil {
			return nil, nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	method := r.method
	if method == "" {
		method = http.MethodGet
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "moneytrees-go/"+Version)
	if r.body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range r.headers {
		req.Header.Set(key, value)
	}
	if r.auth {
		if c.APIKey == "" {
			return nil, nil, &Error{
				Message: r.path + " needs an OAuth access token. Set APIKey or MONEYTREES_TOKEN. See " + c.base() + "/auth.md",
				Code:    "missing_token",
				URL:     target,
			}
		}
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, nil, &Error{Message: err.Error(), Code: "network_error", URL: target}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode >= 400 {
		var envelope struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
				DocsURL string `json:"docs_url"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &envelope)
		message := envelope.Error.Message
		if message == "" {
			message = fmt.Sprintf("%s answered %d", target, resp.StatusCode)
		}
		return nil, nil, &Error{
			Message: message,
			Status:  resp.StatusCode,
			Code:    envelope.Error.Code,
			DocsURL: envelope.Error.DocsURL,
			URL:     target,
		}
	}
	return resp, raw, nil
}

func (c *Client) do(ctx context.Context, r call, out any) error {
	_, raw, err := c.send(ctx, r)
	if err != nil {
		return err
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &Error{Message: r.path + " did not answer JSON: " + err.Error(), Code: "invalid_json"}
	}
	return nil
}

func (c *Client) Index(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	return out, c.do(ctx, call{path: c.api("", c.Sandbox)}, &out)
}

func (c *Client) Movers(ctx context.Context, limit int) (*Movers, error) {
	query := url.Values{}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	var out Movers
	return &out, c.do(ctx, call{path: c.api("/movers", c.Sandbox), query: query}, &out)
}

func (c *Client) SearchTickers(ctx context.Context, q string) ([]TickerMatch, error) {
	var out struct {
		Results []TickerMatch `json:"results"`
	}
	err := c.do(ctx, call{path: c.api("/tickers", c.Sandbox), query: url.Values{"q": {q}}}, &out)
	return out.Results, err
}

func (c *Client) Ticker(ctx context.Context, symbol string) (*Ticker, error) {
	var out Ticker
	return &out, c.do(ctx, call{path: c.api("/tickers/"+url.PathEscape(symbol), c.Sandbox)}, &out)
}

func (c *Client) Signals(ctx context.Context, q SignalsQuery) (*SignalPage, error) {
	query := url.Values{}
	for key, value := range map[string]string{"symbol": q.Symbol, "source": q.Source, "cursor": q.Cursor} {
		if value != "" {
			query.Set(key, value)
		}
	}
	if q.Limit > 0 {
		query.Set("limit", strconv.Itoa(q.Limit))
	}
	var out SignalPage
	return &out, c.do(ctx, call{path: c.api("/signals", c.Sandbox), query: query}, &out)
}

func (c *Client) AllSignals(ctx context.Context, q SignalsQuery, fn func(Signal) bool) error {
	for {
		page, err := c.Signals(ctx, q)
		if err != nil {
			return err
		}
		for _, signal := range page.Data {
			if !fn(signal) {
				return nil
			}
		}
		if page.NextCursor == nil || *page.NextCursor == "" {
			return nil
		}
		q.Cursor = *page.NextCursor
	}
}

func (c *Client) Batch(ctx context.Context, paths ...string) ([]BatchResponse, error) {
	requests := make([]BatchRequest, len(paths))
	for i, path := range paths {
		requests[i] = BatchRequest{Method: http.MethodGet, Path: path}
	}
	var out struct {
		Responses []BatchResponse `json:"responses"`
	}
	err := c.do(ctx, call{method: http.MethodPost, path: c.api("/batch", c.Sandbox), body: map[string]any{"requests": requests}}, &out)
	return out.Responses, err
}

func (c *Client) Me(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	return out, c.do(ctx, call{path: "/api/v1/me", auth: true}, &out)
}

func (c *Client) CreateSandboxOrder(ctx context.Context, order map[string]any, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = randomKey()
	}
	var out map[string]any
	err := c.do(ctx, call{
		method:  http.MethodPost,
		path:    c.api("/orders", true),
		body:    order,
		headers: map[string]string{"Idempotency-Key": idempotencyKey},
	}, &out)
	return out, err
}

func (c *Client) CreateSandboxBacktest(ctx context.Context, params map[string]any) (*Job, error) {
	resp, raw, err := c.send(ctx, call{method: http.MethodPost, path: c.api("/backtests", true), body: params})
	if err != nil {
		return nil, err
	}
	job := &Job{Location: resp.Header.Get("Location"), Body: map[string]any{}}
	_ = json.Unmarshal(raw, &job.Body)
	if id, ok := job.Body["id"].(string); ok && id != "" {
		job.ID = id
	} else {
		job.ID = job.Location[strings.LastIndex(job.Location, "/")+1:]
	}
	return job, nil
}

func (c *Client) SandboxJob(ctx context.Context, id string) (map[string]any, error) {
	var out map[string]any
	return out, c.do(ctx, call{path: c.api("/jobs/"+url.PathEscape(id), true)}, &out)
}

func (c *Client) Ask(ctx context.Context, text string) (map[string]any, error) {
	var out map[string]any
	body := map[string]any{"query": map[string]string{"text": text}}
	return out, c.do(ctx, call{method: http.MethodPost, path: "/ask", body: body}, &out)
}

func (c *Client) rpc(ctx context.Context, server Server, method string, params any, out any) error {
	path := "/api/mcp/docs"
	if server == AccountServer {
		path = "/api/mcp"
	}
	message := map[string]any{"jsonrpc": "2.0", "id": c.rpcID.Add(1), "method": method}
	if params != nil {
		message["params"] = params
	}
	resp, raw, err := c.send(ctx, call{
		method:  http.MethodPost,
		path:    path,
		body:    message,
		headers: map[string]string{"Accept": "application/json, text/event-stream"},
		auth:    server == AccountServer,
	})
	if err != nil {
		return err
	}
	if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		raw = lastEventData(raw)
	}
	var answer struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return &Error{Message: "MCP reply is not JSON-RPC: " + err.Error(), Code: "invalid_json", URL: c.base() + path}
	}
	if answer.Error != nil {
		return &Error{Message: answer.Error.Message, Code: strconv.Itoa(answer.Error.Code), URL: c.base() + path}
	}
	return json.Unmarshal(answer.Result, out)
}

func lastEventData(stream []byte) []byte {
	var last []byte
	normalized := strings.ReplaceAll(string(stream), "\r\n", "\n")
	for _, event := range strings.Split(normalized, "\n\n") {
		var lines []string
		for _, line := range strings.Split(event, "\n") {
			if strings.HasPrefix(line, "data:") {
				lines = append(lines, strings.TrimLeft(line[5:], " "))
			}
		}
		if len(lines) > 0 {
			last = []byte(strings.Join(lines, "\n"))
		}
	}
	return last
}

func (c *Client) ListTools(ctx context.Context, server Server) ([]Tool, error) {
	var out struct {
		Tools []Tool `json:"tools"`
	}
	err := c.rpc(ctx, server, "tools/list", nil, &out)
	return out.Tools, err
}

func (c *Client) CallTool(ctx context.Context, server Server, name string, args map[string]any) (*ToolResult, error) {
	if args == nil {
		args = map[string]any{}
	}
	var out ToolResult
	return &out, c.rpc(ctx, server, "tools/call", map[string]any{"name": name, "arguments": args}, &out)
}

func (c *Client) SearchDocs(ctx context.Context, query string) (*ToolResult, error) {
	return c.CallTool(ctx, DocsServer, "search_docs", map[string]any{"query": query})
}

func (c *Client) ReadDoc(ctx context.Context, path string) (*ToolResult, error) {
	return c.CallTool(ctx, DocsServer, "read_doc", map[string]any{"path": path})
}

func (c *Client) ListDocs(ctx context.Context) (*ToolResult, error) {
	return c.CallTool(ctx, DocsServer, "list_docs", nil)
}

func randomKey() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
