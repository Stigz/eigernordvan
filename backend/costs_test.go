package main

import "testing"

func TestNormalizeAndValidateCostPayload(t *testing.T) {
	payload := []byte(`{"entries":[{"id":"c1","date":"2026-04-01","type":"expense","amount_chf":120.5,"description":"Insurance","category":"insurance","paid_by":"Nic","participants":["Nic","Kayla"]}]}`)
	normalized, err := normalizeAndValidateCostPayload(payload)
	if err != nil {
		t.Fatalf("expected payload to validate, got error: %v", err)
	}
	if len(normalized) == 0 {
		t.Fatalf("expected normalized payload")
	}
}

func TestNormalizeAndValidateCostPayloadRejectsMissingParticipants(t *testing.T) {
	_, err := normalizeAndValidateCostPayload([]byte(`{"entries":[{"id":"c1","date":"2026-04-01","type":"expense","amount_chf":90,"description":"Fuel","category":"fuel","paid_by":"Nic"}]}`))
	if err == nil {
		t.Fatalf("expected validation error for missing participants")
	}
}
