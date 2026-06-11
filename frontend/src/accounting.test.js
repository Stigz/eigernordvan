import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  calculateAccountingProjection,
  normalizeAccountingProjectionFromApi,
  normalizeCostEntryForAccounting,
  normalizeMonthlyCloseFromApi,
  sortMonthlyCloses,
} from "./accounting";

const loadAccountingFixture = () =>
  JSON.parse(fs.readFileSync(new URL("../../docs/accounting-projection-fixture.json", import.meta.url), "utf8"));

const settings = {
  km_rate_chf: 0.5,
  night_rate_chf: 50,
  workday_rate_chf: 100,
  monthly_payment_chf: 50,
  reserve_target_chf: 2000,
  surplus_reserve_percent: 70,
  surplus_historical_repayment_percent: 30,
};

describe("calculateAccountingProjection", () => {
  it("charges usage by kilometer and night", () => {
    const projection = calculateAccountingProjection({
      settings,
      people: ["Nic", "Kayla"],
      period: "2026-06",
      trips: [{ user_name: "Nic", timestamp: "2026-06-10T12:00:00Z", delta_km: 120 }],
      bookings: [{ status: "booked", start_date: "2026-06-12", end_date: "2026-06-14", guest_name: "Kayla" }],
    });

    expect(projection.usageByPerson.Nic).toBe(60);
    expect(projection.usageByPerson.Kayla).toBe(100);
    expect(projection.kmByPerson.Nic).toBe(120);
    expect(projection.nightsByPerson.Kayla).toBe(2);
  });

  it("credits work by half-day increments", () => {
    const projection = calculateAccountingProjection({
      settings,
      people: ["Nic"],
      period: "2026-06",
      workEntries: [{ person: "Nic", month: "2026-06", days: 0.5 }],
    });

    expect(projection.workCreditsByPerson.Nic).toBe(50);
    expect(projection.personBalances.Nic).toBe(0);
  });

  it("counts the source rows used by the monthly preview", () => {
    const projection = calculateAccountingProjection({
      settings,
      people: ["Nic"],
      period: "2026-06",
      trips: [
        { user_name: "Nic", timestamp: "2026-06-10T12:00:00Z", delta_km: 10 },
        { user_name: "Nic", timestamp: "2026-07-10T12:00:00Z", delta_km: 10 },
      ],
      bookings: [
        { status: "booked", start_date: "2026-06-12", end_date: "2026-06-13", guest_name: "Nic" },
        { status: "cancelled", start_date: "2026-06-15", end_date: "2026-06-16", guest_name: "Nic" },
      ],
      workEntries: [
        { person: "Nic", month: "2026-06", days: 1 },
        { person: "Nic", month: "2026-07", days: 1 },
      ],
      costEntries: [
        {
          id: "live-1",
          date: "2026-06-05",
          type: "expense",
          amount_chf: 120,
          category: "insurance",
          paid_by: "Nic",
          bucket: "shared_running",
          funding_account: "personal",
        },
        {
          id: "historical-1",
          date: "2026-01-01",
          type: "expense",
          amount_chf: 8900,
          category: "vehicle_purchase",
          historical: true,
          bucket: "historical_investment",
        },
      ],
    });

    expect(projection.sourceCounts).toEqual({
      cost_entries: 1,
      historical_cost_entries: 1,
      trip_entries: 1,
      booking_entries: 1,
      fuel_entries: 0,
      work_entries: 1,
    });
  });

  it("lets income cover current costs before reserve and historical repayment", () => {
    const projection = calculateAccountingProjection({
      settings: { ...settings, monthly_payment_chf: 0 },
      people: ["Nic", "Kayla"],
      period: "2026-06",
      costEntries: [
        {
          id: "income-1",
          date: "2026-06-01",
          type: "income",
          amount_chf: 1000,
          description: "External booking",
          category: "trip_payout",
          paid_by: "Nic",
          participants: ["Nic", "Kayla"],
          bucket: "income",
          funding_account: "shared_pot",
          allocation_basis: "none",
        },
        {
          id: "cost-1",
          date: "2026-06-02",
          type: "expense",
          amount_chf: 400,
          description: "Insurance",
          category: "insurance",
          paid_by: "Nic",
          participants: ["Nic", "Kayla"],
          bucket: "shared_running",
          funding_account: "shared_pot",
          allocation_basis: "equal",
        },
      ],
    });

    expect(projection.sharedPot.current_costs_chf).toBe(400);
    expect(projection.sharedPot.reserve_allocation_chf).toBe(420);
    expect(projection.sharedPot.historical_repayment_chf).toBe(180);
    expect(projection.sharedPot.balance_chf).toBe(0);
  });

  it("includes gas tab spend as current running cost without a cost entry", () => {
    const projection = calculateAccountingProjection({
      settings: { ...settings, monthly_payment_chf: 0 },
      people: ["Nic", "Kayla"],
      period: "2026-06",
      fuelEntries: [
        { id: "fuel-1", user_name: "Nic", timestamp: "2026-06-10T12:00:00Z", cost_chf: 80, liters: 40, odometer_km: 1200 },
        { id: "fuel-missed", user_name: "Kayla", timestamp: "2026-06-11T12:00:00Z", cost_chf: 0, missed: true },
      ],
    });

    expect(projection.sourceCounts).toMatchObject({ cost_entries: 0, fuel_entries: 1 });
    expect(projection.sharedPot.current_costs_chf).toBe(80);
    expect(projection.sharedPot.fuel_costs_chf).toBe(80);
    expect(projection.bucketTotals.shared_running).toBe(80);
    expect(projection.suggestedSettlements).toEqual([
      { from_person: "shared_pot", to_person: "Nic", amount_chf: 80, reason: "Shared pot reimbursement" },
    ]);
  });

  it("splits policy surplus from the same base amount", () => {
    const projection = calculateAccountingProjection({
      settings,
      people: ["Nic", "Luki", "Kayla", "Jeanne"],
      period: "2026-06",
      trips: [
        { user_name: "Nic", timestamp: "2026-06-10T12:00:00Z", delta_km: 164 },
        { user_name: "Kayla", timestamp: "2026-06-11T12:00:00Z", delta_km: 12 },
      ],
    });

    expect(projection.sharedPot.inflow_chf).toBe(288);
    expect(projection.sharedPot.reserve_allocation_chf).toBe(201.6);
    expect(projection.sharedPot.historical_repayment_chf).toBe(86.4);
    expect(projection.sharedPot.balance_chf).toBe(0);
  });

  it("suggests monthly payments into the shared pot", () => {
    const projection = calculateAccountingProjection({
      settings,
      people: ["Nic", "Kayla"],
      period: "2026-06",
    });

    expect(projection.sharedPot.contributions_due_chf).toBe(100);
    expect(projection.suggestedSettlements).toEqual([
      { from_person: "Nic", to_person: "shared_pot", amount_chf: 50, reason: "Shared pot due" },
      { from_person: "Kayla", to_person: "shared_pot", amount_chf: 50, reason: "Shared pot due" },
    ]);
  });

  it("uses recorded transfers to clear shared pot dues", () => {
    const projection = calculateAccountingProjection({
      settings,
      people: ["Nic", "Kayla"],
      period: "2026-06",
      costEntries: [
        {
          id: "payment-1",
          date: "2026-06-03",
          type: "transfer",
          amount_chf: 50,
          description: "Nic monthly payment",
          category: "settlement",
          from_person: "Nic",
          to_person: "shared_pot",
          bucket: "settlement",
          funding_account: "personal",
          allocation_basis: "none",
        },
      ],
    });

    expect(projection.sharedPot.contributions_paid_chf).toBe(50);
    expect(projection.suggestedSettlements).toEqual([
      { from_person: "Kayla", to_person: "shared_pot", amount_chf: 50, reason: "Shared pot due" },
    ]);
  });

  it("reimburses personal payments for shared running costs through the shared pot", () => {
    const projection = calculateAccountingProjection({
      settings: { ...settings, monthly_payment_chf: 100 },
      people: ["Nic", "Kayla"],
      period: "2026-06",
      costEntries: [
        {
          id: "insurance-1",
          date: "2026-06-05",
          type: "expense",
          amount_chf: 120,
          description: "Insurance",
          category: "insurance",
          paid_by: "Nic",
          participants: ["Nic", "Kayla"],
          bucket: "shared_running",
          funding_account: "personal",
          allocation_basis: "equal",
        },
      ],
    });

    expect(projection.sharedPot.current_costs_chf).toBe(120);
    expect(projection.sharedPot.outflow_chf).toBe(200);
    expect(projection.suggestedSettlements).toEqual([
      { from_person: "Kayla", to_person: "shared_pot", amount_chf: 100, reason: "Shared pot due" },
      { from_person: "shared_pot", to_person: "Nic", amount_chf: 20, reason: "Shared pot reimbursement" },
    ]);
  });

  it("matches the shared backend/frontend accounting projection fixture", () => {
    const fixture = loadAccountingFixture();
    const projection = calculateAccountingProjection({
      settings: fixture.settings,
      people: fixture.people,
      period: fixture.period,
      trips: fixture.trips,
      bookings: fixture.bookings,
      fuelEntries: fixture.fuel_entries,
      workEntries: fixture.work_entries,
      costEntries: fixture.cost_entries,
    });

    expect(projection.monthlyContributionsCHF).toBe(fixture.expected.monthly_contributions_chf);
    expect(projection.sharedPot).toMatchObject(fixture.expected.shared_pot);
    expect(projection.usageByPerson).toMatchObject(fixture.expected.usage_by_person);
    expect(projection.workCreditsByPerson).toMatchObject(fixture.expected.work_credits_by_person);
    expect(projection.kmByPerson).toMatchObject(fixture.expected.km_by_person);
    expect(projection.nightsByPerson).toMatchObject(fixture.expected.nights_by_person);
    expect(projection.bucketTotals).toMatchObject(fixture.expected.bucket_totals);
    expect(projection.personBalances).toMatchObject(fixture.expected.person_balances);
    expect(projection.settlementBalances).toMatchObject(fixture.expected.settlement_balances);
    expect(projection.suggestedSettlements).toEqual(fixture.expected.suggested_settlements);
    expect(projection.sourceCounts).toEqual(fixture.expected.source_counts);
    expect(projection.historical).toEqual(fixture.expected.historical);
  });
});

