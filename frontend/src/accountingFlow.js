import {
  accountingCurrentOpenPeriod,
  accountingCurrentOpenStartDate,
  accountingPeople,
  normalizeAccountingSettings,
  normalizeCostEntryForAccounting,
} from "./accounting";

const sharedPotAccount = "shared_pot";

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const numberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const datePart = (value) => String(value || "").slice(0, 10);
const periodFromDate = (value) => String(value || "").slice(0, 7);

const dateInPeriod = (value, period) => {
  if (!period) return true;
  const date = datePart(value);
  if (!date) return false;
  if (period === accountingCurrentOpenPeriod) {
    return date >= accountingCurrentOpenStartDate;
  }
  return periodFromDate(date) === period;
};

const livingCostCategories = new Set(["hardware_material", "interior_build", "equipment"]);
const vehicleCostCategories = new Set(["vehicle_purchase", "repairs_service", "registration_fees", "insurance", "taxes", "fuel_energy"]);
const livingCostKeywords = [
  "bett",
  "sofa",
  "couch",
  "stoff",
  "propan",
  "gasflasche",
  "lattenrost",
  "futon",
  "scharnier",
  "kugelschnäpper",
  "koch",
  "kitchen",
  "matratze",
  "polster",
  "vorhang",
];
const vehicleCostKeywords = [
  "auspuff",
  "vignette",
  "pneu",
  "reifen",
  "service",
  "werkstatt",
  "repar",
  "versicherung",
  "steuer",
  "strassenverkehr",
  "bremse",
  "motor",
  "diesel",
  "benzin",
  "tcs",
];

const currentCostPot = (entry = {}) => {
  const category = String(entry.category || "").trim();
  const description = `${entry.description || ""} ${entry.notes || ""}`.toLowerCase();
  if (vehicleCostCategories.has(category)) return "vehicle";
  if (livingCostCategories.has(category)) return "living";
  if (vehicleCostKeywords.some((keyword) => description.includes(keyword))) return "vehicle";
  if (livingCostKeywords.some((keyword) => description.includes(keyword))) return "living";
  if (entry.bucket === "van_investment") return "living";
  return "vehicle";
};

const normalizeFuelAmount = (entry = {}) => roundMoney(numberOr(entry.cost_chf ?? entry.fuel_cost_chf));

const makeMoneyRow = ({ label, person = "", source = "", date = "", description = "", amount = 0, formula = "", detail = "" }) => ({
  label,
  person,
  source,
  date,
  description,
  amount: roundMoney(amount),
  formula,
  detail,
});

const addDetail = (items, id, payload) => {
  items[id] = {
    id,
    rows: [],
    ...payload,
    amount: roundMoney(payload.amount || 0),
  };
};

