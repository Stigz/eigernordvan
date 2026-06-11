import { useEffect, useMemo, useState } from "react";
import {
  accountingCurrentOpenPeriod,
  accountingCurrentOpenStartDate,
  accountingBucketLabelMap,
  accountingPeople,
  calculateAccountingProjection,
  defaultAccountingSettings,
  normalizeAccountingProjectionFromApi,
  normalizeAccountingSettings,
  normalizeMonthlyCloseFromApi,
  sortMonthlyCloses,
} from "./accounting";

const formatChf = (value) => `CHF ${Number(value || 0).toFixed(2)}`;
const formatParty = (value) => (value === "shared_pot" ? "Shared pot" : value);
const formatSourceCounts = (counts = {}) =>
  `${Number(counts.cost_entries || 0)} manual costs, ${Number(counts.fuel_entries || 0)} gas rows, ${Number(counts.trip_entries || 0)} trips, ${Number(
    counts.booking_entries || 0,
  )} bookings, ${Number(counts.work_entries || 0)} work rows`;
const formatClosedSourceCounts = (counts = {}) =>
  formatSourceCounts({
    cost_entries: counts.cost_entries ?? counts.costEntries,
    historical_cost_entries: counts.historical_cost_entries ?? counts.historicalCostEntries,
    trip_entries: counts.trip_entries ?? counts.tripEntries,
    booking_entries: counts.booking_entries ?? counts.bookingEntries,
    fuel_entries: counts.fuel_entries ?? counts.fuelEntries,
    work_entries: counts.work_entries ?? counts.workEntries,
  });
const formatSettlementSummary = (rows = []) =>
  rows.length === 0
    ? "No payments"
    : rows.map((row) => `${formatParty(row.from_person)} -> ${formatParty(row.to_person)} ${formatChf(row.amount_chf)}`).join("; ");

const currentMonth = () => new Date().toISOString().slice(0, 7);
const accountingSettingKeys = [
  "km_rate_chf",
  "night_rate_chf",
  "workday_rate_chf",
  "monthly_payment_chf",
  "reserve_target_chf",
  "surplus_reserve_percent",
  "surplus_historical_repayment_percent",
];

const settingsSignature = (settings) => {
  const normalized = normalizeAccountingSettings(settings);
  return JSON.stringify(Object.fromEntries(accountingSettingKeys.map((key) => [key, Number(normalized[key] || 0)])));
};

const closeRequestFromProjection = (projection) => ({
  period: projection.period,
  notes: "Generated from backend accounting preview",
});

