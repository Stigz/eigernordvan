package main

import (
	"encoding/json"
	"os"
	"strconv"
	"testing"
)

type accountingProjectionFixture struct {
	Period      string                    `json:"period"`
	People      []string                  `json:"people"`
	Settings    accountingSettingsPayload `json:"settings"`
	Trips       []tripRecord              `json:"trips"`
	Bookings    []bookingRecord           `json:"bookings"`
	FuelEntries []fuelRecord              `json:"fuel_entries"`
	WorkEntries []workEntryPayload        `json:"work_entries"`
	CostEntries []costEntryPayload        `json:"cost_entries"`
	Expected    struct {
		MonthlyContributionsCHF float64                       `json:"monthly_contributions_chf"`
		SharedPot               map[string]float64            `json:"shared_pot"`
		UsageByPerson           map[string]float64            `json:"usage_by_person"`
		WorkCreditsByPerson     map[string]float64            `json:"work_credits_by_person"`
		KMByPerson              map[string]float64            `json:"km_by_person"`
		NightsByPerson          map[string]float64            `json:"nights_by_person"`
		BucketTotals            map[string]float64            `json:"bucket_totals"`
		PersonBalances          map[string]float64            `json:"person_balances"`
		SettlementBalances      map[string]float64            `json:"settlement_balances"`
		SuggestedSettlements    []settlementSuggestionPayload `json:"suggested_settlements"`
		SourceCounts            map[string]int                `json:"source_counts"`
		Historical              struct {
			InvestmentCHF float64 `json:"investment_chf"`
			Rows          int     `json:"rows"`
		} `json:"historical"`
	} `json:"expected"`
}

func TestNormalizeAccountingSettingsDefaults(t *testing.T) {
	settings, err := normalizeAccountingSettings(accountingSettingsPayload{})
	if err != nil {
		t.Fatalf("expected defaults to validate, got %v", err)
	}
	if settings.KMRateCHF != 0.5 || settings.NightRateCHF != 50 || settings.WorkdayRateCHF != 100 || settings.MonthlyPaymentCHF != 50 {
		t.Fatalf("unexpected default rates: %+v", settings)
	}
	if settings.SurplusReservePercent != 70 || settings.SurplusHistoricalRepaymentPercent != 30 {
		t.Fatalf("unexpected default surplus split: %+v", settings)
	}
}

func TestNormalizeAccountingSettingsPreservesExplicitZeroMonthlyPayment(t *testing.T) {
	settings, err := normalizeAccountingSettings(accountingSettingsPayload{
		KMRateCHF:                         0.5,
		NightRateCHF:                      50,
		WorkdayRateCHF:                    100,
		MonthlyPaymentCHF:                 0,
		ReserveTargetCHF:                  2000,
		SurplusReservePercent:             100,
		SurplusHistoricalRepaymentPercent: 0,
	})
	if err != nil {
		t.Fatalf("expected settings to validate, got %v", err)
	}
	if settings.MonthlyPaymentCHF != 0 {
		t.Fatalf("expected explicit zero monthly payment to be preserved, got %v", settings.MonthlyPaymentCHF)
	}
}

func TestMergeAccountingSettingsPatchKeepsOmittedFields(t *testing.T) {
	settings, err := mergeAccountingSettingsPatch(defaultAccountingSettings(), []byte(`{"km_rate_chf":0.75}`))
	if err != nil {
		t.Fatalf("expected patch to validate, got %v", err)
	}
	if settings.KMRateCHF != 0.75 {
		t.Fatalf("expected km rate patch to apply, got %+v", settings)
	}
	if settings.NightRateCHF != 50 || settings.WorkdayRateCHF != 100 || settings.MonthlyPaymentCHF != 50 {
		t.Fatalf("expected omitted defaults to be preserved, got %+v", settings)
	}
}

func TestMergeAccountingSettingsPatchPreservesExplicitZero(t *testing.T) {
	settings, err := mergeAccountingSettingsPatch(defaultAccountingSettings(), []byte(`{"monthly_payment_chf":0}`))
	if err != nil {
		t.Fatalf("expected patch to validate, got %v", err)
	}
	if settings.MonthlyPaymentCHF != 0 {
		t.Fatalf("expected explicit zero monthly payment to apply, got %+v", settings)
	}
	if settings.KMRateCHF != 0.5 || settings.NightRateCHF != 50 {
		t.Fatalf("expected other defaults to be preserved, got %+v", settings)
	}
}