export const buildAccountingFlowModel = ({
  projection,
  costEntries = [],
  fuelEntries = [],
  people = accountingPeople,
  period,
  settings,
} = {}) => {
  const safeProjection = projection || {};
  const activePeriod = period || safeProjection.period || accountingCurrentOpenPeriod;
  const normalizedSettings = normalizeAccountingSettings(settings || safeProjection.settings || {});
  const activePeople = Array.isArray(people) && people.length ? people : accountingPeople;
  const sharedPot = safeProjection.sharedPot || {};
  const currentPots = safeProjection.currentPots || {};
  const vehiclePot = currentPots.vehicle || {};
  const livingPot = currentPots.livingWork || {};
  const detailItems = {};

  const normalizedCosts = costEntries.map(normalizeCostEntryForAccounting);
  const currentCosts = normalizedCosts.filter((entry) => entry.affects_live_balance && dateInPeriod(entry.date, activePeriod));
  const currentTransfers = currentCosts.filter((entry) => entry.type === "transfer");
  const historicalRows = normalizedCosts.filter((entry) => entry.historical || entry.historical_only);

  const vehicleCostRows = [];
  const livingCostRows = [];
  const incomeRows = [];

  fuelEntries.forEach((entry) => {
    const amount = normalizeFuelAmount(entry);
    if (amount <= 0 || entry.missed || !dateInPeriod(entry.timestamp, activePeriod)) return;
    vehicleCostRows.push(
      makeMoneyRow({
        label: "Gas",
        person: entry.user_name || "",
        source: "Gas",
        date: datePart(entry.timestamp),
        description: entry.note || entry.description || "Gas / Treibstoff",
        amount,
        formula: "Gas-Eintrag",
        detail: entry.id || "",
      }),
    );
  });

  currentCosts.forEach((entry) => {
    const amount = roundMoney(entry.amount_chf);
    if (amount <= 0) return;
    if (entry.type === "income") {
      incomeRows.push(
        makeMoneyRow({
          label: "Einnahme",
          person: entry.paid_by || "",
          source: "Kosten",
          date: entry.date,
          description: entry.description || "Einnahme",
          amount,
          formula: "Einnahme in gemeinsames Konto",
          detail: entry.id || "",
        }),
      );
      return;
    }
    if (entry.type !== "expense") return;
    const target = currentCostPot(entry);
    const row = makeMoneyRow({
      label: target === "living" ? "Wohn-/Ausbaukosten" : "Fahrzeugkosten",
      person: entry.paid_by || "",
      source: "Kosten",
      date: entry.date,
      description: entry.description || entry.category || "Kosten",
      amount,
      formula: entry.funding_account === sharedPotAccount ? "Aus gemeinsamem Konto bezahlt" : "Privat bezahlt, vom Konto zu erstatten",
      detail: entry.id || "",
    });
    if (target === "living") {
      livingCostRows.push(row);
    } else {
      vehicleCostRows.push(row);
    }
  });

  const personRows = activePeople.map((person) => {
    const km = numberOr(safeProjection.kmByPerson?.[person]);
    const nights = numberOr(safeProjection.nightsByPerson?.[person]);
    const kmCharge = roundMoney(km * normalizedSettings.km_rate_chf);
    const nightCharge = roundMoney(nights * normalizedSettings.night_rate_chf);
    const nightVehicle = roundMoney(nightCharge / 2);
    const nightLiving = roundMoney(nightCharge - nightVehicle);
    const vehicleFunding = roundMoney(kmCharge + nightVehicle);
    const livingFunding = nightLiving;
    const workCredit = roundMoney(numberOr(safeProjection.workCreditsByPerson?.[person]));
    const workUsed = roundMoney(numberOr(safeProjection.workOffsetsByPerson?.[person]));
    const workCarried = roundMoney(numberOr(safeProjection.workCarryForwardByPerson?.[person]));
    const balance = roundMoney(numberOr(safeProjection.personBalances?.[person]));
    const suggestedDue = roundMoney(
      (safeProjection.suggestedSettlements || [])
        .filter((row) => row.from_person === person)
        .reduce((sum, row) => sum + numberOr(row.amount_chf), 0),
    );
    const suggestedReceivable = roundMoney(
      (safeProjection.suggestedSettlements || [])
        .filter((row) => row.to_person === person)
        .reduce((sum, row) => sum + numberOr(row.amount_chf), 0),
    );

    return {
      person,
      km,
      nights,
      kmCharge,
      nightCharge,
      nightVehicle,
      nightLiving,
      vehicleFunding,
      livingFunding,
      workCredit,
      workUsed,
      workCarried,
      usageTotal: roundMoney(numberOr(safeProjection.usageByPerson?.[person])),
      netUsage: roundMoney(numberOr(safeProjection.netUsageByPerson?.[person])),
      balance,
      suggestedDue,
      suggestedReceivable,
      formula: `${km.toFixed(1)} km × ${normalizedSettings.km_rate_chf.toFixed(2)} + ${nights.toFixed(1)} Nächte × ${normalizedSettings.night_rate_chf.toFixed(2)}`,
    };
  });

  const totalVehicleFunding = roundMoney(personRows.reduce((sum, row) => sum + row.vehicleFunding, 0));
  const totalLivingFunding = roundMoney(personRows.reduce((sum, row) => sum + row.livingFunding, 0));
  const totalWorkUsed = roundMoney(personRows.reduce((sum, row) => sum + row.workUsed, 0));
  const totalWorkCarried = roundMoney(personRows.reduce((sum, row) => sum + row.workCarried, 0));
  const vehicleCosts = roundMoney(numberOr(vehiclePot.costs_chf));
  const livingCosts = roundMoney(numberOr(livingPot.costs_chf));
  const reserve = roundMoney(numberOr(sharedPot.reserve_allocation_chf));
  const potBalance = roundMoney(numberOr(sharedPot.balance_chf));
  const currentCostTotal = roundMoney(numberOr(sharedPot.current_costs_chf));
  const historicalAmount = roundMoney(numberOr(safeProjection.historical?.investment_chf));
  const historicalCount = Math.max(0, Math.trunc(numberOr(safeProjection.historical?.rows ?? historicalRows.length)));

  const links = [];
  const pushLink = (link) => {
    const amount = roundMoney(link.amount);
    if (amount <= 0) return;
    links.push({ ...link, amount });
  };

  personRows.forEach((row) => {
    pushLink({
      id: `person:${row.person}:vehicle`,
      from: `person:${row.person}`,
      to: "pot:vehicle",
      label: `${row.person} → Fahrzeug`,
      amount: row.vehicleFunding,
      tone: "vehicle",
      rows: [
        makeMoneyRow({
          label: "KM",
          person: row.person,
          amount: row.kmCharge,
          formula: `${row.km.toFixed(1)} km × CHF ${normalizedSettings.km_rate_chf.toFixed(2)}`,
        }),
        makeMoneyRow({
          label: "1/2 Nächte",
          person: row.person,
          amount: row.nightVehicle,
          formula: `${row.nights.toFixed(1)} Nächte × CHF ${normalizedSettings.night_rate_chf.toFixed(2)} ÷ 2`,
        }),
      ],
    });
    pushLink({
      id: `person:${row.person}:living`,
      from: `person:${row.person}`,
      to: "pot:living",
      label: `${row.person} → Nächte & Arbeit`,
      amount: row.livingFunding,
      tone: "living",
      rows: [
        makeMoneyRow({
          label: "1/2 Nächte",
          person: row.person,
          amount: row.nightLiving,
          formula: `${row.nights.toFixed(1)} Nächte × CHF ${normalizedSettings.night_rate_chf.toFixed(2)} ÷ 2`,
        }),
      ],
    });
    pushLink({
      id: `person:${row.person}:work`,
      from: `person:${row.person}`,
      to: "pot:living",
      label: `${row.person} Arbeit`,
      amount: row.workUsed,
      tone: "work",
      dashed: true,
      rows: [
        makeMoneyRow({
          label: "Arbeit genutzt",
          person: row.person,
          amount: row.workUsed,
          formula: `min(CHF ${row.workCredit.toFixed(2)}, CHF ${row.nightLiving.toFixed(2)})`,
        }),
        makeMoneyRow({
          label: "Arbeit offen",
          person: row.person,
          amount: row.workCarried,
          formula: `CHF ${row.workCredit.toFixed(2)} - CHF ${row.workUsed.toFixed(2)}`,
        }),
      ],
    });
  });

  pushLink({
    id: "vehicle:costs",
    from: "pot:vehicle",
    to: "out:vehicle-costs",
    label: "Fahrzeug zahlt Kosten",
    amount: vehicleCosts,
    tone: "vehicle",
    rows: vehicleCostRows,
  });
  pushLink({
    id: "living:costs",
    from: "pot:living",
    to: "out:living-costs",
    label: "Nächte & Arbeit verrechnet",
    amount: livingCosts,
    tone: "living",
    rows: livingCostRows,
  });
  pushLink({
    id: "shared:reserve",
    from: "pot:shared",
    to: "out:reserve",
    label: "Reserve",
    amount: reserve,
    tone: "shared",
    rows: [makeMoneyRow({ label: "Reserve", amount: reserve, formula: "Überschuss × Reserve-Regel" })],
  });
  pushLink({
    id: "shared:balance",
    from: "pot:shared",
    to: "out:balance",
    label: "Rest",
    amount: potBalance,
    tone: "shared",
    rows: [makeMoneyRow({ label: "Rest im Konto", amount: potBalance, formula: "Zufluss - Kosten - Reserve" })],
  });
  pushLink({
    id: "history:paused",
    from: "pot:history",
    to: "out:history",
    label: "Historischer Ausgleich",
    amount: historicalAmount,
    tone: "history",
    muted: true,
    rows: [
      makeMoneyRow({
        label: "Historischer Ausgleich",
        amount: historicalAmount,
        formula: `${historicalCount} importierte Zeilen, aktuell pausiert`,
      }),
    ],
  });

  const nodes = [
    ...personRows.map((row) => ({
      id: `person:${row.person}`,
      label: row.person,
      kind: "person",
      amount: roundMoney(row.vehicleFunding + row.livingFunding - row.workUsed),
      detail: `${row.km.toFixed(1)} km, ${row.nights.toFixed(1)} Nächte`,
    })),
    {
      id: "pot:vehicle",
      label: "Prio 1: Fahrzeug",
      kind: "pot",
      amount: roundMoney(numberOr(vehiclePot.usage_funding_chf)),
      detail: "KM + 1/2 Nächte",
    },
    {
      id: "pot:living",
      label: "Prio 2: Nächte & Arbeit",
      kind: "pot",
      amount: roundMoney(numberOr(livingPot.usage_funding_chf)),
      detail: "1/2 Nächte, Arbeit verrechnet",
    },
    {
      id: "pot:shared",
      label: "Gemeinsames Konto",
      kind: "pot",
      amount: roundMoney(numberOr(sharedPot.inflow_chf)),
      detail: "Soll-Zufluss und Reserve",
    },
    {
      id: "pot:history",
      label: "Historischer Ausgleich",
      kind: "history",
      amount: historicalAmount,
      detail: "Pausiert",
    },
    { id: "out:vehicle-costs", label: "Gas, Unterhalt, Gebühren", kind: "output", amount: vehicleCosts },
    { id: "out:living-costs", label: "Wohnkosten + Arbeit genutzt", kind: "output", amount: livingCosts },
    { id: "out:reserve", label: "Reserve", kind: "output", amount: reserve },
    { id: "out:balance", label: "Rest im Konto", kind: "output", amount: potBalance },
    { id: "out:history", label: "Späterer Ausgleich", kind: "history", amount: historicalAmount },
  ];

  addDetail(detailItems, "overview", {
    title: "Übersicht",
    subtitle: "Aktuelle offene Abrechnung ohne historischen Ausgleich.",
    amount: roundMoney(numberOr(sharedPot.inflow_chf)),
    rows: [
      makeMoneyRow({ label: "Soll-Zufluss", amount: numberOr(sharedPot.inflow_chf), formula: "Monatliche Zahlungen + Nutzung + Einnahmen - Arbeit genutzt" }),
      makeMoneyRow({ label: "Aktuelle Kosten", amount: currentCostTotal, formula: "Fahrzeugkosten + Wohn-/Arbeitskosten" }),
      makeMoneyRow({ label: "Reserve", amount: reserve, formula: "Überschuss nach aktuellen Kosten" }),
      makeMoneyRow({ label: "Rest im Konto", amount: potBalance, formula: "Nach aktueller Regel" }),
    ],
  });

  personRows.forEach((row) => {
    addDetail(detailItems, `person:${row.person}`, {
      title: row.person,
      subtitle: "Personen-Rechnung im aktuellen Zeitraum.",
      amount: row.balance,
      rows: [
        makeMoneyRow({ label: "Fahrzeug-Anteil", person: row.person, amount: row.vehicleFunding, formula: "KM + 1/2 Nächte" }),
        makeMoneyRow({ label: "Nächte-Anteil", person: row.person, amount: row.livingFunding, formula: "1/2 Nächte" }),
        makeMoneyRow({ label: "Arbeit genutzt", person: row.person, amount: row.workUsed, formula: "Offset auf Nächte" }),
        makeMoneyRow({ label: "Arbeit offen", person: row.person, amount: row.workCarried, formula: "Carry-forward" }),
        makeMoneyRow({ label: "Saldo", person: row.person, amount: row.balance, formula: "Projektion aus Konto, Nutzung, Kosten und Arbeit" }),
      ],
    });
  });

  addDetail(detailItems, "pot:vehicle", {
    title: "Prio 1: Fahrzeug",
    subtitle: "KM und halbe Nächte decken Gas, Unterhalt, Versicherung und Gebühren.",
    amount: roundMoney(numberOr(vehiclePot.balance_chf)),
    rows: [
      makeMoneyRow({ label: "KM", amount: numberOr(vehiclePot.km_funding_chf), formula: "Alle KM × km-Rate" }),
      makeMoneyRow({ label: "1/2 Nächte", amount: numberOr(vehiclePot.night_funding_chf), formula: "Nächte × Nacht-Rate ÷ 2" }),
      makeMoneyRow({ label: "Fahrzeugkosten", amount: vehicleCosts, formula: "Gas + Kosten-Tab Fahrzeug" }),
      makeMoneyRow({ label: "Fahrzeug-Saldo", amount: numberOr(vehiclePot.balance_chf), formula: "Finanzierung - Kosten" }),
    ],
  });
  addDetail(detailItems, "pot:living", {
    title: "Prio 2: Nächte & Arbeit",
    subtitle: "Nächte finanzieren Wohn-/Arbeitsanteil; Arbeit reduziert Nachtkosten zuerst.",
    amount: roundMoney(numberOr(livingPot.balance_chf)),
    rows: [
      makeMoneyRow({ label: "1/2 Nächte", amount: totalLivingFunding, formula: "Nächte × Nacht-Rate ÷ 2" }),
      makeMoneyRow({ label: "Arbeit genutzt", amount: totalWorkUsed, formula: "min(Arbeit, Nächte-Anteil)" }),
      makeMoneyRow({ label: "Arbeit offen", amount: totalWorkCarried, formula: "Nicht automatisch ausbezahlt" }),
      makeMoneyRow({ label: "Wohn-/Arbeits-Saldo", amount: numberOr(livingPot.balance_chf), formula: "Finanzierung - Kosten/Offsets" }),
    ],
  });
  addDetail(detailItems, "pot:shared", {
    title: "Gemeinsames Konto",
    subtitle: "Nur reale Zahlungsbewegungen und Soll-Beträge, keine historische Vermischung.",
    amount: potBalance,
    rows: [
      makeMoneyRow({ label: "Monatlich fällig", amount: numberOr(sharedPot.contributions_due_chf), formula: "Personen × Monatsbetrag" }),
      makeMoneyRow({ label: "Eingetragen bezahlt", amount: numberOr(sharedPot.contributions_paid_chf), formula: "Transfer-Einträge ins Konto" }),
      makeMoneyRow({ label: "Einnahmen", amount: numberOr(sharedPot.external_income_chf), formula: "Miete/Rückzahlungen" }),
      makeMoneyRow({ label: "Reserve", amount: reserve, formula: "Aktuelle Regel" }),
      makeMoneyRow({ label: "Rest", amount: potBalance, formula: "Bleibt im Konto" }),
    ],
  });
  addDetail(detailItems, "pot:history", {
    title: "Historischer Ausgleich",
    subtitle: "Altbestand vor 2026-04-01. Sichtbar, aber aktuell nicht zahlungswirksam.",
    amount: historicalAmount,
    rows: [
      makeMoneyRow({ label: "Historische Basis", amount: historicalAmount, formula: `${historicalCount} Zeilen` }),
      makeMoneyRow({ label: "Aktuelle Rückzahlung", amount: numberOr(sharedPot.historical_repayment_chf), formula: "Pausiert" }),
    ],
  });

  links.forEach((link) => {
    addDetail(detailItems, link.id, {
      title: link.label,
      subtitle: link.dashed ? "Interner Arbeits-Offset, kein Cash-Payout." : "Aktueller Abrechnungsfluss.",
      amount: link.amount,
      rows: link.rows,
    });
  });

  const overviewRows = [
    makeMoneyRow({ label: "Soll-Zufluss", amount: numberOr(sharedPot.inflow_chf), formula: "Monatlich fällig + Nutzung + Einnahmen - Arbeit genutzt" }),
    makeMoneyRow({ label: "Aktuelle Kosten", amount: currentCostTotal, formula: "Fahrzeug + Nächte/Arbeit" }),
    makeMoneyRow({ label: "Reserve", amount: reserve, formula: "Überschuss × Reserve-Regel" }),
    makeMoneyRow({ label: "Rest", amount: potBalance, formula: "Zufluss - Kosten - Reserve" }),
    makeMoneyRow({ label: "Historisch pausiert", amount: historicalAmount, formula: "Nicht in aktueller Zahlung" }),
  ];

  const formulaRows = [
    {
      title: "KM",
      formula: "km × km-Rate",
      example: `${personRows.reduce((sum, row) => sum + row.km, 0).toFixed(1)} km × CHF ${normalizedSettings.km_rate_chf.toFixed(2)} = CHF ${roundMoney(
        personRows.reduce((sum, row) => sum + row.kmCharge, 0),
      ).toFixed(2)}`,
    },
    {
      title: "Nächte",
      formula: "Nächte × Nacht-Rate, dann 50/50",
      example: `${personRows.reduce((sum, row) => sum + row.nights, 0).toFixed(1)} Nächte × CHF ${normalizedSettings.night_rate_chf.toFixed(
        2,
      )} = CHF ${roundMoney(personRows.reduce((sum, row) => sum + row.nightCharge, 0)).toFixed(2)}`,
    },
    {
      title: "Arbeit",
      formula: "genutzt = min(Arbeitsgutschrift, Nächte-Anteil)",
      example: `CHF ${roundMoney(personRows.reduce((sum, row) => sum + row.workCredit, 0)).toFixed(2)} Gutschrift, CHF ${totalWorkUsed.toFixed(
        2,
      )} genutzt, CHF ${totalWorkCarried.toFixed(2)} offen`,
    },
    {
      title: "Fahrzeug",
      formula: "KM + 1/2 Nächte - Gas/Unterhalt",
      example: `CHF ${totalVehicleFunding.toFixed(2)} - CHF ${vehicleCosts.toFixed(2)} = CHF ${roundMoney(numberOr(vehiclePot.balance_chf)).toFixed(2)}`,
    },
    {
      title: "Konto",
      formula: "Zufluss - aktuelle Kosten - Reserve",
      example: `CHF ${roundMoney(numberOr(sharedPot.inflow_chf)).toFixed(2)} - CHF ${currentCostTotal.toFixed(2)} - CHF ${reserve.toFixed(
        2,
      )} = CHF ${potBalance.toFixed(2)}`,
    },
  ];

  return {
    period: activePeriod,
    settings: normalizedSettings,
    nodes,
    links,
    detailItems,
    overviewRows,
    personRows,
    vehicleCostRows,
    livingCostRows,
    incomeRows,
    transferRows: currentTransfers,
    formulaRows,
    historical: {
      amount: historicalAmount,
      rows: historicalCount,
    },
    totals: {
      totalVehicleFunding,
      totalLivingFunding,
      totalWorkUsed,
      totalWorkCarried,
      vehicleCosts,
      livingCosts,
      currentCostTotal,
      reserve,
      potBalance,
      sollZufluss: roundMoney(numberOr(sharedPot.inflow_chf)),
      recordedPaid: roundMoney(numberOr(sharedPot.contributions_paid_chf)),
    },
  };
};
