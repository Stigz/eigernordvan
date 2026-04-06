package main

import "testing"

func TestNormalizeAndValidateWorkPayload(t *testing.T) {
	payload := []byte(`{"tasks":[{"id":"1"}],"todos":[],"board":[{"id":"b"}]}`)
	normalized, err := normalizeAndValidateWorkPayload(payload)
	if err != nil {
		t.Fatalf("expected payload to validate, got error: %v", err)
	}
	if len(normalized) == 0 {
		t.Fatalf("expected normalized payload")
	}
}

func TestNormalizeAndValidateWorkPayloadRejectsBadType(t *testing.T) {
	_, err := normalizeAndValidateWorkPayload([]byte(`{"tasks":{}}`))
	if err == nil {
		t.Fatalf("expected validation error for non-array tasks")
	}
}
