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

const initialBookingForm = {
  start_date: "",
  end_date: "",
  status: "booked",
  guest_name: "",
  day_km: "",
  notes: "",
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
  const [gasTableState, setGasTableState] = useState({ state: "loading", message: "Loading fuel entries..." });
  const [bookingForm, setBookingForm] = useState(initialBookingForm);
  const [bookingStatus, setBookingStatus] = useState({ state: "idle", message: "" });
  const [bookings, setBookings] = useState([]);
  const [bookingTableState, setBookingTableState] = useState({ state: "loading", message: "Loading bookings..." });
  const [bookingMonth, setBookingMonth] = useState(() => toMonthStart(new Date()));

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
  }, []);

  useEffect(() => {
    loadBookings(bookingDateRange.from, bookingDateRange.to);
  }, [bookingDateRange.from, bookingDateRange.to]);

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
    setGasTableState({ state: "success", message: "" });
  }, [gasEntries]);

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
      </main>
    </div>
  );
}
