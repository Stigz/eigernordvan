import { Fragment, useEffect, useMemo, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL;

const normalizeApiBaseUrl = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    return "";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const initialForm = {
  user_name: "",
  start_km: "",
  end_km: "",
};

const parseOptionalNumberInput = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const initialGasForm = {
  user_name: "",
  liters: "",
  cost_chf: "",
  odometer_km: "",
};

const initialBookingForm = {
  start_date: "",
  end_date: "",
  status: "booked",
  guest_name: "",
  day_km: "",
  notes: "",
};

const initialCostForm = {
  date: "",
  type: "expense",
  amount_chf: "",
  description: "",
  category: "general",
  paid_by: "Nic",
  participants: ["Nic", "Kayla", "Jeanne", "Lüku"],
  from_person: "Nic",
  to_person: "Kayla",
  notes: "",
  historical_only: true,
};

const costCategories = [
  { id: "vehicle_purchase", label: "Vehicle purchase" },
  { id: "repairs_service", label: "Repairs & service" },
  { id: "registration_fees", label: "Registration & road fees" },
  { id: "insurance", label: "Insurance" },
  { id: "taxes", label: "Taxes" },
  { id: "fuel_energy", label: "Fuel & energy" },
  { id: "hardware_material", label: "Hardware & material" },
  { id: "interior_build", label: "Interior build" },
  { id: "equipment", label: "Equipment & accessories" },
  { id: "trip_payout", label: "Trip payout / reimbursement" },
  { id: "settlement", label: "Internal settlement" },
  { id: "general", label: "General" },
];

const categoryLabelMap = Object.fromEntries(costCategories.map((category) => [category.id, category.label]));

const inferCostCategory = (description, type) => {
  const normalized = String(description || "").toLowerCase();
  if (type === "transfer") {
    return "settlement";
  }
  if (
    normalized.includes("sprinter") ||
    normalized.includes("fahrzeug") ||
    normalized.includes("van kauf") ||
    normalized.includes("purchase")
  ) {
    return "vehicle_purchase";
  }
  if (
    normalized.includes("werkstatt") ||
    normalized.includes("repar") ||
    normalized.includes("brems") ||
    normalized.includes("handbrems") ||
    normalized.includes("mech") ||
    normalized.includes("pneus") ||
    normalized.includes("batterie")
  ) {
    return "repairs_service";
  }
  if (
    normalized.includes("strassenverkehrsamt") ||
    normalized.includes("tagesschild") ||
    normalized.includes("tageschild") ||
    normalized.includes("autobahn")
  ) {
    return "registration_fees";
  }
  if (normalized.includes("versicherung") || normalized.includes("tcs")) {
    return "insurance";
  }
  if (normalized.includes("steuer")) {
    return "taxes";
  }
  if (normalized.includes("benzin") || normalized.includes("diesel") || normalized.includes("tank")) {
    return "fuel_energy";
  }
  if (
    normalized.includes("holz") ||
    normalized.includes("bauhaus") ||
    normalized.includes("landi") ||
    normalized.includes("schraub") ||
    normalized.includes("kabel") ||
    normalized.includes("brunox") ||
    normalized.includes("farbe") ||
    normalized.includes("epoxy") ||
    normalized.includes("material")
  ) {
    return "hardware_material";
  }
  if (
    normalized.includes("bett") ||
    normalized.includes("lattenrost") ||
    normalized.includes("futon") ||
    normalized.includes("table") ||
    normalized.includes("terrassenholz")
  ) {
    return "interior_build";
  }
  if (
    normalized.includes("solar") ||
    normalized.includes("inverter") ||
    normalized.includes("charger") ||
    normalized.includes("heizung") ||
    normalized.includes("kühlschrank") ||
    normalized.includes("detektor") ||
    normalized.includes("wassertank")
  ) {
    return "equipment";
  }
  if (normalized.includes("auszahlung") || normalized.includes("trip")) {
    return "trip_payout";
  }
  return "general";
};

const bookingStatusPriority = {
  open: 0,
  blocked: 1,
  booked: 2,
};

const formatDateISO = (date) => date.toISOString().slice(0, 10);

const parseIsoDate = (value) => new Date(`${value}T00:00:00`);

const monthLabel = (date) =>
  date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

const toMonthStart = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const calculateBookingPreview = (startDate, endDate, dayKm) => {
  if (!startDate || !endDate) {
    return { nights: 0, total: 0 };
  }
  const nights = Math.max(0, Math.round((parseIsoDate(endDate) - parseIsoDate(startDate)) / (1000 * 60 * 60 * 24)));
  const dayKmNumber = Number(dayKm);
  const sanitizedDayKm = Number.isFinite(dayKmNumber) && dayKmNumber > 0 ? dayKmNumber : 0;
  const total = nights * 100 + 100 + sanitizedDayKm * 0.5;
  return { nights, total };
};

const bookingOverlapsDay = (booking, dayIso) => booking.start_date <= dayIso && dayIso < booking.end_date;

const profileStorageKey = "van_trip_profiles_v1";

const parseProfiles = () => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(profileStorageKey);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
  } catch (_error) {
    return [];
  }
};

const saveProfiles = (profiles) => {
  localStorage.setItem(profileStorageKey, JSON.stringify(profiles));
};

const fuelStorageKey = "van_fuel_entries_v1";
const workStorageKey = "van_work_planner_v1";
const workPeople = ["Nic", "Kayla", "Jeanne", "Lüku"];
const costStorageKey = "van_costs_v1";
const boardColumns = ["Backlog", "In Progress", "Done"];
const workStatuses = ["backlog", "in_progress", "done"];
const migrateBoardStatus = (status) => {
  if (status === "review") {
    return "in_progress";
  }
  return workStatuses.includes(status) ? status : "backlog";
};

const boardColumnToStatus = {
  Backlog: "backlog",
  "In Progress": "in_progress",
  Review: "in_progress",
  Done: "done",
};

const statusToBoardColumn = {
  backlog: "Backlog",
  in_progress: "In Progress",
  done: "Done",
};

const parseFuelEntries = () => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(fuelStorageKey);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => ({
        ...entry,
        liters: Number(entry.liters),
        cost_chf: Number(entry.cost_chf),
        odometer_km: Number(entry.odometer_km),
      }))
      .filter(
        (entry) =>
          entry &&
          typeof entry.id === "string" &&
          entry.user_name &&
          Number.isFinite(entry.liters) &&
          Number.isFinite(entry.cost_chf) &&
          Number.isFinite(entry.odometer_km) &&
          entry.timestamp,
      );
  } catch (_error) {
    return [];
  }
};

const saveFuelEntries = (entries) => {
  localStorage.setItem(fuelStorageKey, JSON.stringify(entries));
};

const emptyWorkState = {
  items: [],
};

const cloneEmptyWorkState = () => ({
  items: [],
});

const normalizeTimeEntry = (entry) => {
  const parsedHours = Number(entry?.hours || 0);
  return {
    id: typeof entry?.id === "string" ? entry.id : crypto.randomUUID(),
    date: typeof entry?.date === "string" ? entry.date : formatDateISO(new Date()),
    note: typeof entry?.note === "string" ? entry.note : "",
    hours: Number.isFinite(parsedHours) ? parsedHours : 0,
    created_at: typeof entry?.created_at === "string" ? entry.created_at : new Date().toISOString(),
  };
};

const normalizeWorkSubtask = (subtask) => ({
  id: typeof subtask?.id === "string" ? subtask.id : crypto.randomUUID(),
  title: typeof subtask?.title === "string" ? subtask.title : "",
  status: workStatuses.includes(subtask?.status) ? subtask.status : subtask?.done ? "done" : "backlog",
  estimate_hours: Number(subtask?.estimate_hours || 0) || 0,
  time_entries: Array.isArray(subtask?.time_entries) ? subtask.time_entries.map(normalizeTimeEntry) : [],
});

const normalizeWorkItem = (item, fallbackKind = "todo", fallbackRank = 0) => ({
  id: typeof item?.id === "string" ? item.id : crypto.randomUUID(),
  kind: ["task", "todo", "board"].includes(item?.kind) ? item.kind : fallbackKind,
  title: typeof item?.title === "string" ? item.title : "",
  owner: typeof item?.owner === "string" ? item.owner : typeof item?.person === "string" ? item.person : workPeople[0],
  status: migrateBoardStatus(
    typeof item?.status === "string"
      ? item.status
    : typeof item?.column === "string"
      ? boardColumnToStatus[item.column] || "backlog"
      : item?.done
        ? "done"
        : "backlog",
  ),
  priority: typeof item?.priority === "string" || typeof item?.priority === "number" ? item.priority : "P2",
  due_date: typeof item?.due_date === "string" ? item.due_date : typeof item?.end_date === "string" ? item.end_date : "",
  estimate_hours: Number(item?.estimate_hours || 0) || 0,
  time_entries: Array.isArray(item?.time_entries) ? item.time_entries.map(normalizeTimeEntry) : [],
  subtasks: Array.isArray(item?.subtasks) ? item.subtasks.map(normalizeWorkSubtask) : [],
  created_at: typeof item?.created_at === "string" ? item.created_at : new Date().toISOString(),
  updated_at: typeof item?.updated_at === "string" ? item.updated_at : new Date().toISOString(),
  start_date: typeof item?.start_date === "string" ? item.start_date : "",
  rank: Number.isFinite(Number(item?.rank))
    ? Number(item.rank)
    : Number.isFinite(Number(item?.priority_order))
      ? Number(item.priority_order)
      : fallbackRank,
});

const migrateLegacyWorkState = (parsed) => {
  const next = [];
  if (Array.isArray(parsed?.tasks)) {
    next.push(...parsed.tasks.map((task, index) => normalizeWorkItem({ ...task, kind: "task" }, "task", index + 1)));
  }
  if (Array.isArray(parsed?.todos)) {
    const offset = next.length;
    next.push(...parsed.todos.map((todo, index) => normalizeWorkItem({ ...todo, kind: "todo" }, "todo", offset + index + 1)));
  }
  if (Array.isArray(parsed?.board)) {
    const offset = next.length;
    next.push(...parsed.board.map((card, index) => normalizeWorkItem({ ...card, kind: "board" }, "board", offset + index + 1)));
  }
  return { items: next };
};

const parseWorkStateFromPayload = (payload) => {
  if (!payload || typeof payload !== "object") {
    return cloneEmptyWorkState();
  }
  if (Array.isArray(payload.items)) {
    return { items: payload.items.map((item, index) => normalizeWorkItem(item, item?.kind || "todo", index + 1)) };
  }
  return migrateLegacyWorkState(payload);
};

const parseWorkState = () => {
  if (typeof window === "undefined") {
    return emptyWorkState;
  }

  try {
    const raw = localStorage.getItem(workStorageKey);
    const parsed = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object") {
      return cloneEmptyWorkState();
    }
    if (Array.isArray(parsed.items)) {
      return { items: parsed.items.map((item, index) => normalizeWorkItem(item, item?.kind || "todo", index + 1)) };
    }
    return migrateLegacyWorkState(parsed);
  } catch (_error) {
    return cloneEmptyWorkState();
  }
};

const saveWorkState = (state) => {
  const items = Array.isArray(state.items)
    ? [...state.items]
        .sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0))
        .map((item, index) => ({ ...item, rank: index + 1 }))
    : [];
  localStorage.setItem(workStorageKey, JSON.stringify({ items }));
};

const parseCostState = () => {
  if (typeof window === "undefined") {
    return { entries: [] };
  }
  try {
    const raw = localStorage.getItem(costStorageKey);
    const parsed = JSON.parse(raw || "{\"entries\":[]}");
    if (!Array.isArray(parsed?.entries)) {
      return { entries: [] };
    }
    return {
      entries: parsed.entries.map((entry) => ({
        ...entry,
        category: entry?.category || inferCostCategory(entry?.description, entry?.type),
      })),
    };
  } catch (_error) {
    return { entries: [] };
  }
};

const saveCostState = (state) => {
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  localStorage.setItem(costStorageKey, JSON.stringify({ entries }));
};

const sumTimeEntryHours = (entries) =>
  entries.reduce((sum, entry) => {
    const hours = Number(entry.hours || 0);
    return sum + (Number.isFinite(hours) ? hours : 0);
  }, 0);

const estimateHoursForItem = (item) => {
  const rootEstimate = Number(item?.estimate_hours || 0) || 0;
  const subtaskEstimate = (item?.subtasks || []).reduce((sum, subtask) => sum + (Number(subtask?.estimate_hours || 0) || 0), 0);
  return rootEstimate + subtaskEstimate;
};

const loggedHoursForItem = (item) => {
  const rootLogged = sumTimeEntryHours(item?.time_entries || []);
  const subtaskLogged = (item?.subtasks || []).reduce((sum, subtask) => sum + sumTimeEntryHours(subtask?.time_entries || []), 0);
  return rootLogged + subtaskLogged;
};

const varianceHoursForItem = (item) => loggedHoursForItem(item) - estimateHoursForItem(item);

const compareByOdometerThenTime = (a, b) => {
  if (a.odometer_km !== b.odometer_km) {
    return a.odometer_km - b.odometer_km;
  }
  return new Date(a.timestamp) - new Date(b.timestamp);
};

