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

func TestNormalizeBookingDefaultsPaymentAndCleaning(t *testing.T) {
	record, err := normalizeAndValidateBooking(bookingRequest{StartDate: "2026-04-10", EndDate: "2026-04-12", Status: "booked"})
	if err != nil {
		t.Fatalf("expected valid booking, got %v", err)
	}
	if record.PaymentStatus != "unpaid" {
		t.Fatalf("expected unpaid default, got %q", record.PaymentStatus)
	}
	if !record.CleaningFeeIncluded || record.CleaningFee != 100 || record.EstimateTotal != 300 {
		t.Fatalf("expected default cleaning fee in estimate, got included=%v fee=%v total=%v", record.CleaningFeeIncluded, record.CleaningFee, record.EstimateTotal)
	}
}

func TestNormalizeBookingCanSkipCleaningFee(t *testing.T) {
	includeCleaning := false
	record, err := normalizeAndValidateBooking(bookingRequest{StartDate: "2026-04-10", EndDate: "2026-04-12", Status: "booked", CleaningFeeIncluded: &includeCleaning})
	if err != nil {
		t.Fatalf("expected valid booking, got %v", err)
	}
	if record.CleaningFeeIncluded || record.CleaningFee != 0 || record.EstimateTotal != 200 {
		t.Fatalf("expected cleaning fee excluded, got included=%v fee=%v total=%v", record.CleaningFeeIncluded, record.CleaningFee, record.EstimateTotal)
	}
}

func TestNormalizeBookingTracksPaidByAndPaidTo(t *testing.T) {
	paidBy := "Guest"
	paidTo := "Nic"
	record, err := normalizeAndValidateBooking(bookingRequest{
		StartDate:     "2026-04-10",
		EndDate:       "2026-04-12",
		Status:        "booked",
		PaymentStatus: "paid",
		PaidBy:        &paidBy,
		PaidTo:        &paidTo,
	})
	if err != nil {
		t.Fatalf("expected valid booking, got %v", err)
	}
	if record.PaymentStatus != "paid" || record.PaidBy != paidBy || record.PaidTo != paidTo {
		t.Fatalf("expected payment details to be retained, got status=%q paid_by=%q paid_to=%q", record.PaymentStatus, record.PaidBy, record.PaidTo)
	}
}

func TestNormalizeBookingRejectsInvalidPaymentStatus(t *testing.T) {
	_, err := normalizeAndValidateBooking(bookingRequest{StartDate: "2026-04-10", EndDate: "2026-04-12", Status: "booked", PaymentStatus: "settled"})
	if err == nil {
		t.Fatalf("expected invalid payment status error, got nil")
	}
}
