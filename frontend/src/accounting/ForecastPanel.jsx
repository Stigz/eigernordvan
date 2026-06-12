import { useEffect, useMemo, useState } from "react";

const storageKey = "van_accounting_forecast_v1";
const formatChf = (value) => `CHF ${Number(value || 0).toFixed(2)}`;

const defaultAssumptions = {
  fixedMonthlyInsuranceChf: 80,
  fixedMonthlyTaxFeesChf: 35,
  fixedMonthlyParkingChf: 0,
  maintenanceReserveMonthlyChf: 150,
  targetReserveMonthlyChf: 100,
  expectedExternalIncomeMonthlyChf: 0,
  expectedKmMonthly: 400,
  expectedNightsMonthly: 8,
  activePeople: 4,
};

const numberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const loadAssumptions = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return { ...defaultAssumptions, ...parsed };
  } catch (_error) {
    return defaultAssumptions;
  }
};

export default function ForecastPanel({ settings, people = [] }) {
  const [assumptions, setAssumptions] = useState(loadAssumptions);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(assumptions));
  }, [assumptions]);

  const forecast = useMemo(() => {
    const fixedNeed =
      numberOr(assumptions.fixedMonthlyInsuranceChf) +
      numberOr(assumptions.fixedMonthlyTaxFeesChf) +
      numberOr(assumptions.fixedMonthlyParkingChf) +
      numberOr(assumptions.maintenanceReserveMonthlyChf) +
      numberOr(assumptions.targetReserveMonthlyChf) -
      numberOr(assumptions.expectedExternalIncomeMonthlyChf);
    const activePeople = Math.max(1, numberOr(assumptions.activePeople, people.length || 1));
    const recommendedBase = fixedNeed / activePeople;
    const kmCharges = numberOr(assumptions.expectedKmMonthly) * numberOr(settings.km_rate_chf);
    const nightCharges = numberOr(assumptions.expectedNightsMonthly) * numberOr(settings.night_rate_chf);
    const minimum = Math.max(0, (fixedNeed - numberOr(assumptions.targetReserveMonthlyChf) - numberOr(assumptions.maintenanceReserveMonthlyChf) * 0.35) / activePeople);
    const balanced = Math.max(0, recommendedBase);
    const repairSafe = Math.max(0, (fixedNeed + numberOr(assumptions.maintenanceReserveMonthlyChf) * 0.5) / activePeople);
    return { fixedNeed, activePeople, recommendedBase, kmCharges, nightCharges, minimum, balanced, repairSafe };
  }, [assumptions, people.length, settings.km_rate_chf, settings.night_rate_chf]);

  const update = (event) => {
    const { name, value } = event.target;
    setAssumptions((current) => ({ ...current, [name]: value }));
  };

  return (
    <section className="card full-span forecast-panel">
      <header>
        <p className="eyebrow">D. Future forecast</p>
        <h2>What should we charge in the future?</h2>
        <p className="subtitle">These assumptions are local to your browser for now. Variable usage stays separate from the monthly base.</p>
      </header>

      <div className="forecast-hero">
        <article>
          <span>Recommended monthly base</span>
          <strong>{formatChf(forecast.recommendedBase)}/person</strong>
          <p>
            {formatChf(forecast.fixedNeed)} expected fixed monthly need / {forecast.activePeople} people.
          </p>
        </article>
        <article>
          <span>Variable usage estimate</span>
          <strong>{formatChf(forecast.kmCharges + forecast.nightCharges)}</strong>
          <p>
            {Number(assumptions.expectedKmMonthly || 0).toFixed(0)} km x {formatChf(settings.km_rate_chf)} plus{" "}
            {Number(assumptions.expectedNightsMonthly || 0).toFixed(0)} nights x {formatChf(settings.night_rate_chf)}.
          </p>
        </article>
      </div>

      <div className="forecast-scenarios">
        <article>
          <span>Minimum survival</span>
          <strong>{formatChf(forecast.minimum)}</strong>
          <p>Base only for predictable fixed costs.</p>
        </article>
        <article>
          <span>Balanced</span>
          <strong>{formatChf(forecast.balanced)}</strong>
          <p>Fixed costs plus moderate reserve.</p>
        </article>
        <article>
          <span>Repair-safe</span>
          <strong>{formatChf(forecast.repairSafe)}</strong>
          <p>Fixed costs plus stronger repair reserve.</p>
        </article>
      </div>

      <details className="forecast-assumptions">
        <summary>Forecast assumptions</summary>
        <div className="inline-grid four-col compact-settings">
          {[
            ["fixedMonthlyInsuranceChf", "Insurance / month"],
            ["fixedMonthlyTaxFeesChf", "Tax + fees / month"],
            ["fixedMonthlyParkingChf", "Parking / month"],
            ["maintenanceReserveMonthlyChf", "Maintenance reserve"],
            ["targetReserveMonthlyChf", "Target reserve"],
            ["expectedExternalIncomeMonthlyChf", "Expected income"],
            ["expectedKmMonthly", "Expected km"],
            ["expectedNightsMonthly", "Expected nights"],
            ["activePeople", "Active people"],
          ].map(([name, label]) => (
            <label className="field" key={name}>
              <span>{label}</span>
              <input name={name} type="number" step="1" value={assumptions[name]} onChange={update} />
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
