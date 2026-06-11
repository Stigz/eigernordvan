package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const accountingSchemaVersion = "2026-06-05"
const sharedPotAccount = "shared_pot"

var errAccountingPeriodClosed = errors.New("accounting period is closed")

var accountingBuckets = map[string]struct{}{
	"van_investment":        {},
	"shared_running":        {},
	"usage":                 {},
	"income":                {},
	"settlement":            {},
	"work_credit":           {},
	"historical_investment": {},
	"private_ignore":        {},
}

var fundingAccounts = map[string]struct{}{
	"shared_pot": {},
	"personal":   {},
}

var allocationBases = map[string]struct{}{
	"equal":          {},
	"km_night_usage": {},
	"direct_person":  {},
	"manual":         {},
	"none":           {},
}

var defaultAccountingPeople = []string{"Nic", "Kayla", "Jeanne", "Lüku"}

type accountingSettingsPayload struct {
	SchemaVersion                     string  `json:"schema_version"`
	KMRateCHF                         float64 `json:"km_rate_chf"`
	NightRateCHF                      float64 `json:"night_rate_chf"`
	WorkdayRateCHF                    float64 `json:"workday_rate_chf"`
	MonthlyPaymentCHF                 float64 `json:"monthly_payment_chf"`
	ReserveTargetCHF                  float64 `json:"reserve_target_chf"`
	SurplusReservePercent             float64 `json:"surplus_reserve_percent"`
	SurplusHistoricalRepaymentPercent float64 `json:"surplus_historical_repayment_percent"`
	UpdatedAt                         string  `json:"updated_at,omitempty"`
}

type settlementSuggestionPayload struct {
	FromPerson string  `json:"from_person"`
	ToPerson   string  `json:"to_person"`
	AmountCHF  float64 `json:"amount_chf"`
	Reason     string  `json:"reason,omitempty"`
}

type accountingSharedPotProjection struct {
	InflowCHF              float64 `json:"inflow_chf"`
	OutflowCHF             float64 `json:"outflow_chf"`
	ContributionsDueCHF    float64 `json:"contributions_due_chf"`
	ContributionsPaidCHF   float64 `json:"contributions_paid_chf"`
	UsageChargesCHF        float64 `json:"usage_charges_chf"`
	ExternalIncomeCHF      float64 `json:"external_income_chf"`
	CurrentCostsCHF        float64 `json:"current_costs_chf"`
	ReserveAllocationCHF   float64 `json:"reserve_allocation_chf"`
	HistoricalRepaymentCHF float64 `json:"historical_repayment_chf"`
	BalanceCHF             float64 `json:"balance_chf"`
}

type accountingSourceCounts struct {
	CostEntries           int `json:"cost_entries"`
	HistoricalCostEntries int `json:"historical_cost_entries"`
	TripEntries           int `json:"trip_entries"`
	BookingEntries        int `json:"booking_entries"`
	WorkEntries           int `json:"work_entries"`
}

type accountingHistoricalSummary struct {
	InvestmentCHF float64 `json:"investment_chf"`
	Rows          int     `json:"rows"`
}

type accountingProjectionPayload struct {
	Period                  string                        `json:"period"`
	Settings                accountingSettingsPayload     `json:"settings"`
	MonthlyContributionsCHF float64                       `json:"monthly_contributions_chf"`
	SharedPot               accountingSharedPotProjection `json:"shared_pot"`
	UsageByPerson           map[string]float64            `json:"usage_by_person"`
	WorkCreditsByPerson     map[string]float64            `json:"work_credits_by_person"`
	KMByPerson              map[string]float64            `json:"km_by_person"`
	NightsByPerson          map[string]float64            `json:"nights_by_person"`
	BucketTotals            map[string]float64            `json:"bucket_totals"`
	PersonBalances          map[string]float64            `json:"person_balances"`
	SettlementBalances      map[string]float64            `json:"settlement_balances"`
	SuggestedSettlements    []settlementSuggestionPayload `json:"suggested_settlements"`
	SourceCounts            accountingSourceCounts        `json:"source_counts"`
	Historical              accountingHistoricalSummary   `json:"historical"`
}

type accountingProjectionInput struct {
	CostEntries []costEntryPayload
	Trips       []tripRecord
	Bookings    []bookingRecord
	WorkEntries []workEntryPayload
	Settings    accountingSettingsPayload
	People      []string
	Period      string
}

type monthlyClosePayload struct {
	ID                   string                        `json:"id"`
	Period               string                        `json:"period"`
	SchemaVersion        string                        `json:"schema_version"`
	Settings             accountingSettingsPayload     `json:"settings"`
	Totals               map[string]float64            `json:"totals"`
	EntryCounts          map[string]int                `json:"entry_counts"`
	PersonBalances       map[string]float64            `json:"person_balances"`
	SettlementBalances   map[string]float64            `json:"settlement_balances"`
	SuggestedSettlements []settlementSuggestionPayload `json:"suggested_settlements"`
	Notes                string                        `json:"notes,omitempty"`
	CreatedAt            string                        `json:"created_at,omitempty"`
	UpdatedAt            string                        `json:"updated_at,omitempty"`
}

type historicalJournalEntryPayload struct {
	BookingID     string  `json:"booking_id"`
	Date          string  `json:"date,omitempty"`
	Person        string  `json:"person"`
	Description   string  `json:"description"`
	Note          string  `json:"note,omitempty"`
	Category      string  `json:"category"`
	DebitAccount  string  `json:"debit_account"`
	DebitName     string  `json:"debit_name,omitempty"`
	CreditAccount string  `json:"credit_account"`
	CreditName    string  `json:"credit_name,omitempty"`
	DebitCHF      float64 `json:"debit_chf"`
	CreditCHF     float64 `json:"credit_chf"`
	SourceAmount  float64 `json:"source_amount"`
	SourceRef     string  `json:"source_ref,omitempty"`
	Year          string  `json:"year,omitempty"`
}

type historicalImportRequest struct {
	DryRun        bool                            `json:"dry_run"`
	ImportBatchID string                          `json:"import_batch_id"`
	Entries       []historicalJournalEntryPayload `json:"entries"`
}

type historicalImportReconciliation struct {
	ExpectedRows           int     `json:"expected_rows"`
	ActualRows             int     `json:"actual_rows"`
	ExpectedSourceTotalCHF float64 `json:"expected_source_total_chf"`
	ActualSourceTotalCHF   float64 `json:"actual_source_total_chf"`
	ExpectedSollHabenCHF   float64 `json:"expected_soll_haben_chf"`
	ActualSollCHF          float64 `json:"actual_soll_chf"`
	ActualHabenCHF         float64 `json:"actual_haben_chf"`
	Account1520SaldoCHF    float64 `json:"account_1520_saldo_chf"`
	Account6900SaldoCHF    float64 `json:"account_6900_saldo_chf"`
	MatchesExpected        bool    `json:"matches_expected"`
}

