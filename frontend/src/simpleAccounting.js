const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

const canonicalPerson = (value, people) => {
  const normalized = String(value || "").trim().toLowerCase();
  return people.find((person) => person.toLowerCase() === normalized) || null;
};

const tripDistance = (trip) => {
  const delta = Number(trip?.delta_km);
  if (Number.isFinite(delta) && delta >= 0) {
    return delta;
  }
  const start = Number(trip?.start_km);
  const end = Number(trip?.end_km);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
};

export const buildKmPersonTotals = (trips = [], people = [], excludedName = "Vermietung") => {
  const totals = Object.fromEntries(people.map((person) => [person, { person, km: 0, trips: 0 }]));
  let excludedKm = 0;
  let excludedTrips = 0;
  let unassignedKm = 0;

  trips.forEach((trip) => {
    const km = tripDistance(trip);
    if (!(km > 0)) {
      return;
    }
    if (String(trip.user_name || "").trim().toLowerCase() === excludedName.toLowerCase()) {
      excludedKm += km;
      excludedTrips += 1;
      return;
    }
    const person = canonicalPerson(trip.user_name, people);
    if (!person) {
      unassignedKm += km;
      return;
    }
    totals[person].km += km;
    totals[person].trips += 1;
  });

  const personTotals = people.map((person) => ({
    ...totals[person],
    km: money(totals[person].km),
  }));

  return {
    people: personTotals,
    billableKm: money(personTotals.reduce((sum, item) => sum + item.km, 0)),
    excludedKm: money(excludedKm),
    excludedTrips,
    unassignedKm: money(unassignedKm),
  };
};

export const buildDieselPersonTotals = (fuelEntries = [], people = []) => {
  const totals = Object.fromEntries(
    people.map((person) => [person, { person, fills: 0, liters: 0, paidCHF: 0 }]),
  );
  let totalLiters = 0;
  let totalCostCHF = 0;
  let unassignedCostCHF = 0;

  fuelEntries.forEach((entry) => {
    if (entry?.missed) {
      return;
    }
    const liters = Number(entry?.liters) || 0;
    const costCHF = Number(entry?.cost_chf ?? entry?.fuel_cost_chf) || 0;
    totalLiters += liters;
    totalCostCHF += costCHF;
    const person = canonicalPerson(entry?.user_name, people);
    if (!person) {
      unassignedCostCHF += costCHF;
      return;
    }
    totals[person].fills += 1;
    totals[person].liters += liters;
    totals[person].paidCHF += costCHF;
  });

  return {
    people: people.map((person) => ({
      ...totals[person],
      liters: money(totals[person].liters),
      paidCHF: money(totals[person].paidCHF),
    })),
    totalLiters: money(totalLiters),
    totalCostCHF: money(totalCostCHF),
    unassignedCostCHF: money(unassignedCostCHF),
  };
};

const isLiveCostEntry = (entry) =>
  !entry?.historical_only && !entry?.historical && entry?.affects_live_balance !== false;

export const buildSimpleAccounting = ({
  people = [],
  trips = [],
  fuelEntries = [],
  costEntries = [],
  kmRateCHF = 0.5,
  reserveTargetCHF = 1000,
}) => {
  const kmRate = Math.max(0, Number(kmRateCHF) || 0);
  const reserveTarget = Math.max(0, Number(reserveTargetCHF) || 0);
  const kmTotals = buildKmPersonTotals(trips, people);
  const dieselTotals = buildDieselPersonTotals(fuelEntries, people);
  const rows = Object.fromEntries(
    people.map((person) => [
      person,
      {
        person,
        km: kmTotals.people.find((item) => item.person === person)?.km || 0,
        dieselPaidCHF: dieselTotals.people.find((item) => item.person === person)?.paidCHF || 0,
        otherPaidCHF: 0,
        paidToPotCHF: 0,
        incomeHeldCHF: 0,
      },
    ]),
  );

  let otherCostsCHF = 0;
  let incomeCHF = 0;
  let sharedPotExpensesCHF = 0;
  let sharedPotIncomeCHF = 0;

  costEntries.filter(isLiveCostEntry).forEach((entry) => {
    const amount = Number(entry?.amount_chf) || 0;
    if (!(amount > 0)) {
      return;
    }
    if (entry.type === "expense") {
      otherCostsCHF += amount;
      if (entry.funding_account === "shared_pot") {
        sharedPotExpensesCHF += amount;
        return;
      }
      const payer = canonicalPerson(entry.paid_by, people);
      if (payer) {
        rows[payer].otherPaidCHF += amount;
      }
      return;
    }
    if (entry.type === "income") {
      incomeCHF += amount;
      if (entry.funding_account === "shared_pot") {
        sharedPotIncomeCHF += amount;
        return;
      }
      const holder = canonicalPerson(entry.paid_by, people);
      if (holder) {
        rows[holder].incomeHeldCHF += amount;
      }
      return;
    }
    if (entry.type !== "transfer") {
      return;
    }
    const from = canonicalPerson(entry.from_person, people);
    const to = canonicalPerson(entry.to_person, people);
    if (from) {
      rows[from].paidToPotCHF += amount;
    }
    if (to) {
      rows[to].paidToPotCHF -= amount;
    }
  });

  const peopleRows = people.map((person) => {
    const row = rows[person];
    const usageChargeCHF = row.km * kmRate;
    const givenCHF = row.dieselPaidCHF + row.otherPaidCHF + row.paidToPotCHF - row.incomeHeldCHF;
    const balanceCHF = givenCHF - usageChargeCHF;
    return {
      ...row,
      usageSharePercent: kmTotals.billableKm > 0 ? (row.km / kmTotals.billableKm) * 100 : 0,
      usageChargeCHF: money(usageChargeCHF),
      givenCHF: money(givenCHF),
      balanceCHF: money(balanceCHF),
    };
  });

  const kmChargesCHF = money(kmTotals.billableKm * kmRate);
  const dieselCostsCHF = dieselTotals.totalCostCHF;
  const totalCostsCHF = money(dieselCostsCHF + otherCostsCHF);
  const reserveAfterSettlementCHF = money(kmChargesCHF + incomeCHF - totalCostsCHF);
  const recommendedRateCHF = kmTotals.billableKm > 0
    ? money(Math.max(0, (totalCostsCHF - incomeCHF + reserveTarget) / kmTotals.billableKm))
    : 0;
  const trackedPotCashCHF = money(
    peopleRows.reduce((sum, row) => sum + row.paidToPotCHF, 0) + sharedPotIncomeCHF - sharedPotExpensesCHF,
  );

  return {
    people: peopleRows,
    usageRanking: [...peopleRows].sort((a, b) => b.km - a.km || a.person.localeCompare(b.person)),
    kmTotals,
    dieselTotals,
    kmRateCHF: money(kmRate),
    reserveTargetCHF: money(reserveTarget),
    kmChargesCHF,
    dieselCostsCHF,
    otherCostsCHF: money(otherCostsCHF),
    incomeCHF: money(incomeCHF),
    totalCostsCHF,
    reserveAfterSettlementCHF,
    reserveTargetDifferenceCHF: money(reserveAfterSettlementCHF - reserveTarget),
    recommendedRateCHF,
    trackedPotCashCHF,
  };
};
