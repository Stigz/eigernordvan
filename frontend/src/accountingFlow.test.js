import { describe, expect, it } from "vitest";
import { calculateAccountingProjection } from "./accounting";
import { buildAccountingFlowModel } from "./accountingFlow";

const settings = {
  km_rate_chf: 0.5,
  night_rate_chf: 50,
  workday_rate_chf: 100,
  monthly_payment_chf: 0,
  reserve_target_chf: 2000,
  surplus_reserve_percent: 70,
  surplus_historical_repayment_percent: 30,
};

const buildModel = (input) => {
  const projection = calculateAccountingProjection({ settings, people: ["Nic", "Luki"], period: "2026-06", ...input });
  return buildAccountingFlowModel({ projection, settings, people: ["Nic", "Luki"], period: "2026-06", ...input });
};

describe("buildAccountingFlowModel", () => {
  it("routes km charges only into the vehicle lane", () => {
    const model = buildModel({
      trips: [{ user_name: "Nic", timestamp: "2026-06-10T12:00:00Z", delta_km: 120 }],
    });

    const nic = model.personRows.find((row) => row.person === "Nic");
    expect(nic.kmCharge).toBe(60);
    expect(nic.vehicleFunding).toBe(60);
    expect(nic.livingFunding).toBe(0);
    expect(model.links.find((link) => link.id === "person:Nic:vehicle").amount).toBe(60);
    expect(model.links.find((link) => link.id === "person:Nic:living")).toBeUndefined();
  });

  it("splits night charges exactly 50/50 between vehicle and nights/work", () => {
    const model = buildModel({
      bookings: [{ status: "booked", guest_name: "Luki", start_date: "2026-06-12", end_date: "2026-06-15" }],
    });

    const luki = model.personRows.find((row) => row.person === "Luki");
    expect(luki.nightCharge).toBe(150);
    expect(luki.nightVehicle).toBe(75);
    expect(luki.nightLiving).toBe(75);
    expect(model.links.find((link) => link.id === "person:Luki:vehicle").amount).toBe(75);
    expect(model.links.find((link) => link.id === "person:Luki:living").amount).toBe(75);
  });

  it("keeps gas rows in vehicle costs without requiring a Costs entry duplicate", () => {
    const model = buildModel({
      fuelEntries: [{ id: "fuel-1", user_name: "Nic", timestamp: "2026-06-10T12:00:00Z", cost_chf: 80 }],
    });

    expect(model.vehicleCostRows).toHaveLength(1);
    expect(model.vehicleCostRows[0]).toMatchObject({ source: "Gas", amount: 80, person: "Nic" });
    expect(model.livingCostRows).toHaveLength(0);
    expect(model.totals.vehicleCosts).toBe(80);
  });

  it("shows work as an internal offset and carries unused value forward", () => {
    const model = buildModel({
      bookings: [{ status: "booked", guest_name: "Luki", start_date: "2026-06-12", end_date: "2026-06-15" }],
      workEntries: [{ person: "Luki", month: "2026-06", days: 1 }],
    });

    const luki = model.personRows.find((row) => row.person === "Luki");
    expect(luki.workCredit).toBe(100);
    expect(luki.workUsed).toBe(75);
    expect(luki.workCarried).toBe(25);
    expect(model.links.find((link) => link.id === "person:Luki:work")).toMatchObject({ amount: 75, dashed: true });
  });

  it("keeps historical rows out of current flow totals", () => {
    const model = buildModel({
      costEntries: [
        {
          id: "historical-sheet:B0001",
          date: "2026-01-01",
          type: "expense",
          amount_chf: 8900,
          category: "vehicle_purchase",
          historical: true,
          historical_only: true,
          bucket: "historical_investment",
        },
      ],
    });

    expect(model.historical).toEqual({ amount: 8900, rows: 1 });
    expect(model.vehicleCostRows).toHaveLength(0);
    expect(model.totals.currentCostTotal).toBe(0);
  });

  it("copies person balances from the accounting projection", () => {
    const projection = calculateAccountingProjection({
      settings,
      people: ["Nic", "Luki"],
      period: "2026-06",
      trips: [{ user_name: "Nic", timestamp: "2026-06-10T12:00:00Z", delta_km: 20 }],
    });
    const model = buildAccountingFlowModel({ projection, settings, people: ["Nic", "Luki"], period: "2026-06" });

    expect(model.personRows.find((row) => row.person === "Nic").balance).toBe(projection.personBalances.Nic);
    expect(model.personRows.find((row) => row.person === "Luki").balance).toBe(projection.personBalances.Luki);
  });
});