type historicalImportResponse struct {
	DryRun             bool                           `json:"dry_run"`
	ImportBatchID      string                         `json:"import_batch_id"`
	WouldImportCount   int                            `json:"would_import_count"`
	ImportedCount      int                            `json:"imported_count"`
	SkippedCount       int                            `json:"skipped_count"`
	DuplicateSourceIDs []string                       `json:"duplicate_source_ids"`
	TotalsByAccount    map[string]map[string]float64  `json:"totals_by_account"`
	TotalsByPerson     map[string]float64             `json:"totals_by_person"`
	Reconciliation     historicalImportReconciliation `json:"reconciliation"`
}

type historicalImportBatchPayload struct {
	ID                 string                         `json:"id"`
	SchemaVersion      string                         `json:"schema_version"`
	ImportedAt         string                         `json:"imported_at"`
	EntryCount         int                            `json:"entry_count"`
	Reconciliation     historicalImportReconciliation `json:"reconciliation"`
	DuplicateSourceIDs []string                       `json:"duplicate_source_ids"`
}

func defaultAccountingSettings() accountingSettingsPayload {
	return accountingSettingsPayload{
		SchemaVersion:                     accountingSchemaVersion,
		KMRateCHF:                         0.50,
		NightRateCHF:                      50,
		WorkdayRateCHF:                    100,
		MonthlyPaymentCHF:                 50,
		ReserveTargetCHF:                  2000,
		SurplusReservePercent:             70,
		SurplusHistoricalRepaymentPercent: 30,
	}
}

func normalizeAccountingSettings(settings accountingSettingsPayload) (accountingSettingsPayload, error) {
	defaults := defaultAccountingSettings()
	if settings.SchemaVersion == "" {
		settings.SchemaVersion = defaults.SchemaVersion
	}
	if settings.KMRateCHF == 0 &&
		settings.NightRateCHF == 0 &&
		settings.WorkdayRateCHF == 0 &&
		settings.MonthlyPaymentCHF == 0 &&
		settings.ReserveTargetCHF == 0 &&
		settings.SurplusReservePercent == 0 &&
		settings.SurplusHistoricalRepaymentPercent == 0 {
		settings.KMRateCHF = defaults.KMRateCHF
		settings.NightRateCHF = defaults.NightRateCHF
		settings.WorkdayRateCHF = defaults.WorkdayRateCHF
		settings.MonthlyPaymentCHF = defaults.MonthlyPaymentCHF
		settings.ReserveTargetCHF = defaults.ReserveTargetCHF
		settings.SurplusReservePercent = defaults.SurplusReservePercent
		settings.SurplusHistoricalRepaymentPercent = defaults.SurplusHistoricalRepaymentPercent
	}

	values := map[string]float64{
		"km_rate_chf":                          settings.KMRateCHF,
		"night_rate_chf":                       settings.NightRateCHF,
		"workday_rate_chf":                     settings.WorkdayRateCHF,
		"monthly_payment_chf":                  settings.MonthlyPaymentCHF,
		"reserve_target_chf":                   settings.ReserveTargetCHF,
		"surplus_reserve_percent":              settings.SurplusReservePercent,
		"surplus_historical_repayment_percent": settings.SurplusHistoricalRepaymentPercent,
	}
	for field, value := range values {
		if value < 0 {
			return accountingSettingsPayload{}, fmt.Errorf("%s must be non-negative", field)
		}
	}
	if settings.SurplusReservePercent+settings.SurplusHistoricalRepaymentPercent > 100 {
		return accountingSettingsPayload{}, errors.New("surplus reserve and historical repayment percentages may not exceed 100")
	}
	return settings, nil
}

func mergeAccountingSettingsPatch(base accountingSettingsPayload, raw []byte) (accountingSettingsPayload, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		raw = []byte(`{}`)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return accountingSettingsPayload{}, errors.New("invalid json payload")
	}
	settings, err := normalizeAccountingSettings(base)
	if err != nil {
		return accountingSettingsPayload{}, err
	}
	if rawValue, ok := fields["schema_version"]; ok {
		var value string
		if err := json.Unmarshal(rawValue, &value); err != nil {
			return accountingSettingsPayload{}, errors.New("schema_version must be a string")
		}
		settings.SchemaVersion = strings.TrimSpace(value)
	}
	numberFields := map[string]*float64{
		"km_rate_chf":                          &settings.KMRateCHF,
		"night_rate_chf":                       &settings.NightRateCHF,
		"workday_rate_chf":                     &settings.WorkdayRateCHF,
		"monthly_payment_chf":                  &settings.MonthlyPaymentCHF,
		"reserve_target_chf":                   &settings.ReserveTargetCHF,
		"surplus_reserve_percent":              &settings.SurplusReservePercent,
		"surplus_historical_repayment_percent": &settings.SurplusHistoricalRepaymentPercent,
	}
	for field, target := range numberFields {
		rawValue, ok := fields[field]
		if !ok || strings.TrimSpace(string(rawValue)) == "null" {
			continue
		}
		var value float64
		if err := json.Unmarshal(rawValue, &value); err != nil {
			return accountingSettingsPayload{}, fmt.Errorf("%s must be a number", field)
		}
		*target = value
	}
	return normalizeAccountingSettings(settings)
}

func normalizeCostAccountingFields(entry *costEntryPayload) {
	if entry.SchemaVersion == "" {
		entry.SchemaVersion = accountingSchemaVersion
	}
	if entry.Period == "" {
		entry.Period = accountingPeriodFromDate(entry.Date)
	}
	if entry.HistoricalOnly {
		entry.Historical = true
	}
	if entry.Bucket == "" {
		entry.Bucket = inferAccountingBucket(*entry)
	}
	if entry.FundingAccount == "" {
		entry.FundingAccount = inferFundingAccount(*entry)
	}
	if entry.AllocationBasis == "" {
		entry.AllocationBasis = inferAllocationBasis(*entry)
	}
	if entry.SourceType == "" {
		entry.SourceType = "manual"
	}
	if entry.SourceID == "" {
		entry.SourceID = entry.ID
	}
	entry.AffectsLiveBalance = !entry.HistoricalOnly && !entry.Historical && entry.Bucket != "private_ignore"
}

func validateCostAccountingFields(entry costEntryPayload) error {
	if _, ok := accountingBuckets[entry.Bucket]; !ok {
		return fmt.Errorf("invalid accounting bucket %q for entry %s", entry.Bucket, entry.ID)
	}
	if _, ok := fundingAccounts[entry.FundingAccount]; !ok {
		return fmt.Errorf("invalid funding account %q for entry %s", entry.FundingAccount, entry.ID)
	}
	if _, ok := allocationBases[entry.AllocationBasis]; !ok {
		return fmt.Errorf("invalid allocation basis %q for entry %s", entry.AllocationBasis, entry.ID)
	}
	return nil
}

func accountingPeriodFromDate(date string) string {
	trimmed := strings.TrimSpace(date)
	if len(trimmed) >= 7 {
		return trimmed[:7]
	}
	return ""
}

