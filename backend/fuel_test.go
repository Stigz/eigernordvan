package main

import "testing"

func TestValidateFuelAcceptsValidPayload(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:    "Nic",
		OdometerKM:  floatPtr(12345.6),
		Liters:      52.4,
		FuelCostCHF: 101.8,
	})
	if err != nil {
		t.Fatalf("expected valid fuel payload, got %v", err)
	}
}

func TestValidateFuelRejectsMissingUserName(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:    "",
		OdometerKM:  floatPtr(12345.6),
		Liters:      52.4,
		FuelCostCHF: 101.8,
	})
	if err == nil {
		t.Fatalf("expected missing user_name validation error")
	}
}

func TestValidateFuelRejectsNonPositiveValues(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:    "Nic",
		OdometerKM:  floatPtr(-1),
		Liters:      0,
		FuelCostCHF: 0,
	})
	if err == nil {
		t.Fatalf("expected non-positive fuel values to fail validation")
	}
}

func TestValidateFuelAcceptsMissedEntryWithoutOdometerOrNote(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName: "Nic",
		Missed:   true,
	})
	if err != nil {
		t.Fatalf("expected a simple missed fuel marker to be valid, got %v", err)
	}
}

func TestValidateFuelAcceptsMissedEntryWithOptionalOdometer(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:   "Nic",
		OdometerKM: floatPtr(12345.6),
		Missed:     true,
	})
	if err != nil {
		t.Fatalf("expected missed fuel marker with optional odometer to be valid, got %v", err)
	}
}

func TestValidateFuelRejectsInvalidOptionalOdometerForMissedEntry(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:   "Nic",
		OdometerKM: floatPtr(-1),
		Missed:     true,
	})
	if err == nil {
		t.Fatalf("expected invalid optional odometer to fail validation")
	}
}

func TestEventRecordConvertsMissedMarkerWithoutMeasurements(t *testing.T) {
	record, ok := (eventRecord{
		ID:        "marker-1",
		Timestamp: "2026-07-20T12:00:00Z",
		UserName:  "Nic",
		EventType: "fuel_missed",
	}).asFuel()
	if !ok {
		t.Fatalf("expected marker without measurements to remain visible in the fuel ledger")
	}
	if record.OdometerKM != 0 || record.Liters != 0 || record.FuelCostCHF != 0 || !record.Missed {
		t.Fatalf("unexpected missed marker conversion: %#v", record)
	}
}
