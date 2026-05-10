package main

import "testing"

func TestValidateFuelAcceptsValidPayload(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:    "Nic",
		OdometerKM:  12345.6,
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
		OdometerKM:  12345.6,
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
		OdometerKM:  -1,
		Liters:      0,
		FuelCostCHF: 0,
	})
	if err == nil {
		t.Fatalf("expected non-positive fuel values to fail validation")
	}
}

func TestValidateFuelAcceptsMissedEntryWithNote(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:   "Nic",
		OdometerKM: 12345.6,
		Missed:     true,
		Note:       "Forgot to record a full tank in Italy.",
	})
	if err != nil {
		t.Fatalf("expected missed fuel payload with note to be valid, got %v", err)
	}
}

func TestValidateFuelRejectsMissedEntryWithoutNote(t *testing.T) {
	err := validateFuel(fuelRequest{
		UserName:   "Nic",
		OdometerKM: 12345.6,
		Missed:     true,
	})
	if err == nil {
		t.Fatalf("expected missed fuel payload without note to fail validation")
	}
}
