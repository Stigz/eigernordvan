import { useEffect, useMemo, useState } from "react";
import { buildSimpleAccounting } from "./simpleAccounting";

const settingsStorageKey = "van-simple-accounting-settings-v1";
const defaultSettings = { kmRateCHF: "0.50", reserveTargetCHF: "1000" };

const loadSettings = () => {
  if (typeof window === "undefined") {
    return defaultSettings;
  }
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(settingsStorageKey) || "{}") };
  } catch (_error) {
    return defaultSettings;
  }
};

const chf = (value) => `CHF ${Number(value || 0).toFixed(2)}`;

const SettlementAction = ({ balance }) => {
  if (balance < -0.005) {
    return <strong className="simple-settlement-pay">Pay {chf(Math.abs(balance))}</strong>;
  }
  if (balance > 0.005) {
    return <strong className="simple-settlement-receive">Receive {chf(balance)}</strong>;
  }
  return <strong className="simple-settlement-even">Settled</strong>;
};

export default function SimpleAccountingPanel({ trips = [], fuelEntries = [], costEntries = [], people = [] }) {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  }, [settings]);

  const accounting = useMemo(
    () =>
      buildSimpleAccounting({
        people,
        trips,
        fuelEntries,
        costEntries,
        kmRateCHF: settings.kmRateCHF,
        reserveTargetCHF: settings.reserveTargetCHF,
      }),
    [people, trips, fuelEntries, costEntries, settings],
  );

  const reserveCovered = accounting.reserveTargetDifferenceCHF >= 0;

  return (
    <section className="card simple-ledger-accounting">
      <header>
        <p className="eyebrow">One shared pot</p>
        <h1>Simple accounting</h1>
        <p className="subtitle">
          Kilometres create the charges. Diesel and other costs credit the person who paid. Vermietung kilometres are excluded.
        </p>
      </header>

      <div className="inline-grid two-col simple-accounting-settings">
        <label className="field">
          <span>Charge per km (CHF)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={settings.kmRateCHF}
            onChange={(event) => setSettings((current) => ({ ...current, kmRateCHF: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>Reserve wanted for coming costs (CHF)</span>
          <input
            type="number"
            min="0"
            step="50"
            value={settings.reserveTargetCHF}
            onChange={(event) => setSettings((current) => ({ ...current, reserveTargetCHF: event.target.value }))}
          />
        </label>
      </div>

      <div className={`status ${reserveCovered ? "success" : "fuel-warning-status"}`}>
        {reserveCovered ? (
          <>
            After everyone settles, the pot keeps <strong>{chf(accounting.reserveAfterSettlementCHF)}</strong>. That covers the
            reserve target by {chf(accounting.reserveTargetDifferenceCHF)}.
          </>
        ) : (
          <>
            After everyone settles, the pot keeps <strong>{chf(accounting.reserveAfterSettlementCHF)}</strong>—
            {chf(Math.abs(accounting.reserveTargetDifferenceCHF))} below the reserve target. A rate of about
            {" "}<strong>{chf(accounting.recommendedRateCHF)}/km</strong> would reach it.
          </>
        )}
      </div>

      <div className="summary-grid compact-summary-grid simple-accounting-totals">
        <article className="summary-card compact-summary-card">
          <p className="summary-label">Chargeable kilometres</p>
          <p className="summary-value">{accounting.kmTotals.billableKm.toFixed(1)} km</p>
          <p className="summary-hint">Vermietung excluded: {accounting.kmTotals.excludedKm.toFixed(1)} km</p>
        </article>
        <article className="summary-card compact-summary-card">
          <p className="summary-label">KM charges</p>
          <p className="summary-value">{chf(accounting.kmChargesCHF)}</p>
          <p className="summary-hint">Money collected for costs and reserve</p>
        </article>
        <article className="summary-card compact-summary-card">
          <p className="summary-label">Diesel spent</p>
          <p className="summary-value">{chf(accounting.dieselCostsCHF)}</p>
          <p className="summary-hint">{accounting.dieselTotals.totalLiters.toFixed(2)} liters recorded</p>
        </article>
        <article className="summary-card compact-summary-card">
          <p className="summary-label">Other costs</p>
          <p className="summary-value">{chf(accounting.otherCostsCHF)}</p>
          <p className="summary-hint">Current non-historical expenses</p>
        </article>
        <article className="summary-card compact-summary-card">
          <p className="summary-label">Van income</p>
          <p className="summary-value">{chf(accounting.incomeCHF)}</p>
          <p className="summary-hint">Reduces what the owners must fund</p>
        </article>
        <article className="summary-card compact-summary-card reserve-card">
          <p className="summary-label">Reserve after settlement</p>
          <p className="summary-value">{chf(accounting.reserveAfterSettlementCHF)}</p>
          <p className="summary-hint">After all recorded costs and income</p>
        </article>
      </div>

      <section className="simple-accounting-section">
        <header>
          <h2>Who pays what now?</h2>
          <p className="subtitle">Direct payments are credited. Van income held personally is added to that person’s payment due.</p>
        </header>
        <div className="simple-settlement-grid">
          {accounting.people.map((person) => (
            <article className="simple-settlement-card" key={person.person}>
              <header>
                <h3>{person.person}</h3>
                <SettlementAction balance={person.balanceCHF} />
              </header>
              <dl>
                <div><dt>Used</dt><dd>{person.km.toFixed(1)} km</dd></div>
                <div><dt>KM charge</dt><dd>{chf(person.usageChargeCHF)}</dd></div>
                <div>
                  <dt>{person.givenCHF < 0 ? "Pot money held" : "Given already"}</dt>
                  <dd>{chf(Math.abs(person.givenCHF))}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="simple-accounting-section">
        <header>
          <h2>Who used the van most?</h2>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Person</th><th>KM</th><th>Share</th><th>KM charge</th></tr>
            </thead>
            <tbody>
              {accounting.usageRanking.map((person) => (
                <tr key={person.person}>
                  <td>{person.person}</td>
                  <td>{person.km.toFixed(1)}</td>
                  <td>{person.usageSharePercent.toFixed(1)}%</td>
                  <td>{chf(person.usageChargeCHF)}</td>
                </tr>
              ))}
              <tr className="simple-excluded-row">
                <td>Vermietung</td>
                <td>{accounting.kmTotals.excludedKm.toFixed(1)}</td>
                <td>Excluded</td>
                <td>CHF 0.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <details className="calculation-details simple-accounting-details">
        <summary>Show who paid which costs</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th><th>Diesel</th><th>Other costs</th><th>Pot payments</th><th>Income held</th><th>Net given</th>
              </tr>
            </thead>
            <tbody>
              {accounting.people.map((person) => (
                <tr key={person.person}>
                  <td>{person.person}</td>
                  <td>{chf(person.dieselPaidCHF)}</td>
                  <td>{chf(person.otherPaidCHF)}</td>
                  <td>{chf(person.paidToPotCHF)}</td>
                  <td>{chf(person.incomeHeldCHF)}</td>
                  <td><strong>{chf(person.givenCHF)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
