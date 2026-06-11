export const accountingPeople = ["Nic", "Luki", "Kayla", "Jeanne"];

export const accountingBucketOptions = [
  { id: "van_investment", label: "Van investment" },
  { id: "shared_running", label: "Shared running cost" },
  { id: "usage", label: "Usage cost" },
  { id: "income", label: "Income" },
  { id: "settlement", label: "Settlement" },
  { id: "work_credit", label: "Work credit" },
  { id: "historical_investment", label: "Historical investment" },
  { id: "private_ignore", label: "Private / ignore" },
];

export const fundingAccountOptions = [
  { id: "personal", label: "Paid personally" },
  { id: "shared_pot", label: "Paid from shared pot" },
];

export const allocationBasisOptions = [
  { id: "equal", label: "Split equally" },
  { id: "km_night_usage", label: "By km/night usage" },
  { id: "direct_person", label: "Direct person" },
  { id: "manual", label: "Manual split" },
  { id: "none", label: "No allocation" },
];

export const defaultAccountingSettings = {
  schema_version: "2026-06-05",
  km_rate_chf: 0.5,
  night_rate_chf: 50,
  workday_rate_chf: 100,
  monthly_payment_chf: 50,
  reserve_target_chf: 2000,
  surplus_reserve_percent: 70,
  surplus_historical_repayment_percent: 30,
};

export const accountingBucketLabelMap = Object.fromEntries(accountingBucketOptions.map((option) => [option.id, option.label]));
export const fundingAccountLabelMap = Object.fromEntries(fundingAccountOptions.map((option) => [option.id, option.label]));
export const allocationBasisLabelMap = Object.fromEntries(allocationBasisOptions.map((option) => [option.id, option.label]));

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const sharedPotAccount = "shared_pot";
const sharedPotProjectionKeys = [
  "inflow_chf",
  "outflow_chf",
  "contributions_due_chf",
  "contributions_paid_chf",
  "usage_charges_chf",
  "external_income_chf",
  "current_costs_chf",
  "reserve_allocation_chf",
  "historical_repayment_chf",
  "balance_chf",
];
const sourceCountKeys = ["cost_entries", "historical_cost_entries", "trip_entries", "booking_entries", "work_entries"];
const monthlyCloseTotalKeys = [
  "monthly_contributions_chf",
  "shared_pot_inflow_chf",
  "shared_pot_outflow_chf",
  "shared_pot_balance_chf",
  "contributions_due_chf",
  "contributions_paid_chf",
  "usage_charges_chf",
  "external_income_chf",
  "current_costs_chf",
  "reserve_allocation_chf",
  "historical_repayment_chf",
  "historical_investment_basis_chf",
];

const numberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const periodFromDate = (value) => {
  const text = String(value || "");
  return text.length >= 7 ? text.slice(0, 7) : "";
};

export const normalizeAccountingSettings = (settings = {}) => ({
  ...defaultAccountingSettings,
  ...settings,
  km_rate_chf: numberOr(settings.km_rate_chf, defaultAccountingSettings.km_rate_chf),
  night_rate_chf: numberOr(settings.night_rate_chf, defaultAccountingSettings.night_rate_chf),
  workday_rate_chf: numberOr(settings.workday_rate_chf, defaultAccountingSettings.workday_rate_chf),
  monthly_payment_chf: numberOr(settings.monthly_payment_chf, defaultAccountingSettings.monthly_payment_chf),
  reserve_target_chf: numberOr(settings.reserve_target_chf, defaultAccountingSettings.reserve_target_chf),
  surplus_reserve_percent: numberOr(settings.surplus_reserve_percent, defaultAccountingSettings.surplus_reserve_percent),
  surplus_historical_repayment_percent: numberOr(
    settings.surplus_historical_repayment_percent,
    defaultAccountingSettings.surplus_historical_repayment_percent,
  ),
});

export const inferAccountingBucket = (entry = {}) => {
  if (entry.type === "transfer") return "settlement";
  if (entry.type === "income") return "income";
  switch (entry.category) {
    case "vehicle_purchase":
    case "hardware_material":
    case "interior_build":
    case "equipment":
      return "van_investment";
    case "repairs_service":
    case "registration_fees":
    case "insurance":
    case "taxes":
      return "shared_running";
    case "fuel_energy":
      return "usage";
    case "trip_payout":
      return "income";
    case "settlement":
      return "settlement";
    default:
      return "shared_running";
  }
};

const inferFundingAccount = (entry) => (entry.bucket === "settlement" || entry.bucket === "private_ignore" ? "personal" : "personal");

