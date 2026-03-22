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

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [trips, setTrips] = useState([]);
  const [profiles, setProfiles] = useState(() => parseProfiles());
  const [editId, setEditId] = useState("");
  const [tableState, setTableState] = useState({ state: "loading", message: "Loading entries..." });

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

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
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
    } catch (error) {
      setStatus({ state: "error", message: "Network error. Please try again." });
    }
  };

  const handleEdit = (trip) => {
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
      </main>
    </div>
  );
}