func isValidAccountingPeriod(period string) bool {
	if len(period) != 7 || period[4] != '-' {
		return false
	}
	year, yearErr := strconv.Atoi(period[:4])
	month, monthErr := strconv.Atoi(period[5:])
	return yearErr == nil && monthErr == nil && year > 0 && month >= 1 && month <= 12
}

func inferAccountingBucket(entry costEntryPayload) string {
	if entry.Type == "transfer" {
		return "settlement"
	}
	if entry.Type == "income" {
		return "income"
	}
	switch strings.TrimSpace(entry.Category) {
	case "vehicle_purchase", "hardware_material", "interior_build", "equipment":
		return "van_investment"
	case "repairs_service", "registration_fees", "insurance", "taxes":
		return "shared_running"
	case "fuel_energy":
		return "usage"
	case "trip_payout":
		return "income"
	case "settlement":
		return "settlement"
	default:
		return "shared_running"
	}
}

func inferFundingAccount(entry costEntryPayload) string {
	if entry.Bucket == "settlement" || entry.Bucket == "private_ignore" {
		return "personal"
	}
	return "personal"
}

func inferAllocationBasis(entry costEntryPayload) string {
	switch entry.Bucket {
	case "usage":
		return "km_night_usage"
	case "settlement", "income", "private_ignore":
		return "none"
	default:
		return "equal"
	}
}

func (h *handler) handleGetAccountingSettings(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	settings, err := h.getAccountingSettings(ctx)
	if err != nil {
		log.Printf("get accounting settings failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch accounting settings"), nil
	}
	return h.respond(http.StatusOK, settings), nil
}

func (h *handler) handlePutAccountingSettings(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	current, err := h.getAccountingSettings(ctx)
	if err != nil {
		log.Printf("get accounting settings before put failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch accounting settings"), nil
	}
	normalized, err := mergeAccountingSettingsPatch(current, []byte(request.Body))
	if err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}
	normalized.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := h.upsertJSONRecord(ctx, "accounting-settings", "accounting_settings", normalized); err != nil {
		log.Printf("put accounting settings failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to store accounting settings"), nil
	}
	return h.respond(http.StatusOK, normalized), nil
}

func (h *handler) getAccountingSettings(ctx context.Context) (accountingSettingsPayload, error) {
	result, err := h.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &h.costTableName,
		Key:       map[string]types.AttributeValue{"id": &types.AttributeValueMemberS{Value: "accounting-settings"}},
	})
	if err != nil {
		return accountingSettingsPayload{}, err
	}
	payload, ok := getPayloadString(result.Item)
	if !ok {
		return defaultAccountingSettings(), nil
	}
	var settings accountingSettingsPayload
	if err := json.Unmarshal([]byte(payload), &settings); err != nil {
		return accountingSettingsPayload{}, err
	}
	return normalizeAccountingSettings(settings)
}

func (h *handler) handleGetAccountingPreview(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	period := strings.TrimSpace(request.QueryStringParameters["period"])
	if period == "" {
		period = time.Now().UTC().Format("2006-01")
	}
	if !isValidAccountingPeriod(period) {
		return h.respondError(http.StatusBadRequest, "period must use YYYY-MM"), nil
	}

	projection, err := h.buildLiveAccountingProjection(ctx, period)
	if err != nil {
		log.Printf("accounting preview calculation failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to calculate accounting preview"), nil
	}
	return h.respond(http.StatusOK, projection), nil
}

func (h *handler) buildLiveAccountingProjection(ctx context.Context, period string) (accountingProjectionPayload, error) {
	settings, err := h.getAccountingSettings(ctx)
	if err != nil {
		return accountingProjectionPayload{}, err
	}
	trips, err := h.listTrips(ctx)
	if err != nil {
		return accountingProjectionPayload{}, err
	}
	bookings, err := h.listAllBookings(ctx)
	if err != nil {
		return accountingProjectionPayload{}, err
	}
	workState, err := h.getWorkState(ctx)
	if err != nil {
		return accountingProjectionPayload{}, err
	}
	costEntries, err := h.listCostEntries(ctx)
	if err != nil {
		return accountingProjectionPayload{}, err
	}

	return buildAccountingProjection(accountingProjectionInput{
		CostEntries: costEntries,
		Trips:       trips,
		Bookings:    bookings,
		WorkEntries: workState.Entries,
		Settings:    settings,
		People:      defaultAccountingPeople,
		Period:      period,
	})
}

func (h *handler) handleCreateMonthlyClose(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var close monthlyClosePayload
	if err := json.Unmarshal([]byte(request.Body), &close); err != nil {
		return h.respondError(http.StatusBadRequest, "invalid json payload"), nil
	}
	close.ID = strings.TrimSpace(close.ID)
	close.Period = strings.TrimSpace(close.Period)
	close.Notes = strings.TrimSpace(close.Notes)
	if close.Period == "" {
		return h.respondError(http.StatusBadRequest, "period is required"), nil
	}
	if !isValidAccountingPeriod(close.Period) {
		return h.respondError(http.StatusBadRequest, "period must use YYYY-MM"), nil
	}
	if close.ID != "" && close.ID != close.Period {
		return h.respondError(http.StatusBadRequest, "monthly close id must match period"), nil
	}

	projection, err := h.buildLiveAccountingProjection(ctx, close.Period)
	if err != nil {
		log.Printf("monthly close preview calculation failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to calculate monthly close"), nil
	}
	normalized, err := normalizeMonthlyClose(monthlyCloseFromProjection(projection, close.Notes))
	if err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}
	if err := h.putJSONRecord(ctx, monthlyCloseKey(normalized.ID), "monthly_close", normalized, false); err != nil {
		log.Printf("create monthly close failed: %v", err)
		var conditionalErr *types.ConditionalCheckFailedException
		if errors.As(err, &conditionalErr) {
			return h.respondError(http.StatusConflict, "monthly close already exists"), nil
		}
		return h.respondError(http.StatusInternalServerError, "failed to store monthly close"), nil
	}
	return h.respond(http.StatusOK, normalized), nil
}

func (h *handler) handleListMonthlyCloses(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	closes, err := h.listMonthlyCloses(ctx)
	if err != nil {
		log.Printf("list monthly closes failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch monthly closes"), nil
	}
	return h.respond(http.StatusOK, map[string]any{"items": closes}), nil
}

