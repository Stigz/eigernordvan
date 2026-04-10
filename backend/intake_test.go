package main

import "testing"

func TestBuildIntakeContextIncludesPeopleAndSuggestions(t *testing.T) {
	events := []eventRecord{
		{
			ID:        "trip-1",
			Timestamp: "2026-04-01T10:00:00Z",
			UserName:  "Nic",
			EventType: "trip_manual",
			StartKM:   floatPtr(1000),
			EndKM:     floatPtr(1050),
		},
		{
			ID:         "fuel-1",
			Timestamp:  "2026-04-02T10:00:00Z",
			UserName:   "Nic",
			EventType:  "fuel_manual",
			OdometerKM: floatPtr(1060),
		},
	}
	openTrip := &tripRecord{
		ID:        "open-1",
		Timestamp: "2026-04-03T10:00:00Z",
		UserName:  "Kayla",
		EventType: "trip_manual_open",
		StartKM:   1200,
	}

	people, suggestedStart := buildIntakeContext(events, openTrip)
	if suggestedStart == nil || *suggestedStart != 1050 {
		t.Fatalf("expected suggested start to be 1050, got %+v", suggestedStart)
	}
	if len(people) != 2 {
		t.Fatalf("expected two people in context, got %d", len(people))
	}
	nic, ok := people["Nic"]
	if !ok {
		t.Fatalf("expected Nic in people map")
	}
	if nic.LastFuelOdometer == nil || *nic.LastFuelOdometer != 1060 {
		t.Fatalf("expected Nic fuel odometer to be set")
	}
	kayla, ok := people["Kayla"]
	if !ok {
		t.Fatalf("expected Kayla in people map")
	}
	if !kayla.HasOpenTrip {
		t.Fatalf("expected Kayla to have open trip")
	}
	if kayla.OpenTripStartKM == nil || *kayla.OpenTripStartKM != 1200 {
		t.Fatalf("expected Kayla open trip start km to be 1200")
	}
}