func TestMergeAccountingSettingsPatchRejectsInvalidNumbers(t *testing.T) {
	_, err := mergeAccountingSettingsPatch(defaultAccountingSettings(), []byte(`{"km_rate_chf":"fast"}`))
	if err == nil {
		t.Fatalf("expected invalid number to fail")
	}
}

func TestNormalizeAndValidateCostPayloadAddsAccountingDefaults(t *testing.T) {
	normalized, err := normalizeAndValidateCostPayload([]byte(`{"entries":[{"id":"c1","date":"2026-04-01","type":"expense","amount_chf":120.5,"description":"Insurance","category":"insurance","paid_by":"Nic","participants":["Nic","Kayla"]}]}`))
	if err != nil {
		t.Fatalf("expected old cost payload to validate, got %v", err)
	}
	entry, err := normalizeSingleCostEntry(normalizedEntryJSON(normalized, t))
	if err != nil {
		t.Fatalf("expected normalized entry to validate again, got %v", err)
	}
	if entry.Bucket != "shared_running" || entry.FundingAccount != "personal" || entry.AllocationBasis != "equal" {
		t.Fatalf("unexpected accounting defaults: %+v", entry)
	}
	if !entry.AffectsLiveBalance {
		t.Fatalf("expected old live entry to affect live balance")
	}
}

func TestBuildAccountingProjectionUsesStoredInputs(t *testing.T) {
	projection, err := buildAccountingProjection(accountingProjectionInput{
		Settings: defaultAccountingSettings(),
		People:   []string{"Nic", "Kayla"},
		Period:   "2026-06",
		Trips: []tripRecord{{
			UserName:  "Nic",
			Timestamp: "2026-06-10T12:00:00Z",
			DeltaKM:   120,
		}},
		Bookings: []bookingRecord{{
			Status:    "booked",
			GuestName: "Kayla",
			StartDate: "2026-06-12",
			EndDate:   "2026-06-14",
			Nights:    2,
		}},
		WorkEntries: []workEntryPayload{{
			Person: "Nic",
			Month:  "2026-06",
			Days:   0.5,
		}},
		FuelEntries: []fuelRecord{{
			ID:          "fuel-1",
			Timestamp:   "2026-06-11T12:00:00Z",
			UserName:    "Kayla",
			OdometerKM:  1200,
			Liters:      30,
			FuelCostCHF: 40,
			EventType:   "fuel_manual",
		}},
		CostEntries: []costEntryPayload{
			{
				ID:             "insurance-1",
				Date:           "2026-06-05",
				Type:           "expense",
				AmountCHF:      120,
				Description:    "Insurance",
				Category:       "insurance",
				PaidBy:         "Nic",
				Participants:   []string{"Nic", "Kayla"},
				Bucket:         "shared_running",
				FundingAccount: "personal",
			},
			{
				ID:              "payment-1",
				Date:            "2026-06-06",
				Type:            "transfer",
				AmountCHF:       50,
				Description:     "Kayla monthly payment",
				Category:        "settlement",
				FromPerson:      "Kayla",
				ToPerson:        "shared_pot",
				Bucket:          "settlement",
				AllocationBasis: "none",
			},
			{
				ID:          "historical-sheet:B0001",
				Date:        "2026-01-01",
				Type:        "expense",
				AmountCHF:   8900,
				Description: "Sprinter",
				Category:    "vehicle_purchase",
				Historical:  true,
				Bucket:      "historical_investment",
			},
		},
	})
	if err != nil {
		t.Fatalf("expected projection to build, got %v", err)
	}

	if projection.MonthlyContributionsCHF != 100 ||
		projection.UsageByPerson["Nic"] != 60 ||
		projection.UsageByPerson["Kayla"] != 100 ||
		projection.WorkCreditsByPerson["Nic"] != 50 ||
		projection.SharedPot.CurrentCostsCHF != 160 ||
		projection.SharedPot.FuelCostsCHF != 40 {
		t.Fatalf("unexpected projection totals: %+v", projection)
	}
	if projection.SharedPot.ReserveAllocationCHF != 35 ||
		projection.SharedPot.HistoricalRepaymentCHF != 15 ||
		projection.SharedPot.BalanceCHF != 0 {
		t.Fatalf("unexpected shared pot policy result: %+v", projection.SharedPot)
	}
	if projection.PersonBalances["Nic"] != 60 || projection.PersonBalances["Kayla"] != -60 {
		t.Fatalf("unexpected person balances: %+v", projection.PersonBalances)
	}
	if projection.SourceCounts.CostEntries != 2 ||
		projection.SourceCounts.HistoricalCostEntries != 1 ||
		projection.SourceCounts.TripEntries != 1 ||
		projection.SourceCounts.BookingEntries != 1 ||
		projection.SourceCounts.FuelEntries != 1 ||
		projection.SourceCounts.WorkEntries != 1 {
		t.Fatalf("unexpected source counts: %+v", projection.SourceCounts)
	}
	if projection.Historical.InvestmentCHF != 8900 || projection.Historical.Rows != 1 {
		t.Fatalf("unexpected historical summary: %+v", projection.Historical)
	}
	if len(projection.SuggestedSettlements) != 2 ||
		projection.SuggestedSettlements[0].FromPerson != "Kayla" ||
		projection.SuggestedSettlements[0].ToPerson != "shared_pot" ||
		projection.SuggestedSettlements[0].AmountCHF != 60 ||
		projection.SuggestedSettlements[1].FromPerson != "shared_pot" ||
		projection.SuggestedSettlements[1].ToPerson != "Nic" ||
		projection.SuggestedSettlements[1].AmountCHF != 60 {
		t.Fatalf("unexpected suggested settlements: %+v", projection.SuggestedSettlements)
	}
}

