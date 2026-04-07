package main

import "testing"

func TestCalculateBookingEstimate(t *testing.T) {
	total := calculateBookingEstimate(2, 100, 100, 120, 0.5)
	if total != 360 {
		t.Fatalf("expected total 360, got %v", total)
	}
}

func TestValidateBookingOverlap(t *testing.T) {
	existing := []bookingRecord{
		{ID: "a", StartDate: "2026-04-10", EndDate: "2026-04-12", Status: "booked"},
	}

	err := validateBookingOverlap(bookingRecord{StartDate: "2026-04-11", EndDate: "2026-04-13", Status: "booked"}, existing, "")
	if err == nil {
		t.Fatalf("expected overlap error, got nil")
	}
}

func TestValidateBookingOverlapAllowsBlocked(t *testing.T) {
	existing := []bookingRecord{
		{ID: "a", StartDate: "2026-04-10", EndDate: "2026-04-12", Status: "booked"},
	}

	err := validateBookingOverlap(bookingRecord{StartDate: "2026-04-11", EndDate: "2026-04-13", Status: "blocked"}, existing, "")
	if err != nil {
		t.Fatalf("expected no error for blocked overlap, got %v", err)
	}
}
