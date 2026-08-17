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
import { buildSankeyAccountingModel } from "./accountingFlow";
import AccountingSankey, { SankeyDetailPanel } from "./accounting/AccountingSankey";
import ForecastPanel from "./accounting/ForecastPanel";
import PersonAccountingCards from "./accounting/PersonAccountingCards";
import SettlementNowCard from "./accounting/SettlementNowCard";
import { formatDateISO, formatSwissDate } from "./dateFormatting";

const formatChf = (value) => `CHF ${Number(value || 0).toFixed(2)}`;
const formatSignedChf = (value) => {
  const amount = Number(value || 0);
  return amount < 0 ? `CHF -${Math.abs(amount).toFixed(2)}` : formatChf(amount);
};
const formatNumber = (value) => Number(value || 0).toFixed(1);
const formatParty = (value) => (value === "shared_pot" ? "Gemeinsames Konto" : value);
const reasonLabel = (value = "") => {
  if (value === "Shared pot due") return "Ins gemeinsame Konto";
  if (value === "Shared pot reimbursement") return "Rückerstattung aus Konto";
  return value || "Ausgleich";
};
const formatSourceCounts = (counts = {}) =>
  `${Number(counts.cost_entries || 0)} Kosten, ${Number(counts.fuel_entries || 0)} Diesel, ${Number(counts.trip_entries || 0)} Fahrten, ${Number(
    counts.booking_entries || 0,
  )} Buchungen, ${Number(counts.work_entries || 0)} Arbeit`;
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
    ? "Keine Zahlungen"
    : rows.map((row) => `${formatParty(row.from_person)} -> ${formatParty(row.to_person)} ${formatChf(row.amount_chf)}`).join("; ");

const currentMonth = () => formatDateISO(new Date()).slice(0, 7);
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

const splitLabel = (label = "") => {
  const words = String(label).split(" ");
  if (words.length < 3 || label.length < 20) return [label];
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" ")];
};

const nodeAmount = (node) => {
  if (!Number(node.amount || 0)) return "";
  return formatChf(node.amount);
};

