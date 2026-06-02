import { useEffect, useMemo, useState } from "react";
import { buildBookingCalendarCells, calculateBookingPreview, formatDateISO, monthLabel, paymentLabel, toMonthStart } from "./bookingUtils";

const initialBookingForm = {
  start_date: "",
  end_date: "",
  status: "booked",
  guest_name: "",
  day_km: "",
  include_cleaning_fee: true,
  payment_status: "unpaid",
  paid_by: "",
  paid_to: "",
  notes: "",
};

const bookingFormFromRecord = (booking) => ({
  start_date: booking.start_date || "",
  end_date: booking.end_date || "",
  status: booking.status || "booked",
  guest_name: booking.guest_name || "",
  day_km: booking.day_km ? String(booking.day_km) : "",
  include_cleaning_fee: booking.cleaning_fee_included ?? Number(booking.cleaning_fee || 0) > 0,
  payment_status: booking.payment_status || "unpaid",
  paid_by: booking.paid_by || "",
  paid_to: booking.paid_to || "",
  notes: booking.notes || "",
});

const resetBookingFormAfterSave = (previous) => ({
  ...initialBookingForm,
  guest_name: previous.guest_name,
  paid_to: previous.paid_to,
});

export default function BookingPanel({ apiBaseUrl, canViewBookingDetails = false, people = [] }) {
  const [bookingForm, setBookingForm] = useState(initialBookingForm);
  const [bookingEditId, setBookingEditId] = useState("");
  const [bookingStatus, setBookingStatus] = useState({ state: "idle", message: "" });
  const [bookings, setBookings] = useState([]);
  const [bookingTableState, setBookingTableState] = useState({ state: "loading", message: "Loading bookings..." });
  const [bookingMonth, setBookingMonth] = useState(() => toMonthStart(new Date()));

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
    () => calculateBookingPreview(bookingForm.start_date, bookingForm.end_date, bookingForm.day_km, bookingForm.include_cleaning_fee),
    [bookingForm.start_date, bookingForm.end_date, bookingForm.day_km, bookingForm.include_cleaning_fee],
  );
  const calendarCells = useMemo(() => buildBookingCalendarCells(visibleBookingMonth, bookings), [visibleBookingMonth, bookings]);
  const paymentPeople = useMemo(() => [...new Set(people.filter(Boolean))], [people]);
  const isEditingBooking = Boolean(bookingEditId);
  const showPaymentPeople = bookingForm.payment_status !== "unpaid";

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
      const query = new URLSearchParams({ from, to, visibility: canViewBookingDetails ? "owner" : "availability" });
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
    loadBookings(bookingDateRange.from, bookingDateRange.to);
  }, [bookingDateRange.from, bookingDateRange.to, canViewBookingDetails]);

  const handleBookingChange = (event) => {
    const { name, type, checked, value } = event.target;
    setBookingForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
      ...(name === "payment_status" && value === "unpaid" ? { paid_by: "", paid_to: "" } : {}),
    }));
  };

  const handleCancelBookingEdit = () => {
    setBookingEditId("");
    setBookingForm(initialBookingForm);
    setBookingStatus({ state: "idle", message: "" });
  };

  const handleEditBooking = (booking) => {
    setBookingEditId(booking.id);
    setBookingForm(bookingFormFromRecord(booking));
    setBookingStatus({ state: "idle", message: "" });
  };

  const handleDeleteBooking = async (booking) => {
    if (!apiBaseUrl) {
      setBookingStatus({ state: "error", message: "Missing VITE_API_URL configuration. Set it to your API Gateway URL and rebuild." });
      return;
    }
    const label = booking.guest_name || `${booking.start_date} to ${booking.end_date}`;
    if (!window.confirm(`Delete booking for ${label}? This cannot be undone.`)) {
      return;
    }
    setBookingStatus({ state: "loading", message: "Deleting booking..." });

    try {
      const response = await fetch(`${apiBaseUrl}/bookings/${encodeURIComponent(booking.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        setBookingStatus({ state: "error", message: payload.error || "Could not delete booking." });
        return;
      }
      if (bookingEditId === booking.id) {
        setBookingEditId("");
        setBookingForm(initialBookingForm);
      }
      setBookingStatus({ state: "success", message: "Booking deleted." });
      await loadBookings(bookingDateRange.from, bookingDateRange.to);
    } catch (_error) {
      setBookingStatus({ state: "error", message: "Network error while deleting booking." });
    }
  };

  const handleBookingSubmit = async (event) => {
    event.preventDefault();
    setBookingStatus({ state: "loading", message: isEditingBooking ? "Saving booking changes..." : "Saving booking..." });

    try {
      if (!apiBaseUrl) {
        setBookingStatus({
          state: "error",
          message: "Missing VITE_API_URL configuration. Set it to your API Gateway URL and rebuild.",
        });
        return;
      }

      const response = await fetch(isEditingBooking ? `${apiBaseUrl}/bookings/${encodeURIComponent(bookingEditId)}` : `${apiBaseUrl}/bookings`, {
        method: isEditingBooking ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: bookingForm.start_date,
          end_date: bookingForm.end_date,
          status: bookingForm.status,
          guest_name: bookingForm.guest_name.trim() || undefined,
          day_km: Number(bookingForm.day_km || 0),
          cleaning_fee_included: bookingForm.include_cleaning_fee,
          cleaning_fee: bookingForm.include_cleaning_fee ? 100 : 0,
          payment_status: bookingForm.payment_status,
          paid_by: showPaymentPeople ? bookingForm.paid_by.trim() || undefined : undefined,
          paid_to: showPaymentPeople ? bookingForm.paid_to.trim() || undefined : undefined,
          notes: bookingForm.notes.trim() || undefined,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setBookingStatus({ state: "error", message: payload.error || `Could not ${isEditingBooking ? "update" : "create"} booking.` });
        return;
      }

      setBookingStatus({
        state: "success",
        message: `Saved ${payload.status} booking · ${payload.nights} nights · CHF ${payload.estimate_total.toFixed(2)}`,
      });
      setBookingEditId("");
      setBookingForm((prev) => resetBookingFormAfterSave(prev));
      await loadBookings(bookingDateRange.from, bookingDateRange.to);
    } catch (_error) {
      setBookingStatus({ state: "error", message: "Network error while saving booking." });
    }
  };

  return (
    <div className="panel-grid">
      {canViewBookingDetails && (
        <section className="card">
          <header>
            <p className="eyebrow">Bookings</p>
            <h1>{isEditingBooking ? "Edit booking" : "Create booking"}</h1>
            <p className="subtitle">100/night + optional 100 cleaning + 0.50/km for daytime use.</p>
          </header>

          <form className="form" onSubmit={handleBookingSubmit}>
            <label className="field">
              <span>Check-in date</span>
              <input type="date" name="start_date" value={bookingForm.start_date} onChange={handleBookingChange} required />
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
              <input type="text" name="guest_name" value={bookingForm.guest_name} onChange={handleBookingChange} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Daytime kilometers</span>
              <input type="number" name="day_km" value={bookingForm.day_km} onChange={handleBookingChange} min="0" step="0.1" placeholder="0" />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" name="include_cleaning_fee" checked={bookingForm.include_cleaning_fee} onChange={handleBookingChange} />
              <span>Include CHF 100 cleaning fee</span>
            </label>
            <label className="field">
              <span>Payment status</span>
              <select name="payment_status" value={bookingForm.payment_status} onChange={handleBookingChange}>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partially paid</option>
                <option value="paid">Paid</option>
              </select>
            </label>
            {showPaymentPeople && (
              <>
                <label className="field">
                  <span>Paid by</span>
                  <input list="booking-people" type="text" name="paid_by" value={bookingForm.paid_by} onChange={handleBookingChange} placeholder="Guest or person" />
                </label>
                <label className="field">
                  <span>Paid to</span>
                  <input list="booking-people" type="text" name="paid_to" value={bookingForm.paid_to} onChange={handleBookingChange} placeholder="Owner/person" />
                </label>
                <datalist id="booking-people">
                  {paymentPeople.map((person) => (
                    <option key={person} value={person} />
                  ))}
                </datalist>
              </>
            )}
            <label className="field">
              <span>Notes</span>
              <input type="text" name="notes" value={bookingForm.notes} onChange={handleBookingChange} placeholder="Optional" />
            </label>
            <article className="summary-card">
              <p className="summary-label">Live estimate</p>
              <p className="summary-value">CHF {bookingPreview.total.toFixed(2)}</p>
              <p className="summary-hint">
                {bookingPreview.nights} nights · {bookingForm.include_cleaning_fee ? "CHF 100 cleaning" : "no cleaning fee"} · km fee
              </p>
            </article>
            <div className="form-actions">
              <button className="submit" type="submit" disabled={bookingStatus.state === "loading"}>
                {bookingStatus.state === "loading" ? "Saving..." : isEditingBooking ? "Save changes" : "Create booking"}
              </button>
              {isEditingBooking && (
                <button type="button" className="cancel" onClick={handleCancelBookingEdit}>
                  Cancel edit
                </button>
              )}
            </div>
          </form>
          {bookingStatus.state !== "idle" && <div className={`status ${bookingStatus.state}`}>{bookingStatus.message}</div>}
        </section>
      )}

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
              <div key={cell.iso} className={`day-cell ${cell.status} ${cell.isCurrentMonth ? "" : "outside"}`.trim()} role="gridcell" aria-label={`${cell.iso}: ${cell.status}`}>
                <span>{cell.day}</span>
              </div>
            ))}
          </div>
        )}

        {canViewBookingDetails && (
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
                  <th>Payment</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bookings.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="empty-cell">
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
                      <td>{Number(booking.estimate_total || 0).toFixed(2)}</td>
                      <td>{paymentLabel(booking)}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="table-btn" onClick={() => handleEditBooking(booking)}>
                            Edit
                          </button>
                          <button type="button" className="table-btn danger" onClick={() => handleDeleteBooking(booking)}>
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
  );
}