func TestBuildAccountingProjectionMatchesSharedFixture(t *testing.T) {
	fixture := loadAccountingProjectionFixture(t)
	projection, err := buildAccountingProjection(accountingProjectionInput{
		CostEntries: fixture.CostEntries,
		Trips:       fixture.Trips,
		Bookings:    fixture.Bookings,
		FuelEntries: fixture.FuelEntries,
		WorkEntries: fixture.WorkEntries,
		Settings:    fixture.Settings,
		People:      fixture.People,
		Period:      fixture.Period,
	})
	if err != nil {
		t.Fatalf("expected projection fixture to build, got %v", err)
	}

	if projection.MonthlyContributionsCHF != fixture.Expected.MonthlyContributionsCHF {
		t.Fatalf("unexpected monthly contributions: got %v want %v", projection.MonthlyContributionsCHF, fixture.Expected.MonthlyContributionsCHF)
	}
	assertFloatMapSubset(t, "shared pot", projectionSharedPotMap(projection.SharedPot), fixture.Expected.SharedPot)
	assertFloatMapSubset(t, "usage by person", projection.UsageByPerson, fixture.Expected.UsageByPerson)
	assertFloatMapSubset(t, "work credits by person", projection.WorkCreditsByPerson, fixture.Expected.WorkCreditsByPerson)
	assertFloatMapSubset(t, "km by person", projection.KMByPerson, fixture.Expected.KMByPerson)
	assertFloatMapSubset(t, "nights by person", projection.NightsByPerson, fixture.Expected.NightsByPerson)
	assertFloatMapSubset(t, "bucket totals", projection.BucketTotals, fixture.Expected.BucketTotals)
	assertFloatMapSubset(t, "person balances", projection.PersonBalances, fixture.Expected.PersonBalances)
	assertFloatMapSubset(t, "settlement balances", projection.SettlementBalances, fixture.Expected.SettlementBalances)
	assertSourceCounts(t, projection.SourceCounts, fixture.Expected.SourceCounts)
	if projection.Historical.InvestmentCHF != fixture.Expected.Historical.InvestmentCHF || projection.Historical.Rows != fixture.Expected.Historical.Rows {
		t.Fatalf("unexpected historical summary: got %+v want %+v", projection.Historical, fixture.Expected.Historical)
	}
	if len(projection.SuggestedSettlements) != len(fixture.Expected.SuggestedSettlements) {
		t.Fatalf("unexpected settlement count: got %+v want %+v", projection.SuggestedSettlements, fixture.Expected.SuggestedSettlements)
	}
	for index, expected := range fixture.Expected.SuggestedSettlements {
		if projection.SuggestedSettlements[index] != expected {
			t.Fatalf("unexpected settlement[%d]: got %+v want %+v", index, projection.SuggestedSettlements[index], expected)
		}
	}
}

