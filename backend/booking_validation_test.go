package main

import "testing"

func TestNormalizeAndValidateBookingDefaults(t *testing.T) {
	booking, err := normalizeAndValidateBooking(bookingRequest{
		StartDate: "2026-04-10",
		EndDate:   "2026-04-13",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if booking.Status != "booked" {
		t.Fatalf("expected default status booked, got %s", booking.Status)
	}
	if booking.Nights != 3 {
		t.Fatalf("expected 3 nights, got %d", booking.Nights)
	}
	if booking.EstimateTotal != 400 {
		t.Fatalf("expected total 400, got %.2f", booking.EstimateTotal)
	}
}

func TestNormalizeAndValidateBookingRejectsInvalidStatus(t *testing.T) {
	_, err := normalizeAndValidateBooking(bookingRequest{
		StartDate: "2026-04-10",
		EndDate:   "2026-04-11",
		Status:    "pending",
	})
	if err == nil {
		t.Fatalf("expected error for invalid status")
	}
}

func TestNormalizeAndValidateBookingRejectsInvertedRange(t *testing.T) {
	_, err := normalizeAndValidateBooking(bookingRequest{
		StartDate: "2026-04-12",
		EndDate:   "2026-04-10",
		Status:    "booked",
	})
	if err == nil {
		t.Fatalf("expected error for invalid date range")
	}
}

func TestBookingOverlapsRange(t *testing.T) {
	booking := bookingRecord{StartDate: "2026-04-10", EndDate: "2026-04-12", Status: "booked"}
	from, _ := parseOptionalDate("2026-04-11")
	to, _ := parseOptionalDate("2026-04-13")
	if !bookingOverlapsRange(booking, from, to) {
		t.Fatalf("expected overlap for filtered range")
	}
}