const buildEfficiencyLinePath = (points, width, height, padding) => {
  if (points.length === 0) {
    return "";
  }

  const minY = Math.min(...points.map((point) => point.efficiency));
  const maxY = Math.max(...points.map((point) => point.efficiency));
  const yRange = maxY - minY || 1;
  const xRange = points.length - 1 || 1;

  return points
    .map((point, index) => {
      const x = padding + (index / xRange) * (width - padding * 2);
      const normalizedY = (point.efficiency - minY) / yRange;
      const y = height - padding - normalizedY * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
};

const accountingPeople = [
  { id: crypto.randomUUID(), name: "Nic", km_used: 3200, nights_used: 18, work_hours: 42, extra_payments: 2000 },
  { id: crypto.randomUUID(), name: "Kayla", km_used: 2100, nights_used: 12, work_hours: 26, extra_payments: 600 },
  { id: crypto.randomUUID(), name: "Luk", km_used: 1450, nights_used: 9, work_hours: 14, extra_payments: 350 },
  { id: crypto.randomUUID(), name: "Jeanne", km_used: 1850, nights_used: 11, work_hours: 20, extra_payments: 500 },
];

const accountingInitialSettings = {
  km_rate_chf: 0.62,
  night_rate_chf: 25,
  work_hour_rate_chf: 20,
  yearly_van_costs_chf: 2000,
  monthly_payment_chf: 50,
};

const accountingPersonPalette = ["#2563eb", "#7c3aed", "#db2777", "#16a34a", "#ea580c", "#0891b2"];

const toAccountingNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const accountingRound2 = (value) => Math.round(value * 100) / 100;
const formatChf = (value) => `${toAccountingNumber(value).toFixed(2)} CHF`;

const describePieArc = (cx, cy, radius, startAngle, endAngle) => {
  const start = {
    x: cx + radius * Math.cos(startAngle),
    y: cy + radius * Math.sin(startAngle),
  };
  const end = {
    x: cx + radius * Math.cos(endAngle),
    y: cy + radius * Math.sin(endAngle),
  };
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
};

const PieChart = ({ title, slices }) => {
  const size = 148;
  const radius = 60;
  const cx = size / 2;
  const cy = size / 2;
  const total = slices.reduce((sum, slice) => sum + toAccountingNumber(slice.value), 0);
  let angle = -Math.PI / 2;

  const segments = slices
    .filter((slice) => toAccountingNumber(slice.value) > 0)
    .map((slice) => {
      const value = toAccountingNumber(slice.value);
      const delta = total > 0 ? (value / total) * Math.PI * 2 : 0;
      const start = angle;
      const end = angle + delta;
      angle = end;
      return { ...slice, value, path: describePieArc(cx, cy, radius, start, end), percentage: total > 0 ? (value / total) * 100 : 0 };
    });

  return (
    <article className="split-pie-card">
      <h4>{title}</h4>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title} split pie chart`}>
        <circle cx={cx} cy={cy} r={radius} fill="#e2e8f0" />
        {segments.map((segment) => (
          <path key={`${title}-${segment.name}`} d={segment.path} fill={segment.color} />
        ))}
        <circle cx={cx} cy={cy} r={30} fill="#ffffff" />
      </svg>
      <ul>
        {segments.map((segment) => (
          <li key={`${title}-legend-${segment.name}`}>
            <span className="legend-dot" style={{ backgroundColor: segment.color }} />
            <span>{segment.name}</span>
            <strong>{segment.percentage.toFixed(1)}%</strong>
          </li>
        ))}
      </ul>
    </article>
  );
};

const WaterfallChart = ({ name, values, finalBalance }) => {
  const chartHeight = 220;
  const stepWidth = 84;
  const stepGap = 34;
  const leftPad = 36;
  const rightPad = 18;
  const topPad = 24;
  const bottomPad = 48;
  const chartWidth = leftPad + rightPad + stepWidth * values.length + stepGap * (values.length - 1);

  let running = 0;
  const segments = values.map((step) => {
    if (step.kind === "total") {
      return { ...step, start: 0, end: step.value };
    }
    const start = running;
    running += step.value;
    return { ...step, start, end: running };
  });

  const yValues = [0, ...segments.flatMap((segment) => [segment.start, segment.end]), finalBalance];
  const min = Math.min(...yValues, 0);
  const max = Math.max(...yValues, 0);
  const range = max - min || 1;
  const toY = (value) => topPad + ((max - value) / range) * (chartHeight - topPad - bottomPad);
  const baselineY = toY(0);

  return (
    <svg className="waterfall-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${name} annual balance waterfall`}>
      <line x1={leftPad - 12} y1={baselineY} x2={chartWidth - rightPad + 8} y2={baselineY} className="waterfall-zero-line" />
      {segments.map((segment, index) => {
        const x = leftPad + index * (stepWidth + stepGap);
        const yStart = toY(segment.start);
        const yEnd = toY(segment.end);
        const y = Math.min(yStart, yEnd);
        const barHeight = Math.max(4, Math.abs(yStart - yEnd));
        const isPositive = segment.value >= 0;
        const isTotal = segment.kind === "total";
        const className = isTotal
          ? "waterfall-total"
          : segment.tone === "km"
            ? "waterfall-km"
            : segment.tone === "nights"
              ? "waterfall-nights"
              : isPositive
                ? "waterfall-positive"
                : "waterfall-negative";

        return (
          <Fragment key={`${segment.label}-${index}`}>
            {!isTotal && index > 0 ? (
              <line
                x1={x - stepGap + 8}
                y1={toY(segments[index - 1].end)}
                x2={x}
                y2={toY(segment.start)}
                className="waterfall-connector"
              />
            ) : null}
            <rect x={x} y={y} width={stepWidth} height={barHeight} rx="8" className={className} />
            <text x={x + stepWidth / 2} y={Math.max(14, y - 8)} textAnchor="middle" className="waterfall-value">
              {`${segment.value >= 0 ? "+" : "−"}${Math.abs(segment.value).toFixed(0)}`}
            </text>
            <text x={x + stepWidth / 2} y={chartHeight - 16} textAnchor="middle" className="waterfall-label">
              {segment.label}
            </text>
          </Fragment>
        );
      })}
    </svg>
  );
};