func normalizeMonthlyClose(close monthlyClosePayload) (monthlyClosePayload, error) {
	close.ID = strings.TrimSpace(close.ID)
	close.Period = strings.TrimSpace(close.Period)
	close.SchemaVersion = strings.TrimSpace(close.SchemaVersion)
	close.Notes = strings.TrimSpace(close.Notes)
	if close.Period == "" {
		return monthlyClosePayload{}, errors.New("period is required")
	}
	if !isValidAccountingPeriod(close.Period) {
		return monthlyClosePayload{}, errors.New("period must use YYYY-MM")
	}
	if close.ID != "" && close.ID != close.Period {
		return monthlyClosePayload{}, errors.New("monthly close id must match period")
	}
	close.ID = close.Period
	if close.SchemaVersion == "" {
		close.SchemaVersion = accountingSchemaVersion
	}
	settings, err := normalizeAccountingSettings(close.Settings)
	if err != nil {
		return monthlyClosePayload{}, err
	}
	close.Settings = settings
	now := time.Now().UTC().Format(time.RFC3339)
	if close.CreatedAt == "" {
		close.CreatedAt = now
	}
	close.UpdatedAt = now
	if close.Totals == nil {
		close.Totals = map[string]float64{}
	} else {
		close.Totals = roundMap(close.Totals)
	}
	if close.EntryCounts == nil {
		close.EntryCounts = map[string]int{}
	}
	if close.PersonBalances == nil {
		close.PersonBalances = map[string]float64{}
	} else {
		close.PersonBalances = roundMap(close.PersonBalances)
	}
	if close.SettlementBalances == nil {
		close.SettlementBalances = map[string]float64{}
	} else {
		close.SettlementBalances = roundMap(close.SettlementBalances)
	}
	for index := range close.SuggestedSettlements {
		close.SuggestedSettlements[index].FromPerson = strings.TrimSpace(close.SuggestedSettlements[index].FromPerson)
		close.SuggestedSettlements[index].ToPerson = strings.TrimSpace(close.SuggestedSettlements[index].ToPerson)
		close.SuggestedSettlements[index].Reason = strings.TrimSpace(close.SuggestedSettlements[index].Reason)
		close.SuggestedSettlements[index].AmountCHF = roundMoney(close.SuggestedSettlements[index].AmountCHF)
		if close.SuggestedSettlements[index].FromPerson == "" || close.SuggestedSettlements[index].ToPerson == "" {
			return monthlyClosePayload{}, errors.New("suggested settlements require from_person and to_person")
		}
		if close.SuggestedSettlements[index].AmountCHF <= 0 {
			return monthlyClosePayload{}, errors.New("suggested settlement amount_chf must be positive")
		}
	}
	return close, nil
}

func monthlyCloseKey(id string) string {
	return "monthly-close#" + strings.TrimSpace(id)
}

func closedAccountingPeriods(closes []monthlyClosePayload) map[string]struct{} {
	periods := make(map[string]struct{}, len(closes))
	for _, close := range closes {
		period := strings.TrimSpace(close.Period)
		if period == "" {
			period = strings.TrimSpace(close.ID)
		}
		if isValidAccountingPeriod(period) {
			periods[period] = struct{}{}
		}
	}
	return periods
}

func costEntryAccountingPeriod(entry costEntryPayload) string {
	period := strings.TrimSpace(entry.Period)
	if period != "" {
		return period
	}
	return accountingPeriodFromDate(entry.Date)
}

func closedPeriodForCostEntry(entry costEntryPayload, periods map[string]struct{}) (string, bool) {
	period := costEntryAccountingPeriod(entry)
	if period == "" {
		return "", false
	}
	_, closed := periods[period]
	return period, closed
}

func closedPeriodForTrip(trip tripRecord, periods map[string]struct{}) (string, bool) {
	period := accountingPeriodFromDate(trip.Timestamp)
	if period == "" {
		return "", false
	}
	_, closed := periods[period]
	return period, closed
}

func accountingPeriodsForBooking(booking bookingRecord) []string {
	start, startErr := parseDate(booking.StartDate)
	end, endErr := parseDate(booking.EndDate)
	if startErr != nil || endErr != nil || !start.Before(end) {
		period := accountingPeriodFromDate(booking.StartDate)
		if period == "" {
			return []string{}
		}
		return []string{period}
	}

	firstOfMonth := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
	periods := []string{}
	seen := map[string]struct{}{}
	for cursor := firstOfMonth; cursor.Before(end); cursor = cursor.AddDate(0, 1, 0) {
		period := cursor.Format("2006-01")
		if _, ok := seen[period]; ok {
			continue
		}
		seen[period] = struct{}{}
		periods = append(periods, period)
	}
	return periods
}

func closedPeriodForBooking(booking bookingRecord, periods map[string]struct{}) (string, bool) {
	for _, period := range accountingPeriodsForBooking(booking) {
		if _, closed := periods[period]; closed {
			return period, true
		}
	}
	return "", false
}

func closedPeriodForWorkEntry(entry workEntryPayload, periods map[string]struct{}) (string, bool) {
	period := strings.TrimSpace(entry.Month)
	if period == "" {
		return "", false
	}
	_, closed := periods[period]
	return period, closed
}

func monthlyCloseFromProjection(projection accountingProjectionPayload, notes string) monthlyClosePayload {
	return monthlyClosePayload{
		ID:            projection.Period,
		Period:        projection.Period,
		SchemaVersion: accountingSchemaVersion,
		Settings:      projection.Settings,
		Totals: map[string]float64{
			"monthly_contributions_chf":       projection.MonthlyContributionsCHF,
			"shared_pot_inflow_chf":           projection.SharedPot.InflowCHF,
			"shared_pot_outflow_chf":          projection.SharedPot.OutflowCHF,
			"shared_pot_balance_chf":          projection.SharedPot.BalanceCHF,
			"contributions_due_chf":           projection.SharedPot.ContributionsDueCHF,
			"contributions_paid_chf":          projection.SharedPot.ContributionsPaidCHF,
			"usage_charges_chf":               projection.SharedPot.UsageChargesCHF,
			"external_income_chf":             projection.SharedPot.ExternalIncomeCHF,
			"current_costs_chf":               projection.SharedPot.CurrentCostsCHF,
			"reserve_allocation_chf":          projection.SharedPot.ReserveAllocationCHF,
			"historical_repayment_chf":        projection.SharedPot.HistoricalRepaymentCHF,
			"historical_investment_basis_chf": projection.Historical.InvestmentCHF,
		},
		EntryCounts: map[string]int{
			"cost_entries":            projection.SourceCounts.CostEntries,
			"historical_cost_entries": projection.SourceCounts.HistoricalCostEntries,
			"trip_entries":            projection.SourceCounts.TripEntries,
			"booking_entries":         projection.SourceCounts.BookingEntries,
			"work_entries":            projection.SourceCounts.WorkEntries,
		},
		PersonBalances:       projection.PersonBalances,
		SettlementBalances:   projection.SettlementBalances,
		SuggestedSettlements: projection.SuggestedSettlements,
		Notes:                strings.TrimSpace(notes),
	}
}