function FlowChart({ model, selectedId, onSelect }) {
  const maxLinkAmount = Math.max(1, ...model.links.map((link) => Number(link.amount || 0)));
  const personNodes = model.personRows.map((row, index) => ({
    id: `person:${row.person}`,
    x: 28,
    y: 72 + index * 68,
    w: 150,
    h: 48,
  }));
  const fixedNodes = [
    { id: "pot:vehicle", x: 326, y: 100, w: 210, h: 72 },
    { id: "pot:living", x: 326, y: 242, w: 210, h: 72 },
    { id: "pot:shared", x: 326, y: 386, w: 210, h: 72 },
    { id: "pot:history", x: 326, y: 490, w: 210, h: 54 },
    { id: "out:vehicle-costs", x: 718, y: 100, w: 210, h: 72 },
    { id: "out:living-costs", x: 718, y: 242, w: 210, h: 72 },
    { id: "out:reserve", x: 718, y: 364, w: 210, h: 54 },
    { id: "out:balance", x: 718, y: 430, w: 210, h: 54 },
    { id: "out:history", x: 718, y: 490, w: 210, h: 54 },
  ];
  const nodePositions = Object.fromEntries([...personNodes, ...fixedNodes].map((node) => [node.id, node]));
  const nodes = model.nodes
    .map((node) => ({ ...node, ...(nodePositions[node.id] || {}) }))
    .filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));

  const select = (id) => {
    if (id) onSelect(id);
  };

  const linkPath = (link) => {
    const from = nodePositions[link.from];
    const to = nodePositions[link.to];
    if (!from || !to) return "";
    const startX = from.x + from.w;
    const startY = from.y + from.h / 2;
    const endX = to.x;
    const endY = to.y + to.h / 2;
    const curve = Math.max(90, (endX - startX) / 2);
    return `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
  };

  return (
    <div className="flow-chart-shell">
      <svg className="flow-chart" viewBox="0 0 960 565" role="img" aria-label="Accounting flow overview">
        <g className="flow-background-labels">
          <text x="30" y="34">Personen</text>
          <text x="326" y="34">2 Töpfe + Konto</text>
          <text x="718" y="34">Wohin es geht</text>
        </g>
        <g className="flow-links">
          {model.links.map((link) => {
            const path = linkPath(link);
            const width = Math.max(3, Math.min(22, 3 + (Number(link.amount || 0) / maxLinkAmount) * 18));
            const isSelected = selectedId === link.id;
            return (
              <g key={link.id} className={`flow-link-group ${isSelected ? "selected" : ""}`}>
                <path
                  d={path}
                  className="flow-hit"
                  strokeWidth={Math.max(18, width + 12)}
                  onClick={() => select(link.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") select(link.id);
                  }}
                  tabIndex="0"
                />
                <path
                  d={path}
                  className={`flow-link ${link.tone || "shared"} ${link.dashed ? "dashed" : ""} ${link.muted ? "muted-link" : ""}`}
                  strokeWidth={width}
                />
                <title>{`${link.label}: ${formatChf(link.amount)}`}</title>
              </g>
            );
          })}
        </g>
        <g className="flow-nodes">
          {nodes.map((node) => {
            const isSelected = selectedId === node.id;
            const lines = splitLabel(node.label);
            return (
              <g
                key={node.id}
                className={`flow-node ${node.kind || ""} ${isSelected ? "selected" : ""}`}
                role="button"
                tabIndex="0"
                onClick={() => select(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") select(node.id);
                }}
              >
                <rect x={node.x} y={node.y} width={node.w} height={node.h} rx="12" />
                <text x={node.x + 14} y={node.y + 20} className="flow-node-title">
                  {lines.map((line, index) => (
                    <tspan key={line} x={node.x + 14} dy={index === 0 ? 0 : 15}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <text x={node.x + 14} y={node.y + node.h - 12} className="flow-node-value">
                  {nodeAmount(node) || node.detail || ""}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="flow-legend">
        <span><i className="legend-line vehicle" />Fahrzeug</span>
        <span><i className="legend-line living" />Nächte</span>
        <span><i className="legend-line work" />Arbeit intern</span>
        <span><i className="legend-line history" />Historisch pausiert</span>
      </div>
    </div>
  );
}

function MoneyRowsTable({ rows = [], emptyText = "Keine Zeilen." }) {
  return (
    <div className="table-wrap calculation-table">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Source</th>
            <th>Person</th>
            <th>Description</th>
            <th>Accounting effect</th>
            <th>Formula</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-cell">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${row.label}-${row.detail || row.description}-${index}`}>
                <td>{row.date ? formatSwissDate(row.date, row.date) : "-"}</td>
                <td>{row.source || "-"}</td>
                <td>{row.person || "-"}</td>
                <td className="notes-cell">{row.description || "-"}</td>
                <td>{row.label}</td>
                <td className="notes-cell">{row.formula || row.detail || "-"}</td>
                <td>{formatSignedChf(row.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function PaymentTable({ projection, recordedPaid }) {
  const rows = projection.suggestedSettlements || [];
  return (
    <section className="card full-span payment-card">
      <header>
        <p className="eyebrow">Wer zahlt jetzt?</p>
        <h2>Direkte Zahlungsvorschläge</h2>
      </header>
      <div className="payment-summary">
        <span>Vorschläge: {rows.length}</span>
        <span>Eingetragen bezahlt: {formatChf(recordedPaid)}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Von</th>
              <th>An</th>
              <th>Betrag</th>
              <th>Grund</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="4" className="empty-cell">
                  Keine Zahlungsvorschläge für diese Vorschau.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.from_person}-${row.to_person}-${row.amount_chf}`}>
                  <td>{formatParty(row.from_person)}</td>
                  <td>{formatParty(row.to_person)}</td>
                  <td>{formatChf(row.amount_chf)}</td>
                  <td>{reasonLabel(row.reason)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Rechenblatt({ model }) {
  return (
    <div className="accounting-tab-grid">
      <section>
        <h3>Overview</h3>
        <MoneyRowsTable rows={model.overviewRows} />
      </section>
      <section>
        <h3>People</h3>
        <div className="table-wrap calculation-table">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>KM</th>
                <th>Nächte</th>
                <th>Fahrzeug</th>
                <th>Nächte/Arbeit</th>
                <th>Arbeit genutzt</th>
                <th>Arbeit offen</th>
                <th>Saldo</th>
                <th>Rechnung</th>
              </tr>
            </thead>
            <tbody>
              {model.personRows.map((row) => (
                <tr key={row.person}>
                  <td>{row.person}</td>
                  <td>{formatNumber(row.km)}</td>
                  <td>{formatNumber(row.nights)}</td>
                  <td>{formatChf(row.vehicleFunding)}</td>
                  <td>{formatChf(row.livingFunding)}</td>
                  <td>{formatChf(row.workUsed)}</td>
                  <td>{formatChf(row.workCarried)}</td>
                  <td>{formatSignedChf(row.balance)}</td>
                  <td className="notes-cell">{row.formula}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3>Audit trail: where did this number come from?</h3>
        <MoneyRowsTable rows={model.auditRows} emptyText="No source rows in this period." />
      </section>
      <section>
        <h3>Vehicle: diesel, maintenance, fees</h3>
        <MoneyRowsTable rows={model.vehicleCostRows} emptyText="No vehicle costs in this period." />
      </section>
      <section>
        <h3>Nights & work</h3>
        <MoneyRowsTable
          rows={model.personRows.flatMap((row) => [
            {
              label: "Nächte-Anteil",
              person: row.person,
              amount: row.livingFunding,
              formula: `${row.nights.toFixed(1)} Nächte × Nacht-Rate ÷ 2`,
            },
            {
              label: "Arbeit genutzt",
              person: row.person,
              amount: row.workUsed,
              formula: `min(Arbeitsgutschrift ${formatChf(row.workCredit)}, Nächte-Anteil ${formatChf(row.livingFunding)})`,
            },
            {
              label: "Arbeit offen",
              person: row.person,
              amount: row.workCarried,
              formula: "Carry-forward, keine automatische Auszahlung",
            },
          ])}
        />
      </section>
      <section>
        <h3>Living / Ausbau costs</h3>
        <MoneyRowsTable rows={model.livingCostRows} emptyText="No living/work costs in this period." />
      </section>
    </div>
  );
}

function Drilldown({ detail }) {
  return (
    <div className="drilldown-panel">
      <div className="drilldown-head">
        <div>
          <h3>{detail.title}</h3>
          <p className="subtitle">{detail.subtitle}</p>
        </div>
        <strong>{formatSignedChf(detail.amount)}</strong>
      </div>
      <MoneyRowsTable rows={detail.rows || []} emptyText="Für diese Auswahl gibt es keine Einzelzeilen." />
    </div>
  );
}

function Formeln({ model }) {
  return (
    <div className="formula-grid">
      {model.formulaRows.map((row) => (
        <article className="formula-card" key={row.title}>
          <p className="summary-label">{row.title}</p>
          <h3>{row.formula}</h3>
          <p>{row.example}</p>
        </article>
      ))}
    </div>
  );
}

function AuditDetails({ projection, monthlyCloses }) {
  const visibleMonthlyCloses = monthlyCloses.slice(0, 12);
  return (
    <details className="card full-span audit-details">
      <summary>Audit und alte Tabellen</summary>
      <div className="audit-grid">
        <section>
          <h3>Doppelte Buchhaltung Buckets</h3>
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
            Zeilen: {formatSourceCounts(projection.sourceCounts)}. Historisch: {projection.historical.rows} Zeilen /{" "}
            {formatChf(projection.historical.investment_chf)}.
          </p>
        </section>
        <section>
          <h3>Geschlossene Monate</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Monat</th>
                  <th>Rest</th>
                  <th>Kosten</th>
                  <th>Reserve</th>
                  <th>Zeilen</th>
                  <th>Zahlungen</th>
                </tr>
              </thead>
              <tbody>
                {visibleMonthlyCloses.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty-cell">
                      Noch keine geschlossenen Monate.
                    </td>
                  </tr>
                ) : (
                  visibleMonthlyCloses.map((close) => (
                    <tr key={close.id || close.period}>
                      <td>{close.period}</td>
                      <td>{formatChf(close.totals.shared_pot_balance_chf)}</td>
                      <td>{formatChf(close.totals.current_costs_chf)}</td>
                      <td>{formatChf(close.totals.reserve_allocation_chf)}</td>
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
    </details>
  );
}

export default function AccountingDashboard({ apiBaseUrl, costEntries = [], trips = [], fuelEntries = [], workEntries = [], people = accountingPeople }) {
  const [settings, setSettings] = useState(defaultAccountingSettings);
  const [periodMode, setPeriodMode] = useState("current_open");
  const [monthPeriod, setMonthPeriod] = useState(currentMonth());
  const [bookings, setBookings] = useState([]);
  const [apiProjection, setApiProjection] = useState(null);
  const [monthlyCloses, setMonthlyCloses] = useState([]);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [selectedFlowId, setSelectedFlowId] = useState("overview");
  const [activeDetailTab, setActiveDetailTab] = useState("rechenblatt");
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const period = periodMode === "current_open" ? accountingCurrentOpenPeriod : monthPeriod;
  const isCurrentOpenPeriod = period === accountingCurrentOpenPeriod;
  const periodLabel = isCurrentOpenPeriod ? `Offen seit ${formatSwissDate(accountingCurrentOpenStartDate)}` : period;

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
        if (!isCancelled) setStatus({ state: "error", message: "Accounting-Regeln konnten nicht geladen werden." });
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
        if (!isCancelled) setStatus({ state: "error", message: "Accounting-Kontext konnte nicht geladen werden." });
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
  const flowModel = useMemo(
    () => buildSankeyAccountingModel({ projection, costEntries, fuelEntries, trips, bookings, workEntries, people, period, settings }),
    [bookings, costEntries, flowModelKey(projection), fuelEntries, people, period, settings, trips, workEntries],
  );
  const selectedDetail = flowModel.detailItems[selectedFlowId] || flowModel.detailItems.overview;
  const existingClose = isCurrentOpenPeriod ? null : monthlyCloses.find((close) => close.period === period);
  const closeButtonLabel = isCurrentOpenPeriod
    ? "Monat wählen zum Schliessen"
    : existingClose
      ? "Monat schon geschlossen"
      : previewUsesUnsavedSettings
        ? "Regeln zuerst speichern"
        : "Monat speichern";

  useEffect(() => {
    if (!flowModel.detailItems[selectedFlowId]) {
      setSelectedFlowId("overview");
    }
  }, [flowModel.detailItems, selectedFlowId]);

  const handleSelectFlow = (id) => {
    setSelectedFlowId(id);
  };

  const handleSettingChange = (event) => {
    const { name, value } = event.target;
    setSettings((current) => ({ ...current, [name]: value }));
  };

  const handleSaveSettings = async () => {
    if (!apiBaseUrl) {
      setStatus({ state: "error", message: "API URL fehlt. Regeln sind nur lokale Vorschau." });
      return;
    }
    setStatus({ state: "loading", message: "Accounting-Regeln werden gespeichert..." });
    try {
      const response = await fetch(`${apiBaseUrl}/accounting/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeAccountingSettings(settings)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus({ state: "error", message: payload.error || "Accounting-Regeln konnten nicht gespeichert werden." });
        return;
      }
      setSettings(normalizeAccountingSettings(payload));
      setApiProjection(null);
      setPreviewRefreshKey((current) => current + 1);
      setStatus({ state: "success", message: "Accounting-Regeln gespeichert." });
    } catch (_error) {
      setStatus({ state: "error", message: "Netzwerkfehler beim Speichern der Accounting-Regeln." });
    }
  };

  const handleSaveMonthlyClose = async () => {
    if (!apiBaseUrl) {
      setStatus({ state: "error", message: "API URL fehlt. Monatsabschluss ist nur mit Backend möglich." });
      return;
    }
    if (isCurrentOpenPeriod) {
      setStatus({ state: "error", message: "Bitte einen einzelnen Monat wählen." });
      return;
    }
    if (existingClose) {
      setStatus({ state: "error", message: "Dieser Monat ist schon geschlossen. Korrekturen als neue Anpassung erfassen." });
      return;
    }
    if (previewUsesUnsavedSettings) {
      setStatus({ state: "error", message: "Regeln speichern, bevor der Monat geschlossen wird." });
      return;
    }
    setStatus({ state: "loading", message: "Monat wird gespeichert..." });
    try {
      const response = await fetch(`${apiBaseUrl}/accounting/monthly-closes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(closeRequestFromProjection(projection)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus({ state: "error", message: payload.error || "Monat konnte nicht gespeichert werden." });
        return;
      }
      const savedClose = normalizeMonthlyCloseFromApi(payload, { people });
      if (savedClose) {
        setMonthlyCloses((current) => sortMonthlyCloses([savedClose, ...current.filter((close) => close.period !== savedClose.period)]));
      }
      setStatus({ state: "success", message: `${period} gespeichert.` });
    } catch (_error) {
      setStatus({ state: "error", message: "Netzwerkfehler beim Speichern des Monats." });
    }
  };

  const periodControls = (
    <div className="flow-controls">
      <label className="field">
        <span>Period</span>
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
      <div className="form-actions flow-actions">
        <button className="cancel" type="button" onClick={handleSaveMonthlyClose} disabled={Boolean(isCurrentOpenPeriod || existingClose || previewUsesUnsavedSettings)}>
          {closeButtonLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="panel-grid accounting-flow-page">
      <SettlementNowCard projection={projection} model={flowModel} periodLabel={periodLabel} controls={periodControls} status={status} />

      <section className="card full-span accounting-story-card">
        <header>
          <p className="eyebrow">How to read this</p>
          <h2>The accounting story</h2>
        </header>
        <div className="story-grid">
          <article>
            <strong>1. Monthly base keeps the van alive.</strong>
            <p>Everyone contributes to predictable fixed costs and reserve.</p>
          </article>
          <article>
            <strong>2. Usage pays for actual use.</strong>
            <p>Kilometres fund vehicle wear and fuel. Nights split between vehicle and living/Ausbau.</p>
          </article>
          <article>
            <strong>3. Private payments are credited.</strong>
            <p>If someone pays for diesel or repairs personally, the shared pot owes them back.</p>
          </article>
          <article>
            <strong>4. Work is not cash.</strong>
            <p>Work reduces living/night charges first, but it does not create money in the bank account.</p>
          </article>
          <article>
            <strong>5. Historical investment is paused.</strong>
            <p>Old investments are shown for transparency but not automatically paid back this period.</p>
          </article>
        </div>
      </section>

      <AccountingSankey model={flowModel} selectedId={selectedFlowId} onSelect={handleSelectFlow} />
      <SankeyDetailPanel detail={selectedDetail} />
      <PersonAccountingCards model={flowModel} />
      <ForecastPanel settings={flowModel.settings} people={people} />

      <section className="card full-span table-card accounting-detail-card">
        <header>
          <p className="eyebrow">E. Rechenblatt / audit trail</p>
          <h2>How exactly was this calculated?</h2>
        </header>
        <div className="detail-tabs" role="tablist" aria-label="Accounting detail views">
          {[
            ["rechenblatt", "Rechenblatt"],
            ["formeln", "Formeln"],
          ].map(([id, label]) => (
            <button key={id} type="button" className={`detail-tab ${activeDetailTab === id ? "active" : ""}`} onClick={() => setActiveDetailTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {activeDetailTab === "rechenblatt" && <Rechenblatt model={flowModel} />}
        {activeDetailTab === "formeln" && <Formeln model={flowModel} />}
      </section>

      <section className="card full-span settings-card">
        <header>
          <p className="eyebrow">F. Settings / assumptions</p>
          <h2>Accounting rules</h2>
          <p className="subtitle">These are the real rates used by the current projection.</p>
        </header>
        <details className="rules-panel">
          <summary>Regeln</summary>
          <div className="inline-grid four-col compact-settings">
            <label className="field">
              <span>Km-Rate</span>
              <input name="km_rate_chf" type="number" step="0.01" value={settings.km_rate_chf} onChange={handleSettingChange} />
            </label>
            <label className="field">
              <span>Nacht-Rate</span>
              <input name="night_rate_chf" type="number" step="0.01" value={settings.night_rate_chf} onChange={handleSettingChange} />
            </label>
            <label className="field">
              <span>Arbeitstag</span>
              <input name="workday_rate_chf" type="number" step="0.01" value={settings.workday_rate_chf} onChange={handleSettingChange} />
            </label>
            <label className="field">
              <span>Monatszahlung</span>
              <input name="monthly_payment_chf" type="number" step="0.01" value={settings.monthly_payment_chf} onChange={handleSettingChange} />
            </label>
            <label className="field">
              <span>Reserve-Ziel</span>
              <input name="reserve_target_chf" type="number" step="0.01" value={settings.reserve_target_chf} onChange={handleSettingChange} />
            </label>
            <label className="field">
              <span>Ueberschuss Reserve (%)</span>
              <input name="surplus_reserve_percent" type="number" step="1" value={settings.surplus_reserve_percent} onChange={handleSettingChange} />
            </label>
            <label className="field">
              <span>Ueberschuss Historisch (%)</span>
              <input
                name="surplus_historical_repayment_percent"
                type="number"
                step="1"
                value={settings.surplus_historical_repayment_percent}
                onChange={handleSettingChange}
              />
            </label>
            <div className="toggle-field">
              <button className="submit" type="button" onClick={handleSaveSettings}>
                Regeln speichern
              </button>
            </div>
          </div>
          {previewUsesUnsavedSettings && <p className="subtitle">Local preview with unsaved rules.</p>}
          {existingClose && <p className="subtitle">Saved close for {period}: {formatClosedSourceCounts(existingClose.entryCounts)}.</p>}
        </details>
      </section>

      <AuditDetails projection={projection} monthlyCloses={monthlyCloses} />
    </div>
  );
}

const flowModelKey = (projection = {}) =>
  JSON.stringify({
    period: projection.period,
    sharedPot: projection.sharedPot,
    currentPots: projection.currentPots,
    personBalances: projection.personBalances,
    usageByPerson: projection.usageByPerson,
    workOffsetsByPerson: projection.workOffsetsByPerson,
  });
