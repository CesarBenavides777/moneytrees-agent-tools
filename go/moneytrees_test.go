package moneytrees

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

type seen struct {
	method, uri string
	header      http.Header
	body        []byte
}

func stub(t *testing.T, handler func(w http.ResponseWriter, r *http.Request, body []byte)) (*Client, *[]seen) {
	t.Helper()
	var log []seen
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		log = append(log, seen{r.Method, r.URL.RequestURI(), r.Header.Clone(), body})
		handler(w, r, body)
	}))
	t.Cleanup(server.Close)
	return &Client{BaseURL: server.URL}, &log
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func TestSandboxReadsGoUnderSandboxPath(t *testing.T) {
	client, log := stub(t, func(w http.ResponseWriter, r *http.Request, _ []byte) {
		writeJSON(w, 200, map[string]any{"asOf": "now", "gainers": []any{}, "losers": []any{}})
	})
	client.Sandbox = true
	if _, err := client.Movers(context.Background(), 3); err != nil {
		t.Fatal(err)
	}
	if got := (*log)[0].uri; got != "/api/v1/sandbox/movers?limit=3" {
		t.Fatalf("uri = %q", got)
	}
}

func TestErrorEnvelope(t *testing.T) {
	client, _ := stub(t, func(w http.ResponseWriter, r *http.Request, _ []byte) {
		writeJSON(w, 404, map[string]any{"error": map[string]string{
			"code": "ticker_not_found", "message": "No ticker NOPE", "docs_url": "https://moneytrees.ai/docs/errors",
		}})
	})
	_, err := client.Ticker(context.Background(), "NOPE")
	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("err = %v", err)
	}
	want := Error{Message: "No ticker NOPE", Status: 404, Code: "ticker_not_found", DocsURL: "https://moneytrees.ai/docs/errors"}
	apiErr.URL = ""
	if *apiErr != want {
		t.Fatalf("got %+v", *apiErr)
	}
}

func TestMeSendsBearerAndRefusesWithoutToken(t *testing.T) {
	client, log := stub(t, func(w http.ResponseWriter, r *http.Request, _ []byte) {
		writeJSON(w, 200, map[string]any{"plan": "pro"})
	})
	client.APIKey = "tok_123"
	if _, err := client.Me(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := (*log)[0].header.Get("Authorization"); got != "Bearer tok_123" {
		t.Fatalf("Authorization = %q", got)
	}
	client.APIKey = ""
	_, err := client.Me(context.Background())
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Code != "missing_token" || len(*log) != 1 {
		t.Fatalf("err = %v, requests = %d", err, len(*log))
	}
}

func TestAllSignalsFollowsCursor(t *testing.T) {
	client, log := stub(t, func(w http.ResponseWriter, r *http.Request, _ []byte) {
		if r.URL.Query().Get("cursor") == "" {
			writeJSON(w, 200, map[string]any{"data": []map[string]string{{"id": "a"}}, "nextCursor": "c2"})
			return
		}
		writeJSON(w, 200, map[string]any{"data": []map[string]string{{"id": "b"}}, "nextCursor": nil})
	})
	var ids []string
	err := client.AllSignals(context.Background(), SignalsQuery{Symbol: "BONK"}, func(s Signal) bool {
		ids = append(ids, s.ID)
		return true
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(ids, []string{"a", "b"}) || (*log)[1].uri != "/api/v1/signals?cursor=c2&symbol=BONK" {
		t.Fatalf("ids = %v, second uri = %q", ids, (*log)[1].uri)
	}
}

func TestSandboxOrderAndBacktest(t *testing.T) {
	client, log := stub(t, func(w http.ResponseWriter, r *http.Request, _ []byte) {
		if r.URL.Path == "/api/v1/sandbox/orders" {
			writeJSON(w, 201, map[string]string{"id": "ord_1"})
			return
		}
		w.Header().Set("Location", "/api/v1/sandbox/jobs/job_9")
		writeJSON(w, 202, map[string]string{"status": "queued"})
	})
	ctx := context.Background()
	if _, err := client.CreateSandboxOrder(ctx, map[string]any{"symbol": "BONK"}, "key-1"); err != nil {
		t.Fatal(err)
	}
	if got := (*log)[0].header.Get("Idempotency-Key"); got != "key-1" {
		t.Fatalf("Idempotency-Key = %q", got)
	}
	job, err := client.CreateSandboxBacktest(ctx, map[string]any{"symbol": "BONK"})
	if err != nil {
		t.Fatal(err)
	}
	if job.ID != "job_9" || job.Location != "/api/v1/sandbox/jobs/job_9" {
		t.Fatalf("job = %+v", job)
	}
}

func TestDocsMCPEventStreamAndRPCError(t *testing.T) {
	client, log := stub(t, func(w http.ResponseWriter, r *http.Request, body []byte) {
		var rpc struct {
			ID     int    `json:"id"`
			Method string `json:"method"`
		}
		_ = json.Unmarshal(body, &rpc)
		if rpc.Method == "tools/list" {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":%d,\"result\":{\"tools\":[{\"name\":\"search_docs\"}]}}\n\n", rpc.ID)
			return
		}
		writeJSON(w, 200, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "error": map[string]any{"code": -32602, "message": "Unknown tool"}})
	})
	ctx := context.Background()
	tools, err := client.ListTools(ctx, DocsServer)
	if err != nil || len(tools) != 1 || tools[0].Name != "search_docs" || (*log)[0].uri != "/api/mcp/docs" {
		t.Fatalf("tools = %+v, err = %v", tools, err)
	}
	_, err = client.CallTool(ctx, DocsServer, "nope", nil)
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Code != "-32602" {
		t.Fatalf("err = %v", err)
	}
}
