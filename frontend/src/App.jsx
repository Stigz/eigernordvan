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
    return { entries: parsed.entries };
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

const accountingDemoPeople = [
  { id: crypto.randomUUID(), name: "Nic", km_used: 3200, nights_used: 18, work_hours: 42, money_paid: 1200, manual_cost_share: 0 },
  { id: crypto.randomUUID(), name: "Kayla", km_used: 2100, nights_used: 12, work_hours: 26, money_paid: 600, manual_cost_share: 0 },
  { id: crypto.randomUUID(), name: "Luk", km_used: 1450, nights_used: 9, work_hours: 14, money_paid: 350, manual_cost_share: 0 },
  { id: crypto.randomUUID(), name: "Jeanne", km_used: 1850, nights_used: 11, work_hours: 20, money_paid: 500, manual_cost_share: 0 },
];

const accountingInitialSettings = {
  km_rate_chf: 0.62,
  night_rate_chf: 24,
  work_hour_rate_chf: 38,
  annual_fixed_costs_chf: 8000,
  cost_split_mode: "usage",
  calculation_mode: "annual_balance",
};

const toAccountingNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const accountingRound2 = (value) => Math.round(value * 100) / 100;

const VanAccountingSandbox = () => {
  const [people, setPeople] = useState(accountingDemoPeople);
  const [settings, setSettings] = useState(accountingInitialSettings);

  const totals = useMemo(() => {
    const usageValues = people.map(
      (person) => toAccountingNumber(person.km_used) * toAccountingNumber(settings.km_rate_chf) + toAccountingNumber(person.nights_used) * toAccountingNumber(settings.night_rate_chf),
    );
    const workValues = people.map((person) => toAccountingNumber(person.work_hours) * toAccountingNumber(settings.work_hour_rate_chf));
    const sumUsageValue = usageValues.reduce((acc, value) => acc + value, 0);
    const contributions = people.map((person, index) => toAccountingNumber(person.money_paid) + workValues[index]);
    const sumContributions = contributions.reduce((acc, value) => acc + value, 0);
    return { usageValues, workValues, sumUsageValue, contributions, sumContributions };
  }, [people, settings]);

  const results = useMemo(
    () =>
      people.map((person, index) => {
        const usage_value = totals.usageValues[index];
        const work_value = totals.workValues[index];
        // annual_balance mode: contribution_value_i = work_value_i
        const contribution_value = work_value;

        // annual_balance cost share:
        // usage: annual_fixed_costs_chf * (usage_value_i / sum(usage_value))
        // equal: annual_fixed_costs_chf / number_of_people
        // manual: user-entered manual_cost_share
        let cost_share = 0;
        if (settings.cost_split_mode === "usage") {
          cost_share =
            totals.sumUsageValue > 0
              ? toAccountingNumber(settings.annual_fixed_costs_chf) * (usage_value / totals.sumUsageValue)
              : 0;
        } else if (settings.cost_split_mode === "equal") {
          cost_share = people.length > 0 ? toAccountingNumber(settings.annual_fixed_costs_chf) / people.length : 0;
        } else {
          cost_share = toAccountingNumber(person.manual_cost_share);
        }
        // annual_balance mode: net_balance_i = contribution_value_i - usage_value_i - cost_share_i
        const net_balance = contribution_value - usage_value - cost_share;

        // relative_fairness mode:
        // contribution_pool_i = money_paid_i + work_value_i
        const contribution_pool = totals.contributions[index];
        // fair_usage_share_i = contribution_pool_i / sum(contribution_pool)
        const fair_usage_share = totals.sumContributions > 0 ? contribution_pool / totals.sumContributions : 0;
        // fair_usage_value_i = fair_usage_share_i * sum(usage_value)
        const fair_usage_value = fair_usage_share * totals.sumUsageValue;
        // relative_balance_i = fair_usage_value_i - usage_value_i
        const relative_balance = fair_usage_value - usage_value;

        return {
          id: person.id,
          name: person.name,
          usage_value: accountingRound2(usage_value),
          work_value: accountingRound2(work_value),
          contribution_value: accountingRound2(contribution_value),
          cost_share: accountingRound2(cost_share),
          net_balance: accountingRound2(net_balance),
          fair_usage_share,
          fair_usage_value: accountingRound2(fair_usage_value),
          relative_balance: accountingRound2(relative_balance),
        };
      }),
    [people, settings, totals],
  );

  const setPersonValue = (id, field, value) => {
    setPeople((current) => current.map((person) => (person.id === id ? { ...person, [field]: value } : person)));
  };

  const addPerson = () => {
    setPeople((current) => [
      ...current,
      { id: crypto.randomUUID(), name: "", km_used: 0, nights_used: 0, work_hours: 0, money_paid: 0, manual_cost_share: 0 },
    ]);
  };

  return (
    <section className="card">
      <header>
        <p className="eyebrow">Accounting sandbox</p>
        <h2>Future Van Accounting Simulator</h2>
        <p className="subtitle">Edit values below to test fairness models. Calculations update instantly.</p>
      </header>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>km_used</th>
              <th>nights_used</th>
              <th>work_hours</th>
              <th>money_paid</th>
              <th>manual cost share</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id}>
                <td><input value={person.name} onChange={(event) => setPersonValue(person.id, "name", event.target.value)} /></td>
                <td><input type="number" value={person.km_used} onChange={(event) => setPersonValue(person.id, "km_used", event.target.value)} /></td>
                <td><input type="number" value={person.nights_used} onChange={(event) => setPersonValue(person.id, "nights_used", event.target.value)} /></td>
                <td><input type="number" value={person.work_hours} onChange={(event) => setPersonValue(person.id, "work_hours", event.target.value)} /></td>
                <td><input type="number" value={person.money_paid} onChange={(event) => setPersonValue(person.id, "money_paid", event.target.value)} /></td>
                <td><input type="number" value={person.manual_cost_share} onChange={(event) => setPersonValue(person.id, "manual_cost_share", event.target.value)} /></td>
                <td>
                  <button className="table-btn danger" type="button" disabled={people.length === 1} onClick={() => setPeople((current) => current.filter((item) => item.id !== person.id))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="submit" type="button" onClick={addPerson}>Add person</button>

      <div className="summary-grid accounting-settings-grid">
        <label className="field"><span>km_rate_chf</span><input type="number" step="0.01" value={settings.km_rate_chf} onChange={(event) => setSettings((current) => ({ ...current, km_rate_chf: event.target.value }))} /></label>
        <label className="field"><span>night_rate_chf</span><input type="number" step="0.01" value={settings.night_rate_chf} onChange={(event) => setSettings((current) => ({ ...current, night_rate_chf: event.target.value }))} /></label>
        <label className="field"><span>work_hour_rate_chf</span><input type="number" step="0.01" value={settings.work_hour_rate_chf} onChange={(event) => setSettings((current) => ({ ...current, work_hour_rate_chf: event.target.value }))} /></label>
        <label className="field"><span>annual_fixed_costs_chf</span><input type="number" step="0.01" value={settings.annual_fixed_costs_chf} onChange={(event) => setSettings((current) => ({ ...current, annual_fixed_costs_chf: event.target.value }))} /></label>
        <label className="field">
          <span>cost_split_mode</span>
          <select value={settings.cost_split_mode} onChange={(event) => setSettings((current) => ({ ...current, cost_split_mode: event.target.value }))}>
            <option value="usage">usage</option><option value="equal">equal</option><option value="manual">manual</option>
          </select>
        </label>
        <label className="field">
          <span>calculation_mode</span>
          <select value={settings.calculation_mode} onChange={(event) => setSettings((current) => ({ ...current, calculation_mode: event.target.value }))}>
            <option value="annual_balance">annual_balance</option><option value="relative_fairness">relative_fairness</option>
          </select>
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>usage_value</th><th>work_value</th><th>contribution_value</th><th>cost_share</th><th>net_balance</th><th>fair_usage_share</th><th>fair_usage_value</th><th>relative_balance</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={result.id}>
                <td>{result.name || "(unnamed)"}</td>
                <td>{result.usage_value.toFixed(2)}</td>
                <td>{result.work_value.toFixed(2)}</td>
                <td>{result.contribution_value.toFixed(2)}</td>
                <td>{result.cost_share.toFixed(2)}</td>
                <td className={result.net_balance >= 0 ? "balance-positive" : "balance-negative"}>{result.net_balance.toFixed(2)}</td>
                <td>{(result.fair_usage_share * 100).toFixed(2)}%</td>
                <td>{result.fair_usage_value.toFixed(2)}</td>
                <td className={result.relative_balance >= 0 ? "balance-positive" : "balance-negative"}>{result.relative_balance.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default function App() {
  const [activeView, setActiveView] = useState("km");
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
  const [costSyncStatus, setCostSyncStatus] = useState({ state: "idle", message: "" });
  const [isCostLoaded, setIsCostLoaded] = useState(false);

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
    saveFuelEntries(gasEntries);
    setGasTableState({ state: "success", message: "" });
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
        const nextState = { entries: Array.isArray(payload.entries) ? payload.entries : [] };
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

  const handleGasSubmit = (event) => {
    event.preventDefault();

    const entry = {
      id: crypto.randomUUID(),
      user_name: gasForm.user_name.trim(),
      liters: Number(gasForm.liters),
      cost_chf: Number(gasForm.cost_chf),
      odometer_km: Number(gasForm.odometer_km),
      timestamp: new Date().toISOString(),
    };

    if (!entry.user_name || entry.liters <= 0 || entry.cost_chf <= 0 || entry.odometer_km < 0) {
      setGasStatus({ state: "error", message: "Enter valid name, liters, cost, and odometer values." });
      return;
    }

    setGasTableState({ state: "loading", message: "Updating fuel history..." });
    setGasEntries((prev) => [entry, ...prev]);
    upsertProfile(entry.user_name);
    setGasStatus({ state: "success", message: "Fuel entry added." });
    setGasForm((prev) => ({ ...initialGasForm, user_name: prev.user_name }));
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

  const handleDeleteGas = (entryId) => {
    setGasTableState({ state: "loading", message: "Updating fuel history..." });
    setGasEntries((prev) => prev.filter((entry) => entry.id !== entryId));
    setGasStatus({ state: "success", message: "Fuel entry deleted." });
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
      category: costForm.category.trim() || "general",
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

  return (
    <div className="page">
      <main className="layout layout-stack">
        <section className="card view-switcher-card">
          <p className="eyebrow">Views</p>
          <div className="view-switcher" role="tablist" aria-label="Ledger views">
            {[
              { id: "km", label: "KM" },
              { id: "gas", label: "Gas" },
              { id: "booking", label: "Booking" },
              { id: "costs", label: "Costs" },
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
                  <input name="category" value={costForm.category} onChange={handleCostFormChange} />
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
                    {sortedCostEntries.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="empty-cell">
                          No cost entries yet.
                        </td>
                      </tr>
                    ) : (
                      sortedCostEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.date}</td>
                          <td>{entry.type}</td>
                          <td>{entry.description}</td>
                          <td>{entry.category}</td>
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