const inferAllocationBasis = (entry) => {
  if (entry.bucket === "usage") return "km_night_usage";
  if (["income", "settlement", "private_ignore"].includes(entry.bucket)) return "none";
  return "equal";
};

export const normalizeCostEntryForAccounting = (entry = {}) => {
  const historical = Boolean(entry.historical || entry.historical_only);
  const normalized = {
    ...entry,
    schema_version: entry.schema_version || defaultAccountingSettings.schema_version,
    period: entry.period || periodFromDate(entry.date),
    bucket: entry.bucket || inferAccountingBucket(entry),
    source_type: entry.source_type || "manual",
    source_id: entry.source_id || entry.id || "",
    historical,
    historical_only: Boolean(entry.historical_only || historical),
  };
  normalized.funding_account = entry.funding_account || inferFundingAccount(normalized);
  normalized.allocation_basis = entry.allocation_basis || inferAllocationBasis(normalized);
  normalized.affects_live_balance =
    typeof entry.affects_live_balance === "boolean"
      ? entry.affects_live_balance
      : !normalized.historical_only && !normalized.historical && normalized.bucket !== "private_ignore";
  return normalized;
};

const emptyPersonMap = (people, initial = 0) => Object.fromEntries(people.map((person) => [person, initial]));

const normalizeMoneyMap = (values = {}, keys = []) => {
  const normalized = Object.fromEntries(keys.map((key) => [key, 0]));
  Object.entries(values || {}).forEach(([key, value]) => {
    normalized[key] = roundMoney(numberOr(value));
  });
  return normalized;
};

const normalizeCountMap = (values = {}) =>
  Object.fromEntries(sourceCountKeys.map((key) => [key, Math.max(0, Math.trunc(numberOr(values?.[key])))]));

export const normalizeAccountingProjectionFromApi = (payload = {}, { people = accountingPeople } = {}) => {
  if (!payload || typeof payload !== "object" || !payload.period || !payload.shared_pot) {
    return null;
  }
  const settings = normalizeAccountingSettings(payload.settings || {});
  const sharedPot = Object.fromEntries(
    sharedPotProjectionKeys.map((key) => [key, roundMoney(numberOr(payload.shared_pot?.[key]))]),
  );
  const suggestedSettlements = Array.isArray(payload.suggested_settlements)
    ? payload.suggested_settlements
        .map((row) => ({
          from_person: String(row?.from_person || "").trim(),
          to_person: String(row?.to_person || "").trim(),
          amount_chf: roundMoney(numberOr(row?.amount_chf)),
          reason: String(row?.reason || "").trim(),
        }))
        .filter((row) => row.from_person && row.to_person && row.amount_chf > 0)
    : [];

  return {
    period: String(payload.period),
    settings,
    monthlyContributionsCHF: roundMoney(numberOr(payload.monthly_contributions_chf)),
    sharedPot,
    usageByPerson: normalizeMoneyMap(payload.usage_by_person, people),
    workCreditsByPerson: normalizeMoneyMap(payload.work_credits_by_person, people),
    kmByPerson: normalizeMoneyMap(payload.km_by_person, people),
    nightsByPerson: normalizeMoneyMap(payload.nights_by_person, people),
    bucketTotals: normalizeMoneyMap(
      payload.bucket_totals,
      accountingBucketOptions.map((option) => option.id),
    ),
    personBalances: normalizeMoneyMap(payload.person_balances, people),
    settlementBalances: normalizeMoneyMap(payload.settlement_balances, [...people, sharedPotAccount]),
    suggestedSettlements,
    sourceCounts: normalizeCountMap(payload.source_counts),
    historical: {
      investment_chf: roundMoney(numberOr(payload.historical?.investment_chf)),
      rows: Math.max(0, Math.trunc(numberOr(payload.historical?.rows))),
    },
  };
};

export const normalizeMonthlyCloseFromApi = (payload = {}, { people = accountingPeople } = {}) => {
  if (!payload || typeof payload !== "object" || !payload.period) {
    return null;
  }
  const suggestedSettlements = Array.isArray(payload.suggested_settlements)
    ? payload.suggested_settlements
        .map((row) => ({
          from_person: String(row?.from_person || "").trim(),
          to_person: String(row?.to_person || "").trim(),
          amount_chf: roundMoney(numberOr(row?.amount_chf)),
          reason: String(row?.reason || "").trim(),
        }))
        .filter((row) => row.from_person && row.to_person && row.amount_chf > 0)
    : [];

  return {
    id: String(payload.id || payload.period),
    period: String(payload.period),
    schemaVersion: String(payload.schema_version || defaultAccountingSettings.schema_version),
    settings: normalizeAccountingSettings(payload.settings || {}),
    totals: normalizeMoneyMap(payload.totals, monthlyCloseTotalKeys),
    entryCounts: normalizeCountMap(payload.entry_counts),
    personBalances: normalizeMoneyMap(payload.person_balances, people),
    settlementBalances: normalizeMoneyMap(payload.settlement_balances, [...people, sharedPotAccount]),
    suggestedSettlements,
    notes: String(payload.notes || "").trim(),
    createdAt: String(payload.created_at || ""),
    updatedAt: String(payload.updated_at || ""),
  };
};