func TestBuildAccountingProjectionRejectsInvalidPeriod(t *testing.T) {
	_, err := buildAccountingProjection(accountingProjectionInput{Period: "2026-99"})
	if err == nil {
		t.Fatalf("expected invalid projection period to fail")
	}
}

func TestClosedPeriodForCostEntryUsesDateAndExplicitPeriod(t *testing.T) {
	closedPeriods := closedAccountingPeriods([]monthlyClosePayload{{Period: "2026-06"}})
	if _, ok := closedPeriods["2026-06"]; !ok {
		t.Fatalf("expected closed period set to include 2026-06")
	}
	if period, closed := closedPeriodForCostEntry(costEntryPayload{Date: "2026-06-15"}, closedPeriods); !closed || period != "2026-06" {
		t.Fatalf("expected June date to be closed, got period=%q closed=%v", period, closed)
	}
	if period, closed := closedPeriodForCostEntry(costEntryPayload{Date: "2026-07-01", Period: "2026-06"}, closedPeriods); !closed || period != "2026-06" {
		t.Fatalf("expected explicit period to be closed, got period=%q closed=%v", period, closed)
	}
	if period, closed := closedPeriodForCostEntry(costEntryPayload{Date: "2026-07-01"}, closedPeriods); closed || period != "2026-07" {
		t.Fatalf("expected July date to remain open, got period=%q closed=%v", period, closed)
	}
}

func TestClosedPeriodForAccountingSources(t *testing.T) {
	closedPeriods := closedAccountingPeriods([]monthlyClosePayload{{Period: "2026-06"}, {Period: "2026-07"}})

	if period, closed := closedPeriodForTrip(tripRecord{Timestamp: "2026-06-09T12:00:00Z"}, closedPeriods); !closed || period != "2026-06" {
		t.Fatalf("expected June trip to be closed, got period=%q closed=%v", period, closed)
	}
	if period, closed := closedPeriodForTrip(tripRecord{Timestamp: "2026-08-01T12:00:00Z"}, closedPeriods); closed || period != "2026-08" {
		t.Fatalf("expected August trip to remain open, got period=%q closed=%v", period, closed)
	}

	periods := accountingPeriodsForBooking(bookingRecord{StartDate: "2026-06-30", EndDate: "2026-07-02"})
	if len(periods) != 2 || periods[0] != "2026-06" || periods[1] != "2026-07" {
		t.Fatalf("expected booking to touch June and July, got %#v", periods)
	}
	if period, closed := closedPeriodForBooking(bookingRecord{StartDate: "2026-05-31", EndDate: "2026-06-01"}, closedPeriods); closed || period != "" {
		t.Fatalf("expected booking ending on June 1 to affect only May, got period=%q closed=%v", period, closed)
	}
	if period, closed := closedPeriodForBooking(bookingRecord{StartDate: "2026-06-30", EndDate: "2026-07-02"}, closedPeriods); !closed || period != "2026-06" {
		t.Fatalf("expected cross-month booking to be closed from first closed period, got period=%q closed=%v", period, closed)
	}

	if period, closed := closedPeriodForWorkEntry(workEntryPayload{Month: "2026-07"}, closedPeriods); !closed || period != "2026-07" {
		t.Fatalf("expected July work entry to be closed, got period=%q closed=%v", period, closed)
	}
	if period, closed := closedPeriodForWorkEntry(workEntryPayload{Month: "2026-08"}, closedPeriods); closed || period != "2026-08" {
		t.Fatalf("expected August work entry to remain open, got period=%q closed=%v", period, closed)
	}
}

func TestClosedEntryComparisonsIgnoreTimestampsOnly(t *testing.T) {
	leftCost := costEntryPayload{
		ID: "insurance-1", Date: "2026-06-10", Type: "expense", AmountCHF: 100, Description: "Insurance",
		Category: "insurance", PaidBy: "Nic", Participants: []string{"Nic", "Kayla"}, CreatedAt: "old", UpdatedAt: "old",
	}
	rightCost := leftCost
	rightCost.CreatedAt = "new"
	rightCost.UpdatedAt = "new"
	if !sameClosedCostEntry(leftCost, rightCost) {
		t.Fatalf("expected cost entries with only timestamp changes to compare equal")
	}
	rightCost.AmountCHF = 101
	if sameClosedCostEntry(leftCost, rightCost) {
		t.Fatalf("expected cost entries with amount changes to compare different")
	}

	leftWork := workEntryPayload{ID: "work-1", Person: "Nic", Month: "2026-06", Days: 1, WorkNotes: "Build", CreatedAt: "old", UpdatedAt: "old"}
	rightWork := leftWork
	rightWork.CreatedAt = "new"
	rightWork.UpdatedAt = "new"
	if !sameClosedWorkEntry(leftWork, rightWork) {
		t.Fatalf("expected work entries with only timestamp changes to compare equal")
	}
	rightWork.Days = 1.5
	if sameClosedWorkEntry(leftWork, rightWork) {
		t.Fatalf("expected work entries with day changes to compare different")
	}
}