export default function AccountingDashboard({ apiBaseUrl, costEntries = [], trips = [], fuelEntries = [], workEntries = [], people = accountingPeople }) {
  const [settings, setSettings] = useState(defaultAccountingSettings);
  const [periodMode, setPeriodMode] = useState("current_open");
  const [monthPeriod, setMonthPeriod] = useState(currentMonth());
  const [bookings, setBookings] = useState([]);
  const [apiProjection, setApiProjection] = useState(null);
  const [monthlyCloses, setMonthlyCloses] = useState([]);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const period = periodMode === "current_open" ? accountingCurrentOpenPeriod : monthPeriod;
  const isCurrentOpenPeriod = period === accountingCurrentOpenPeriod;
  const periodLabel = isCurrentOpenPeriod ? `Current open since ${accountingCurrentOpenStartDate}` : period;

  useEffect(() => {
    if (!apiBaseUrl) return;
    let isCancelled = false;
    const loadSettings = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/accounting/settings`);
        const payload = await response.json().catch(() => ({}));
        if (!isCancelled && response.ok) {
          setSettings(normalizeAccountingSettings(payload));
        }
      } catch (_error) {
        if (!isCancelled) setStatus({ state: "error", message: "Could not load accounting settings." });
      }
    };
    loadSettings();
    return () => {
      isCancelled = true;
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!apiBaseUrl || !period) return;
    let isCancelled = false;
    const loadAccountingContext = async () => {
      const [year] = isCurrentOpenPeriod ? [accountingCurrentOpenStartDate.slice(0, 4)] : period.split("-");
      const from = isCurrentOpenPeriod ? accountingCurrentOpenStartDate : `${year}-01-01`;
      const to = isCurrentOpenPeriod ? "2100-01-01" : `${Number(year) + 1}-01-01`;
      try {
        const [bookingResponse, closeResponse, previewResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/bookings?${new URLSearchParams({ from, to, visibility: "owner" })}`),
          fetch(`${apiBaseUrl}/accounting/monthly-closes`),
          fetch(`${apiBaseUrl}/accounting/preview?${new URLSearchParams({ period })}`),
        ]);
        const bookingPayload = await bookingResponse.json().catch(() => ({}));
        const closePayload = await closeResponse.json().catch(() => ({}));
        const previewPayload = await previewResponse.json().catch(() => ({}));
        if (isCancelled) return;
        if (bookingResponse.ok) setBookings(Array.isArray(bookingPayload.items) ? bookingPayload.items : []);
        if (closeResponse.ok) {
          setMonthlyCloses(
            sortMonthlyCloses(
              (Array.isArray(closePayload.items) ? closePayload.items : [])
                .map((item) => normalizeMonthlyCloseFromApi(item, { people }))
                .filter(Boolean),
            ),
          );
        }
        if (previewResponse.ok) {
          setApiProjection(normalizeAccountingProjectionFromApi(previewPayload, { people }));
        } else {
          setApiProjection(null);
        }
      } catch (_error) {
        if (!isCancelled) setStatus({ state: "error", message: "Could not load accounting context." });
      }
    };
    loadAccountingContext();
    return () => {
      isCancelled = true;
    };
  }, [apiBaseUrl, isCurrentOpenPeriod, people, period, previewRefreshKey]);

  const localProjection = useMemo(
    () =>
      calculateAccountingProjection({
        costEntries,
        trips,
        bookings,
        fuelEntries,
        workEntries,
        settings,
        people,
        period,
      }),
    [bookings, costEntries, fuelEntries, people, period, settings, trips, workEntries],
  );
  const apiProjectionMatchesSettings = Boolean(
    apiProjection && apiProjection.period === period && settingsSignature(apiProjection.settings) === settingsSignature(settings),
  );
  const projection = apiProjectionMatchesSettings ? apiProjection : localProjection;
  const previewUsesUnsavedSettings = Boolean(apiProjection && apiProjection.period === period && !apiProjectionMatchesSettings);

  const historicalRows = useMemo(() => costEntries.filter((entry) => entry.historical || entry.historical_only), [costEntries]);
  const visibleMonthlyCloses = monthlyCloses.slice(0, 12);
  const existingClose = isCurrentOpenPeriod ? null : monthlyCloses.find((close) => close.period === period);
  const closeButtonLabel = isCurrentOpenPeriod
    ? "Choose a month to close"
    : existingClose
      ? "Month already closed"
      : previewUsesUnsavedSettings
        ? "Save settings first"
        : "Save monthly close";
  const vehiclePot = projection.currentPots?.vehicle || {};
  const livingWorkPot = projection.currentPots?.livingWork || {};

  const handleSettingChange = (event) => {
    const { name, value } = event.target;
    setSettings((current) => ({ ...current, [name]: value }));
  };

  const handleSaveSettings = async () => {
    if (!apiBaseUrl) {
      setStatus({ state: "error", message: "Missing API URL. Settings are only previewed locally." });
      return;
    }
    setStatus({ state: "loading", message: "Saving accounting settings..." });
    try {
      const response = await fetch(`${apiBaseUrl}/accounting/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeAccountingSettings(settings)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus({ state: "error", message: payload.error || "Could not save accounting settings." });
        return;
      }
      setSettings(normalizeAccountingSettings(payload));
      setApiProjection(null);
      setPreviewRefreshKey((current) => current + 1);
      setStatus({ state: "success", message: "Accounting settings saved." });
    } catch (_error) {
      setStatus({ state: "error", message: "Network error while saving accounting settings." });
    }
  };

  const handleSaveMonthlyClose = async () => {
    if (!apiBaseUrl) {
      setStatus({ state: "error", message: "Missing API URL. Monthly close can only be previewed locally." });
      return;
    }
    if (isCurrentOpenPeriod) {
      setStatus({ state: "error", message: "Switch to a month before saving a monthly close." });
      return;
    }
    if (existingClose) {
      setStatus({ state: "error", message: "This month is already closed. Create an adjustment entry instead of overwriting it." });
      return;
    }
    if (previewUsesUnsavedSettings) {
      setStatus({ state: "error", message: "Save accounting settings before closing this month." });
      return;
    }
    setStatus({ state: "loading", message: "Saving monthly close..." });
    try {
      const response = await fetch(`${apiBaseUrl}/accounting/monthly-closes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(closeRequestFromProjection(projection)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus({ state: "error", message: payload.error || "Could not save monthly close." });
        return;
      }
      const savedClose = normalizeMonthlyCloseFromApi(payload, { people });
      if (savedClose) {
        setMonthlyCloses((current) => sortMonthlyCloses([savedClose, ...current.filter((close) => close.period !== savedClose.period)]));
      }
      setStatus({ state: "success", message: `Closed ${period}.` });
    } catch (_error) {
      setStatus({ state: "error", message: "Network error while saving monthly close." });
    }
  };

  return (
    <div className="panel-grid">
      <section className="card full-span">
        <header>
          <p className="eyebrow">Doppelte Buchhaltung</p>
          <h1>Private van accounting</h1>
          <p className="subtitle">Track the open period with a vehicle pot, a nights/work pot, and historical Ausgleich kept separate.</p>
        </header>
        {status.state !== "idle" && <div className={`status ${status.state}`}>{status.message}</div>}
        <div className="inline-grid four-col">
          <label className="field">
            <span>View</span>
            <select value={periodMode} onChange={(event) => setPeriodMode(event.target.value)}>
              <option value="current_open">Current open period</option>
              <option value="month">Single month</option>
            </select>
          </label>
          {periodMode === "month" && (
            <label className="field">
              <span>Month</span>
              <input type="month" value={monthPeriod} onChange={(event) => setMonthPeriod(event.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Km rate</span>
            <input name="km_rate_chf" type="number" step="0.01" value={settings.km_rate_chf} onChange={handleSettingChange} />
          </label>
          <label className="field">
            <span>Night rate</span>
            <input name="night_rate_chf" type="number" step="0.01" value={settings.night_rate_chf} onChange={handleSettingChange} />
          </label>
          <label className="field">
            <span>Workday credit</span>
            <input name="workday_rate_chf" type="number" step="0.01" value={settings.workday_rate_chf} onChange={handleSettingChange} />
          </label>
          <label className="field">
            <span>Monthly payment</span>
            <input name="monthly_payment_chf" type="number" step="0.01" value={settings.monthly_payment_chf} onChange={handleSettingChange} />
          </label>
          <label className="field">
            <span>Reserve target</span>
            <input name="reserve_target_chf" type="number" step="0.01" value={settings.reserve_target_chf} onChange={handleSettingChange} />
          </label>
          <label className="field">
            <span>Surplus to reserve (%)</span>
            <input name="surplus_reserve_percent" type="number" step="1" value={settings.surplus_reserve_percent} onChange={handleSettingChange} />
          </label>
          <label className="field">
            <span>Surplus to history (%)</span>
            <input
              name="surplus_historical_repayment_percent"
              type="number"
              step="1"
              value={settings.surplus_historical_repayment_percent}
              onChange={handleSettingChange}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="submit" type="button" onClick={handleSaveSettings}>
            Save settings
          </button>
          <button
            className="cancel"
            type="button"
            onClick={handleSaveMonthlyClose}
            disabled={Boolean(isCurrentOpenPeriod || existingClose || previewUsesUnsavedSettings)}
          >
            {closeButtonLabel}
          </button>
        </div>
        {previewUsesUnsavedSettings && <p className="subtitle">Local preview with unsaved settings. Save settings before closing {period}.</p>}
        {existingClose && (
          <p className="subtitle">
            Saved close for {period}: {formatClosedSourceCounts(existingClose.entryCounts)}.
          </p>
        )}
      </section>

      <section className="card table-card">
        <header>
          <p className="eyebrow">Shared konto</p>
          <h2>{periodLabel}</h2>
        </header>
        <div className="summary-grid compact-summary-grid">
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Bank inflow</p>
            <p className="summary-value">{formatChf(projection.sharedPot.inflow_chf)}</p>
            <p className="summary-hint">Payments, net usage, and income.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Monthly due</p>
            <p className="summary-value">{formatChf(projection.sharedPot.contributions_due_chf)}</p>
            <p className="summary-hint">Expected member payments.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Recorded paid</p>
            <p className="summary-value">{formatChf(projection.sharedPot.contributions_paid_chf)}</p>
            <p className="summary-hint">Transfers entered this month.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Current costs</p>
            <p className="summary-value">{formatChf(projection.sharedPot.current_costs_chf)}</p>
            <p className="summary-hint">Vehicle and living costs before reserve.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Gas costs</p>
            <p className="summary-value">{formatChf(projection.sharedPot.fuel_costs_chf)}</p>
            <p className="summary-hint">Pulled from the Gas tab.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Reserve</p>
            <p className="summary-value">{formatChf(projection.sharedPot.reserve_allocation_chf)}</p>
            <p className="summary-hint">From surplus after current costs.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Historical repayment</p>
            <p className="summary-value">{formatChf(projection.sharedPot.historical_repayment_chf)}</p>
            <p className="summary-hint">Paused; shown as Ausgleich below.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Pot balance</p>
            <p className="summary-value">{formatChf(projection.sharedPot.balance_chf)}</p>
            <p className="summary-hint">Cash left after current policy.</p>
          </article>
        </div>
      </section>

      <section className="card table-card">
        <header>
          <p className="eyebrow">Vehicle running</p>
          <h2>KM, gas, insurance, maintenance</h2>
        </header>
        <div className="summary-grid compact-summary-grid">
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Usage funding</p>
            <p className="summary-value">{formatChf(vehiclePot.usage_funding_chf)}</p>
            <p className="summary-hint">All km plus half of nights.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Vehicle costs</p>
            <p className="summary-value">{formatChf(vehiclePot.costs_chf)}</p>
            <p className="summary-hint">Gas, insurance, road fees, repairs.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Vehicle balance</p>
            <p className="summary-value">{formatChf(vehiclePot.balance_chf)}</p>
            <p className="summary-hint">{vehiclePot.deficit_chf > 0 ? `${formatChf(vehiclePot.deficit_chf)} needs shared bank cover.` : "Covered by usage."}</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Gas from tab</p>
            <p className="summary-value">{formatChf(vehiclePot.fuel_costs_chf)}</p>
            <p className="summary-hint">Not duplicated in Costs.</p>
          </article>
        </div>
      </section>

      <section className="card table-card">
        <header>
          <p className="eyebrow">Nights & work</p>
          <h2>Overnight usage and credits</h2>
        </header>
        <div className="summary-grid compact-summary-grid">
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Night funding</p>
            <p className="summary-value">{formatChf(livingWorkPot.night_funding_chf)}</p>
            <p className="summary-hint">Half of night charges.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Work used</p>
            <p className="summary-value">{formatChf(livingWorkPot.work_offset_chf)}</p>
            <p className="summary-hint">Offsets night charges first.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Work carried</p>
            <p className="summary-value">{formatChf(livingWorkPot.work_carryforward_chf)}</p>
            <p className="summary-hint">Value kept for future offsets.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Living balance</p>
            <p className="summary-value">{formatChf(livingWorkPot.balance_chf)}</p>
            <p className="summary-hint">Nights/work pot only.</p>
          </article>
        </div>
      </section>

      <section className="card table-card">
        <header>
          <p className="eyebrow">People</p>
          <h2>Usage, work, cash balance</h2>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Km</th>
                <th>Nights</th>
                <th>Usage</th>
                <th>Work used</th>
                <th>Work carried</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person}>
                  <td>{person}</td>
                  <td>{projection.kmByPerson[person].toFixed(1)}</td>
                  <td>{projection.nightsByPerson[person].toFixed(1)}</td>
                  <td>{formatChf(projection.usageByPerson[person])}</td>
                  <td>{formatChf(projection.workOffsetsByPerson?.[person])}</td>
                  <td>{formatChf(projection.workCarryForwardByPerson?.[person])}</td>
                  <td>{formatChf(projection.personBalances[person])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card table-card">
        <header>
          <p className="eyebrow">Settlement</p>
          <h2>Suggested payments</h2>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Amount</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {projection.suggestedSettlements.length === 0 ? (
                <tr>
                  <td colSpan="4" className="empty-cell">
                    No suggested payments for this preview.
                  </td>
                </tr>
              ) : (
                projection.suggestedSettlements.map((row) => (
                  <tr key={`${row.from_person}-${row.to_person}-${row.amount_chf}`}>
                    <td>{formatParty(row.from_person)}</td>
                    <td>{formatParty(row.to_person)}</td>
                    <td>{formatChf(row.amount_chf)}</td>
                    <td>{row.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card full-span table-card">
        <header>
          <p className="eyebrow">Historical Ausgleich</p>
          <h2>Frozen backlog</h2>
        </header>
        <div className="summary-grid compact-summary-grid">
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Historical basis</p>
            <p className="summary-value">{formatChf(projection.historical.investment_chf)}</p>
            <p className="summary-hint">Imported audit/investment rows.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Historical rows</p>
            <p className="summary-value">{projection.historical.rows}</p>
            <p className="summary-hint">Kept out of current running costs.</p>
          </article>
          <article className="summary-card compact-summary-card">
            <p className="summary-label">Current repayment</p>
            <p className="summary-value">{formatChf(projection.sharedPot.historical_repayment_chf)}</p>
            <p className="summary-hint">Paused until you decide the Ausgleich rule.</p>
          </article>
        </div>
      </section>

      <section className="card full-span table-card">
        <header>
          <p className="eyebrow">Audit</p>
          <h2>Double-entry buckets</h2>
        </header>
        <div className="chart-list">
          {Object.entries(projection.bucketTotals)
            .filter(([, amount]) => amount > 0)
            .map(([bucket, amount]) => (
              <div className="chart-row" key={bucket}>
                <span className="chart-month">{accountingBucketLabelMap[bucket] || bucket}</span>
                <div className="chart-track">
                  <div className="chart-bar" style={{ width: `${Math.min(100, Math.max(8, amount / 20))}%` }} />
                </div>
                <span className="chart-value">{formatChf(amount)}</span>
              </div>
            ))}
        </div>
        <p className="subtitle">
          Rows used: {formatSourceCounts(projection.sourceCounts)}. Historical audit rows loaded: {historicalRows.length}. Historical investment basis:{" "}
          {formatChf(projection.historical.investment_chf)}.
        </p>
      </section>

      <section className="card full-span table-card">
        <header>
          <p className="eyebrow">Closed months</p>
          <h2>Monthly snapshots</h2>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Pot balance</th>
                <th>Current costs</th>
                <th>Reserve</th>
                <th>History</th>
                <th>Rows</th>
                <th>Suggested payments</th>
              </tr>
            </thead>
            <tbody>
              {visibleMonthlyCloses.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-cell">
                    No closed months yet.
                  </td>
                </tr>
              ) : (
                visibleMonthlyCloses.map((close) => (
                  <tr key={close.id || close.period}>
                    <td>{close.period}</td>
                    <td>{formatChf(close.totals.shared_pot_balance_chf)}</td>
                    <td>{formatChf(close.totals.current_costs_chf)}</td>
                    <td>{formatChf(close.totals.reserve_allocation_chf)}</td>
                    <td>{formatChf(close.totals.historical_repayment_chf)}</td>
                    <td>{formatClosedSourceCounts(close.entryCounts)}</td>
                    <td>{formatSettlementSummary(close.suggestedSettlements)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