export const sortMonthlyCloses = (closes = []) =>
  [...closes].sort((left, right) => {
    if (left.period === right.period) {
      return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
    }
    return String(right.period || "").localeCompare(String(left.period || ""));
  });

const addBalance = (balances, person, amount) => {
  if (Object.prototype.hasOwnProperty.call(balances, person)) {
    balances[person] = roundMoney(balances[person] + amount);
  }
};

const moveBetweenBalances = (balances, from, to, amount, reason, rows = []) => {
  const rounded = roundMoney(amount);
  if (!from || !to || rounded <= 0) return 0;
  addBalance(balances, from, rounded);
  addBalance(balances, to, -rounded);
  rows.push({ from_person: from, to_person: to, amount_chf: rounded, reason });
  return rounded;
};

const splitAmount = (amount, participants) => {
  const valid = participants.filter(Boolean);
  if (valid.length === 0) return [];
  const share = roundMoney(amount / valid.length);
  return valid.map((person) => [person, share]);
};

const dateInPeriod = (value, period) => !period || periodFromDate(value) === period;

const bookingNights = (booking) => {
  if (Number.isFinite(Number(booking.nights))) return Number(booking.nights);
  if (!booking.start_date || !booking.end_date) return 0;
  const start = new Date(`${booking.start_date}T00:00:00`);
  const end = new Date(`${booking.end_date}T00:00:00`);
  return Math.max(0, Math.round((end - start) / 86400000));
};

const resolveBookingPerson = (booking, people) => {
  const candidates = [booking.user_name, booking.person, booking.guest_name, booking.paid_by, booking.paid_to];
  return candidates.find((candidate) => people.includes(candidate)) || "";
};

const flattenBalances = (balances, rows, reason = "Balance flattening") => {
  const debtors = Object.entries(balances)
    .filter(([, amount]) => amount < -0.005)
    .map(([person, amount]) => ({ person, amount: -amount }));
  const creditors = Object.entries(balances)
    .filter(([, amount]) => amount > 0.005)
    .map(([person, amount]) => ({ person, amount }));
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = roundMoney(Math.min(debtor.amount, creditor.amount));
    if (amount > 0) {
      rows.push({ from_person: debtor.person, to_person: creditor.person, amount_chf: amount, reason });
    }
    debtor.amount = roundMoney(debtor.amount - amount);
    creditor.amount = roundMoney(creditor.amount - amount);
    if (debtor.amount <= 0.005) debtorIndex += 1;
    if (creditor.amount <= 0.005) creditorIndex += 1;
  }
  return rows;
};

export const buildSuggestedSettlements = (balances, centralAccount = sharedPotAccount) => {
  const working = { ...balances };
  const rows = [];

  if (Object.prototype.hasOwnProperty.call(working, centralAccount)) {
    const debtors = Object.entries(working)
      .filter(([person, amount]) => person !== centralAccount && amount < -0.005)
      .map(([person, amount]) => ({ person, amount: -amount }));
    for (const debtor of debtors) {
      moveBetweenBalances(working, debtor.person, centralAccount, debtor.amount, "Shared pot due", rows);
    }

    const creditors = Object.entries(working)
      .filter(([person, amount]) => person !== centralAccount && amount > 0.005)
      .map(([person, amount]) => ({ person, amount }));
    for (const creditor of creditors) {
      moveBetweenBalances(working, centralAccount, creditor.person, creditor.amount, "Shared pot reimbursement", rows);
    }
    return rows;
  }

  return flattenBalances(working, rows);
};