func buildAccountingProjection(input accountingProjectionInput) (accountingProjectionPayload, error) {
	period := strings.TrimSpace(input.Period)
	if period == "" {
		period = time.Now().UTC().Format("2006-01")
	}
	if !isValidAccountingPeriod(period) {
		return accountingProjectionPayload{}, errors.New("period must use YYYY-MM")
	}
	settings, err := normalizeAccountingSettings(input.Settings)
	if err != nil {
		return accountingProjectionPayload{}, err
	}
	people := cleanPeople(input.People)
	if len(people) == 0 {
		people = append([]string(nil), defaultAccountingPeople...)
	}

	normalizedCosts := normalizeProjectionCostEntries(input.CostEntries)
	liveCostEntries := make([]costEntryPayload, 0, len(normalizedCosts))
	historicalCostEntries := make([]costEntryPayload, 0)
	for _, entry := range normalizedCosts {
		if entry.Historical {
			historicalCostEntries = append(historicalCostEntries, entry)
		}
		if entry.AffectsLiveBalance && dateInAccountingPeriod(entry.Date, period) {
			liveCostEntries = append(liveCostEntries, entry)
		}
	}
	periodTrips := filterTripsByPeriod(input.Trips, period)
	periodBookings := filterBookingsByPeriod(input.Bookings, period)
	periodWorkEntries := filterWorkEntriesByPeriod(input.WorkEntries, period)

	balances := emptyAccountingPersonMap(people)
	settlementBalances := emptyAccountingPersonMap(people)
	settlementBalances[sharedPotAccount] = 0
	usageByPerson := emptyAccountingPersonMap(people)
	workCreditsByPerson := emptyAccountingPersonMap(people)
	kmByPerson := emptyAccountingPersonMap(people)
	nightsByPerson := emptyAccountingPersonMap(people)
	bucketTotals := emptyAccountingBucketMap()
	monthlyContributions := roundMoney(settings.MonthlyPaymentCHF * float64(len(people)))

	projection := accountingProjectionPayload{
		Period:                  period,
		Settings:                settings,
		MonthlyContributionsCHF: monthlyContributions,
		UsageByPerson:           usageByPerson,
		WorkCreditsByPerson:     workCreditsByPerson,
		KMByPerson:              kmByPerson,
		NightsByPerson:          nightsByPerson,
		BucketTotals:            bucketTotals,
		PersonBalances:          balances,
		SettlementBalances:      settlementBalances,
		SourceCounts: accountingSourceCounts{
			CostEntries:           len(liveCostEntries),
			HistoricalCostEntries: len(historicalCostEntries),
			TripEntries:           len(periodTrips),
			BookingEntries:        len(periodBookings),
			WorkEntries:           len(periodWorkEntries),
		},
		Historical: accountingHistoricalSummary{
			InvestmentCHF: historicalInvestmentTotal(historicalCostEntries),
			Rows:          len(historicalCostEntries),
		},
	}

	for _, person := range people {
		addAccountingBalance(balances, person, -settings.MonthlyPaymentCHF)
		addAccountingBalance(settlementBalances, person, -settings.MonthlyPaymentCHF)
	}
	addAccountingBalance(settlementBalances, sharedPotAccount, monthlyContributions)
	projection.SharedPot.ContributionsDueCHF = monthlyContributions
	projection.SharedPot.InflowCHF = roundMoney(projection.SharedPot.InflowCHF + monthlyContributions)

	for _, trip := range periodTrips {
		if !containsString(people, trip.UserName) {
			continue
		}
		cost := roundMoney(trip.DeltaKM * settings.KMRateCHF)
		kmByPerson[trip.UserName] = roundMoney(kmByPerson[trip.UserName] + trip.DeltaKM)
		usageByPerson[trip.UserName] = roundMoney(usageByPerson[trip.UserName] + cost)
		bucketTotals["usage"] = roundMoney(bucketTotals["usage"] + cost)
		addAccountingBalance(balances, trip.UserName, -cost)
		addAccountingBalance(settlementBalances, trip.UserName, -cost)
		addAccountingBalance(settlementBalances, sharedPotAccount, cost)
		projection.SharedPot.UsageChargesCHF = roundMoney(projection.SharedPot.UsageChargesCHF + cost)
		projection.SharedPot.InflowCHF = roundMoney(projection.SharedPot.InflowCHF + cost)
	}

	for _, booking := range periodBookings {
		person := resolveAccountingBookingPerson(booking, people)
		nights := accountingBookingNights(booking)
		if person != "" {
			cost := roundMoney(nights * settings.NightRateCHF)
			nightsByPerson[person] = roundMoney(nightsByPerson[person] + nights)
			usageByPerson[person] = roundMoney(usageByPerson[person] + cost)
			bucketTotals["usage"] = roundMoney(bucketTotals["usage"] + cost)
			addAccountingBalance(balances, person, -cost)
			addAccountingBalance(settlementBalances, person, -cost)
			addAccountingBalance(settlementBalances, sharedPotAccount, cost)
			projection.SharedPot.UsageChargesCHF = roundMoney(projection.SharedPot.UsageChargesCHF + cost)
			projection.SharedPot.InflowCHF = roundMoney(projection.SharedPot.InflowCHF + cost)
			continue
		}
		if booking.PaymentStatus == "paid" || booking.PaymentStatus == "partial" {
			income := roundMoney(booking.EstimateTotal)
			bucketTotals["income"] = roundMoney(bucketTotals["income"] + income)
			projection.SharedPot.ExternalIncomeCHF = roundMoney(projection.SharedPot.ExternalIncomeCHF + income)
			projection.SharedPot.InflowCHF = roundMoney(projection.SharedPot.InflowCHF + income)
		}
	}

	for _, entry := range periodWorkEntries {
		if !containsString(people, entry.Person) {
			continue
		}
		credit := roundMoney(entry.Days * settings.WorkdayRateCHF)
		workCreditsByPerson[entry.Person] = roundMoney(workCreditsByPerson[entry.Person] + credit)
		bucketTotals["work_credit"] = roundMoney(bucketTotals["work_credit"] + credit)
		addAccountingBalance(balances, entry.Person, credit)
		addAccountingBalance(settlementBalances, entry.Person, credit)
		addAccountingBalance(settlementBalances, sharedPotAccount, -credit)
		projection.SharedPot.OutflowCHF = roundMoney(projection.SharedPot.OutflowCHF + credit)
	}

	for _, entry := range liveCostEntries {
		amount := roundMoney(entry.AmountCHF)
		if amount <= 0 {
			continue
		}
		bucketTotals[entry.Bucket] = roundMoney(bucketTotals[entry.Bucket] + amount)
		if entry.Type == "transfer" {
			addAccountingBalance(balances, entry.FromPerson, amount)
			addAccountingBalance(balances, entry.ToPerson, -amount)
			addAccountingBalance(settlementBalances, entry.FromPerson, amount)
			addAccountingBalance(settlementBalances, entry.ToPerson, -amount)
			if entry.ToPerson == sharedPotAccount {
				projection.SharedPot.ContributionsPaidCHF = roundMoney(projection.SharedPot.ContributionsPaidCHF + amount)
			}
			continue
		}
		if entry.Type == "income" {
			if entry.FundingAccount == "personal" && containsString(people, entry.PaidBy) {
				addAccountingBalance(balances, entry.PaidBy, -amount)
				addAccountingBalance(settlementBalances, entry.PaidBy, -amount)
				addAccountingBalance(settlementBalances, sharedPotAccount, amount)
			}
			projection.SharedPot.ExternalIncomeCHF = roundMoney(projection.SharedPot.ExternalIncomeCHF + amount)
			projection.SharedPot.InflowCHF = roundMoney(projection.SharedPot.InflowCHF + amount)
			continue
		}
		if entry.Bucket == "shared_running" || entry.Bucket == "usage" {
			projection.SharedPot.CurrentCostsCHF = roundMoney(projection.SharedPot.CurrentCostsCHF + amount)
			projection.SharedPot.OutflowCHF = roundMoney(projection.SharedPot.OutflowCHF + amount)
			if entry.FundingAccount != sharedPotAccount {
				addAccountingBalance(balances, entry.PaidBy, amount)
				addAccountingBalance(settlementBalances, entry.PaidBy, amount)
				addAccountingBalance(settlementBalances, sharedPotAccount, -amount)
			}
			continue
		}
		if entry.FundingAccount == sharedPotAccount {
			projection.SharedPot.OutflowCHF = roundMoney(projection.SharedPot.OutflowCHF + amount)
			continue
		}
		addAccountingBalance(balances, entry.PaidBy, amount)
		participants := entry.Participants
		if len(participants) == 0 {
			participants = people
		}
		for _, split := range splitAccountingAmount(amount, participants) {
			addAccountingBalance(balances, split.Person, -split.Amount)
		}
	}

	surplusBeforePolicy := roundMoney(math.Max(0, projection.SharedPot.InflowCHF-projection.SharedPot.OutflowCHF))
	reserveNeed := math.Max(0, settings.ReserveTargetCHF)
	reserveAllocation := roundMoney(math.Min(reserveNeed, surplusBeforePolicy*(settings.SurplusReservePercent/100)))
	historicalRepayment := roundMoney(math.Min(
		math.Max(0, surplusBeforePolicy-reserveAllocation),
		surplusBeforePolicy*(settings.SurplusHistoricalRepaymentPercent/100),
	))
	projection.SharedPot.ReserveAllocationCHF = reserveAllocation
	projection.SharedPot.HistoricalRepaymentCHF = historicalRepayment
	projection.SharedPot.OutflowCHF = roundMoney(projection.SharedPot.OutflowCHF + reserveAllocation + historicalRepayment)
	projection.SharedPot.BalanceCHF = roundMoney(projection.SharedPot.InflowCHF - projection.SharedPot.OutflowCHF)
	projection.PersonBalances = roundMap(balances)
	projection.SettlementBalances = roundMap(settlementBalances)
	projection.SuggestedSettlements = buildAccountingSuggestedSettlements(projection.SettlementBalances, people)

	return projection, nil
}