func TestMonthlyCloseFromProjectionSnapshotsBackendProjection(t *testing.T) {
	projection, err := buildAccountingProjection(accountingProjectionInput{
		Settings: defaultAccountingSettings(),
		People:   []string{"Nic", "Kayla"},
		Period:   "2026-06",
		Trips: []tripRecord{{
			UserName:  "Nic",
			Timestamp: "2026-06-10T12:00:00Z",
			DeltaKM:   120,
		}},
		CostEntries: []costEntryPayload{{
			ID:             "insurance-1",
			Date:           "2026-06-05",
			Type:           "expense",
			AmountCHF:      120,
			Description:    "Insurance",
			Category:       "insurance",
			PaidBy:         "Nic",
			Participants:   []string{"Nic", "Kayla"},
			Bucket:         "shared_running",
			FundingAccount: "personal",
		}},
	})
	if err != nil {
		t.Fatalf("expected projection to build, got %v", err)
	}

	close, err := normalizeMonthlyClose(monthlyCloseFromProjection(projection, " Reviewed "))
	if err != nil {
		t.Fatalf("expected close snapshot to normalize, got %v", err)
	}
	if close.ID != "2026-06" || close.Period != "2026-06" || close.SchemaVersion != accountingSchemaVersion {
		t.Fatalf("unexpected close identity: %+v", close)
	}
	if close.Totals["monthly_contributions_chf"] != 100 ||
		close.Totals["shared_pot_inflow_chf"] != projection.SharedPot.InflowCHF ||
		close.Totals["current_costs_chf"] != 120 {
		t.Fatalf("expected close totals to come from projection, got %+v", close.Totals)
	}
	if close.EntryCounts["cost_entries"] != 1 || close.EntryCounts["trip_entries"] != 1 {
		t.Fatalf("expected close entry counts to come from projection, got %+v", close.EntryCounts)
	}
	if close.PersonBalances["Nic"] != projection.PersonBalances["Nic"] ||
		close.SettlementBalances["shared_pot"] != projection.SettlementBalances["shared_pot"] {
		t.Fatalf("expected close balances to come from projection, got person=%+v settlement=%+v", close.PersonBalances, close.SettlementBalances)
	}
	if close.Notes != "Reviewed" {
		t.Fatalf("expected notes to be trimmed, got %q", close.Notes)
	}
}

func TestBuildHistoricalImportDryRunReconcilesExpectedTotals(t *testing.T) {
	rows := make([]historicalJournalEntryPayload, 0, 216)
	rows = append(rows, historicalJournalEntryPayload{
		BookingID:     "B0001",
		Person:        "Nic",
		Description:   "Sprinter 4x4",
		Category:      "Fahrzeug Anschaffung",
		DebitAccount:  "1400",
		CreditAccount: "2001",
		DebitCHF:      8900,
		CreditCHF:     8900,
		SourceAmount:  8900,
		SourceRef:     "Quelle_Kosten!B3",
	})
	for i := 2; i <= 215; i += 1 {
		rows = append(rows, historicalJournalEntryPayload{
			BookingID:     "B" + leftPadInt(i, 4),
			Person:        "Nic",
			Description:   "Neutral pair",
			Category:      "Interne Transfers / Durchlauf",
			DebitAccount:  "2990",
			CreditAccount: "2001",
			DebitCHF:      200,
			CreditCHF:     200,
			SourceAmount:  100,
		})
	}
	rows = append(rows, historicalJournalEntryPayload{
		BookingID:     "B0216",
		Person:        "Nic",
		Description:   "Final reconciliation",
		Category:      "Ausbau & Material",
		DebitAccount:  "1510",
		CreditAccount: "2001",
		DebitCHF:      24427.69,
		CreditCHF:     24427.69,
		SourceAmount:  5533.69,
	})

	response, entries, _, err := buildHistoricalImport(historicalImportRequest{DryRun: true, ImportBatchID: "historical-sheet", Entries: rows}, map[string]struct{}{})
	if err != nil {
		t.Fatalf("expected dry run to build, got %v", err)
	}
	if len(entries) != 216 || response.WouldImportCount != 216 {
		t.Fatalf("expected 216 entries, got entries=%d response=%d", len(entries), response.WouldImportCount)
	}
	if !response.Reconciliation.MatchesExpected {
		t.Fatalf("expected dry-run reconciliation to match, got %+v", response.Reconciliation)
	}
	if entries[0].ID != "historical-sheet:B0001" || !entries[0].Historical || entries[0].AffectsLiveBalance {
		t.Fatalf("unexpected imported entry metadata: %+v", entries[0])
	}
	if entries[0].SourceRef != "Quelle_Kosten!B3" ||
		entries[0].DebitAccount != "1400" ||
		entries[0].CreditAccount != "2001" ||
		entries[0].SourceAmountCHF != 8900 {
		t.Fatalf("expected historical audit fields to be preserved, got %+v", entries[0])
	}
}

