package main

import "testing"

func floatPtr(v float64) *float64 {
	return &v
}

func TestValidateTripCreatePayloadAllowsStartOnly(t *testing.T) {
	err := validateTripCreatePayload(tripRequest{
		UserName: "Nic",
		StartKM:  floatPtr(12345.0),
	})
	if err != nil {
		t.Fatalf("expected start-only payload to be valid, got %v", err)
	}
}

func TestValidateTripCreatePayloadAllowsEndOnly(t *testing.T) {
	err := validateTripCreatePayload(tripRequest{
		UserName: "Nic",
		EndKM:    floatPtr(12405.3),
	})
	if err != nil {
		t.Fatalf("expected end-only payload to be valid, got %v", err)
	}
}

func TestValidateTripCreatePayloadRejectsMissingOdometers(t *testing.T) {
	err := validateTripCreatePayload(tripRequest{
		UserName: "Nic",
	})
	if err == nil {
		t.Fatalf("expected error when both start_km and end_km are missing")
	}
}

func TestValidateTripCreatePayloadRejectsInvalidRange(t *testing.T) {
	err := validateTripCreatePayload(tripRequest{
		UserName: "Nic",
		StartKM:  floatPtr(200),
		EndKM:    floatPtr(199),
	})
	if err == nil {
		t.Fatalf("expected validation error for end_km <= start_km")
	}
}

func TestValidateTripUpdatePayloadRequiresBothOdometers(t *testing.T) {
	err := validateTripUpdatePayload(tripRequest{
		UserName: "Nic",
		StartKM:  floatPtr(200),
	})
	if err == nil {
		t.Fatalf("expected validation error when update omits end_km")
	}
}

func TestValidateTripUpdateAllowsGapRanges(t *testing.T) {
	existing := []tripRecord{
		{ID: "a", StartKM: 100, EndKM: 120},
		{ID: "b", StartKM: 150, EndKM: 170},
	}

	if err := validateTripUpdate(121, 149, existing, "new-id"); err != nil {
		t.Fatalf("expected non-overlapping gap range to be allowed, got %v", err)
	}
}

func TestValidateTripUpdateRejectsOverlap(t *testing.T) {
	existing := []tripRecord{
		{ID: "a", StartKM: 100, EndKM: 120},
	}

	err := validateTripUpdate(110, 130, existing, "new-id")
	if err == nil {
		t.Fatalf("expected overlap to be rejected")
	}
}
