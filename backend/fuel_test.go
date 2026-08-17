package main

import (
	"testing"
	"time"
)

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

func TestValidateFuelAcceptsPartialFillWithMeasurements(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:    "Kayla",
		OdometerKM:  floatPtr(314760),
		Liters:      62,
		FuelCostCHF: 120,
		Partial:     true,
		Date:        "2026-06-19",
	})
	if err != nil {
		t.Fatalf("expected partial fill with receipt values to be valid, got %v", err)
	}
}

func TestValidateFuelAcceptsRecordedFillWithoutOdometer(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:    "Jeanne",
		Liters:      48.5,
		FuelCostCHF: 95,
	})
	if err != nil {
		t.Fatalf("expected odometer to be optional for a recorded fill, got %v", err)
	}
}

func TestValidateFuelRejectsEntryThatIsMissedAndPartial(t *testing.T) {
	err := validateFuel(fuelRequest{UserName: "Kayla", Missed: true, Partial: true})
	if err == nil {
		t.Fatalf("expected mutually exclusive fuel states to fail validation")
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

func TestEventRecordConvertsPartialFillWithMeasurements(t *testing.T) {
	record, ok := (eventRecord{
		ID:          "partial-1",
		Timestamp:   "2026-06-19T15:06:29Z",
		UserName:    "Kayla",
		EventType:   "fuel_partial_updated",
		OdometerKM:  floatPtr(314760),
		Liters:      floatPtr(62),
		FuelCostCHF: floatPtr(120),
	}).asFuel()
	if !ok || !record.Partial || record.Missed || record.Liters != 62 || record.FuelCostCHF != 120 {
		t.Fatalf("unexpected partial fill conversion: %#v", record)
	}
}

func TestEventRecordKeepsRecordedFillWithoutOdometer(t *testing.T) {
	record, ok := (eventRecord{
		ID:          "no-odometer",
		Timestamp:   "2026-08-17T12:00:00Z",
		UserName:    "Jeanne",
		EventType:   "fuel_manual",
		Liters:      floatPtr(48.5),
		FuelCostCHF: floatPtr(95),
	}).asFuel()
	if !ok || record.Liters != 48.5 || record.FuelCostCHF != 95 || record.OdometerKM != 0 {
		t.Fatalf("unexpected fuel record without odometer: %#v", record)
	}
}

func TestResolveEventTimestampUsesZurichDateAndPreservesClockTime(t *testing.T) {
	reference := time.Date(2026, time.August, 17, 12, 31, 36, 0, time.UTC)
	resolved, err := resolveEventTimestamp("2026-06-19", reference)
	if err != nil {
		t.Fatalf("expected valid date, got %v", err)
	}
	if got := resolved.Format(time.RFC3339); got != "2026-06-19T12:31:36Z" {
		t.Fatalf("expected Zurich-local clock time to be preserved, got %s", got)
	}
}
