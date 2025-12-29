import { useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL;

const initialForm = {
  user_name: "",
  start_km: "",
  end_km: "",
};

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ state: "idle", message: "" });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ state: "loading", message: "Logging trip..." });

    try {
      const response = await fetch(`${apiUrl}/trip`, {
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
    } catch (error) {
      setStatus({ state: "error", message: "Network error. Please try again." });
    }
  };

  return (
    <div className="page">
      <main className="card">
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
      </main>
    </div>
  );
}
