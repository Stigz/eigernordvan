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
