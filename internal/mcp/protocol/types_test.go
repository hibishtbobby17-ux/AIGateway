package protocol

import (
	"encoding/json"
	"testing"
)

func TestJSONRPCRequestParsing(t *testing.T) {
	raw := `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`
	var req Request
	if err := json.Unmarshal([]byte(raw), &req); err != nil {
		t.Fatalf("failed unmarshaling request: %v", err)
	}

	if req.JSONRPC != "2.0" {
		t.Errorf("expected jsonrpc 2.0, got: %s", req.JSONRPC)
	}
	if req.Method != "tools/list" {
		t.Errorf("expected method tools/list, got: %s", req.Method)
	}
	if req.IsNotification() {
		t.Errorf("expected request with id=1 to NOT be notification")
	}

	// Test notification
	rawNotification := `{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}`
	var notif Request
	if err := json.Unmarshal([]byte(rawNotification), &notif); err != nil {
		t.Fatalf("failed unmarshaling notification: %v", err)
	}
	if !notif.IsNotification() {
		t.Errorf("expected request without id to be notification")
	}
}

func TestJSONRPCResponseCreation(t *testing.T) {
	id := json.RawMessage(`42`)
	resp, err := NewResponse(&id, ListToolsResult{
		Tools: []Tool{
			{Name: "test_tool", Description: "a test tool", InputSchema: json.RawMessage(`{}`)},
		},
	})
	if err != nil {
		t.Fatalf("failed creating response: %v", err)
	}

	marshaled, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed marshaling response: %v", err)
	}

	var parsed Response
	if err := json.Unmarshal(marshaled, &parsed); err != nil {
		t.Fatalf("failed parsing marshaled response: %v", err)
	}

	if string(*parsed.ID) != "42" {
		t.Errorf("expected id 42, got: %s", string(*parsed.ID))
	}
	if parsed.Error != nil {
		t.Errorf("expected nil error on success response, got: %v", parsed.Error)
	}

	// Test Error response
	errResp := NewErrorResponse(&id, CodeMethodNotFound, "method not found", nil)
	if errResp.Error.Code != CodeMethodNotFound {
		t.Errorf("expected code %d, got: %d", CodeMethodNotFound, errResp.Error.Code)
	}
}
