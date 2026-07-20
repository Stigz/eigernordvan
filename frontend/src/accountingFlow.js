import {
  accountingCurrentOpenPeriod,
  accountingCurrentOpenStartDate,
  accountingPeople,
  normalizeAccountingSettings,
  normalizeCostEntryForAccounting,
} from "./accounting";

const sharedPotAccount = "shared_pot";
const externalIncomeNode = "source:income";

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

const emptyPersonMoneyMap = (people = []) => Object.fromEntries(people.map((person) => [person, 0]));

const addDetail = (items, id, payload) => {
  items[id] = {
    id,
    rows: [],
    ...payload,
    amount: roundMoney(payload.amount || 0),
  };
};

export const buildSankeyAccountingModel = ({
  projection,
  costEntries = [],
  fuelEntries = [],
  trips = [],
  bookings = [],
  workEntries = [],
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
  const monthlyPaidByPerson = emptyPersonMoneyMap(activePeople);
  const privatePaidByPerson = emptyPersonMoneyMap(activePeople);
  const monthlyRows = [];
  const usageRows = [];
  const workRows = [];
  const transferRows = currentTransfers.map((entry) =>
    makeMoneyRow({
      label: "Eingetragen bezahlt",
      person: entry.from_person || entry.paid_by || "",
      source: "Kosten",
      date: entry.date,
      description: entry.description || "Transfer",
      amount: roundMoney(entry.amount_chf),
      formula: `${entry.from_person || "-"} → ${entry.to_person || "-"}`,
      detail: entry.id || "",
    }),
  );

  activePeople.forEach((person) => {
    monthlyRows.push(
      makeMoneyRow({
        label: "Monatlicher Basisbeitrag",
        person,
        source: "Regel",
        description: "Fixer Monatsbeitrag in gemeinsames Konto",
        amount: normalizedSettings.monthly_payment_chf,
        formula: `CHF ${normalizedSettings.monthly_payment_chf.toFixed(2)} pro Person`,
      }),
    );
  });

  currentTransfers.forEach((entry) => {
    const amount = roundMoney(entry.amount_chf);
    if (entry.to_person === sharedPotAccount && Object.prototype.hasOwnProperty.call(monthlyPaidByPerson, entry.from_person)) {
      monthlyPaidByPerson[entry.from_person] = roundMoney(monthlyPaidByPerson[entry.from_person] + amount);
    }
  });

  fuelEntries.forEach((entry) => {
    const amount = normalizeFuelAmount(entry);
    if (amount <= 0 || entry.missed || !dateInPeriod(entry.timestamp, activePeriod)) return;
    if (Object.prototype.hasOwnProperty.call(privatePaidByPerson, entry.user_name)) {
      privatePaidByPerson[entry.user_name] = roundMoney(privatePaidByPerson[entry.user_name] + amount);
    }
    vehicleCostRows.push(
      makeMoneyRow({
        label: "Diesel",
        person: entry.user_name || "",
        source: "Diesel",
        date: datePart(entry.timestamp),
        description: entry.note || entry.description || "Diesel / Treibstoff",
        amount,
        formula: "Diesel-Eintrag",
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
    if (entry.funding_account !== sharedPotAccount && Object.prototype.hasOwnProperty.call(privatePaidByPerson, entry.paid_by)) {
      privatePaidByPerson[entry.paid_by] = roundMoney(privatePaidByPerson[entry.paid_by] + amount);
    }
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
    const settlementBalance = roundMoney(numberOr(safeProjection.settlementBalances?.[person]));
    const suggestedDue = roundMoney(
      (safeProjection.suggestedSettlements || [])
        .filter((row) => row.from_person === person && row.to_person === sharedPotAccount)
        .reduce((sum, row) => sum + numberOr(row.amount_chf), 0),
    );
    const suggestedReceivable = roundMoney(
      (safeProjection.suggestedSettlements || [])
        .filter((row) => row.from_person === sharedPotAccount && row.to_person === person)
        .reduce((sum, row) => sum + numberOr(row.amount_chf), 0),
    );
    const monthlyDue = roundMoney(normalizedSettings.monthly_payment_chf);
    const monthlyPaid = roundMoney(monthlyPaidByPerson[person]);
    const privatePaid = roundMoney(privatePaidByPerson[person]);

    if (kmCharge > 0) {
      usageRows.push(
        makeMoneyRow({
          label: "Kilometer",
          person,
          source: "KM",
          description: "Distanzbasierte Fahrzeugnutzung",
          amount: kmCharge,
          formula: `${km.toFixed(1)} km × CHF ${normalizedSettings.km_rate_chf.toFixed(2)}`,
        }),
      );
    }
    if (nightCharge > 0) {
      usageRows.push(
        makeMoneyRow({
          label: "Nächte",
          person,
          source: "Booking",
          description: "Übernachtungen, 50/50 Fahrzeug und Ausbau",
          amount: nightCharge,
          formula: `${nights.toFixed(1)} Nächte × CHF ${normalizedSettings.night_rate_chf.toFixed(2)}`,
        }),
      );
    }
    if (workCredit > 0 || workUsed > 0 || workCarried > 0) {
      workRows.push(
        makeMoneyRow({
          label: "Arbeit",
          person,
          source: "Work",
          description: "Interner Credit, kein Cash-Payout",
          amount: workUsed,
          formula: `min(CHF ${workCredit.toFixed(2)}, CHF ${nightLiving.toFixed(2)})`,
        }),
      );
    }

    return {
      person,
      km,
      nights,
      monthlyDue,
      monthlyPaid,
      privatePaid,
      alreadyPaid: roundMoney(monthlyPaid + privatePaid),
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
      settlementBalance,
      suggestedDue,
      suggestedReceivable,
      netSettlement: roundMoney(suggestedReceivable - suggestedDue),
      resultLabel: suggestedReceivable > 0 ? "Gets reimbursed" : suggestedDue > 0 ? "Must pay now" : "Balanced for now",
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
  const monthlyDueTotal = roundMoney(personRows.reduce((sum, row) => sum + row.monthlyDue, 0));
  const kmChargeTotal = roundMoney(personRows.reduce((sum, row) => sum + row.kmCharge, 0));
  const nightVehicleTotal = roundMoney(personRows.reduce((sum, row) => sum + row.nightVehicle, 0));
  const nightLivingTotal = roundMoney(personRows.reduce((sum, row) => sum + row.nightLiving, 0));
  const totalPrivatePaid = roundMoney(personRows.reduce((sum, row) => sum + row.privatePaid, 0));
  const totalMonthlyPaid = roundMoney(personRows.reduce((sum, row) => sum + row.monthlyPaid, 0));
  const totalDueToSharedPot = roundMoney(personRows.reduce((sum, row) => sum + row.suggestedDue, 0));
  const totalReimbursementsFromSharedPot = roundMoney(personRows.reduce((sum, row) => sum + row.suggestedReceivable, 0));
  const externalIncome = roundMoney(numberOr(sharedPot.external_income_chf));
  const hasMeaningfulData =
    monthlyDueTotal > 0 ||
    kmChargeTotal > 0 ||
    nightVehicleTotal > 0 ||
    totalWorkUsed > 0 ||
    vehicleCosts > 0 ||
    livingCosts > 0 ||
    totalDueToSharedPot > 0 ||
    totalReimbursementsFromSharedPot > 0 ||
    externalIncome > 0;

  const links = [];
  const pushLink = (link) => {
    const amount = roundMoney(link.amount);
    if (amount <= 0) return;
    links.push({ ...link, amount, rows: link.rows || [], explanation: link.explanation || "" });
  };

  personRows.forEach((row) => {
    const usageTotal = roundMoney(row.kmCharge + row.nightCharge);
    const personUsageRows = [];
    if (row.kmCharge > 0) {
      personUsageRows.push(
        makeMoneyRow({
          label: "Kilometer",
          person: row.person,
          source: "KM",
          description: "Distanzbasierte Fahrzeugnutzung",
          amount: row.kmCharge,
          formula: `${row.km.toFixed(1)} km × CHF ${normalizedSettings.km_rate_chf.toFixed(2)}`,
        }),
      );
    }
    if (row.nightCharge > 0) {
      personUsageRows.push(
        makeMoneyRow({
          label: "Nächte",
          person: row.person,
          source: "Booking",
          description: "Übernachtungen, 50/50 Fahrzeug und Ausbau",
          amount: row.nightCharge,
          formula: `${row.nights.toFixed(1)} Nächte × CHF ${normalizedSettings.night_rate_chf.toFixed(2)}`,
        }),
      );
    }

    pushLink({
      id: `person:${row.person}:monthly`,
      from: `person:${row.person}`,
      to: "charge:monthly",
      label: `${row.person} monthly base`,
      amount: row.monthlyDue,
      tone: "monthly",
      category: "monthly",
      rows: [
        makeMoneyRow({
          label: "Monatlicher Basisbeitrag",
          person: row.person,
          amount: row.monthlyDue,
          formula: `CHF ${normalizedSettings.monthly_payment_chf.toFixed(2)} pro Person`,
        }),
      ],
      explanation: "Monthly base keeps predictable fixed costs and the shared konto alive.",
    });
    pushLink({
      id: `person:${row.person}:usage`,
      from: `person:${row.person}`,
      to: "charge:usage",
      label: `${row.person} usage`,
      amount: usageTotal,
      tone: "usage",
      category: "usage",
      rows: personUsageRows,
      explanation: "Usage is first gathered per person, then split into kilometres and nights so the chart stays readable.",
    });
    pushLink({
      id: `person:${row.person}:work`,
      from: `person:${row.person}`,
      to: "charge:work",
      label: `${row.person} work credit`,
      amount: row.workUsed,
      tone: "work",
      category: "work_credit",
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
      explanation: "Work credit is an internal offset against living/night charges. It is not cash in the shared konto.",
    });
    pushLink({
      id: `person:${row.person}:private_paid`,
      from: `person:${row.person}`,
      to: "charge:private-paid",
      label: `${row.person} already paid`,
      amount: row.privatePaid,
      tone: "reimbursement",
      category: "expense_paid",
      rows: [
        makeMoneyRow({
          label: "Privat bezahlt",
          person: row.person,
          amount: row.privatePaid,
          formula: "Diesel/Kosten privat bezahlt",
        }),
      ],
      explanation: "Private payments are credited because the shared pot owes that person back.",
    });
  });

  pushLink({
    id: "monthly:shared",
    from: "charge:monthly",
    to: "pot:shared",
    label: "Monthly base → shared pot",
    amount: monthlyDueTotal,
    tone: "monthly",
    category: "monthly",
    rows: monthlyRows,
    explanation: "Base payments are the predictable monthly obligation for the shared konto.",
  });
  pushLink({
    id: "usage:km",
    from: "charge:usage",
    to: "charge:km",
    label: "Usage → kilometres",
    amount: kmChargeTotal,
    tone: "vehicle",
    category: "km",
    rows: usageRows.filter((row) => row.label === "Kilometer"),
    explanation: "The kilometre part of usage is separated before it funds the vehicle pot.",
  });
  pushLink({
    id: "usage:nights",
    from: "charge:usage",
    to: "charge:nights",
    label: "Usage → nights",
    amount: roundMoney(nightVehicleTotal + nightLivingTotal),
    tone: "living",
    category: "night",
    rows: usageRows.filter((row) => row.label === "Nächte"),
    explanation: "Night usage is separated, then split exactly 50/50 into vehicle and living/Ausbau.",
  });
  pushLink({
    id: "km:vehicle",
    from: "charge:km",
    to: "pot:vehicle",
    label: "KM → vehicle pot",
    amount: kmChargeTotal,
    tone: "vehicle",
    category: "km",
    rows: usageRows.filter((row) => row.label === "Kilometer"),
    explanation: "All kilometre charges fund the vehicle pot.",
  });
  pushLink({
    id: "nights:vehicle",
    from: "charge:nights",
    to: "pot:vehicle",
    label: "Half nights → vehicle pot",
    amount: nightVehicleTotal,
    tone: "vehicle",
    category: "night_vehicle",
    rows: personRows.map((row) =>
      makeMoneyRow({
        label: "1/2 Nächte",
        person: row.person,
        amount: row.nightVehicle,
        formula: `${row.nights.toFixed(1)} Nächte × CHF ${normalizedSettings.night_rate_chf.toFixed(2)} ÷ 2`,
      }),
    ),
    explanation: "Night charges are split 50/50: half helps the vehicle pot.",
  });
  pushLink({
    id: "nights:living",
    from: "charge:nights",
    to: "pot:living",
    label: "Half nights → living pot",
    amount: nightLivingTotal,
    tone: "living",
    category: "night_living",
    rows: personRows.map((row) =>
      makeMoneyRow({
        label: "1/2 Nächte",
        person: row.person,
        amount: row.nightLiving,
        formula: `${row.nights.toFixed(1)} Nächte × CHF ${normalizedSettings.night_rate_chf.toFixed(2)} ÷ 2`,
      }),
    ),
    explanation: "Night charges are split 50/50: half funds living/Ausbau.",
  });
  pushLink({
    id: "work:living",
    from: "charge:work",
    to: "pot:living",
    label: "Work credit offset",
    amount: totalWorkUsed,
    tone: "work",
    category: "work_credit",
    dashed: true,
    rows: workRows,
    explanation: "Work reduces living/night charges first and carries forward if unused. It is not cash.",
  });
  pushLink({
    id: "private-paid:reimbursements",
    from: "charge:private-paid",
    to: "out:reimbursements",
    label: "Private payments credited",
    amount: totalPrivatePaid,
    tone: "reimbursement",
    category: "expense_paid",
    rows: [...vehicleCostRows, ...livingCostRows].filter((row) => row.formula.includes("Privat bezahlt")),
    explanation: "When someone paid for diesel or shared costs privately, the shared pot should reimburse them.",
  });
  pushLink({
    id: "income:shared",
    from: externalIncomeNode,
    to: "pot:shared",
    label: "Income → shared pot",
    amount: externalIncome,
    tone: "income",
    category: "income",
    rows: incomeRows,
    explanation: "Rental and external income helps cover current shared costs first.",
  });
  pushLink({
    id: "vehicle:costs",
    from: "pot:vehicle",
    to: "out:vehicle-costs",
    label: "Fahrzeug zahlt Kosten",
    amount: vehicleCosts,
    tone: "vehicle",
    category: "vehicle_cost",
    rows: vehicleCostRows,
    explanation: "Vehicle pot covers diesel, repairs, insurance, taxes, road fees, service, and maintenance.",
  });
  pushLink({
    id: "living:costs",
    from: "pot:living",
    to: "out:living-costs",
    label: "Nächte & Arbeit verrechnet",
    amount: livingCosts,
    tone: "living",
    category: "living_cost",
    rows: livingCostRows,
    explanation: "Living/Ausbau pot covers interior and comfort costs plus used work offsets.",
  });
  pushLink({
    id: "shared:reserve",
    from: "pot:shared",
    to: "out:reserve",
    label: "Reserve",
    amount: reserve,
    tone: "reserve",
    category: "reserve",
    rows: [makeMoneyRow({ label: "Reserve", amount: reserve, formula: "Überschuss × Reserve-Regel" })],
    explanation: "Surplus after current costs goes to reserve before historical repayment.",
  });
  pushLink({
    id: "shared:balance",
    from: "pot:shared",
    to: "out:balance",
    label: "Rest",
    amount: potBalance,
    tone: "balance",
    category: "balance",
    rows: [makeMoneyRow({ label: "Rest im Konto", amount: potBalance, formula: "Zufluss - Kosten - Reserve" })],
    explanation: "Cash left after current policy.",
  });
  pushLink({
    id: "history:paused",
    from: "pot:history",
    to: "out:history",
    label: "Historischer Ausgleich",
    amount: historicalAmount,
    tone: "history",
    category: "historical_paused",
    muted: true,
    dashed: true,
    rows: [
      makeMoneyRow({
        label: "Historischer Ausgleich",
        amount: historicalAmount,
        formula: `${historicalCount} importierte Zeilen, aktuell pausiert`,
      }),
    ],
    explanation: "Old investments stay visible, but they are not charged in this current period.",
  });

  const nodes = [
    ...personRows.map((row) => ({
      id: `person:${row.person}`,
      label: row.person,
      kind: "person",
      column: 0,
      tone: "person",
      amount: roundMoney(row.monthlyDue + row.kmCharge + row.nightCharge + row.privatePaid),
      detail: `${row.km.toFixed(1)} km, ${row.nights.toFixed(1)} Nächte`,
      explanation: row.resultLabel,
    })),
    {
      id: externalIncomeNode,
      label: "Einnahmen",
      kind: "source",
      column: 0,
      tone: "income",
      amount: externalIncome,
      detail: "Miete / Einnahmen",
      hiddenWhenZero: true,
    },
    { id: "charge:monthly", label: "Monatsbeitrag", kind: "charge", column: 1, tone: "monthly", amount: monthlyDueTotal, detail: "fixer Beitrag" },
    {
      id: "charge:usage",
      label: "Nutzung",
      kind: "charge",
      column: 1,
      tone: "usage",
      amount: roundMoney(kmChargeTotal + nightVehicleTotal + nightLivingTotal),
      detail: "km + Nächte",
    },
    { id: "charge:km", label: "Kilometer", kind: "charge", column: 1, tone: "vehicle", amount: kmChargeTotal, detail: "km × Rate" },
    {
      id: "charge:nights",
      label: "Nächte",
      kind: "charge",
      column: 1,
      tone: "living",
      amount: roundMoney(nightVehicleTotal + nightLivingTotal),
      detail: "50/50 geteilt",
    },
    { id: "charge:work", label: "Arbeit", kind: "charge", column: 1, tone: "work", amount: totalWorkUsed, detail: "intern, kein Cash" },
    { id: "charge:private-paid", label: "Privat bezahlt", kind: "charge", column: 1, tone: "reimbursement", amount: totalPrivatePaid, detail: "Gutschrift" },
    {
      id: "pot:vehicle",
      label: "Fahrzeug",
      kind: "pot",
      column: 2,
      tone: "vehicle",
      amount: roundMoney(numberOr(vehiclePot.usage_funding_chf)),
      detail: "km + 1/2 Nächte",
    },
    {
      id: "pot:living",
      label: "Nächte & Arbeit",
      kind: "pot",
      column: 2,
      tone: "living",
      amount: roundMoney(numberOr(livingPot.usage_funding_chf)),
      detail: "1/2 Nächte + Arbeit",
    },
    {
      id: "pot:shared",
      label: "Gemeinsames Konto",
      kind: "pot",
      column: 2,
      tone: "shared",
      amount: roundMoney(numberOr(sharedPot.inflow_chf)),
      detail: "realer Geldtopf",
    },
    {
      id: "pot:history",
      label: "Historischer Ausgleich",
      kind: "history",
      column: 2,
      tone: "history",
      amount: historicalAmount,
      detail: "pausiert",
    },
    { id: "out:vehicle-costs", label: "Fahrzeugkosten", kind: "output", column: 3, tone: "vehicle", amount: vehicleCosts, detail: "Diesel, Service, Gebühren" },
    { id: "out:living-costs", label: "Ausbaukosten", kind: "output", column: 3, tone: "living", amount: livingCosts, detail: "Innenraum + Arbeit" },
    { id: "out:reserve", label: "Reserve", kind: "output", column: 3, tone: "reserve", amount: reserve, detail: "future safety" },
    { id: "out:balance", label: "Rest im Konto", kind: "output", column: 3, tone: "balance", amount: potBalance, detail: "Cash bleibt" },
    { id: "out:reimbursements", label: "Private Gutschrift", kind: "output", column: 3, tone: "reimbursement", amount: totalPrivatePaid, detail: "bereits bezahlt" },
    { id: "out:history", label: "Späterer Ausgleich", kind: "history", column: 3, tone: "history", amount: historicalAmount, detail: "nicht aktiv" },
  ].filter((node) => !node.hiddenWhenZero || Number(node.amount || 0) > 0);

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

  addDetail(detailItems, "charge:usage", {
    title: "Nutzung",
    subtitle: "Alle persönlichen km- und Nachtkosten werden hier gesammelt und danach sauber aufgeteilt.",
    amount: roundMoney(kmChargeTotal + nightVehicleTotal + nightLivingTotal),
    rows: usageRows,
  });
  addDetail(detailItems, "charge:km", {
    title: "Kilometer",
    subtitle: "KM finanzieren nur den Fahrzeugtopf.",
    amount: kmChargeTotal,
    rows: usageRows.filter((row) => row.label === "Kilometer"),
  });
  addDetail(detailItems, "charge:nights", {
    title: "Nächte",
    subtitle: "Nächte werden 50/50 auf Fahrzeug und Nächte & Arbeit geteilt.",
    amount: roundMoney(nightVehicleTotal + nightLivingTotal),
    rows: usageRows.filter((row) => row.label === "Nächte"),
  });
  addDetail(detailItems, "charge:work", {
    title: "Arbeit",
    subtitle: "Interner Credit: reduziert Nachtkosten zuerst, kein automatischer Cash-Payout.",
    amount: totalWorkUsed,
    rows: workRows,
  });
  addDetail(detailItems, "charge:private-paid", {
    title: "Privat bezahlt",
    subtitle: "Diesel oder gemeinsame Kosten, die schon jemand privat übernommen hat.",
    amount: totalPrivatePaid,
    rows: [...vehicleCostRows, ...livingCostRows].filter((row) => row.formula.includes("Privat bezahlt")),
  });

  addDetail(detailItems, "pot:vehicle", {
    title: "Prio 1: Fahrzeug",
    subtitle: "KM und halbe Nächte decken Diesel, Unterhalt, Versicherung und Gebühren.",
    amount: roundMoney(numberOr(vehiclePot.balance_chf)),
    rows: [
      makeMoneyRow({ label: "KM", amount: numberOr(vehiclePot.km_funding_chf), formula: "Alle KM × km-Rate" }),
      makeMoneyRow({ label: "1/2 Nächte", amount: numberOr(vehiclePot.night_funding_chf), formula: "Nächte × Nacht-Rate ÷ 2" }),
      makeMoneyRow({ label: "Fahrzeugkosten", amount: vehicleCosts, formula: "Diesel + Kosten-Tab Fahrzeug" }),
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
  nodes.forEach((node) => {
    if (!detailItems[node.id]) {
      addDetail(detailItems, node.id, {
        title: node.label,
        subtitle: node.explanation || node.detail || "Accounting node.",
        amount: node.amount,
        rows: links
          .filter((link) => link.from === node.id || link.to === node.id)
          .map((link) => makeMoneyRow({ label: link.label, amount: link.amount, formula: link.explanation || link.category || "" })),
      });
    }
  });

  const overviewRows = [
    makeMoneyRow({ label: "Soll-Zufluss", amount: numberOr(sharedPot.inflow_chf), formula: "Monatlich fällig + Nutzung + Einnahmen - Arbeit genutzt" }),
    makeMoneyRow({ label: "Aktuelle Kosten", amount: currentCostTotal, formula: "Fahrzeug + Nächte/Arbeit" }),
    makeMoneyRow({ label: "Reserve", amount: reserve, formula: "Überschuss × Reserve-Regel" }),
    makeMoneyRow({ label: "Rest", amount: potBalance, formula: "Zufluss - Kosten - Reserve" }),
    makeMoneyRow({ label: "Historisch pausiert", amount: historicalAmount, formula: "Nicht in aktueller Zahlung" }),
  ];
  const auditRows = [
    ...monthlyRows,
    ...usageRows,
    ...workRows,
    ...vehicleCostRows,
    ...livingCostRows,
    ...incomeRows,
    ...transferRows,
    makeMoneyRow({ label: "Reserve", source: "Regel", description: "Reserve allocation", amount: reserve, formula: "Überschuss × Reserve-Regel" }),
    makeMoneyRow({
      label: "Historischer Ausgleich pausiert",
      source: "Import",
      description: "Old investments visible, not charged now",
      amount: historicalAmount,
      formula: `${historicalCount} historical rows`,
    }),
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
      formula: "KM + 1/2 Nächte - Diesel/Unterhalt",
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
    auditRows,
    personRows,
    vehicleCostRows,
    livingCostRows,
    incomeRows,
    transferRows,
    formulaRows,
    settlementGroups: {
      dueToSharedPot: (safeProjection.suggestedSettlements || []).filter((row) => row.to_person === sharedPotAccount),
      reimbursementsFromSharedPot: (safeProjection.suggestedSettlements || []).filter((row) => row.from_person === sharedPotAccount),
    },
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
      monthlyDueTotal,
      totalMonthlyPaid,
      totalPrivatePaid,
      totalDueToSharedPot,
      totalReimbursementsFromSharedPot,
      externalIncome,
    },
    hasMeaningfulData,
  };
};

export const buildAccountingFlowModel = (args = {}) => buildSankeyAccountingModel(args);