describe("normalizeCostEntryForAccounting", () => {
  it("keeps old cost entries live and fills accounting defaults", () => {
    const entry = normalizeCostEntryForAccounting({
      id: "legacy",
      date: "2026-06-05",
      type: "expense",
      amount_chf: 120,
      category: "insurance",
      paid_by: "Nic",
      participants: ["Nic", "Kayla"],
    });

    expect(entry.period).toBe("2026-06");
    expect(entry.bucket).toBe("shared_running");
    expect(entry.funding_account).toBe("personal");
    expect(entry.allocation_basis).toBe("equal");
    expect(entry.affects_live_balance).toBe(true);
  });

  it("keeps historical rows out of live balances", () => {
    const entry = normalizeCostEntryForAccounting({
      id: "historical-sheet:B0001",
      date: "2026-01-01",
      type: "expense",
      amount_chf: 8900,
      category: "Fahrzeug Anschaffung",
      historical: true,
      historical_only: true,
      bucket: "historical_investment",
    });

    expect(entry.historical).toBe(true);
    expect(entry.affects_live_balance).toBe(false);
  });
});

describe("normalizeAccountingProjectionFromApi", () => {
  it("maps backend preview payloads into the dashboard projection shape", () => {
    const projection = normalizeAccountingProjectionFromApi(
      {
        period: "2026-06",
        settings: { ...settings, monthly_payment_chf: "75" },
        monthly_contributions_chf: "150",
        shared_pot: {
          inflow_chf: "300.129",
          outflow_chf: 120,
          balance_chf: 180.129,
          contributions_due_chf: 150,
        },
        usage_by_person: { Nic: "60" },
        work_credits_by_person: { Kayla: 50 },
        km_by_person: { Nic: 120 },
        nights_by_person: { Kayla: 2 },
        bucket_totals: { usage: 160 },
        person_balances: { Nic: -60, Kayla: 50 },
        settlement_balances: { Nic: -60, Kayla: 50, shared_pot: 10 },
        suggested_settlements: [{ from_person: " Nic ", to_person: " shared_pot ", amount_chf: "60.129", reason: " Shared pot due " }],
        source_counts: { cost_entries: 2, historical_cost_entries: 1, trip_entries: 1, booking_entries: 1, fuel_entries: 1, work_entries: 1 },
        historical: { investment_chf: 8900, rows: 1 },
      },
      { people: ["Nic", "Kayla"] },
    );

    expect(projection.period).toBe("2026-06");
    expect(projection.settings.monthly_payment_chf).toBe(75);
    expect(projection.monthlyContributionsCHF).toBe(150);
    expect(projection.sharedPot.inflow_chf).toBe(300.13);
    expect(projection.sharedPot.external_income_chf).toBe(0);
    expect(projection.sharedPot.fuel_costs_chf).toBe(0);
    expect(projection.usageByPerson).toEqual({ Nic: 60, Kayla: 0 });
    expect(projection.workCreditsByPerson).toEqual({ Nic: 0, Kayla: 50 });
    expect(projection.settlementBalances.shared_pot).toBe(10);
    expect(projection.suggestedSettlements).toEqual([
      { from_person: "Nic", to_person: "shared_pot", amount_chf: 60.13, reason: "Shared pot due" },
    ]);
    expect(projection.sourceCounts.cost_entries).toBe(2);
    expect(projection.sourceCounts.fuel_entries).toBe(1);
    expect(projection.historical).toEqual({ investment_chf: 8900, rows: 1 });
  });

  it("returns null for unusable backend preview payloads", () => {
    expect(normalizeAccountingProjectionFromApi({ period: "2026-06" })).toBeNull();
    expect(normalizeAccountingProjectionFromApi(null)).toBeNull();
  });
});