func normalizeProjectionCostEntries(entries []costEntryPayload) []costEntryPayload {
	normalized := make([]costEntryPayload, 0, len(entries))
	for _, entry := range entries {
		normalizeCostAccountingFields(&entry)
		normalized = append(normalized, entry)
	}
	return normalized
}

func cleanPeople(people []string) []string {
	cleaned := make([]string, 0, len(people))
	seen := map[string]struct{}{}
	for _, person := range people {
		trimmed := strings.TrimSpace(person)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		cleaned = append(cleaned, trimmed)
	}
	return cleaned
}

func emptyAccountingPersonMap(people []string) map[string]float64 {
	values := make(map[string]float64, len(people))
	for _, person := range people {
		values[person] = 0
	}
	return values
}

func emptyAccountingBucketMap() map[string]float64 {
	values := make(map[string]float64, len(accountingBuckets))
	for bucket := range accountingBuckets {
		values[bucket] = 0
	}
	return values
}

func addAccountingBalance(balances map[string]float64, person string, amount float64) {
	if _, ok := balances[person]; !ok {
		return
	}
	balances[person] = roundMoney(balances[person] + amount)
}

func dateInAccountingPeriod(value, period string) bool {
	return period == "" || accountingPeriodFromDate(value) == period
}

func filterTripsByPeriod(trips []tripRecord, period string) []tripRecord {
	filtered := make([]tripRecord, 0, len(trips))
	for _, trip := range trips {
		if dateInAccountingPeriod(trip.Timestamp, period) {
			filtered = append(filtered, trip)
		}
	}
	return filtered
}

func filterBookingsByPeriod(bookings []bookingRecord, period string) []bookingRecord {
	filtered := make([]bookingRecord, 0, len(bookings))
	for _, booking := range bookings {
		if booking.Status == "booked" && dateInAccountingPeriod(booking.StartDate, period) {
			filtered = append(filtered, booking)
		}
	}
	return filtered
}

