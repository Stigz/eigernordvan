package main

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func TestDynamoValueToAnyConvertsNestedValues(t *testing.T) {
	value := &types.AttributeValueMemberM{Value: map[string]types.AttributeValue{
		"id":      &types.AttributeValueMemberS{Value: "trip-1"},
		"delta":   &types.AttributeValueMemberN{Value: "12.5"},
		"active":  &types.AttributeValueMemberBOOL{Value: true},
		"receipt": &types.AttributeValueMemberB{Value: []byte("ok")},
		"tags":    &types.AttributeValueMemberSS{Value: []string{"van", "fuel"}},
		"nested": &types.AttributeValueMemberL{Value: []types.AttributeValue{
			&types.AttributeValueMemberNULL{Value: true},
			&types.AttributeValueMemberN{Value: "7"},
		}},
	}}

	got := dynamoValueToAny(value)
	want := map[string]any{
		"id":      "trip-1",
		"delta":   12.5,
		"active":  true,
		"receipt": "b2s=",
		"tags":    []string{"van", "fuel"},
		"nested":  []any{nil, 7.0},
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected converted value:\n got %#v\nwant %#v", got, want)
	}
}

func TestBackupExportPayloadIncludesAccountingRecoverySections(t *testing.T) {
	payload := backupExportPayload{
		SchemaVersion: "2026-06-05",
		Tables:        map[string]backupTableExport{},
		Work:          workStatePayload{Entries: []workEntryPayload{}},
		Costs:         costStatePayload{Entries: []costEntryPayload{}},
		AccountingEntries: []costEntryPayload{{
			ID:                 "cost-1",
			Date:               "2026-06-01",
			Period:             "2026-06",
			Type:               "expense",
			AmountCHF:          50,
			Description:        "Insurance",
			Category:           "insurance",
			Bucket:             "shared_running",
			FundingAccount:     "personal",
			AllocationBasis:    "equal",
			AffectsLiveBalance: true,
		}},
		AccountingSettings: accountingSettingsPayload{
			SchemaVersion:     accountingSchemaVersion,
			KMRateCHF:         0.5,
			NightRateCHF:      50,
			WorkdayRateCHF:    100,
			MonthlyPaymentCHF: 50,
		},
		AccountingMonthlyCloses: []monthlyClosePayload{{
			ID:     "2026-06",
			Period: "2026-06",
		}},
		HistoricalImportBatches: []historicalImportBatchPayload{{
			ID:         "historical-sheet",
			EntryCount: 216,
		}},
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("expected backup payload to marshal, got %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("expected backup payload to unmarshal, got %v", err)
	}

	for _, key := range []string{"accounting_entries", "accounting_settings", "accounting_monthly_closes", "historical_import_batches"} {
		if _, ok := got[key]; !ok {
			t.Fatalf("expected backup payload to include %s: %s", key, raw)
		}
	}
}

func TestSortedAccountingEntriesOrdersByPeriodDateAndID(t *testing.T) {
	entries := []costEntryPayload{
		{ID: "c", Period: "2026-06", Date: "2026-06-02"},
		{ID: "b", Period: "2026-05", Date: "2026-05-10"},
		{ID: "a", Period: "2026-06", Date: "2026-06-01"},
	}

	got := sortedAccountingEntries(entries)
	if got[0].ID != "b" || got[1].ID != "a" || got[2].ID != "c" {
		t.Fatalf("unexpected accounting entry order: %+v", got)
	}
	if entries[0].ID != "c" {
		t.Fatalf("expected original entries to remain unmodified: %+v", entries)
	}
}
