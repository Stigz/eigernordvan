import { useEffect, useMemo, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL;

const initialForm = {
  user_name: "",
  start_km: "",
  end_km: "",
};

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [trips, setTrips] = useState([]);
  const [tableState, setTableState] = useState({ state: "loading", message: "Loading entries..." });

  const apiBaseUrl = useMemo(() => {
    if (!apiUrl) {
      return "";
    }
    return apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
  }, []);

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

  useEffect(() => {
    loadTrips();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
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

      const response = await fetch(`${apiBaseUrl}/trip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_name: form.user_name.trim(),
          start_km: Number(form.start_km),
          end_km: Number(form.end_km),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setStatus({ state: "error", message: payload.error || "Something went wrong." });
        return;
      }

      setStatus({
        state: "success",
        message: `Trip logged. Distance: ${payload.delta_km.toFixed(1)} km · Cost: CHF ${payload.trip_cost_chf.toFixed(2)}`,
      });
      setForm(initialForm);
      await loadTrips();
    } catch (error) {
      setStatus({ state: "error", message: "Network error. Please try again." });
    }
  };

  return (
    <div className="page">
      <main className="layout">
        <section className="card">
          <header>
            <p className="eyebrow">Van usage</p>
            <h1>Log Trip</h1>
            <p className="subtitle">
              Simple logging keeps the habit strong. No photos, no logins, just trust.
            </p>
          </header>

          <form className="form" onSubmit={handleSubmit}>
            <label className="field">
              <span>User name</span>
              <input
                type="text"
                name="user_name"
                placeholder="e.g. Alex"
                value={form.user_name}
                onChange={handleChange}
                required
              />
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
                required
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
                required
              />
            </label>

            <button className="submit" type="submit" disabled={status.state === "loading"}>
              {status.state === "loading" ? "Saving..." : "Submit"}
            </button>
          </form>

          {status.state !== "idle" && (
            <div className={`status ${status.state}`}>{status.message}</div>
          )}

          <footer className="footer">
            <p>
              Future additions like OCR or fuel costs will attach as new ledger events, keeping
              history intact.
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
                  </tr>
                </thead>
                <tbody>
                  {trips.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="empty-cell">
                        {tableState.state === "loading" ? "Loading..." : "No entries yet."}
                      </td>
                    </tr>
                  ) : (
                    trips.map((trip) => (
                      <tr key={trip.id}>
                        <td>{new Date(trip.timestamp).toLocaleString()}</td>
                        <td>{trip.user_name}</td>
                        <td>{trip.start_km.toFixed(1)}</td>
                        <td>{trip.end_km.toFixed(1)}</td>
                        <td>{trip.delta_km.toFixed(1)}</td>
                        <td>{trip.trip_cost_chf.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