describe("normalizeMonthlyCloseFromApi", () => {
  it("maps stored monthly closes into dashboard-friendly shape", () => {
    const close = normalizeMonthlyCloseFromApi(
      {
        id: "2026-06",
        period: "2026-06",
        schema_version: "2026-06-05",
        settings,
        totals: {
          shared_pot_balance_chf: "81.899",
          current_costs_chf: 120,
          reserve_allocation_chf: 273,
        },
        entry_counts: { cost_entries: 2, trip_entries: 1 },
        person_balances: { Nic: 60, Kayla: -100 },
        settlement_balances: { Nic: 60, Kayla: -100, shared_pot: 40 },
        suggested_settlements: [{ from_person: " Kayla ", to_person: " shared_pot ", amount_chf: "100", reason: " Shared pot due " }],
        notes: " Generated ",
        created_at: "2026-06-30T12:00:00Z",
      },
      { people: ["Nic", "Kayla"] },
    );

    expect(close.period).toBe("2026-06");
    expect(close.totals.shared_pot_balance_chf).toBe(81.9);
    expect(close.totals.historical_repayment_chf).toBe(0);
    expect(close.entryCounts.cost_entries).toBe(2);
    expect(close.entryCounts.booking_entries).toBe(0);
    expect(close.settlementBalances.shared_pot).toBe(40);
    expect(close.suggestedSettlements).toEqual([
      { from_person: "Kayla", to_person: "shared_pot", amount_chf: 100, reason: "Shared pot due" },
    ]);
    expect(close.notes).toBe("Generated");
  });

  it("sorts closes newest period first", () => {
    const closes = sortMonthlyCloses([
      { period: "2026-05", createdAt: "2026-05-31T12:00:00Z" },
      { period: "2026-07", createdAt: "2026-07-31T12:00:00Z" },
      { period: "2026-06", createdAt: "2026-06-30T12:00:00Z" },
    ]);

    expect(closes.map((close) => close.period)).toEqual(["2026-07", "2026-06", "2026-05"]);
  });
});