export const calculateAccountingProjection = ({
  costEntries = [],
  trips = [],
  bookings = [],
  workEntries = [],
  settings = defaultAccountingSettings,
  people = accountingPeople,
  period = periodFromDate(new Date().toISOString()),
} = {}) => {
  const normalizedSettings = normalizeAccountingSettings(settings);
  const balances = emptyPersonMap(people);
  const settlementBalances = { ...emptyPersonMap(people), [sharedPotAccount]: 0 };
  const usageByPerson = emptyPersonMap(people);
  const workCreditsByPerson = emptyPersonMap(people);
  const kmByPerson = emptyPersonMap(people);
  const nightsByPerson = emptyPersonMap(people);
  const bucketTotals = emptyPersonMap(accountingBucketOptions.map((option) => option.id));
  const normalizedCosts = costEntries.map(normalizeCostEntryForAccounting);
  const liveCostEntries = normalizedCosts.filter((entry) => entry.affects_live_balance && dateInPeriod(entry.date, period));
  const historicalCostEntries = normalizedCosts.filter((entry) => entry.historical);
  const periodTrips = trips.filter((trip) => dateInPeriod(trip.timestamp, period));
  const periodBookings = bookings.filter((booking) => booking.status === "booked" && dateInPeriod(booking.start_date, period));
  const periodWorkEntries = workEntries.filter((entry) => entry.month === period);

  const projection = {
    period,
    settings: normalizedSettings,
    monthlyContributionsCHF: roundMoney(normalizedSettings.monthly_payment_chf * people.length),
    sharedPot: {
      inflow_chf: 0,
      outflow_chf: 0,
      contributions_due_chf: 0,
      contributions_paid_chf: 0,
      usage_charges_chf: 0,
      external_income_chf: 0,
      current_costs_chf: 0,
      reserve_allocation_chf: 0,
      historical_repayment_chf: 0,
      balance_chf: 0,
    },
    usageByPerson,
    workCreditsByPerson,
    kmByPerson,
    nightsByPerson,
    bucketTotals,
    personBalances: balances,
    settlementBalances,
    suggestedSettlements: [],
    sourceCounts: {
      cost_entries: liveCostEntries.length,
      historical_cost_entries: historicalCostEntries.length,
      trip_entries: periodTrips.length,
      booking_entries: periodBookings.length,
      work_entries: periodWorkEntries.length,
    },
    historical: {
      investment_chf: roundMoney(
        historicalCostEntries.filter((entry) => entry.bucket === "historical_investment").reduce((sum, entry) => sum + numberOr(entry.amount_chf), 0),
      ),
      rows: historicalCostEntries.length,
    },
  };

  people.forEach((person) => {
    addBalance(balances, person, -normalizedSettings.monthly_payment_chf);
    addBalance(settlementBalances, person, -normalizedSettings.monthly_payment_chf);
  });
  addBalance(settlementBalances, sharedPotAccount, projection.monthlyContributionsCHF);
  projection.sharedPot.contributions_due_chf = projection.monthlyContributionsCHF;
  projection.sharedPot.inflow_chf = roundMoney(projection.sharedPot.inflow_chf + projection.monthlyContributionsCHF);

  periodTrips.forEach((trip) => {
    const person = trip.user_name;
    if (!people.includes(person)) return;
    const km = numberOr(trip.delta_km);
    const cost = roundMoney(km * normalizedSettings.km_rate_chf);
    kmByPerson[person] = roundMoney(kmByPerson[person] + km);
    usageByPerson[person] = roundMoney(usageByPerson[person] + cost);
    bucketTotals.usage = roundMoney(bucketTotals.usage + cost);
    addBalance(balances, person, -cost);
    addBalance(settlementBalances, person, -cost);
    addBalance(settlementBalances, sharedPotAccount, cost);
    projection.sharedPot.usage_charges_chf = roundMoney(projection.sharedPot.usage_charges_chf + cost);
    projection.sharedPot.inflow_chf = roundMoney(projection.sharedPot.inflow_chf + cost);
  });

  periodBookings.forEach((booking) => {
    const person = resolveBookingPerson(booking, people);
    const nights = bookingNights(booking);
    if (person) {
      const cost = roundMoney(nights * normalizedSettings.night_rate_chf);
      nightsByPerson[person] = roundMoney(nightsByPerson[person] + nights);
      usageByPerson[person] = roundMoney(usageByPerson[person] + cost);
      bucketTotals.usage = roundMoney(bucketTotals.usage + cost);
      addBalance(balances, person, -cost);
      addBalance(settlementBalances, person, -cost);
      addBalance(settlementBalances, sharedPotAccount, cost);
      projection.sharedPot.usage_charges_chf = roundMoney(projection.sharedPot.usage_charges_chf + cost);
      projection.sharedPot.inflow_chf = roundMoney(projection.sharedPot.inflow_chf + cost);
    } else if (booking.payment_status === "paid" || booking.payment_status === "partial") {
      const income = roundMoney(numberOr(booking.estimate_total));
      bucketTotals.income = roundMoney(bucketTotals.income + income);
      projection.sharedPot.external_income_chf = roundMoney(projection.sharedPot.external_income_chf + income);
      projection.sharedPot.inflow_chf = roundMoney(projection.sharedPot.inflow_chf + income);
    }
  });

  periodWorkEntries.forEach((entry) => {
    if (!people.includes(entry.person)) return;
    const credit = roundMoney(numberOr(entry.days) * normalizedSettings.workday_rate_chf);
    workCreditsByPerson[entry.person] = roundMoney(workCreditsByPerson[entry.person] + credit);
    bucketTotals.work_credit = roundMoney(bucketTotals.work_credit + credit);
    addBalance(balances, entry.person, credit);
    addBalance(settlementBalances, entry.person, credit);
    addBalance(settlementBalances, sharedPotAccount, -credit);
    projection.sharedPot.outflow_chf = roundMoney(projection.sharedPot.outflow_chf + credit);
  });

  liveCostEntries.forEach((entry) => {
    const amount = roundMoney(numberOr(entry.amount_chf));
    if (amount <= 0) return;
    bucketTotals[entry.bucket] = roundMoney((bucketTotals[entry.bucket] || 0) + amount);

    if (entry.type === "transfer") {
      addBalance(balances, entry.from_person, amount);
      addBalance(balances, entry.to_person, -amount);
      addBalance(settlementBalances, entry.from_person, amount);
      addBalance(settlementBalances, entry.to_person, -amount);
      if (entry.to_person === sharedPotAccount) {
        projection.sharedPot.contributions_paid_chf = roundMoney(projection.sharedPot.contributions_paid_chf + amount);
      }
      return;
    }

    if (entry.type === "income") {
      if (entry.funding_account === "personal" && people.includes(entry.paid_by)) {
        addBalance(balances, entry.paid_by, -amount);
        addBalance(settlementBalances, entry.paid_by, -amount);
        addBalance(settlementBalances, sharedPotAccount, amount);
      }
      projection.sharedPot.external_income_chf = roundMoney(projection.sharedPot.external_income_chf + amount);
      projection.sharedPot.inflow_chf = roundMoney(projection.sharedPot.inflow_chf + amount);
      return;
    }

    if (entry.bucket === "shared_running" || entry.bucket === "usage") {
      projection.sharedPot.current_costs_chf = roundMoney(projection.sharedPot.current_costs_chf + amount);
      projection.sharedPot.outflow_chf = roundMoney(projection.sharedPot.outflow_chf + amount);
      if (entry.funding_account !== "shared_pot") {
        addBalance(balances, entry.paid_by, amount);
        addBalance(settlementBalances, entry.paid_by, amount);
        addBalance(settlementBalances, sharedPotAccount, -amount);
      }
      return;
    }

    if (entry.funding_account === "shared_pot") {
      projection.sharedPot.outflow_chf = roundMoney(projection.sharedPot.outflow_chf + amount);
      return;
    }

    addBalance(balances, entry.paid_by, amount);
    const participants = Array.isArray(entry.participants) && entry.participants.length ? entry.participants : people;
    splitAmount(amount, participants).forEach(([person, share]) => addBalance(balances, person, -share));
  });

  const surplusBeforePolicy = roundMoney(Math.max(0, projection.sharedPot.inflow_chf - projection.sharedPot.outflow_chf));
  const reserveNeed = Math.max(0, normalizedSettings.reserve_target_chf);
  const reserveAllocation = roundMoney(Math.min(reserveNeed, surplusBeforePolicy * (normalizedSettings.surplus_reserve_percent / 100)));
  const historicalRepayment = roundMoney(
    Math.min(
      Math.max(0, surplusBeforePolicy - reserveAllocation),
      surplusBeforePolicy * (normalizedSettings.surplus_historical_repayment_percent / 100),
    ),
  );

  projection.sharedPot.reserve_allocation_chf = reserveAllocation;
  projection.sharedPot.historical_repayment_chf = historicalRepayment;
  projection.sharedPot.outflow_chf = roundMoney(projection.sharedPot.outflow_chf + reserveAllocation + historicalRepayment);
  projection.sharedPot.balance_chf = roundMoney(projection.sharedPot.inflow_chf - projection.sharedPot.outflow_chf);
  projection.personBalances = Object.fromEntries(Object.entries(balances).map(([person, amount]) => [person, roundMoney(amount)]));
  projection.settlementBalances = Object.fromEntries(Object.entries(settlementBalances).map(([person, amount]) => [person, roundMoney(amount)]));
  projection.suggestedSettlements = buildSuggestedSettlements(projection.settlementBalances);

  return projection;
};