func filterWorkEntriesByPeriod(entries []workEntryPayload, period string) []workEntryPayload {
	filtered := make([]workEntryPayload, 0, len(entries))
	for _, entry := range entries {
		if entry.Month == period {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}

func resolveAccountingBookingPerson(booking bookingRecord, people []string) string {
	for _, candidate := range []string{booking.GuestName, booking.PaidBy, booking.PaidTo} {
		if containsString(people, candidate) {
			return candidate
		}
	}
	return ""
}

func accountingBookingNights(booking bookingRecord) float64 {
	if booking.Nights > 0 {
		return float64(booking.Nights)
	}
	start, startErr := parseDate(booking.StartDate)
	end, endErr := parseDate(booking.EndDate)
	if startErr != nil || endErr != nil || !start.Before(end) {
		return 0
	}
	return end.Sub(start).Hours() / 24
}

func historicalInvestmentTotal(entries []costEntryPayload) float64 {
	total := 0.0
	for _, entry := range entries {
		if entry.Bucket == "historical_investment" {
			total += entry.AmountCHF
		}
	}
	return roundMoney(total)
}

type accountingSplit struct {
	Person string
	Amount float64
}

func splitAccountingAmount(amount float64, participants []string) []accountingSplit {
	cleaned := cleanPeople(participants)
	if len(cleaned) == 0 {
		return []accountingSplit{}
	}
	share := roundMoney(amount / float64(len(cleaned)))
	splits := make([]accountingSplit, 0, len(cleaned))
	for _, person := range cleaned {
		splits = append(splits, accountingSplit{Person: person, Amount: share})
	}
	return splits
}

func buildAccountingSuggestedSettlements(balances map[string]float64, people []string) []settlementSuggestionPayload {
	working := roundMap(balances)
	rows := []settlementSuggestionPayload{}
	if _, ok := working[sharedPotAccount]; !ok {
		return rows
	}
	for _, person := range people {
		amount := working[person]
		if amount >= -0.005 {
			continue
		}
		moved := moveAccountingSettlementBalance(person, sharedPotAccount, -amount, "Shared pot due", &rows)
		working[person] = roundMoney(working[person] + moved)
		working[sharedPotAccount] = roundMoney(working[sharedPotAccount] - moved)
	}
	for _, person := range people {
		amount := working[person]
		if amount <= 0.005 {
			continue
		}
		moved := moveAccountingSettlementBalance(sharedPotAccount, person, amount, "Shared pot reimbursement", &rows)
		working[sharedPotAccount] = roundMoney(working[sharedPotAccount] + moved)
		working[person] = roundMoney(working[person] - moved)
	}
	return rows
}

func moveAccountingSettlementBalance(from, to string, amount float64, reason string, rows *[]settlementSuggestionPayload) float64 {
	rounded := roundMoney(amount)
	if strings.TrimSpace(from) == "" || strings.TrimSpace(to) == "" || rounded <= 0 {
		return 0
	}
	*rows = append(*rows, settlementSuggestionPayload{
		FromPerson: from,
		ToPerson:   to,
		AmountCHF:  rounded,
		Reason:     reason,
	})
	return rounded
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func (h *handler) listMonthlyCloses(ctx context.Context) ([]monthlyClosePayload, error) {
	items, err := h.scanAllItems(ctx, h.costTableName)
	if err != nil {
		return nil, err
	}
	closes := make([]monthlyClosePayload, 0)
	for _, item := range items {
		itemType, ok := getStringAttribute(item, "item_type")
		if !ok || itemType != "monthly_close" {
			continue
		}
		payload, ok := getPayloadString(item)
		if !ok {
			continue
		}
		var close monthlyClosePayload
		if err := json.Unmarshal([]byte(payload), &close); err != nil {
			continue
		}
		closes = append(closes, close)
	}
	sort.Slice(closes, func(i, j int) bool { return closes[i].Period < closes[j].Period })
	return closes, nil
}

func (h *handler) handleImportHistoricalAccounting(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var importRequest historicalImportRequest
	if err := json.Unmarshal([]byte(request.Body), &importRequest); err != nil {
		return h.respondError(http.StatusBadRequest, "invalid json payload"), nil
	}
	existingEntries, err := h.listCostEntries(ctx)
	if err != nil {
		log.Printf("list entries for historical import failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to prepare historical import"), nil
	}
	existingIDs := make(map[string]struct{}, len(existingEntries))
	for _, entry := range existingEntries {
		existingIDs[entry.ID] = struct{}{}
	}
	response, normalizedEntries, batch, err := buildHistoricalImport(importRequest, existingIDs)
	if err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}
	if importRequest.DryRun {
		return h.respond(http.StatusOK, response), nil
	}
	imported := 0
	for _, entry := range normalizedEntries {
		if _, exists := existingIDs[entry.ID]; exists {
			continue
		}
		if err := h.putCostEntry(ctx, entry, false); err != nil {
			var conditionalErr *types.ConditionalCheckFailedException
			if errors.As(err, &conditionalErr) {
				continue
			}
			log.Printf("historical import put entry failed: %v", err)
			return h.respondError(http.StatusInternalServerError, "failed to store historical import"), nil
		}
		imported += 1
	}
	batch.EntryCount = imported
	if err := h.putJSONRecord(ctx, historicalImportBatchKey(batch.ID), "historical_import_batch", batch, false); err != nil {
		var conditionalErr *types.ConditionalCheckFailedException
		if !errors.As(err, &conditionalErr) {
			log.Printf("historical import put batch failed: %v", err)
			return h.respondError(http.StatusInternalServerError, "failed to store historical import batch"), nil
		}
	}
	response.ImportedCount = imported
	response.SkippedCount = response.WouldImportCount - imported
	return h.respond(http.StatusOK, response), nil
}

func buildHistoricalImport(request historicalImportRequest, existingIDs map[string]struct{}) (historicalImportResponse, []costEntryPayload, historicalImportBatchPayload, error) {
	batchID := strings.TrimSpace(request.ImportBatchID)
	if batchID == "" {
		batchID = "historical-sheet"
	}
	if len(request.Entries) == 0 {
		return historicalImportResponse{}, nil, historicalImportBatchPayload{}, errors.New("entries are required")
	}

	accountTotals := map[string]map[string]float64{}
	personTotals := map[string]float64{}
	seen := map[string]struct{}{}
	duplicates := []string{}
	normalizedEntries := make([]costEntryPayload, 0, len(request.Entries))
	var sourceTotal, debitTotal, creditTotal float64

	for _, row := range request.Entries {
		bookingID := strings.TrimSpace(row.BookingID)
		if bookingID == "" {
			return historicalImportResponse{}, nil, historicalImportBatchPayload{}, errors.New("booking_id is required for every historical row")
		}
		entryID := fmt.Sprintf("%s:%s", batchID, bookingID)
		if _, exists := seen[entryID]; exists {
			duplicates = append(duplicates, entryID)
		}
		if _, exists := existingIDs[entryID]; exists {
			duplicates = append(duplicates, entryID)
		}
		seen[entryID] = struct{}{}
		sourceTotal += row.SourceAmount
		debitTotal += row.DebitCHF
		creditTotal += row.CreditCHF
		personTotals[strings.TrimSpace(row.Person)] += row.SourceAmount
		addAccountTotal(accountTotals, row.DebitAccount, "debit_chf", row.DebitCHF)
		addAccountTotal(accountTotals, row.CreditAccount, "credit_chf", row.CreditCHF)

		entry := historicalRowToCostEntry(batchID, row)
		normalizeCostAccountingFields(&entry)
		normalizedEntries = append(normalizedEntries, entry)
	}
	for account, totals := range accountTotals {
		totals["saldo_chf"] = roundMoney(totals["debit_chf"] - totals["credit_chf"])
		accountTotals[account] = totals
	}

	reconciliation := historicalImportReconciliation{
		ExpectedRows:           216,
		ActualRows:             len(request.Entries),
		ExpectedSourceTotalCHF: roundMoney(35833.69),
		ActualSourceTotalCHF:   roundMoney(sourceTotal),
		ExpectedSollHabenCHF:   roundMoney(76127.69),
		ActualSollCHF:          roundMoney(debitTotal),
		ActualHabenCHF:         roundMoney(creditTotal),
		Account1520SaldoCHF:    roundMoney(accountTotals["1520"]["saldo_chf"]),
		Account6900SaldoCHF:    roundMoney(accountTotals["6900"]["saldo_chf"]),
	}
	reconciliation.MatchesExpected = reconciliation.ActualRows == reconciliation.ExpectedRows &&
		reconciliation.ActualSourceTotalCHF == reconciliation.ExpectedSourceTotalCHF &&
		reconciliation.ActualSollCHF == reconciliation.ExpectedSollHabenCHF &&
		reconciliation.ActualHabenCHF == reconciliation.ExpectedSollHabenCHF &&
		reconciliation.Account1520SaldoCHF == 0 &&
		reconciliation.Account6900SaldoCHF == 0

	sort.Strings(duplicates)
	duplicates = uniqueStrings(duplicates)
	response := historicalImportResponse{
		DryRun:             request.DryRun,
		ImportBatchID:      batchID,
		WouldImportCount:   len(normalizedEntries),
		SkippedCount:       len(duplicates),
		DuplicateSourceIDs: duplicates,
		TotalsByAccount:    accountTotals,
		TotalsByPerson:     roundMap(personTotals),
		Reconciliation:     reconciliation,
	}
	batch := historicalImportBatchPayload{
		ID:                 batchID,
		SchemaVersion:      accountingSchemaVersion,
		ImportedAt:         time.Now().UTC().Format(time.RFC3339),
		EntryCount:         len(normalizedEntries),
		Reconciliation:     reconciliation,
		DuplicateSourceIDs: duplicates,
	}
	return response, normalizedEntries, batch, nil
}

func historicalRowToCostEntry(batchID string, row historicalJournalEntryPayload) costEntryPayload {
	sourceAmount := row.SourceAmount
	entryType := "expense"
	if sourceAmount < 0 {
		entryType = "income"
	}
	date := strings.TrimSpace(row.Date)
	if date == "" {
		year := strings.TrimSpace(row.Year)
		if len(year) == 4 {
			date = year + "-01-01"
		} else {
			date = "2026-01-01"
		}
	}
	bucket := historicalBucketFromAccounts(row.DebitAccount, row.CreditAccount)
	entry := costEntryPayload{
		ID:                 fmt.Sprintf("%s:%s", batchID, strings.TrimSpace(row.BookingID)),
		Date:               date,
		Type:               entryType,
		AmountCHF:          roundMoney(absFloat(sourceAmount)),
		Description:        strings.TrimSpace(row.Description),
		Category:           strings.TrimSpace(row.Category),
		PaidBy:             strings.TrimSpace(row.Person),
		Participants:       []string{"Nic", "Kayla", "Jeanne", "Lüku"},
		HistoricalOnly:     true,
		SchemaVersion:      accountingSchemaVersion,
		Bucket:             bucket,
		FundingAccount:     "personal",
		AllocationBasis:    "equal",
		SourceType:         "historical_sheet",
		SourceID:           strings.TrimSpace(row.BookingID),
		SourceRef:          strings.TrimSpace(row.SourceRef),
		DebitAccount:       strings.TrimSpace(row.DebitAccount),
		DebitName:          strings.TrimSpace(row.DebitName),
		CreditAccount:      strings.TrimSpace(row.CreditAccount),
		CreditName:         strings.TrimSpace(row.CreditName),
		SourceAmountCHF:    roundMoney(sourceAmount),
		Historical:         true,
		ImportBatchID:      batchID,
		AffectsLiveBalance: false,
		Notes:              strings.TrimSpace(row.Note),
	}
	if bucket == "settlement" {
		entry.Type = "transfer"
		entry.Participants = nil
		entry.FromPerson = strings.TrimSpace(row.Person)
		entry.ToPerson = "shared_pot"
		entry.AllocationBasis = "none"
	}
	if bucket == "usage" {
		entry.AllocationBasis = "km_night_usage"
	}
	return entry
}

func historicalBucketFromAccounts(debitAccount, creditAccount string) string {
	account := strings.TrimSpace(debitAccount)
	if strings.HasPrefix(account, "2") {
		account = strings.TrimSpace(creditAccount)
	}
	switch account {
	case "1400", "1510":
		return "historical_investment"
	case "6000", "6100":
		return "shared_running"
	case "6200":
		return "usage"
	case "2990":
		return "settlement"
	case "3400":
		return "income"
	default:
		return "private_ignore"
	}
}

func (h *handler) listHistoricalImportBatches(ctx context.Context) ([]historicalImportBatchPayload, error) {
	items, err := h.scanAllItems(ctx, h.costTableName)
	if err != nil {
		return nil, err
	}
	batches := make([]historicalImportBatchPayload, 0)
	for _, item := range items {
		itemType, ok := getStringAttribute(item, "item_type")
		if !ok || itemType != "historical_import_batch" {
			continue
		}
		payload, ok := getPayloadString(item)
		if !ok {
			continue
		}
		var batch historicalImportBatchPayload
		if err := json.Unmarshal([]byte(payload), &batch); err != nil {
			continue
		}
		batches = append(batches, batch)
	}
	sort.Slice(batches, func(i, j int) bool { return batches[i].ImportedAt < batches[j].ImportedAt })
	return batches, nil
}

func historicalImportBatchKey(id string) string {
	return "historical-import-batch#" + strings.TrimSpace(id)
}

func addAccountTotal(totals map[string]map[string]float64, account, key string, value float64) {
	account = strings.TrimSpace(account)
	if account == "" {
		return
	}
	if _, ok := totals[account]; !ok {
		totals[account] = map[string]float64{"debit_chf": 0, "credit_chf": 0, "saldo_chf": 0}
	}
	totals[account][key] = roundMoney(totals[account][key] + value)
}

func roundMap(values map[string]float64) map[string]float64 {
	rounded := make(map[string]float64, len(values))
	for key, value := range values {
		rounded[key] = roundMoney(value)
	}
	return rounded
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return values
	}
	result := []string{}
	previous := ""
	for _, value := range values {
		if value == previous {
			continue
		}
		result = append(result, value)
		previous = value
	}
	return result
}

func absFloat(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

func (h *handler) putJSONRecord(ctx context.Context, id, itemType string, payload any, mustExist bool) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	item := map[string]types.AttributeValue{
		"id":         &types.AttributeValueMemberS{Value: id},
		"item_type":  &types.AttributeValueMemberS{Value: itemType},
		"payload":    &types.AttributeValueMemberS{Value: string(payloadBytes)},
		"updated_at": &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
	}
	input := &dynamodb.PutItemInput{
		TableName: &h.costTableName,
		Item:      item,
	}
	if mustExist {
		input.ConditionExpression = awsString("attribute_exists(id)")
	} else {
		input.ConditionExpression = awsString("attribute_not_exists(id)")
	}
	_, err = h.db.PutItem(ctx, input)
	return err
}

func (h *handler) upsertJSONRecord(ctx context.Context, id, itemType string, payload any) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	item := map[string]types.AttributeValue{
		"id":         &types.AttributeValueMemberS{Value: id},
		"item_type":  &types.AttributeValueMemberS{Value: itemType},
		"payload":    &types.AttributeValueMemberS{Value: string(payloadBytes)},
		"updated_at": &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
	}
	_, err = h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.costTableName,
		Item:      item,
	})
	return err
}

func getPayloadString(item map[string]types.AttributeValue) (string, bool) {
	payloadAttr, ok := item["payload"].(*types.AttributeValueMemberS)
	if !ok {
		return "", false
	}
	return payloadAttr.Value, true
}

func getStringAttribute(item map[string]types.AttributeValue, key string) (string, bool) {
	value, ok := item[key].(*types.AttributeValueMemberS)
	if !ok {
		return "", false
	}
	return value.Value, true
}

func parseHistoricalNumber(value string) float64 {
	trimmed := strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(value), ",", ""), "'", "")
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0
	}
	return parsed
}