func TestBuildHistoricalImportDetectsDuplicateExistingIDs(t *testing.T) {
	rows := []historicalJournalEntryPayload{{
		BookingID:     "B0001",
		Person:        "Nic",
		Description:   "Sprinter 4x4",
		Category:      "Fahrzeug Anschaffung",
		DebitAccount:  "1400",
		CreditAccount: "2001",
		DebitCHF:      1,
		CreditCHF:     1,
		SourceAmount:  1,
	}}
	response, _, _, err := buildHistoricalImport(historicalImportRequest{DryRun: true, ImportBatchID: "historical-sheet", Entries: rows}, map[string]struct{}{"historical-sheet:B0001": {}})
	if err != nil {
		t.Fatalf("expected dry run to build, got %v", err)
	}
	if len(response.DuplicateSourceIDs) != 1 || response.DuplicateSourceIDs[0] != "historical-sheet:B0001" {
		t.Fatalf("expected duplicate source id, got %+v", response.DuplicateSourceIDs)
	}
}

func TestNormalizeMonthlyCloseUsesPeriodIDAndSettings(t *testing.T) {
	close, err := normalizeMonthlyClose(monthlyClosePayload{Period: "2026-06"})
	if err != nil {
		t.Fatalf("expected monthly close to normalize, got %v", err)
	}
	if close.ID != "2026-06" ||
		close.Settings.WorkdayRateCHF != 100 ||
		close.Totals == nil ||
		close.EntryCounts == nil ||
		close.PersonBalances == nil ||
		close.SettlementBalances == nil {
		t.Fatalf("unexpected monthly close defaults: %+v", close)
	}
}

func TestNormalizeMonthlyCloseRejectsInvalidPeriod(t *testing.T) {
	_, err := normalizeMonthlyClose(monthlyClosePayload{Period: "2026-13"})
	if err == nil {
		t.Fatalf("expected invalid monthly close period to fail")
	}
}

func TestNormalizeMonthlyCloseRejectsMismatchedID(t *testing.T) {
	_, err := normalizeMonthlyClose(monthlyClosePayload{ID: "custom", Period: "2026-06"})
	if err == nil {
		t.Fatalf("expected mismatched monthly close id to fail")
	}
}

func TestNormalizeMonthlyClosePreservesSettlementBalances(t *testing.T) {
	close, err := normalizeMonthlyClose(monthlyClosePayload{
		Period: "2026-06",
		EntryCounts: map[string]int{
			"cost_entries": 2,
			"trip_entries": 1,
		},
		SettlementBalances: map[string]float64{
			"Nic":        -50.129,
			"shared_pot": 50.129,
		},
		SuggestedSettlements: []settlementSuggestionPayload{{
			FromPerson: " Nic ",
			ToPerson:   " shared_pot ",
			AmountCHF:  50.129,
			Reason:     " Shared pot due ",
		}},
	})
	if err != nil {
		t.Fatalf("expected monthly close to normalize, got %v", err)
	}
	if close.EntryCounts["cost_entries"] != 2 || close.EntryCounts["trip_entries"] != 1 {
		t.Fatalf("expected entry counts to be preserved, got %+v", close.EntryCounts)
	}
	if close.SettlementBalances["shared_pot"] != 50.13 || close.SettlementBalances["Nic"] != -50.13 {
		t.Fatalf("expected settlement balances to be preserved, got %+v", close.SettlementBalances)
	}
	if close.SuggestedSettlements[0].FromPerson != "Nic" ||
		close.SuggestedSettlements[0].ToPerson != "shared_pot" ||
		close.SuggestedSettlements[0].AmountCHF != 50.13 ||
		close.SuggestedSettlements[0].Reason != "Shared pot due" {
		t.Fatalf("expected settlement suggestion to normalize, got %+v", close.SuggestedSettlements[0])
	}
}

