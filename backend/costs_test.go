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

func TestNormalizeAndValidateCostPayloadAcceptsSharedPotTransfer(t *testing.T) {
	payload := []byte(`{"entries":[{"id":"t1","date":"2026-06-01","type":"transfer","amount_chf":50,"description":"Nic monthly payment","category":"settlement","from_person":"Nic","to_person":"shared_pot","bucket":"settlement","funding_account":"personal","allocation_basis":"none"}]}`)
	normalized, err := normalizeAndValidateCostPayload(payload)
	if err != nil {
		t.Fatalf("expected shared pot transfer to validate, got error: %v", err)
	}
	entry, err := normalizeSingleCostEntry(normalizedEntryJSON(normalized, t))
	if err != nil {
		t.Fatalf("expected normalized transfer to validate again, got %v", err)
	}
	if entry.FromPerson != "Nic" || entry.ToPerson != "shared_pot" || entry.Bucket != "settlement" || entry.AllocationBasis != "none" {
		t.Fatalf("unexpected shared pot transfer normalization: %+v", entry)
	}
}

func TestNormalizeAndValidateCostPayloadRejectsSameSharedPotTransferSides(t *testing.T) {
	_, err := normalizeAndValidateCostPayload([]byte(`{"entries":[{"id":"t1","date":"2026-06-01","type":"transfer","amount_chf":50,"description":"Bad transfer","category":"settlement","from_person":"shared_pot","to_person":"shared_pot"}]}`))
	if err == nil {
		t.Fatalf("expected validation error for transfer with identical sides")
	}
}
