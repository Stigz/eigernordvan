import { useEffect, useMemo, useState } from "react";

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

const initialGasForm = {
  user_name: "",
  liters: "",
  cost_chf: "",
  odometer_km: "",
};

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

export default function App() {
  const [activeView, setActiveView] = useState("km");
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [trips, setTrips] = useState([]);
  const [profiles, setProfiles] = useState(() => parseProfiles());
  const [editId, setEditId] = useState("");
  const [tableState, setTableState] = useState({ state: "loading", message: "Loading entries..." });
  const [gasForm, setGasForm] = useState(initialGasForm);
  const [gasStatus, setGasStatus] = useState({ state: "idle", message: "" });
  const [gasEntries, setGasEntries] = useState(() => parseFuelEntries());

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

  const sortedGasEntries = useMemo(
    () => [...gasEntries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
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

  const summaryCards = useMemo(() => {
    const totalKm = trips.reduce((sum, trip) => sum + trip.delta_km, 0);
    const totalFuelLiters = gasEntries.reduce((sum, entry) => sum + entry.liters, 0);
    const totalFuelCost = gasEntries.reduce((sum, entry) => sum + entry.cost_chf, 0);
    const avgCostPerKm = totalKm > 0 ? totalFuelCost / totalKm : 0;
    const kmPerLiter = totalFuelLiters > 0 ? totalKm / totalFuelLiters : 0;

    return [
      { label: "Total KM", value: `${totalKm.toFixed(1)} km` },
      { label: "Fuel Spend", value: `CHF ${totalFuelCost.toFixed(2)}` },
      { label: "KM / Liter", value: kmPerLiter > 0 ? kmPerLiter.toFixed(2) : "—" },
      { label: "CHF / KM", value: totalKm > 0 ? avgCostPerKm.toFixed(3) : "—" },
    ];
  }, [trips, gasEntries]);

  const efficiencySeries = useMemo(() => {
    const byMonth = new Map();

    trips.forEach((trip) => {
      const monthKey = new Date(trip.timestamp).toISOString().slice(0, 7);
      const current = byMonth.get(monthKey) || { km: 0, liters: 0 };
      current.km += trip.delta_km;
      byMonth.set(monthKey, current);
    });

    gasEntries.forEach((entry) => {
      const monthKey = new Date(entry.timestamp).toISOString().slice(0, 7);
      const current = byMonth.get(monthKey) || { km: 0, liters: 0 };
      current.liters += entry.liters;
      byMonth.set(monthKey, current);
    });

    const values = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({
        month,
        efficiency: value.liters > 0 ? value.km / value.liters : 0,
      }))
      .filter((item) => item.efficiency > 0);

    const maxEfficiency = values.reduce((max, item) => Math.max(max, item.efficiency), 0);

    return values.map((item) => ({
      ...item,
      width: maxEfficiency > 0 ? Math.max(8, (item.efficiency / maxEfficiency) * 100) : 0,
    }));
  }, [trips, gasEntries]);

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

  useEffect(() => {
    if (!editId && latestEndKm !== null) {
      setForm((prev) => ({ ...prev, start_km: String(latestEndKm.toFixed(1)) }));
    }
  }, [latestEndKm, editId]);

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
  }, [gasEntries]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleGasChange = (event) => {
    const { name, value } = event.target;
    setGasForm((prev) => ({ ...prev, [name]: value }));
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

      const response = await fetch(targetUrl, {
        method: isEditing ? "PUT" : "POST",
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

      upsertProfile(form.user_name);
      setStatus({
        state: "success",
        message: `Saved. Distance: ${payload.delta_km.toFixed(1)} km · Cost: CHF ${payload.trip_cost_chf.toFixed(2)}`,
      });
      setEditId("");
      setForm((prev) => ({ ...initialForm, user_name: prev.user_name }));
      await loadTrips();
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
    setGasEntries((prev) => prev.filter((entry) => entry.id !== entryId));
    setGasStatus({ state: "success", message: "Fuel entry deleted." });
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
              { id: "insights", label: "Insights" },
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
                      {tableTrips.length === 0 ? (
                        <tr>
                          <td colSpan="8" className="empty-cell">
                            {tableState.state === "loading" ? "Loading..." : "No entries yet."}
                          </td>
                        </tr>
                      ) : (
                        tableTrips.map((trip) => (
                          <tr key={trip.id}>
                            <td>{new Date(trip.timestamp).toLocaleString()}</td>
                            <td>{trip.user_name}</td>
                            <td>{trip.start_km.toFixed(1)}</td>
                            <td>{trip.end_km.toFixed(1)}</td>
                            <td>{trip.delta_km.toFixed(1)}</td>
                            <td>{trip.trip_cost_chf.toFixed(2)}</td>
                            <td>
                              {conflictMap.get(trip.id)?.length ? (
                                <ul className="conflict-list">
                                  {conflictMap.get(trip.id).map((conflict) => (
                                    <li key={conflict}>{conflict}</li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="conflict-ok">OK</span>
                              )}
                            </td>
                            <td>
                              <div className="row-actions">
                                <button type="button" className="table-btn" onClick={() => handleEdit(trip)}>
                                  Edit
                                </button>
                                <button type="button" className="table-btn danger" onClick={() => handleDelete(trip)}>
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
                          No fuel entries yet.
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
            </section>
          </div>
        )}

        {activeView === "insights" && (
          <section className="card insights-panel">
            <header>
              <p className="eyebrow">Insights</p>
              <h2>Efficiency overview</h2>
              <p className="subtitle">Monthly km/l trend based on trip distance and gas logs.</p>
            </header>

            <div className="summary-grid">
              {summaryCards.map((card) => (
                <article key={card.label} className="summary-card">
                  <p className="summary-label">{card.label}</p>
                  <p className="summary-value">{card.value}</p>
                </article>
              ))}
            </div>

            <div className="chart-list" role="img" aria-label="Bar chart of monthly efficiency in kilometers per liter">
              {efficiencySeries.length === 0 ? (
                <p className="subtitle">Add km and gas records to see the efficiency chart.</p>
              ) : (
                efficiencySeries.map((item) => (
                  <div key={item.month} className="chart-row">
                    <span className="chart-month">{item.month}</span>
                    <div className="chart-track">
                      <div className="chart-bar" style={{ width: `${item.width}%` }} />
                    </div>
                    <span className="chart-value">{item.efficiency.toFixed(2)} km/l</span>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