const VanAccountingSandbox = () => {
  const [people, setPeople] = useState(accountingPeople);
  const [settings, setSettings] = useState(accountingInitialSettings);

  const results = useMemo(() => {
    const totalUseCost = people.reduce((sum, person) => {
      const useCost =
        toAccountingNumber(person.km_used) * toAccountingNumber(settings.km_rate_chf) +
        toAccountingNumber(person.nights_used) * toAccountingNumber(settings.night_rate_chf);
      return sum + useCost;
    }, 0);

    return people.map((person) => {
      const kmCost = toAccountingNumber(person.km_used) * toAccountingNumber(settings.km_rate_chf);
      const nightCost = toAccountingNumber(person.nights_used) * toAccountingNumber(settings.night_rate_chf);
      const useCost = kmCost + nightCost;
      const workCredit = toAccountingNumber(person.work_hours) * toAccountingNumber(settings.work_hour_rate_chf);
      const extraPayments = toAccountingNumber(person.extra_payments);
      const paymentsMade = extraPayments + toAccountingNumber(settings.monthly_payment_chf) * 12;
      const usageShare = totalUseCost > 0 ? useCost / totalUseCost : 0;
      const yearlyCostShare = toAccountingNumber(settings.yearly_van_costs_chf) * usageShare;
      const annualBalance = workCredit + paymentsMade - useCost - yearlyCostShare;

      return {
        ...person,
        kmCost: accountingRound2(kmCost),
        nightCost: accountingRound2(nightCost),
        usageSharePct: accountingRound2(usageShare * 100),
        workCredit: accountingRound2(workCredit),
        paymentsMade: accountingRound2(paymentsMade),
        useCost: accountingRound2(useCost),
        yearlyCostShare: accountingRound2(yearlyCostShare),
        annualBalance: accountingRound2(annualBalance),
      };
    });
  }, [people, settings]);

  const setPersonValue = (id, field, value) => {
    setPeople((current) => current.map((person) => (person.id === id ? { ...person, [field]: value } : person)));
  };

  const maxBalanceMagnitude = Math.max(1, ...results.map((result) => Math.abs(result.annualBalance)));
  const pieCategories = [
    { key: "km_used", title: "Kilometers used" },
    { key: "nights_used", title: "Nights used" },
    { key: "useCost", title: "Use cost split" },
    { key: "yearlyCostShare", title: "Yearly cost share split" },
  ];

  return (
    <section className="card accounting-card simple-accounting annual-balance-dashboard">
      <header>
        <p className="eyebrow">Van accounting</p>
        <h2>Annual balance</h2>
        <p className="subtitle">See what each person put in, took out, and where their annual balance lands.</p>
      </header>

      <section className="summary-grid accounting-settings-grid compact-settings">
        <label className="field"><span>Kilometer rate (CHF)</span><input type="number" step="0.01" value={settings.km_rate_chf} onChange={(event) => setSettings((current) => ({ ...current, km_rate_chf: event.target.value }))} /></label>
        <label className="field"><span>Night rate (CHF)</span><input type="number" step="0.01" value={settings.night_rate_chf} onChange={(event) => setSettings((current) => ({ ...current, night_rate_chf: event.target.value }))} /></label>
        <label className="field"><span>Work hour rate (CHF)</span><input type="number" step="0.01" value={settings.work_hour_rate_chf} onChange={(event) => setSettings((current) => ({ ...current, work_hour_rate_chf: event.target.value }))} /></label>
        <label className="field"><span>Yearly van costs (CHF)</span><input type="number" step="0.01" value={settings.yearly_van_costs_chf} onChange={(event) => setSettings((current) => ({ ...current, yearly_van_costs_chf: event.target.value }))} /></label>
        <label className="field"><span>Monthly payment (CHF)</span><input type="number" step="0.01" value={settings.monthly_payment_chf} onChange={(event) => setSettings((current) => ({ ...current, monthly_payment_chf: event.target.value }))} /></label>
      </section>

      <p className="monthly-note">Includes CHF 50/month basic contribution for each person.</p>

      <section className="accounting-person-grid">
        {results.map((result) => {
          const waterfallValues = [
            { label: "Work credit", value: result.workCredit },
            { label: "Payments made", value: result.paymentsMade },
            { label: "Km cost", value: -result.kmCost, tone: "km" },
            { label: "Night cost", value: -result.nightCost, tone: "nights" },
            { label: "Share of yearly van costs", value: -result.yearlyCostShare },
            { label: "Annual balance", value: result.annualBalance, kind: "total" },
          ];
          return (
            <article key={result.id} className="accounting-person-card clean-card">
              <header>
                <strong>{result.name}</strong>
                <span className={result.annualBalance >= 0 ? "balance-positive" : "balance-negative"}>{formatChf(result.annualBalance)}</span>
              </header>

              <div className="person-input-grid">
                <label className="field"><span>Kilometers</span><input type="number" value={result.km_used} onChange={(event) => setPersonValue(result.id, "km_used", event.target.value)} /></label>
                <label className="field"><span>Nights</span><input type="number" value={result.nights_used} onChange={(event) => setPersonValue(result.id, "nights_used", event.target.value)} /></label>
                <label className="field"><span>Work hours</span><input type="number" value={result.work_hours} onChange={(event) => setPersonValue(result.id, "work_hours", event.target.value)} /></label>
                <label className="field"><span>Extra payments</span><input type="number" value={result.extra_payments} onChange={(event) => setPersonValue(result.id, "extra_payments", event.target.value)} /></label>
              </div>

              <WaterfallChart name={result.name} values={waterfallValues} finalBalance={result.annualBalance} />

              <footer className="card-footer-metrics">
                <span>Work: {formatChf(result.workCredit)}</span>
                <span>Payments: {formatChf(result.paymentsMade)}</span>
                <span>Use: {formatChf(result.useCost)}</span>
                <span>Km: {formatChf(result.kmCost)}</span>
                <span>Nights: {formatChf(result.nightCost)}</span>
                <span>Yearly costs: {formatChf(result.yearlyCostShare)}</span>
                <span>Usage share: {result.usageSharePct.toFixed(2)}%</span>
              </footer>
              <details className="calculation-details person-details">
                <summary>Show calculation details</summary>
                <ul className="formula-list">
                  <li>Km cost = km × km rate</li>
                  <li>Night cost = nights × night rate</li>
                  <li>Use cost = km cost + night cost</li>
                  <li>Work credit = hours × rate</li>
                  <li>Payments = extra payments + monthly payment × 12</li>
                  <li>Usage share = use cost ÷ total use cost</li>
                  <li>Yearly cost share = yearly van costs × usage share</li>
                  <li>Annual balance = work + payments - use - yearly costs</li>
                </ul>
              </details>
            </article>
          );
        })}
      </section>

      <section className="accounting-visual simple-chart group-balance-chart">
        <h3>Annual balances</h3>
        <div className="chart-list group-bars">
          {results.map((result) => (
            <div key={`balance-${result.id}`} className="chart-row annual-balance-row">
              <span className="chart-month">{result.name}</span>
              <div className="chart-track neutral diverging">
                <div className="zero-line" />
                <div
                  className={`chart-bar ${result.annualBalance >= 0 ? "positive" : "negative"}`}
                  style={{
                    width: `${(Math.abs(result.annualBalance) / maxBalanceMagnitude) * 50}%`,
                    marginLeft: result.annualBalance >= 0 ? "50%" : `${50 - (Math.abs(result.annualBalance) / maxBalanceMagnitude) * 50}%`,
                  }}
                />
              </div>
              <span className={`chart-value ${result.annualBalance >= 0 ? "balance-positive" : "balance-negative"}`}>{formatChf(result.annualBalance)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="accounting-visual simple-chart split-pies-grid">
        <h3>Split between people by category</h3>
        <div className="split-pies-list">
          {pieCategories.map((category) => (
            <PieChart
              key={category.key}
              title={category.title}
              slices={results.map((result, index) => ({
                name: result.name,
                value: result[category.key],
                color: accountingPersonPalette[index % accountingPersonPalette.length],
              }))}
            />
          ))}
        </div>
      </section>
    </section>
  );
};

export default function App() {
  const [activeView, setActiveView] = useState("km");
  const [showQuickIntake, setShowQuickIntake] = useState(true);
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [trips, setTrips] = useState([]);
  const [profiles, setProfiles] = useState(() => parseProfiles());
  const [editId, setEditId] = useState("");
  const [tableState, setTableState] = useState({ state: "loading", message: "Loading entries..." });
  const [openTrip, setOpenTrip] = useState(null);
  const [gasForm, setGasForm] = useState(initialGasForm);
  const [gasStatus, setGasStatus] = useState({ state: "idle", message: "" });
  const [gasEntries, setGasEntries] = useState(() => parseFuelEntries());
  const [gasTableState, setGasTableState] = useState({ state: "loading", message: "Loading fuel entries..." });
  const [bookingForm, setBookingForm] = useState(initialBookingForm);
  const [bookingStatus, setBookingStatus] = useState({ state: "idle", message: "" });
  const [bookings, setBookings] = useState([]);
  const [bookingTableState, setBookingTableState] = useState({ state: "loading", message: "Loading bookings..." });
  const [bookingMonth, setBookingMonth] = useState(() => toMonthStart(new Date()));
  const [workState, setWorkState] = useState(() => parseWorkState());
  const [workItemForm, setWorkItemForm] = useState({
    title: "",
    owner: workPeople[0],
    priority: "P2",
    status: "backlog",
    estimate_hours: "",
    due_date: "",
    start_date: "",
  });
  const [workFilters, setWorkFilters] = useState({ owner: "all", status: "all", priority: "all", due: "all" });
  const [workSyncStatus, setWorkSyncStatus] = useState({ state: "idle", message: "" });
  const [isWorkLoaded, setIsWorkLoaded] = useState(false);
  const [costState, setCostState] = useState(() => parseCostState());
  const [costForm, setCostForm] = useState(() => ({ ...initialCostForm, date: formatDateISO(new Date()) }));
  const [costFilters, setCostFilters] = useState({ year: "all", category: "all", person: "all", type: "all" });
  const [costSyncStatus, setCostSyncStatus] = useState({ state: "idle", message: "" });
  const [isCostLoaded, setIsCostLoaded] = useState(false);
  const [intakeContext, setIntakeContext] = useState({ people: [], open_trip: null, suggested_start_km: null });
  const [quickIntakePerson, setQuickIntakePerson] = useState("");
  const [quickIntakeAction, setQuickIntakeAction] = useState("km");
  const [quickIntakeKmMode, setQuickIntakeKmMode] = useState("end");
  const [quickIntakeForm, setQuickIntakeForm] = useState({ start_km: "", end_km: "", liters: "", cost_chf: "", odometer_km: "" });
  const [quickIntakeStatus, setQuickIntakeStatus] = useState({ state: "idle", message: "" });

  const apiBaseUrl = useMemo(() => normalizeApiBaseUrl(apiUrl), []);
  const latestEndKm = useMemo(
    () => (trips.length === 0 ? null : Math.max(...trips.map((trip) => trip.end_km))),
    [trips],
  );

  const tableTrips = useMemo(
    () =>
      [...trips].sort((a, b) => {
        if (b.end_km === a.end_km) {
          return new Date(b.timestamp) - new Date(a.timestamp);
        }
        return b.end_km - a.end_km;
      }),
    [trips],
  );

  const tableRows = useMemo(() => {
    const ascending = [...trips].sort((a, b) => {
      if (a.start_km === b.start_km) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }
      return a.start_km - b.start_km;
    });

    const rows = [];
    ascending.forEach((trip, index) => {
      rows.push({ type: "trip", trip });
      const next = ascending[index + 1];
      if (next && next.start_km > trip.end_km) {
        rows.push({
          type: "gap",
          id: `${trip.id}-${next.id}`,
          start_km: trip.end_km,
          end_km: next.start_km,
        });
      }
    });

    return rows;
  }, [trips]);

  const sortedGasEntries = useMemo(
    () =>
      [...gasEntries].sort((a, b) => {
        const odometerComparison = b.odometer_km - a.odometer_km;
        if (odometerComparison !== 0) {
          return odometerComparison;
        }
        return new Date(b.timestamp) - new Date(a.timestamp);
      }),
    [gasEntries],
  );

  const conflictMap = useMemo(() => {
    const map = new Map();
    const ascendingTrips = [...trips].sort((a, b) => {
      if (a.start_km === b.start_km) {
        return a.end_km - b.end_km;
      }
      return a.start_km - b.start_km;
    });

    ascendingTrips.forEach((trip, index) => {
      const conflicts = [];
      if (trip.end_km <= trip.start_km) {
        conflicts.push("End must be above start.");
      }

      const previous = ascendingTrips[index - 1];
      if (previous) {
        if (trip.start_km > previous.end_km) {
          conflicts.push(`Gap: ${previous.end_km.toFixed(1)} → ${trip.start_km.toFixed(1)} km missing.`);
        } else if (trip.start_km < previous.end_km) {
          conflicts.push(`Overlap with previous range ending ${previous.end_km.toFixed(1)}.`);
        }
      }
      map.set(trip.id, conflicts);
    });

    return map;
  }, [trips]);

  const fuelEfficiencyIntervals = useMemo(() => {
    const orderedTrips = [...trips].sort((a, b) => {
      if (a.start_km !== b.start_km) {
        return a.start_km - b.start_km;
      }
      return new Date(a.timestamp) - new Date(b.timestamp);
    });

    const orderedFuelEntries = [...gasEntries].sort(compareByOdometerThenTime);

    const getDistanceBetweenOdometers = (startKm, endKm) => {
      if (!(Number.isFinite(startKm) && Number.isFinite(endKm)) || endKm <= startKm) {
        return 0;
      }

      return orderedTrips.reduce((sum, trip) => {
        const overlapStart = Math.max(startKm, trip.start_km);
        const overlapEnd = Math.min(endKm, trip.end_km);
        if (overlapEnd <= overlapStart) {
          return sum;
        }
        return sum + (overlapEnd - overlapStart);
      }, 0);
    };

    return orderedFuelEntries
      .map((entry, index) => {
        const previous = orderedFuelEntries[index - 1];
        if (!previous) {
          return null;
        }

        const intervalDistanceKm = getDistanceBetweenOdometers(previous.odometer_km, entry.odometer_km);
        if (!(intervalDistanceKm > 0 && entry.liters > 0)) {
          return null;
        }

        const kmPerLiter = intervalDistanceKm / entry.liters;
        const litersPer100Km = (entry.liters / intervalDistanceKm) * 100;
        const costPer100Km = (entry.cost_chf / intervalDistanceKm) * 100;

        return {
          id: entry.id,
          timestamp: entry.timestamp,
          user_name: entry.user_name,
          from_odometer_km: previous.odometer_km,
          to_odometer_km: entry.odometer_km,
          interval_distance_km: intervalDistanceKm,
          liters: entry.liters,
          cost_chf: entry.cost_chf,
          km_per_liter: kmPerLiter,
          liters_per_100km: litersPer100Km,
          cost_per_100km: costPer100Km,
        };
      })
      .filter(Boolean);
  }, [trips, gasEntries]);

  const insightSummaryCards = useMemo(() => {
    const latestInterval = fuelEfficiencyIntervals.at(-1) || null;
    const days30Ago = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const last30Intervals = fuelEfficiencyIntervals.filter((item) => new Date(item.timestamp).getTime() >= days30Ago);

    const avg = (items, key) => {
      if (items.length === 0) {
        return null;
      }
      return items.reduce((sum, item) => sum + item[key], 0) / items.length;
    };

    return [
      {
        label: "Latest efficiency",
        value: latestInterval ? `${latestInterval.km_per_liter.toFixed(2)} km/l` : "—",
        hint: latestInterval
          ? `${latestInterval.interval_distance_km.toFixed(1)} km interval`
          : "Need at least 2 fuel events",
      },
      {
        label: "30-day avg km/l",
        value: last30Intervals.length ? `${avg(last30Intervals, "km_per_liter")?.toFixed(2)} km/l` : "—",
        hint: `${last30Intervals.length} intervals included`,
      },
      {
        label: "30-day L/100km",
        value: last30Intervals.length ? `${avg(last30Intervals, "liters_per_100km")?.toFixed(2)}` : "—",
        hint: "Lower is better",
      },
      {
        label: "30-day CHF/100km",
        value: last30Intervals.length ? `CHF ${avg(last30Intervals, "cost_per_100km")?.toFixed(2)}` : "—",
        hint: "Fuel cost intensity",
      },
    ];
  }, [fuelEfficiencyIntervals]);

  const efficiencyTrend = useMemo(() => {
    const trendPoints = [...fuelEfficiencyIntervals]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map((item) => ({
        id: item.id,
        timestamp: item.timestamp,
        efficiency: item.km_per_liter,
      }));

    const svgWidth = 700;
    const svgHeight = 220;
    const padding = 24;
    return {
      points: trendPoints,
      linePath: buildEfficiencyLinePath(trendPoints, svgWidth, svgHeight, padding),
      width: svgWidth,
      height: svgHeight,
      padding,
    };
  }, [fuelEfficiencyIntervals]);

  const visibleBookingMonth = useMemo(() => toMonthStart(bookingMonth), [bookingMonth]);

  const bookingDateRange = useMemo(() => {
    const monthStart = visibleBookingMonth;
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    return {
      from: formatDateISO(monthStart),
      to: formatDateISO(monthEnd),
    };
  }, [visibleBookingMonth]);

  const bookingPreview = useMemo(
    () => calculateBookingPreview(bookingForm.start_date, bookingForm.end_date, bookingForm.day_km),
    [bookingForm.start_date, bookingForm.end_date, bookingForm.day_km],
  );

  const calendarCells = useMemo(() => {
    const start = visibleBookingMonth;
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    const calendarStart = addDays(monthStart, -monthStart.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(calendarStart, index);
      const iso = formatDateISO(date);

      const status = bookings.reduce(
        (selectedStatus, booking) => {
          if (!bookingOverlapsDay(booking, iso)) {
            return selectedStatus;
          }
          const resolvedStatus = booking.status === "open_override" ? "open" : booking.status;
          if (bookingStatusPriority[resolvedStatus] > bookingStatusPriority[selectedStatus]) {
            return resolvedStatus;
          }
          return selectedStatus;
        },
        "open",
      );

      return {
        iso,
        date,
        day: date.getDate(),
        isCurrentMonth: date.getMonth() === monthStart.getMonth(),
        status,
      };
    });
  }, [visibleBookingMonth, bookings]);

  const personHoursSummary = useMemo(() => {
    return workPeople.map((person) => {
      const trackedHours = workState.items.filter((item) => item.owner === person).reduce((sum, item) => sum + loggedHoursForItem(item), 0);
      const estimatedHours = workState.items
        .filter((item) => item.owner === person)
        .reduce((sum, item) => sum + estimateHoursForItem(item), 0);

      return { person, taskHours: trackedHours, todoEstimateHours: estimatedHours, varianceHours: trackedHours - estimatedHours };
    });
  }, [workState.items]);

  const aggregateWorkMetrics = useMemo(() => {
    const estimateHours = workState.items.reduce((sum, item) => sum + estimateHoursForItem(item), 0);
    const loggedHours = workState.items.reduce((sum, item) => sum + loggedHoursForItem(item), 0);
    return {
      estimateHours,
      loggedHours,
      varianceHours: loggedHours - estimateHours,
    };
  }, [workState.items]);

  const filteredWorkItems = useMemo(() => {
    const todayIso = formatDateISO(new Date());
    return workState.items.filter((item) => {
      if (workFilters.owner !== "all" && item.owner !== workFilters.owner) {
        return false;
      }
      if (workFilters.status !== "all" && migrateBoardStatus(item.status) !== workFilters.status) {
        return false;
      }
      if (workFilters.priority !== "all" && String(item.priority) !== workFilters.priority) {
        return false;
      }
      if (workFilters.due === "overdue" && !(item.due_date && item.due_date < todayIso)) {
        return false;
      }
      if (workFilters.due === "upcoming" && !(item.due_date && item.due_date >= todayIso)) {
        return false;
      }
      if (workFilters.due === "no_due" && item.due_date) {
        return false;
      }
      return true;
    });
  }, [workState.items, workFilters]);

  const rankedWorkItems = useMemo(
    () =>
      [...workState.items].sort((a, b) => {
        const rankComparison = (Number(a.rank) || 0) - (Number(b.rank) || 0);
        if (rankComparison !== 0) {
          return rankComparison;
        }
        return (a.title || "").localeCompare(b.title || "");
      }),
    [workState.items],
  );

  const rankedFilteredWorkItems = useMemo(
    () => rankedWorkItems.filter((item) => filteredWorkItems.some((filtered) => filtered.id === item.id)),
    [rankedWorkItems, filteredWorkItems],
  );

  const sortedCostEntries = useMemo(
    () =>
      [...(costState.entries || [])].sort((a, b) => {
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date);
        }
        return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
      }),
    [costState.entries],
  );

  const costYearOptions = useMemo(() => {
    const years = new Set();
    (costState.entries || []).forEach((entry) => {
      const year = String(entry?.date || "").slice(0, 4);
      if (/^\d{4}$/.test(year)) {
        years.add(year);
      }
    });
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [costState.entries]);

  const filteredCostEntries = useMemo(
    () =>
      sortedCostEntries.filter((entry) => {
        if (costFilters.type !== "all" && entry.type !== costFilters.type) {
          return false;
        }
        if (costFilters.category !== "all" && entry.category !== costFilters.category) {
          return false;
        }
        if (costFilters.year !== "all" && String(entry.date || "").slice(0, 4) !== costFilters.year) {
          return false;
        }
        if (costFilters.person !== "all") {
          if (entry.type === "transfer") {
            return entry.from_person === costFilters.person || entry.to_person === costFilters.person;
          }
          const participants = Array.isArray(entry.participants) ? entry.participants : [];
          return entry.paid_by === costFilters.person || participants.includes(costFilters.person);
        }
        return true;
      }),
    [sortedCostEntries, costFilters],
  );

  const categoryTotals = useMemo(() => {
    const totals = {};
    filteredCostEntries.forEach((entry) => {
      if (entry.type === "transfer") {
        return;
      }
      const category = entry.category || "general";
      totals[category] = (totals[category] || 0) + Number(entry.amount_chf || 0);
    });
    return Object.entries(totals)
      .sort(([, a], [, b]) => b - a)
      .map(([category, amount]) => ({ category, amount }));
  }, [filteredCostEntries]);

  const historicalYearTotals = useMemo(() => {
    const totals = {};
    (costState.entries || []).forEach((entry) => {
      if (!entry.historical_only) {
        return;
      }
      const year = String(entry.date || "").slice(0, 4) || "unknown";
      totals[year] = (totals[year] || 0) + Number(entry.amount_chf || 0);
    });
    return Object.entries(totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, amount]) => ({ year, amount }));
  }, [costState.entries]);

  const costSummary = useMemo(() => {
    const balances = Object.fromEntries(workPeople.map((person) => [person, 0]));
    let totalExpense = 0;
    let totalIncome = 0;
    let historicalCount = 0;
    let settlementCount = 0;

    (costState.entries || []).forEach((entry) => {
      if (entry.historical_only) {
        historicalCount += 1;
      }
      const amount = Number(entry.amount_chf || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return;
      }
      if (entry.type === "expense") {
        totalExpense += amount;
        const participants = Array.isArray(entry.participants) && entry.participants.length ? entry.participants : [entry.paid_by];
        const share = amount / participants.length;
        participants.forEach((participant) => {
          if (balances[participant] !== undefined) {
            balances[participant] -= share;
          }
        });
        if (balances[entry.paid_by] !== undefined) {
          balances[entry.paid_by] += amount;
        }
      } else if (entry.type === "income") {
        totalIncome += amount;
        const participants = Array.isArray(entry.participants) && entry.participants.length ? entry.participants : [entry.paid_by];
        const share = amount / participants.length;
        participants.forEach((participant) => {
          if (balances[participant] !== undefined) {
            balances[participant] += share;
          }
        });
        if (balances[entry.paid_by] !== undefined) {
          balances[entry.paid_by] -= amount;
        }
      } else if (entry.type === "transfer") {
        settlementCount += 1;
        if (balances[entry.from_person] !== undefined) {
          balances[entry.from_person] += amount;
        }
        if (balances[entry.to_person] !== undefined) {
          balances[entry.to_person] -= amount;
        }
      }
    });

    return {
      totalExpense,
      totalIncome,
      netProjectCost: totalExpense - totalIncome,
      historicalCount,
      settlementCount,
      balances,
    };
  }, [costState.entries]);

  const loadTrips = async () => {
    if (!apiBaseUrl) {
      setTableState({
        state: "error",
        message: "Missing VITE_API_URL configuration. Set it to your API Gateway URL and rebuild.",
      });
      return;
    }

    setTableState({ state: "loading", message: "Loading entries..." });

    try {
      const response = await fetch(`${apiBaseUrl}/trips`);
      const payload = await response.json();

      if (!response.ok) {
        setTableState({ state: "error", message: payload.error || "Could not load trip history." });
        return;
      }

      setTrips(Array.isArray(payload.items) ? payload.items : []);
      setTableState({ state: "success", message: "" });
    } catch (_error) {
      setTableState({ state: "error", message: "Network error while loading history." });
    }
  };

  const loadOpenTrip = async () => {
    if (!apiBaseUrl) {
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/trip/open`);
      const payload = await response.json();
      if (!response.ok) {
        return;
      }
      setOpenTrip(payload.item || null);
    } catch (_error) {
      setOpenTrip(null);
    }
  };

  const loadFuelEntries = async () => {
    if (!apiBaseUrl) {
      return;
    }
    try {
      setGasTableState({ state: "loading", message: "Loading fuel entries..." });
      const response = await fetch(`${apiBaseUrl}/fuel`);
      const payload = await response.json();
      if (!response.ok) {
        setGasTableState({ state: "error", message: payload.error || "Could not load fuel entries." });
        return;
      }
      setGasEntries(Array.isArray(payload.items) ? payload.items : []);
      setGasTableState({ state: "success", message: "" });
    } catch (_error) {
      setGasTableState({ state: "error", message: "Network error while loading fuel history." });
    }
  };

  const loadIntakeContext = async () => {
    if (!apiBaseUrl) {
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/intake/context`);
      const payload = await response.json();
      if (!response.ok) {
        return;
      }
      setIntakeContext({
        people: Array.isArray(payload.people) ? payload.people : [],
        open_trip: payload.open_trip || null,
        suggested_start_km: Number.isFinite(Number(payload.suggested_start_km)) ? Number(payload.suggested_start_km) : null,
      });
    } catch (_error) {
      // keep best-effort intake context silent
    }
  };

  const loadBookings = async (from, to) => {
    if (!apiBaseUrl) {
      setBookingTableState({
        state: "error",
        message: "Missing VITE_API_URL configuration. Set it to your API Gateway URL and rebuild.",
      });
      return;
    }

    setBookingTableState({ state: "loading", message: "Loading bookings..." });

    try {
      const query = new URLSearchParams({ from, to });
      const response = await fetch(`${apiBaseUrl}/bookings?${query.toString()}`);
      const payload = await response.json();

      if (!response.ok) {
        setBookingTableState({ state: "error", message: payload.error || "Could not load bookings." });
        return;
      }

      setBookings(Array.isArray(payload.items) ? payload.items : []);
      setBookingTableState({ state: "success", message: "" });
    } catch (_error) {
      setBookingTableState({ state: "error", message: "Network error while loading bookings." });
    }
  };

  useEffect(() => {
    loadTrips();
    loadOpenTrip();
    loadFuelEntries();
    loadIntakeContext();
  }, []);

  useEffect(() => {
    loadBookings(bookingDateRange.from, bookingDateRange.to);
  }, [bookingDateRange.from, bookingDateRange.to]);

  useEffect(() => {
    if (editId) {
      return;
    }
    if (openTrip) {
      setForm((prev) => ({
        ...prev,
        user_name: prev.user_name || openTrip.user_name || "",
        start_km: String(openTrip.start_km.toFixed(1)),
      }));
      return;
    }
    if (latestEndKm !== null) {
      setForm((prev) => ({ ...prev, start_km: prev.start_km || String(latestEndKm.toFixed(1)) }));
    }
  }, [latestEndKm, editId, openTrip]);

  useEffect(() => {
    const fromTrips = [...new Set(trips.map((trip) => trip.user_name).filter(Boolean))];
    if (fromTrips.length === 0) {
      return;
    }
    setProfiles((prev) => {
      const merged = [...new Set([...prev, ...fromTrips])].sort((a, b) => a.localeCompare(b));
      if (merged.length === prev.length) {
        return prev;
      }
      saveProfiles(merged);
      return merged;
    });
  }, [trips]);

  useEffect(() => {
    if (openTrip) {
      setQuickIntakeKmMode("end");
      setQuickIntakeForm((prev) => ({ ...prev, start_km: String(openTrip.start_km.toFixed(1)) }));
    } else if (latestEndKm !== null) {
      setQuickIntakeForm((prev) => ({ ...prev, start_km: prev.start_km || String(latestEndKm.toFixed(1)) }));
    }
  }, [openTrip, latestEndKm]);

  useEffect(() => {
    saveFuelEntries(gasEntries);
  }, [gasEntries]);

  useEffect(() => {
    saveWorkState(workState);
  }, [workState]);

  useEffect(() => {
    saveCostState(costState);
  }, [costState]);

  useEffect(() => {
    const loadWorkFromApi = async () => {
      if (!apiBaseUrl) {
        setIsWorkLoaded(true);
        return;
      }

      try {
        setWorkSyncStatus({ state: "loading", message: "Loading work workspace..." });
        const response = await fetch(`${apiBaseUrl}/work`);
        const payload = await response.json();
        if (!response.ok) {
          setWorkSyncStatus({ state: "error", message: payload.error || "Could not load work workspace." });
          setIsWorkLoaded(true);
          return;
        }
        const migrated = parseWorkStateFromPayload(payload);
        setWorkState(migrated);
        saveWorkState(migrated);
        setWorkSyncStatus({ state: "success", message: "Work workspace synced." });
      } catch (_error) {
        setWorkSyncStatus({ state: "error", message: "Network error while loading work workspace." });
      } finally {
        setIsWorkLoaded(true);
      }
    };

    loadWorkFromApi();
  }, [apiBaseUrl]);

  useEffect(() => {
    const persistWorkToApi = async () => {
      if (!apiBaseUrl || !isWorkLoaded) {
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}/work`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(workState),
        });
        const payload = await response.json();
        if (!response.ok) {
          setWorkSyncStatus({ state: "error", message: payload.error || "Could not save work workspace." });
          return;
        }
        setWorkSyncStatus({ state: "success", message: "Work workspace saved." });
      } catch (_error) {
        setWorkSyncStatus({ state: "error", message: "Network error while saving work workspace." });
      }
    };
    persistWorkToApi();
  }, [apiBaseUrl, isWorkLoaded, workState]);

  useEffect(() => {
    const loadCostsFromApi = async () => {
      if (!apiBaseUrl) {
        setIsCostLoaded(true);
        return;
      }

      try {
        setCostSyncStatus({ state: "loading", message: "Loading cost workspace..." });
        const response = await fetch(`${apiBaseUrl}/costs`);
        const payload = await response.json();
        if (!response.ok) {
          setCostSyncStatus({ state: "error", message: payload.error || "Could not load cost workspace." });
          setIsCostLoaded(true);
          return;
        }
        const nextState = {
          entries: Array.isArray(payload.entries)
            ? payload.entries.map((entry) => ({
                ...entry,
                category: entry?.category || inferCostCategory(entry?.description, entry?.type),
              }))
            : [],
        };
        setCostState(nextState);
        saveCostState(nextState);
        setCostSyncStatus({ state: "success", message: "Cost workspace synced." });
      } catch (_error) {
        setCostSyncStatus({ state: "error", message: "Network error while loading cost workspace." });
      } finally {
        setIsCostLoaded(true);
      }
    };

    loadCostsFromApi();
  }, [apiBaseUrl]);

  useEffect(() => {
    const persistCostToApi = async () => {
      if (!apiBaseUrl || !isCostLoaded) {
        return;
      }
      try {
        const response = await fetch(`${apiBaseUrl}/costs`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(costState),
        });
        const payload = await response.json();
        if (!response.ok) {
          setCostSyncStatus({ state: "error", message: payload.error || "Could not save cost workspace." });
          return;
        }
        setCostSyncStatus({ state: "success", message: "Cost workspace saved." });
      } catch (_error) {
        setCostSyncStatus({ state: "error", message: "Network error while saving cost workspace." });
      }
    };
    persistCostToApi();
  }, [apiBaseUrl, isCostLoaded, costState]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleGasChange = (event) => {
    const { name, value } = event.target;
    setGasForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleBookingChange = (event) => {
    const { name, value } = event.target;
    setBookingForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleWorkItemFormChange = (event) => {
    const { name, value } = event.target;
    setWorkItemForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleWorkFilterChange = (event) => {
    const { name, value } = event.target;
    setWorkFilters((prev) => ({ ...prev, [name]: value }));
  };

  const handleCostFormChange = (event) => {
    const { name, value, type, checked } = event.target;
    if (name === "historical_only") {
      setCostForm((prev) => ({ ...prev, historical_only: checked }));
      return;
    }
    if (name === "participants") {
      setCostForm((prev) => {
        const participants = new Set(prev.participants || []);
        if (checked) {
          participants.add(value);
        } else {
          participants.delete(value);
        }
        return { ...prev, participants: [...participants] };
      });
      return;
    }
    setCostForm((prev) => ({ ...prev, [name]: type === "number" ? value : value }));
  };

  const handleCostFilterChange = (event) => {
    const { name, value } = event.target;
    setCostFilters((prev) => ({ ...prev, [name]: value }));
  };

  const upsertProfile = (name) => {
    const normalized = name.trim();
    if (!normalized) {
      return;
    }
    setProfiles((prev) => {
      if (prev.includes(normalized)) {
        return prev;
      }
      const next = [...prev, normalized].sort((a, b) => a.localeCompare(b));
      saveProfiles(next);
      return next;
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ state: "loading", message: "Logging trip..." });

    try {
      if (!apiBaseUrl) {
        setStatus({
          state: "error",
          message: "Missing VITE_API_URL configuration. Set it to your API Gateway URL and rebuild.",
        });
        return;
      }

      const isEditing = Boolean(editId);
      const targetUrl = isEditing ? `${apiBaseUrl}/trip/${editId}` : `${apiBaseUrl}/trip`;

      const startKm = parseOptionalNumberInput(form.start_km);
      const endKm = parseOptionalNumberInput(form.end_km);
      const response = await fetch(targetUrl, {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_name: form.user_name.trim(),
          ...(startKm !== null ? { start_km: startKm } : {}),
          ...(endKm !== null ? { end_km: endKm } : {}),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setStatus({ state: "error", message: payload.error || "Something went wrong." });
        return;
      }

      upsertProfile(form.user_name);
      const isOpenTrip = payload.is_open || payload.event_type === "trip_manual_open";
      const message = isOpenTrip
        ? "Trip start saved. Add an end odometer later to close it."
        : `Saved. Distance: ${payload.delta_km.toFixed(1)} km · Cost: CHF ${payload.trip_cost_chf.toFixed(2)}`;
      setStatus({ state: "success", message });
      setEditId("");
      setForm((prev) => ({ ...initialForm, user_name: prev.user_name }));
      await loadTrips();
      await loadOpenTrip();
    } catch (_error) {
      setStatus({ state: "error", message: "Network error. Please try again." });
    }
  };

  const handleGasSubmit = async (event) => {
    event.preventDefault();
    const entry = {
      user_name: gasForm.user_name.trim(),
      liters: Number(gasForm.liters),
      cost_chf: Number(gasForm.cost_chf),
      odometer_km: Number(gasForm.odometer_km),
    };

    if (!entry.user_name || entry.liters <= 0 || entry.cost_chf <= 0 || entry.odometer_km < 0) {
      setGasStatus({ state: "error", message: "Enter valid name, liters, cost, and odometer values." });
      return;
    }
    if (!apiBaseUrl) {
      setGasStatus({ state: "error", message: "Missing API URL configuration." });
      return;
    }
    setGasStatus({ state: "loading", message: "Saving fuel entry..." });
    try {
      const response = await fetch(`${apiBaseUrl}/fuel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_name: entry.user_name,
          liters: entry.liters,
          fuel_cost_chf: entry.cost_chf,
          odometer_km: entry.odometer_km,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setGasStatus({ state: "error", message: payload.error || "Could not save fuel entry." });
        return;
      }
      upsertProfile(entry.user_name);
      setGasStatus({ state: "success", message: "Fuel entry added." });
      setGasForm((prev) => ({ ...initialGasForm, user_name: prev.user_name }));
      await loadFuelEntries();
      await loadIntakeContext();
    } catch (_error) {
      setGasStatus({ state: "error", message: "Network error while saving fuel entry." });
    }
  };

  const handleEdit = (trip) => {
    setActiveView("km");
    setEditId(trip.id);
    setForm({
      user_name: trip.user_name,
      start_km: String(trip.start_km.toFixed(1)),
      end_km: String(trip.end_km.toFixed(1)),
    });
    setStatus({ state: "idle", message: "" });
  };

  const handleCancelEdit = () => {
    setEditId("");
    setForm((prev) => ({ ...initialForm, user_name: prev.user_name }));
  };

  const handleDelete = async (trip) => {
    const shouldDelete = window.confirm(`Delete trip from ${trip.start_km.toFixed(1)} to ${trip.end_km.toFixed(1)} km?`);
    if (!shouldDelete) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/trip/${trip.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        setStatus({ state: "error", message: payload.error || "Could not delete this trip." });
        return;
      }
      if (editId === trip.id) {
        handleCancelEdit();
      }
      setStatus({ state: "success", message: "Trip deleted." });
      await loadTrips();
    } catch (_error) {
      setStatus({ state: "error", message: "Network error while deleting trip." });
    }
  };

  const handleDeleteGas = (_entryId) => {
    setGasStatus({ state: "error", message: "Fuel deletion is not available yet. Add a correction entry instead." });
  };

  const handleAddWorkItem = (event) => {
    event.preventDefault();
    if (!workItemForm.title.trim()) {
      return;
    }
    setWorkState((prev) => ({
      ...prev,
      items: [
        {
          id: crypto.randomUUID(),
          kind: "task",
          title: workItemForm.title.trim(),
          owner: workItemForm.owner,
          status: migrateBoardStatus(workItemForm.status),
          priority: workItemForm.priority || "P2",
          due_date: workItemForm.due_date || "",
          estimate_hours: Number(workItemForm.estimate_hours || 0),
          start_date: workItemForm.start_date || "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          rank: prev.items.length + 1,
          time_entries: [],
          subtasks: [],
        },
        ...prev.items,
      ],
    }));
    setWorkItemForm((prev) => ({ ...prev, title: "", estimate_hours: "", due_date: "", start_date: "" }));
  };

  const moveBoardTask = (taskId, direction) => {
    setWorkState((prev) => ({
      ...prev,
      items: prev.items.map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        const normalizedStatus = migrateBoardStatus(task.status);
        const index = boardColumns.indexOf(statusToBoardColumn[normalizedStatus] || "Backlog");
        const next = Math.min(boardColumns.length - 1, Math.max(0, index + direction));
        return { ...task, status: boardColumnToStatus[boardColumns[next]], updated_at: new Date().toISOString() };
      }),
    }));
  };

  const moveWorkItemRank = (itemId, direction) => {
    setWorkState((prev) => {
      const orderedItems = [...prev.items].sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0));
      const fromIndex = orderedItems.findIndex((item) => item.id === itemId);
      const toIndex = fromIndex + direction;
      if (fromIndex < 0 || toIndex < 0 || toIndex >= orderedItems.length) {
        return prev;
      }

      const [moved] = orderedItems.splice(fromIndex, 1);
      orderedItems.splice(toIndex, 0, moved);

      return {
        ...prev,
        items: orderedItems.map((item, index) => ({
          ...item,
          rank: index + 1,
          updated_at: item.id === moved.id ? new Date().toISOString() : item.updated_at,
        })),
      };
    });
  };

  const updateWorkItem = (itemId, updater) => {
    setWorkState((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        return {
          ...updater(item),
          updated_at: new Date().toISOString(),
        };
      }),
    }));
  };

  const handleWorkEstimateChange = (itemId, value) => {
    updateWorkItem(itemId, (item) => ({ ...item, estimate_hours: Math.max(0, Number(value || 0)) }));
  };

  const handleAddWorkSubtask = (event, itemId) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("subtask_title") || "").trim();
    const estimateHours = Math.max(0, Number(form.get("subtask_estimate_hours") || 0));
    if (!title) {
      return;
    }
    updateWorkItem(itemId, (item) => ({
      ...item,
      subtasks: [
        ...item.subtasks,
        { id: crypto.randomUUID(), title, status: "backlog", estimate_hours: estimateHours, time_entries: [] },
      ],
    }));
    event.currentTarget.reset();
  };

  const handleToggleSubtaskDone = (itemId, subtaskId) => {
    updateWorkItem(itemId, (item) => ({
      ...item,
      subtasks: item.subtasks.map((subtask) =>
        subtask.id === subtaskId ? { ...subtask, status: subtask.status === "done" ? "backlog" : "done" } : subtask,
      ),
    }));
  };

  const handleSubtaskEstimateChange = (itemId, subtaskId, value) => {
    updateWorkItem(itemId, (item) => ({
      ...item,
      subtasks: item.subtasks.map((subtask) =>
        subtask.id === subtaskId ? { ...subtask, estimate_hours: Math.max(0, Number(value || 0)) } : subtask,
      ),
    }));
  };

  const handleDeleteSubtask = (itemId, subtaskId) => {
    updateWorkItem(itemId, (item) => ({
      ...item,
      subtasks: item.subtasks.filter((subtask) => subtask.id !== subtaskId),
    }));
  };

  const handleAddWorkTimeEntry = (event, itemId, subtaskId = null) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const hours = Number(form.get("hours") || 0);
    if (!(Number.isFinite(hours) && hours > 0)) {
      return;
    }
    const entry = normalizeTimeEntry({
      date: String(form.get("date") || formatDateISO(new Date())),
      note: String(form.get("note") || "").trim(),
      hours,
    });

    updateWorkItem(itemId, (item) => {
      if (!subtaskId) {
        return { ...item, time_entries: [...item.time_entries, entry] };
      }
      return {
        ...item,
        subtasks: item.subtasks.map((subtask) =>
          subtask.id === subtaskId ? { ...subtask, time_entries: [...subtask.time_entries, entry] } : subtask,
        ),
      };
    });
    event.currentTarget.reset();
  };

  const handleDeleteWorkTimeEntry = (itemId, entryId, subtaskId = null) => {
    updateWorkItem(itemId, (item) => {
      if (!subtaskId) {
        return { ...item, time_entries: item.time_entries.filter((entry) => entry.id !== entryId) };
      }
      return {
        ...item,
        subtasks: item.subtasks.map((subtask) =>
          subtask.id === subtaskId
            ? { ...subtask, time_entries: subtask.time_entries.filter((entry) => entry.id !== entryId) }
            : subtask,
        ),
      };
    });
  };

  const handleBookingSubmit = async (event) => {
    event.preventDefault();
    setBookingStatus({ state: "loading", message: "Saving booking..." });

    try {
      if (!apiBaseUrl) {
        setBookingStatus({
          state: "error",
          message: "Missing VITE_API_URL configuration. Set it to your API Gateway URL and rebuild.",
        });
        return;
      }
      const response = await fetch(`${apiBaseUrl}/bookings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start_date: bookingForm.start_date,
          end_date: bookingForm.end_date,
          status: bookingForm.status,
          guest_name: bookingForm.guest_name.trim() || undefined,
          day_km: Number(bookingForm.day_km || 0),
          notes: bookingForm.notes.trim() || undefined,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setBookingStatus({ state: "error", message: payload.error || "Could not create booking." });
        return;
      }

      setBookingStatus({
        state: "success",
        message: `Saved ${payload.status} booking · ${payload.nights} nights · CHF ${payload.estimate_total.toFixed(2)}`,
      });
      setBookingForm((prev) => ({ ...initialBookingForm, guest_name: prev.guest_name }));
      await loadBookings(bookingDateRange.from, bookingDateRange.to);
    } catch (_error) {
      setBookingStatus({ state: "error", message: "Network error while saving booking." });
    }
  };

  const handleCostSubmit = (event) => {
    event.preventDefault();
    const amount = Number(costForm.amount_chf);
    if (!Number.isFinite(amount) || amount <= 0) {
      setCostSyncStatus({ state: "error", message: "Amount must be greater than 0." });
      return;
    }
    if (!costForm.description.trim()) {
      setCostSyncStatus({ state: "error", message: "Description is required." });
      return;
    }
    if (costForm.type !== "transfer" && (!Array.isArray(costForm.participants) || costForm.participants.length === 0)) {
      setCostSyncStatus({ state: "error", message: "Select at least one participant." });
      return;
    }

    const now = new Date().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      date: costForm.date,
      type: costForm.type,
      amount_chf: amount,
      description: costForm.description.trim(),
      category: costForm.category.trim() || inferCostCategory(costForm.description, costForm.type),
      paid_by: costForm.type === "transfer" ? "" : costForm.paid_by,
      participants: costForm.type === "transfer" ? [] : costForm.participants,
      from_person: costForm.type === "transfer" ? costForm.from_person : "",
      to_person: costForm.type === "transfer" ? costForm.to_person : "",
      historical_only: Boolean(costForm.historical_only),
      notes: costForm.notes.trim(),
      created_at: now,
      updated_at: now,
    };

    setCostState((prev) => ({ entries: [entry, ...(prev.entries || [])] }));
    setCostForm((prev) => ({
      ...initialCostForm,
      date: formatDateISO(new Date()),
      paid_by: prev.paid_by,
      participants: prev.participants,
    }));
    setCostSyncStatus({ state: "success", message: "Cost entry saved." });
  };

  const handleDeleteCostEntry = (id) => {
    setCostState((prev) => ({ entries: (prev.entries || []).filter((entry) => entry.id !== id) }));
  };

  const handleImportHistoricalDataset = () => {
    const raw = window.prompt("Paste lines as: description<TAB>amount (one per line).");
    if (!raw) {
      return;
    }
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const importedEntries = lines
      .map((line) => line.split("\t").map((part) => part.trim()))
      .filter((parts) => parts.length >= 2)
      .map((parts, index) => {
        const description = parts[0];
        const amount = Number(String(parts[1]).replace(/[^0-9.-]/g, ""));
        if (!description || !Number.isFinite(amount)) {
          return null;
        }
        const now = new Date().toISOString();
        return {
          id: crypto.randomUUID(),
          date: formatDateISO(new Date(Date.now() - index * 86400000)),
          type: amount < 0 ? "income" : "expense",
          amount_chf: Math.abs(amount),
          description,
          category: inferCostCategory(description, amount < 0 ? "income" : "expense"),
          paid_by: "Nic",
          participants: [...workPeople],
          from_person: "",
          to_person: "",
          historical_only: true,
          notes: "Imported from raw historical paste",
          created_at: now,
          updated_at: now,
        };
      })
      .filter(Boolean);

    if (importedEntries.length === 0) {
      setCostSyncStatus({ state: "error", message: "No valid lines found. Use: description<TAB>amount" });
      return;
    }

    setCostState((prev) => ({ entries: [...importedEntries, ...(prev.entries || [])] }));
    setCostSyncStatus({ state: "success", message: `Imported ${importedEntries.length} historical entries with categories.` });
  };

  const submitQuickIntake = async (event) => {
    event.preventDefault();
    const normalizedPerson = quickIntakePerson.trim();
    if (!normalizedPerson) {
      setQuickIntakeStatus({ state: "error", message: "Please choose or enter a person first." });
      return;
    }
    if (!apiBaseUrl) {
      setQuickIntakeStatus({ state: "error", message: "Missing API URL configuration." });
      return;
    }

    if (quickIntakeAction === "gas") {
      const liters = Number(quickIntakeForm.liters);
      const cost = Number(quickIntakeForm.cost_chf);
      const odometer = Number(quickIntakeForm.odometer_km);
      if (!(liters > 0 && cost > 0 && odometer >= 0)) {
        setQuickIntakeStatus({ state: "error", message: "For gas, enter liters, total cost, and odometer." });
        return;
      }
      setQuickIntakeStatus({ state: "loading", message: "Saving gas entry..." });
      try {
        const response = await fetch(`${apiBaseUrl}/fuel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_name: normalizedPerson,
            liters,
            fuel_cost_chf: cost,
            odometer_km: odometer,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setQuickIntakeStatus({ state: "error", message: payload.error || "Could not save gas entry." });
          return;
        }
      } catch (_error) {
        setQuickIntakeStatus({ state: "error", message: "Network error while saving gas entry." });
        return;
      }
      upsertProfile(normalizedPerson);
      setQuickIntakeStatus({ state: "success", message: "Saved gas entry. Opening main page..." });
      await loadFuelEntries();
      await loadIntakeContext();
      setTimeout(() => setShowQuickIntake(false), 400);
      return;
    }

    const startKm = parseOptionalNumberInput(quickIntakeForm.start_km);
    const endKm = parseOptionalNumberInput(quickIntakeForm.end_km);
    const hasOpenTrip = Boolean(openTrip);
    if (quickIntakeKmMode === "start" && startKm === null) {
      setQuickIntakeStatus({ state: "error", message: "Enter a start odometer to log trip start." });
      return;
    }
    if (quickIntakeKmMode === "end" && endKm === null) {
      setQuickIntakeStatus({ state: "error", message: "Enter an end odometer to close trip." });
      return;
    }
    if (!hasOpenTrip && quickIntakeKmMode === "end" && startKm === null) {
      setQuickIntakeStatus({
        state: "error",
        message: "No open trip found. Enter start + end or switch to start-only mode.",
      });
      return;
    }

    setQuickIntakeStatus({ state: "loading", message: "Saving KM entry..." });
    try {
      const response = await fetch(`${apiBaseUrl}/trip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_name: normalizedPerson,
          ...(quickIntakeKmMode === "start" ? { start_km: startKm } : {}),
          ...(quickIntakeKmMode === "end" ? { end_km: endKm } : {}),
          ...(quickIntakeKmMode === "both" ? { start_km: startKm, end_km: endKm } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setQuickIntakeStatus({ state: "error", message: payload.error || "Could not save KM entry." });
        return;
      }
      upsertProfile(normalizedPerson);
      setQuickIntakeStatus({
        state: "success",
        message: payload.is_open ? "Trip start saved. Opening main page..." : "Trip saved. Opening main page...",
      });
      await loadTrips();
      await loadOpenTrip();
      await loadIntakeContext();
      setTimeout(() => setShowQuickIntake(false), 400);
    } catch (_error) {
      setQuickIntakeStatus({ state: "error", message: "Network error while saving KM entry." });
    }
  };

  return (
    <div className="page">
      {showQuickIntake && (
        <section className="quick-intake-shell">
          <div className="quick-intake-card">
            <button type="button" className="quick-intake-close" onClick={() => setShowQuickIntake(false)} aria-label="Close quick intake">
              ×
            </button>
            <p className="quick-intake-hint">Click × to go to the main page.</p>
            <h2>Quick trip / gas entry</h2>
            <p className="subtitle">For phones and computers: simple steps, big buttons, clear errors.</p>
            <form className="form" onSubmit={submitQuickIntake}>
              <label className="field">
                <span>Step 1: Person</span>
                <input
                  type="text"
                  list="quick-intake-people"
                  value={quickIntakePerson}
                  onChange={(event) => setQuickIntakePerson(event.target.value)}
                  placeholder="Pick existing or type new name"
                  required
                />
                <datalist id="quick-intake-people">
                  {[...new Set([...profiles, ...(intakeContext.people || []).map((person) => person.name)])].map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>

              <label className="field">
                <span>Step 2: What do you want to log?</span>
                <select
                  value={quickIntakeAction}
                  onChange={(event) => {
                    setQuickIntakeAction(event.target.value);
                  }}
                >
                  <option value="km">KM trip</option>
                  <option value="gas">Gas fill</option>
                </select>
              </label>

              {quickIntakeAction === "km" ? (
                <>
                  <label className="field">
                    <span>Step 3: KM mode</span>
                    <select value={quickIntakeKmMode} onChange={(event) => setQuickIntakeKmMode(event.target.value)}>
                      <option value="end">Close trip (end KM)</option>
                      <option value="start">Start trip only</option>
                      <option value="both">Start + end together</option>
                    </select>
                  </label>
                  {(quickIntakeKmMode === "start" || quickIntakeKmMode === "both") && (
                    <label className="field">
                      <span>Start KM</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.1"
                        value={quickIntakeForm.start_km}
                        onChange={(event) => setQuickIntakeForm((prev) => ({ ...prev, start_km: event.target.value }))}
                        placeholder={
                          intakeContext?.open_trip?.start_km
                            ? `Open trip start: ${Number(intakeContext.open_trip.start_km).toFixed(1)}`
                            : intakeContext?.suggested_start_km !== null
                              ? `Suggested: ${Number(intakeContext.suggested_start_km).toFixed(1)}`
                              : "Enter start KM"
                        }
                      />
                    </label>
                  )}
                  {(quickIntakeKmMode === "end" || quickIntakeKmMode === "both") && (
                    <label className="field">
                      <span>End KM</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.1"
                        value={quickIntakeForm.end_km}
                        onChange={(event) => setQuickIntakeForm((prev) => ({ ...prev, end_km: event.target.value }))}
                        placeholder="Enter end KM"
                      />
                    </label>
                  )}
                  {openTrip && <p className="subtitle">Open trip detected from {openTrip.start_km.toFixed(1)} km. End KM is suggested first.</p>}
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Liters</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={quickIntakeForm.liters}
                      onChange={(event) => setQuickIntakeForm((prev) => ({ ...prev, liters: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Total cost (CHF)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={quickIntakeForm.cost_chf}
                      onChange={(event) => setQuickIntakeForm((prev) => ({ ...prev, cost_chf: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Odometer KM</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={quickIntakeForm.odometer_km}
                      onChange={(event) => setQuickIntakeForm((prev) => ({ ...prev, odometer_km: event.target.value }))}
                      required
                    />
                  </label>
                </>
              )}

              <div className="form-actions">
                <button type="submit" className="submit">
                  Save & open main page
                </button>
              </div>
            </form>
            {quickIntakeStatus.state !== "idle" && <div className={`status ${quickIntakeStatus.state}`}>{quickIntakeStatus.message}</div>}
          </div>
        </section>
      )}
      <main className="layout layout-stack">
        <section className="card view-switcher-card">
          <p className="eyebrow">Views</p>
          <div className="view-switcher" role="tablist" aria-label="Ledger views">
            {[
              { id: "km", label: "KM" },
              { id: "gas", label: "Gas" },
              { id: "booking", label: "Booking" },
              { id: "costs", label: "Costs" },
              { id: "historical", label: "Historical" },
              { id: "work", label: "Work" },
              { id: "insights", label: "Insights" },
              { id: "accounting", label: "Accounting" },
            ].map((view) => (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={activeView === view.id}
                className={`segment-btn ${activeView === view.id ? "active" : ""}`}
                onClick={() => setActiveView(view.id)}
              >
                {view.label}
              </button>
            ))}
          </div>
        </section>

        {activeView === "km" && (
          <div className="panel-grid">
            <section className="card">
              <header>
                <p className="eyebrow">Van usage</p>
                <h1>Log Trip</h1>
                <p className="subtitle">Simple logging keeps the habit strong. No photos, no logins, just trust.</p>
              </header>

              <form className="form" onSubmit={handleSubmit}>
                <label className="field">
                  <span>User name</span>
                  <input
                    type="text"
                    name="user_name"
                    list="saved-profiles"
                    placeholder="e.g. Alex"
                    value={form.user_name}
                    onChange={handleChange}
                    required
                  />
                  <datalist id="saved-profiles">
                    {profiles.map((profile) => (
                      <option key={profile} value={profile} />
                    ))}
                  </datalist>
                </label>

                <label className="field">
                  <span>Start odometer (km)</span>
                  <input
                    type="number"
                    name="start_km"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    placeholder="12345"
                    value={form.start_km}
                    onChange={handleChange}
                  />
                </label>

                <label className="field">
                  <span>End odometer (km)</span>
                  <input
                    type="number"
                    name="end_km"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    placeholder="12399"
                    value={form.end_km}
                    onChange={handleChange}
                  />
                </label>

                <div className="form-actions">
                  <button className="submit" type="submit" disabled={status.state === "loading"}>
                    {status.state === "loading" ? "Saving..." : editId ? "Update entry" : "Submit"}
                  </button>
                  {editId && (
                    <button className="cancel" type="button" onClick={handleCancelEdit}>
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>

              {status.state !== "idle" && <div className={`status ${status.state}`}>{status.message}</div>}

              <footer className="footer">
                <p>
                  Future additions like OCR or fuel costs will attach as new ledger events, keeping history intact.
                </p>
              </footer>
            </section>

            <section className="card table-card">
              <header>
                <p className="eyebrow">Ledger</p>
                <h2>Trip history</h2>
              </header>

              {tableState.state === "error" ? (
                <div className="status error">{tableState.message}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time (UTC)</th>
                        <th>User</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Δ km</th>
                        <th>CHF</th>
                        <th>Conflicts</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.length === 0 ? (
                        <tr>
                          <td colSpan="8" className="empty-cell">
                            {tableState.state === "loading" ? "Loading..." : "No entries yet."}
                          </td>
                        </tr>
                      ) : (
                        tableRows.map((row) =>
                          row.type === "gap" ? (
                            <tr key={row.id}>
                              <td colSpan="8">
                                <strong>Fill usage history gap:</strong> {row.start_km.toFixed(1)} → {row.end_km.toFixed(1)} km
                              </td>
                            </tr>
                          ) : (
                            <tr key={row.trip.id}>
                              <td>{new Date(row.trip.timestamp).toLocaleString()}</td>
                              <td>{row.trip.user_name}</td>
                              <td>{row.trip.start_km.toFixed(1)}</td>
                              <td>{row.trip.end_km.toFixed(1)}</td>
                              <td>{row.trip.delta_km.toFixed(1)}</td>
                              <td>{row.trip.trip_cost_chf.toFixed(2)}</td>
                              <td>
                                {conflictMap.get(row.trip.id)?.length ? (
                                  <ul className="conflict-list">
                                    {conflictMap.get(row.trip.id).map((conflict) => (
                                      <li key={conflict}>{conflict}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="conflict-ok">OK</span>
                                )}
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button type="button" className="table-btn" onClick={() => handleEdit(row.trip)}>
                                    Edit
                                  </button>
                                  <button type="button" className="table-btn danger" onClick={() => handleDelete(row.trip)}>
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ),
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {activeView === "gas" && (
          <div className="panel-grid">
            <section className="card">
              <header>
                <p className="eyebrow">Fuel ledger</p>
                <h1>Log Gas Fill</h1>
                <p className="subtitle">Track liters, spend, and odometer to feed efficiency insights.</p>
              </header>
              <form className="form" onSubmit={handleGasSubmit}>
                <label className="field">
                  <span>User name</span>
                  <input
                    type="text"
                    name="user_name"
                    list="saved-profiles"
                    placeholder="e.g. Alex"
                    value={gasForm.user_name}
                    onChange={handleGasChange}
                    required
                  />
                </label>
                <label className="field">
                  <span>Liters</span>
                  <input
                    type="number"
                    name="liters"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="40.00"
                    value={gasForm.liters}
                    onChange={handleGasChange}
                    required
                  />
                </label>
                <label className="field">
                  <span>Total cost (CHF)</span>
                  <input
                    type="number"
                    name="cost_chf"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="80.00"
                    value={gasForm.cost_chf}
                    onChange={handleGasChange}
                    required
                  />
                </label>
                <label className="field">
                  <span>Odometer (km)</span>
                  <input
                    type="number"
                    name="odometer_km"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    placeholder="12450.0"
                    value={gasForm.odometer_km}
                    onChange={handleGasChange}
                    required
                  />
                </label>

                <div className="form-actions">
                  <button className="submit" type="submit">
                    Save gas entry
                  </button>
                </div>
              </form>
              {gasStatus.state !== "idle" && <div className={`status ${gasStatus.state}`}>{gasStatus.message}</div>}
            </section>

            <section className="card table-card">
              <header>
                <p className="eyebrow">Fuel table</p>
                <h2>Gas history</h2>
              </header>

              {gasTableState.state === "error" ? (
                <div className="status error">{gasTableState.message}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time (UTC)</th>
                        <th>User</th>
                        <th>Liters</th>
                        <th>CHF</th>
                        <th>Odometer</th>
                        <th>CHF/L</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGasEntries.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="empty-cell">
                            {gasTableState.state === "loading" ? "Loading..." : "No fuel entries yet."}
                          </td>
                        </tr>
                      ) : (
                        sortedGasEntries.map((entry) => (
                          <tr key={entry.id}>
                            <td>{new Date(entry.timestamp).toLocaleString()}</td>
                            <td>{entry.user_name}</td>
                            <td>{entry.liters.toFixed(2)}</td>
                            <td>{entry.cost_chf.toFixed(2)}</td>
                            <td>{entry.odometer_km.toFixed(1)}</td>
                            <td>{(entry.cost_chf / entry.liters).toFixed(2)}</td>
                            <td>
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="table-btn danger"
                                  onClick={() => handleDeleteGas(entry.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {activeView === "booking" && (
          <div className="panel-grid">
            <section className="card">
              <header>
                <p className="eyebrow">Calendar booking</p>
                <h1>Create booking</h1>
                <p className="subtitle">100/night + 100 cleaning + 0.50/km for daytime use.</p>
              </header>

              <form className="form" onSubmit={handleBookingSubmit}>
                <label className="field">
                  <span>Check-in date</span>
                  <input
                    type="date"
                    name="start_date"
                    value={bookingForm.start_date}
                    onChange={handleBookingChange}
                    required
                  />
                </label>
                <label className="field">
                  <span>Check-out date</span>
                  <input type="date" name="end_date" value={bookingForm.end_date} onChange={handleBookingChange} required />
                </label>
                <label className="field">
                  <span>Status</span>
                  <select name="status" value={bookingForm.status} onChange={handleBookingChange}>
                    <option value="booked">Booked</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </label>
                <label className="field">
                  <span>Guest name</span>
                  <input
                    type="text"
                    name="guest_name"
                    value={bookingForm.guest_name}
                    onChange={handleBookingChange}
                    placeholder="Optional"
                  />
                </label>
                <label className="field">
                  <span>Daytime kilometers</span>
                  <input
                    type="number"
                    name="day_km"
                    value={bookingForm.day_km}
                    onChange={handleBookingChange}
                    min="0"
                    step="0.1"
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <input type="text" name="notes" value={bookingForm.notes} onChange={handleBookingChange} placeholder="Optional" />
                </label>
                <article className="summary-card">
                  <p className="summary-label">Live estimate</p>
                  <p className="summary-value">CHF {bookingPreview.total.toFixed(2)}</p>
                  <p className="summary-hint">{bookingPreview.nights} nights + CHF 100 cleaning + km fee</p>
                </article>
                <div className="form-actions">
                  <button className="submit" type="submit" disabled={bookingStatus.state === "loading"}>
                    {bookingStatus.state === "loading" ? "Saving..." : "Create booking"}
                  </button>
                </div>
              </form>
              {bookingStatus.state !== "idle" && <div className={`status ${bookingStatus.state}`}>{bookingStatus.message}</div>}
            </section>

            <section className="card table-card">
              <header className="calendar-header">
                <div>
                  <p className="eyebrow">Availability</p>
                  <h2>{monthLabel(visibleBookingMonth)}</h2>
                </div>
                <div className="calendar-nav">
                  <button type="button" className="table-btn" onClick={() => setBookingMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
                    Prev
                  </button>
                  <button type="button" className="table-btn" onClick={() => setBookingMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
                    Next
                  </button>
                </div>
              </header>

              <div className="booking-legend">
                <span className="legend-pill open">Open</span>
                <span className="legend-pill booked">Booked</span>
                <span className="legend-pill blocked">Blocked</span>
              </div>

              {bookingTableState.state === "error" ? (
                <div className="status error">{bookingTableState.message}</div>
              ) : (
                <div className="calendar-grid" role="grid" aria-label="Booking calendar">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
                    <div key={weekday} className="weekday-cell">
                      {weekday}
                    </div>
                  ))}
                  {calendarCells.map((cell) => (
                    <div
                      key={cell.iso}
                      className={`day-cell ${cell.status} ${cell.isCurrentMonth ? "" : "outside"}`.trim()}
                      role="gridcell"
                      aria-label={`${cell.iso}: ${cell.status}`}
                    >
                      <span>{cell.day}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Start</th>
                      <th>End</th>
                      <th>Status</th>
                      <th>Guest</th>
                      <th>Nights</th>
                      <th>Estimate CHF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="empty-cell">
                          {bookingTableState.state === "loading" ? "Loading..." : "No bookings in this month."}
                        </td>
                      </tr>
                    ) : (
                      bookings.map((booking) => (
                        <tr key={booking.id}>
                          <td>{booking.start_date}</td>
                          <td>{booking.end_date}</td>
                          <td>{booking.status}</td>
                          <td>{booking.guest_name || "—"}</td>
                          <td>{booking.nights}</td>
                          <td>{booking.estimate_total.toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeView === "costs" && (
          <div className="panel-grid">
            <section className="card">
              <header>
                <p className="eyebrow">Shared finance</p>
                <h1>Costs & income ledger</h1>
                <p className="subtitle">Track expenses, income, and settlements with shared participants.</p>
              </header>

              <form className="form" onSubmit={handleCostSubmit}>
                <label className="field">
                  <span>Date</span>
                  <input type="date" name="date" value={costForm.date} onChange={handleCostFormChange} required />
                </label>
                <label className="field">
                  <span>Type</span>
                  <select name="type" value={costForm.type} onChange={handleCostFormChange}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Settlement transfer</option>
                  </select>
                </label>
                <label className="field">
                  <span>Amount (CHF)</span>
                  <input
                    type="number"
                    name="amount_chf"
                    min="0.01"
                    step="0.01"
                    value={costForm.amount_chf}
                    onChange={handleCostFormChange}
                    required
                  />
                </label>
                <label className="field">
                  <span>Description</span>
                  <input name="description" value={costForm.description} onChange={handleCostFormChange} required />
                </label>
                <label className="field">
                  <span>Category</span>
                  <select name="category" value={costForm.category} onChange={handleCostFormChange}>
                    {costCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                {costForm.type === "transfer" ? (
                  <div className="inline-grid">
                    <label className="field">
                      <span>From</span>
                      <select name="from_person" value={costForm.from_person} onChange={handleCostFormChange}>
                        {workPeople.map((person) => (
                          <option key={person} value={person}>
                            {person}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>To</span>
                      <select name="to_person" value={costForm.to_person} onChange={handleCostFormChange}>
                        {workPeople.map((person) => (
                          <option key={person} value={person}>
                            {person}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <>
                    <label className="field">
                      <span>Paid by</span>
                      <select name="paid_by" value={costForm.paid_by} onChange={handleCostFormChange}>
                        {workPeople.map((person) => (
                          <option key={person} value={person}>
                            {person}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="field">
                      <span>Participants</span>
                      <div className="filter-row">
                        {workPeople.map((person) => (
                          <label key={person} className="checkline">
                            <input
                              type="checkbox"
                              name="participants"
                              value={person}
                              checked={(costForm.participants || []).includes(person)}
                              onChange={handleCostFormChange}
                            />
                            <span>{person}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                )}
                <label className="field">
                  <span>Notes</span>
                  <input name="notes" value={costForm.notes} onChange={handleCostFormChange} placeholder="Optional" />
                </label>
                <label className="checkline">
                  <input
                    type="checkbox"
                    name="historical_only"
                    checked={Boolean(costForm.historical_only)}
                    onChange={handleCostFormChange}
                  />
                  <span>Historical reference only (exclude from settlement decisions for now)</span>
                </label>
                <div className="form-actions">
                  <button className="submit" type="submit">
                    Add cost entry
                  </button>
                  <button className="cancel" type="button" onClick={handleImportHistoricalDataset}>
                    Import raw lines
                  </button>
                </div>
              </form>
              {costSyncStatus.state !== "idle" && <div className={`status ${costSyncStatus.state}`}>{costSyncStatus.message}</div>}
            </section>

            <section className="card table-card">
              <header>
                <p className="eyebrow">Summary</p>
                <h2>Net position</h2>
              </header>
              <div className="summary-grid compact-summary-grid">
                <article className="summary-card compact-summary-card">
                  <p className="summary-label">Expenses</p>
                  <p className="summary-value">CHF {costSummary.totalExpense.toFixed(2)}</p>
                </article>
                <article className="summary-card compact-summary-card">
                  <p className="summary-label">Income</p>
                  <p className="summary-value">CHF {costSummary.totalIncome.toFixed(2)}</p>
                </article>
                <article className="summary-card compact-summary-card">
                  <p className="summary-label">Net project cost</p>
                  <p className="summary-value">CHF {costSummary.netProjectCost.toFixed(2)}</p>
                  <p className="summary-hint">{costSummary.historicalCount} historical-only entries flagged</p>
                </article>
              </div>
              <div className="inline-grid two-col">
                <label className="field">
                  <span>Filter year</span>
                  <select name="year" value={costFilters.year} onChange={handleCostFilterChange}>
                    <option value="all">All years</option>
                    {costYearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Filter category</span>
                  <select name="category" value={costFilters.category} onChange={handleCostFilterChange}>
                    <option value="all">All categories</option>
                    {costCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Filter person</span>
                  <select name="person" value={costFilters.person} onChange={handleCostFilterChange}>
                    <option value="all">All people</option>
                    {workPeople.map((person) => (
                      <option key={person} value={person}>
                        {person}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Filter type</span>
                  <select name="type" value={costFilters.type} onChange={handleCostFilterChange}>
                    <option value="all">All types</option>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </label>
              </div>
              <div className="chart-list">
                {categoryTotals.length === 0 ? (
                  <p className="subtitle">No category totals for the selected filters.</p>
                ) : (
                  categoryTotals.slice(0, 8).map((item) => {
                    const maxValue = Math.max(...categoryTotals.map((row) => row.amount), 1);
                    return (
                      <div key={item.category} className="chart-row">
                        <span className="chart-month">{categoryLabelMap[item.category] || item.category}</span>
                        <div className="chart-track">
                          <div className="chart-bar" style={{ width: `${(item.amount / maxValue) * 100}%` }} />
                        </div>
                        <span className="chart-value">CHF {item.amount.toFixed(2)}</span>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Balance (CHF)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workPeople.map((person) => (
                      <tr key={person}>
                        <td>{person}</td>
                        <td>{costSummary.balances[person].toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Amount</th>
                      <th>Details</th>
                      <th>Flags</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCostEntries.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="empty-cell">
                          No cost entries yet.
                        </td>
                      </tr>
                    ) : (
                      filteredCostEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.date}</td>
                          <td>{entry.type}</td>
                          <td>{entry.description}</td>
                          <td>{categoryLabelMap[entry.category] || entry.category}</td>
                          <td>{Number(entry.amount_chf).toFixed(2)}</td>
                          <td>
                            {entry.type === "transfer"
                              ? `${entry.from_person} → ${entry.to_person}`
                              : `${entry.paid_by} · ${(entry.participants || []).join(", ")}`}
                          </td>
                          <td>{entry.historical_only ? "Historical" : "Live"}</td>
                          <td>
                            <button type="button" className="table-btn danger" onClick={() => handleDeleteCostEntry(entry.id)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeView === "historical" && (
          <div className="panel-grid">
            <section className="card">
              <header>
                <p className="eyebrow">History</p>
                <h1>Historical costs</h1>
                <p className="subtitle">Simple yearly totals and category distribution from imported historical rows.</p>
              </header>
              <div className="summary-grid compact-summary-grid">
                <article className="summary-card compact-summary-card">
                  <p className="summary-label">Historical entries</p>
                  <p className="summary-value">{costSummary.historicalCount}</p>
                </article>
                <article className="summary-card compact-summary-card">
                  <p className="summary-label">Historical total</p>
                  <p className="summary-value">
                    CHF {historicalYearTotals.reduce((sum, item) => sum + item.amount, 0).toFixed(2)}
                  </p>
                </article>
              </div>
              <div className="chart-list">
                {historicalYearTotals.length === 0 ? (
                  <p className="subtitle">No historical rows yet. Use “Import raw lines” in the Costs view.</p>
                ) : (
                  historicalYearTotals.map((item) => {
                    const maxValue = Math.max(...historicalYearTotals.map((row) => row.amount), 1);
                    return (
                      <div key={item.year} className="chart-row">
                        <span className="chart-month">{item.year}</span>
                        <div className="chart-track">
                          <div className="chart-bar" style={{ width: `${(item.amount / maxValue) * 100}%` }} />
                        </div>
                        <span className="chart-value">CHF {item.amount.toFixed(2)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}

        {activeView === "work" && (
          <div className="panel-grid">
            <section className="card">
              <header>
                <p className="eyebrow">Work workspace</p>
                <h1>Work items table</h1>
                <p className="subtitle">Single source of truth for planning and Kanban.</p>
              </header>
              {workSyncStatus.state !== "idle" && <div className={`status ${workSyncStatus.state}`}>{workSyncStatus.message}</div>}
              <form className="form" onSubmit={handleAddWorkItem}>
                <div className="inline-grid four-col">
                  <input name="title" value={workItemForm.title} onChange={handleWorkItemFormChange} placeholder="Work item title" required />
                  <select name="owner" value={workItemForm.owner} onChange={handleWorkItemFormChange}>
                    {workPeople.map((person) => (
                      <option key={person} value={person}>
                        {person}
                      </option>
                    ))}
                  </select>
                  <select name="priority" value={workItemForm.priority} onChange={handleWorkItemFormChange}>
                    <option value="P0">P0</option>
                    <option value="P1">P1</option>
                    <option value="P2">P2</option>
                    <option value="P3">P3</option>
                  </select>
                  <select name="status" value={workItemForm.status} onChange={handleWorkItemFormChange}>
                    <option value="backlog">Backlog</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
                <div className="inline-grid three-col">
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    name="estimate_hours"
                    value={workItemForm.estimate_hours}
                    onChange={handleWorkItemFormChange}
                    placeholder="Estimate hours"
                  />
                  <input type="date" name="start_date" value={workItemForm.start_date} onChange={handleWorkItemFormChange} />
                  <input type="date" name="due_date" value={workItemForm.due_date} onChange={handleWorkItemFormChange} />
                </div>
                <button className="submit" type="submit">
                  Add work item
                </button>
              </form>
              <header>
                <p className="eyebrow">Filter</p>
              </header>
              <div className="inline-grid four-col">
                <select name="owner" value={workFilters.owner} onChange={handleWorkFilterChange}>
                  <option value="all">All owners</option>
                  {workPeople.map((person) => (
                    <option key={person} value={person}>
                      {person}
                    </option>
                  ))}
                </select>
                <select name="status" value={workFilters.status} onChange={handleWorkFilterChange}>
                  <option value="all">All statuses</option>
                  <option value="backlog">Backlog</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
                <select name="priority" value={workFilters.priority} onChange={handleWorkFilterChange}>
                  <option value="all">All priorities</option>
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
                <select name="due" value={workFilters.due} onChange={handleWorkFilterChange}>
                  <option value="all">All due dates</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="overdue">Overdue</option>
                  <option value="no_due">No due date</option>
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Order</th>
                      <th>Priority</th>
                      <th>Title</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Estimate</th>
                      <th>Logged</th>
                      <th>Variance</th>
                      <th>Due date</th>
                      <th>Updated at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedFilteredWorkItems.length === 0 ? (
                      <tr>
                        <td colSpan="11" className="empty-cell">
                          No matching work items.
                        </td>
                      </tr>
                    ) : (
                      rankedFilteredWorkItems.map((item, index) => (
                        <Fragment key={item.id}>
                          <tr>
                            <td>{item.rank || index + 1}</td>
                            <td>
                              <div className="row-actions">
                                <button className="table-btn" type="button" onClick={() => moveWorkItemRank(item.id, -1)} disabled={index === 0}>
                                  ↑
                                </button>
                                <button
                                  className="table-btn"
                                  type="button"
                                  onClick={() => moveWorkItemRank(item.id, 1)}
                                  disabled={index === rankedFilteredWorkItems.length - 1}
                                >
                                  ↓
                                </button>
                              </div>
                            </td>
                            <td>{item.priority || "P2"}</td>
                            <td>{item.title}</td>
                            <td>{item.owner}</td>
                            <td>{(statusToBoardColumn[migrateBoardStatus(item.status)] || "Backlog").replace("_", " ")}</td>
                            <td>{estimateHoursForItem(item).toFixed(2)}h</td>
                            <td>{loggedHoursForItem(item).toFixed(2)}h</td>
                            <td>{varianceHoursForItem(item).toFixed(2)}h</td>
                            <td>{item.due_date || "—"}</td>
                            <td>{item.updated_at ? new Date(item.updated_at).toLocaleString() : "—"}</td>
                          </tr>
                          <tr>
                            <td colSpan="11">
                              <details className="work-item">
                                <summary>
                                  Details · estimate, checklist, and time log <span className="muted">({item.title})</span>
                                </summary>
                                <div className="details-content">
                                  <div className="inline-grid details-three-col">
                                    <label className="field compact-form">
                                      <span>Item estimate (hours)</span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.25"
                                        value={item.estimate_hours}
                                        onChange={(event) => handleWorkEstimateChange(item.id, event.target.value)}
                                      />
                                    </label>
                                    <div className="summary-card">
                                      <p className="summary-label">Item logged</p>
                                      <p className="summary-value">{sumTimeEntryHours(item.time_entries || []).toFixed(2)}h</p>
                                    </div>
                                    <div className="summary-card">
                                      <p className="summary-label">Total variance</p>
                                      <p className="summary-value">{varianceHoursForItem(item).toFixed(2)}h</p>
                                    </div>
                                  </div>

                                  <form className="inline-grid details-subtask-form" onSubmit={(event) => handleAddWorkSubtask(event, item.id)}>
                                    <input name="subtask_title" placeholder="Checklist subitem title" required />
                                    <input type="number" step="0.25" min="0" name="subtask_estimate_hours" placeholder="Estimate h" />
                                    <button type="submit" className="table-btn">
                                      Add subitem
                                    </button>
                                  </form>

                                  <div className="stack-list">
                                    {item.subtasks.map((subtask) => (
                                      <div key={subtask.id} className="sub-item">
                                        <div className="checkline">
                                          <input
                                            type="checkbox"
                                            checked={subtask.status === "done"}
                                            onChange={() => handleToggleSubtaskDone(item.id, subtask.id)}
                                          />
                                          <strong>{subtask.title}</strong>
                                          <span className="muted">{sumTimeEntryHours(subtask.time_entries || []).toFixed(2)}h logged</span>
                                          <button className="table-btn danger" type="button" onClick={() => handleDeleteSubtask(item.id, subtask.id)}>
                                            Remove
                                          </button>
                                        </div>
                                        <div className="inline-grid details-subtask-row">
                                          <label className="field compact-form">
                                            <span>Subitem estimate (h)</span>
                                            <input
                                              type="number"
                                              min="0"
                                              step="0.25"
                                              value={subtask.estimate_hours}
                                              onChange={(event) => handleSubtaskEstimateChange(item.id, subtask.id, event.target.value)}
                                            />
                                          </label>
                                          <form
                                            className="inline-grid details-time-entry-grid"
                                            onSubmit={(event) => handleAddWorkTimeEntry(event, item.id, subtask.id)}
                                          >
                                            <input type="date" name="date" defaultValue={formatDateISO(new Date())} />
                                            <input type="number" min="0.25" step="0.25" name="hours" placeholder="Hours" required />
                                            <input name="note" placeholder="Note (optional)" />
                                            <button type="submit" className="table-btn">
                                              Log time
                                            </button>
                                          </form>
                                        </div>
                                        <ul className="stack-list">
                                          {(subtask.time_entries || []).map((entry) => (
                                            <li key={entry.id} className="checkline">
                                              <span>
                                                {entry.date} · {Number(entry.hours).toFixed(2)}h {entry.note ? `· ${entry.note}` : ""}
                                              </span>
                                              <button
                                                type="button"
                                                className="table-btn danger"
                                                onClick={() => handleDeleteWorkTimeEntry(item.id, entry.id, subtask.id)}
                                              >
                                                Delete
                                              </button>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ))}
                                  </div>

                                  <form className="inline-grid details-time-entry-grid" onSubmit={(event) => handleAddWorkTimeEntry(event, item.id)}>
                                    <input type="date" name="date" defaultValue={formatDateISO(new Date())} />
                                    <input type="number" min="0.25" step="0.25" name="hours" placeholder="Hours" required />
                                    <input name="note" placeholder="Item time entry note (optional)" />
                                    <button type="submit" className="table-btn">
                                      Add item time
                                    </button>
                                  </form>
                                  <ul className="stack-list">
                                    {(item.time_entries || []).map((entry) => (
                                      <li key={entry.id} className="checkline">
                                        <span>
                                          {entry.date} · {Number(entry.hours).toFixed(2)}h {entry.note ? `· ${entry.note}` : ""}
                                        </span>
                                        <button
                                          type="button"
                                          className="table-btn danger"
                                          onClick={() => handleDeleteWorkTimeEntry(item.id, entry.id)}
                                        >
                                          Delete
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </details>
                            </td>
                          </tr>
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card">
              <header>
                <p className="eyebrow">Kanban</p>
                <h2>Grouped from filtered items</h2>
              </header>
              <div className="board-grid">
                {boardColumns.map((column, columnIndex) => (
                  <article key={column} className="board-column">
                    <h3>{column}</h3>
                    {rankedFilteredWorkItems
                      .filter((item) => (statusToBoardColumn[migrateBoardStatus(item.status)] || "Backlog") === column)
                      .map((item) => (
                        <div className="board-card" key={item.id}>
                          <p>{item.title}</p>
                          <p className="subtitle">
                            {item.owner} · {item.priority || "P2"} · est. {estimateHoursForItem(item).toFixed(2)}h
                          </p>
                          <p className="subtitle">Due: {item.due_date || "—"}</p>
                          <div className="row-actions">
                            <button className="table-btn" type="button" onClick={() => moveBoardTask(item.id, -1)} disabled={columnIndex === 0}>
                              ←
                            </button>
                            <button
                              className="table-btn"
                              type="button"
                              onClick={() => moveBoardTask(item.id, 1)}
                              disabled={columnIndex === boardColumns.length - 1}
                            >
                              →
                            </button>
                          </div>
                        </div>
                      ))}
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeView === "insights" && (
          <section className="card insights-panel">
            <header>
              <p className="eyebrow">Insights</p>
              <h2>Fuel efficiency overview</h2>
              <p className="subtitle">Efficiency intervals are derived from ordered fuel events and trip ranges.</p>
            </header>

            <div className="summary-grid compact-summary-grid">
              {insightSummaryCards.map((card) => (
                <article key={card.label} className="summary-card compact-summary-card">
                  <p className="summary-label">{card.label}</p>
                  <p className="summary-value">{card.value}</p>
                  <p className="summary-hint">{card.hint}</p>
                </article>
              ))}
            </div>

            <div className="summary-grid compact-summary-grid">
              <article className="summary-card compact-summary-card">
                <p className="summary-label">Work variance</p>
                <p className="summary-value">{aggregateWorkMetrics.varianceHours.toFixed(2)}h</p>
                <p className="summary-hint">
                  Logged {aggregateWorkMetrics.loggedHours.toFixed(2)}h vs est. {aggregateWorkMetrics.estimateHours.toFixed(2)}h
                </p>
              </article>
              {personHoursSummary.map((item) => (
                <article key={item.person} className="summary-card compact-summary-card">
                  <p className="summary-label">{item.person}</p>
                  <p className="summary-value">{item.taskHours.toFixed(2)}h tracked</p>
                  <p className="summary-hint">
                    Est. {item.todoEstimateHours.toFixed(2)}h · variance {item.varianceHours.toFixed(2)}h
                  </p>
                </article>
              ))}
            </div>

            <div className="line-chart-shell" role="img" aria-label="Line chart showing fuel efficiency trend in km per liter">
              {efficiencyTrend.points.length < 2 ? (
                <p className="subtitle">Add at least two valid fuel intervals to see an efficiency trend line.</p>
              ) : (
                <>
                  <svg viewBox={`0 0 ${efficiencyTrend.width} ${efficiencyTrend.height}`} className="line-chart">
                    <polyline points={efficiencyTrend.linePath} className="line-chart-path" />
                    {efficiencyTrend.points.map((point, index) => {
                      const minY = Math.min(...efficiencyTrend.points.map((item) => item.efficiency));
                      const maxY = Math.max(...efficiencyTrend.points.map((item) => item.efficiency));
                      const yRange = maxY - minY || 1;
                      const xRange = efficiencyTrend.points.length - 1 || 1;
                      const x =
                        efficiencyTrend.padding +
                        (index / xRange) * (efficiencyTrend.width - efficiencyTrend.padding * 2);
                      const normalizedY = (point.efficiency - minY) / yRange;
                      const y =
                        efficiencyTrend.height -
                        efficiencyTrend.padding -
                        normalizedY * (efficiencyTrend.height - efficiencyTrend.padding * 2);
                      return <circle key={point.id} cx={x} cy={y} r="4" className="line-chart-dot" />;
                    })}
                  </svg>
                  <div className="line-chart-legend">
                    <span>{new Date(efficiencyTrend.points[0].timestamp).toLocaleDateString()}</span>
                    <span>{new Date(efficiencyTrend.points.at(-1).timestamp).toLocaleDateString()}</span>
                  </div>
                </>
              )}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fuel time (UTC)</th>
                    <th>User</th>
                    <th>From km</th>
                    <th>To km</th>
                    <th>Δ km</th>
                    <th>km/l</th>
                    <th>L/100km</th>
                    <th>CHF/100km</th>
                  </tr>
                </thead>
                <tbody>
                  {fuelEfficiencyIntervals.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="empty-cell">
                        No efficiency intervals yet.
                      </td>
                    </tr>
                  ) : (
                    [...fuelEfficiencyIntervals]
                      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                      .map((item) => (
                        <tr key={item.id}>
                          <td>{new Date(item.timestamp).toLocaleString()}</td>
                          <td>{item.user_name}</td>
                          <td>{item.from_odometer_km.toFixed(1)}</td>
                          <td>{item.to_odometer_km.toFixed(1)}</td>
                          <td>{item.interval_distance_km.toFixed(1)}</td>
                          <td>{item.km_per_liter.toFixed(2)}</td>
                          <td>{item.liters_per_100km.toFixed(2)}</td>
                          <td>{item.cost_per_100km.toFixed(2)}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeView === "accounting" && <VanAccountingSandbox />}
      </main>
    </div>
  );
}
