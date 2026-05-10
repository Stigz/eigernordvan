package main

import (
	"encoding/json"
	"testing"
)

func TestNormalizeAndValidateWorkPayload(t *testing.T) {
	payload := []byte(`{"entries":[{"id":"1","person":"Nic","month":"2026-05","days":1.5,"work_notes":"Built bed frame"}]}`)
	normalized, err := normalizeAndValidateWorkPayload(payload)
	if err != nil {
		t.Fatalf("expected payload to validate, got error: %v", err)
	}

	var state workStatePayload
	if err := json.Unmarshal(normalized, &state); err != nil {
		t.Fatalf("expected normalized payload to be json: %v", err)
	}
	if len(state.Entries) != 1 {
		t.Fatalf("expected one work entry, got %d", len(state.Entries))
	}
	if state.Entries[0].Days != 1.5 {
		t.Fatalf("expected half-day value to be preserved, got %v", state.Entries[0].Days)
	}
}

func TestNormalizeAndValidateWorkPayloadRejectsBadType(t *testing.T) {
	_, err := normalizeAndValidateWorkPayload([]byte(`{"entries":{}}`))
	if err == nil {
		t.Fatalf("expected validation error for non-array entries")
	}
}

func TestNormalizeAndValidateWorkPayloadRejectsNonHalfDay(t *testing.T) {
	_, err := normalizeAndValidateWorkPayload([]byte(`{"entries":[{"id":"1","person":"Nic","month":"2026-05","days":1.25,"work_notes":"bad"}]}`))
	if err == nil {
		t.Fatalf("expected validation error for non-half-day increments")
	}
}