func TestNormalizeMonthlyCloseRejectsInvalidSettlementSuggestion(t *testing.T) {
	_, err := normalizeMonthlyClose(monthlyClosePayload{
		Period: "2026-06",
		SuggestedSettlements: []settlementSuggestionPayload{{
			FromPerson: "Nic",
			ToPerson:   "shared_pot",
			AmountCHF:  0,
		}},
	})
	if err == nil {
		t.Fatalf("expected invalid settlement suggestion to fail")
	}
}

func TestRoundMoneyRoundsNegativeValuesSymmetrically(t *testing.T) {
	if roundMoney(-50.129) != -50.13 {
		t.Fatalf("expected negative values to round symmetrically, got %v", roundMoney(-50.129))
	}
}

func normalizedEntryJSON(raw []byte, t *testing.T) []byte {
	t.Helper()
	var state costStatePayload
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatalf("expected normalized payload to unmarshal: %v", err)
	}
	if len(state.Entries) != 1 {
		t.Fatalf("expected one entry, got %d", len(state.Entries))
	}
	entryJSON, err := json.Marshal(state.Entries[0])
	if err != nil {
		t.Fatalf("expected entry to marshal: %v", err)
	}
	return entryJSON
}

func leftPadInt(value, width int) string {
	raw := strconv.Itoa(value)
	for len(raw) < width {
		raw = "0" + raw
	}
	return raw
}

func loadAccountingProjectionFixture(t *testing.T) accountingProjectionFixture {
	t.Helper()
	raw, err := os.ReadFile("../docs/accounting-projection-fixture.json")
	if err != nil {
		t.Fatalf("expected accounting fixture to read: %v", err)
	}
	var fixture accountingProjectionFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("expected accounting fixture to unmarshal: %v", err)
	}
	return fixture
}

func assertFloatMapSubset(t *testing.T, name string, actual, expected map[string]float64) {
	t.Helper()
	for key, want := range expected {
		if got := actual[key]; got != want {
			t.Fatalf("%s[%s]: got %v want %v; actual=%+v", name, key, got, want, actual)
		}
	}
}

func assertSourceCounts(t *testing.T, actual accountingSourceCounts, expected map[string]int) {
	t.Helper()
	got := map[string]int{
		"cost_entries":            actual.CostEntries,
		"historical_cost_entries": actual.HistoricalCostEntries,
		"trip_entries":            actual.TripEntries,
		"booking_entries":         actual.BookingEntries,
		"fuel_entries":            actual.FuelEntries,
		"work_entries":            actual.WorkEntries,
	}
	for key, want := range expected {
		if got[key] != want {
			t.Fatalf("source_counts[%s]: got %v want %v; actual=%+v", key, got[key], want, got)
		}
	}
}

func projectionSharedPotMap(sharedPot accountingSharedPotProjection) map[string]float64 {
	return map[string]float64{
		"inflow_chf":               sharedPot.InflowCHF,
		"outflow_chf":              sharedPot.OutflowCHF,
		"contributions_due_chf":    sharedPot.ContributionsDueCHF,
		"contributions_paid_chf":   sharedPot.ContributionsPaidCHF,
		"usage_charges_chf":        sharedPot.UsageChargesCHF,
		"external_income_chf":      sharedPot.ExternalIncomeCHF,
		"current_costs_chf":        sharedPot.CurrentCostsCHF,
		"fuel_costs_chf":           sharedPot.FuelCostsCHF,
		"reserve_allocation_chf":   sharedPot.ReserveAllocationCHF,
		"historical_repayment_chf": sharedPot.HistoricalRepaymentCHF,
		"balance_chf":              sharedPot.BalanceCHF,
	}
}
