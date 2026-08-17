import { describe, expect, it } from "vitest";
import { buildDieselPersonTotals, buildKmPersonTotals, buildSimpleAccounting } from "./simpleAccounting";

const people = ["Nic", "Kayla", "Luki", "Jeanne"];

describe("simple accounting", () => {
  const trips = [
    { user_name: "Nic", delta_km: 100 },
    { user_name: "Kayla", start_km: 100, end_km: 150 },
    { user_name: "Vermietung", delta_km: 200 },
  ];
  const fuelEntries = [
    { user_name: "Nic", liters: 30, cost_chf: 60 },
    { user_name: "Kayla", liters: 20, cost_chf: 40 },
    { user_name: "Luki", missed: true, liters: 0, cost_chf: 0 },
  ];

  it("excludes rental kilometers from owner charges", () => {
    const totals = buildKmPersonTotals(trips, people);
    expect(totals.billableKm).toBe(150);
    expect(totals.excludedKm).toBe(200);
    expect(totals.people.find((item) => item.person === "Nic")?.km).toBe(100);
  });

  it("counts diesel totals by the person who paid", () => {
    const totals = buildDieselPersonTotals(fuelEntries, people);
    expect(totals.totalCostCHF).toBe(100);
    expect(totals.people.find((item) => item.person === "Kayla")).toMatchObject({ fills: 1, liters: 20, paidCHF: 40 });
  });

  it("credits personal spending and payments while charging usage", () => {
    const result = buildSimpleAccounting({
      people,
      trips,
      fuelEntries,
      kmRateCHF: 1,
      reserveTargetCHF: 50,
      costEntries: [
        { type: "expense", amount_chf: 20, paid_by: "Kayla", funding_account: "personal" },
        { type: "expense", amount_chf: 10, paid_by: "Nic", funding_account: "shared_pot" },
        { type: "income", amount_chf: 30, paid_by: "Nic", funding_account: "personal" },
        { type: "transfer", amount_chf: 25, from_person: "Nic", to_person: "shared_pot" },
        { type: "expense", amount_chf: 999, paid_by: "Nic", historical_only: true },
      ],
    });

    expect(result).toMatchObject({
      kmChargesCHF: 150,
      dieselCostsCHF: 100,
      otherCostsCHF: 30,
      incomeCHF: 30,
      totalCostsCHF: 130,
      reserveAfterSettlementCHF: 50,
      recommendedRateCHF: 1,
    });
    expect(result.people.find((item) => item.person === "Nic")).toMatchObject({
      dieselPaidCHF: 60,
      paidToPotCHF: 25,
      incomeHeldCHF: 30,
      givenCHF: 55,
      usageChargeCHF: 100,
      balanceCHF: -45,
    });
    expect(result.people.find((item) => item.person === "Kayla")).toMatchObject({
      dieselPaidCHF: 40,
      otherPaidCHF: 20,
      givenCHF: 60,
      usageChargeCHF: 50,
      balanceCHF: 10,
    });
  });
});
