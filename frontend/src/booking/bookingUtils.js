export const bookingStatusPriority = {
  open: 0,
  blocked: 1,
  booked: 2,
};

export const formatDateISO = (date) => date.toISOString().slice(0, 10);

export const parseIsoDate = (value) => new Date(`${value}T00:00:00`);

export const monthLabel = (date) =>
  date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

export const toMonthStart = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

export const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const calculateBookingPreview = (startDate, endDate, dayKm, includeCleaningFee = true) => {
  if (!startDate || !endDate) {
    return { nights: 0, cleaningFee: includeCleaningFee ? 100 : 0, total: 0 };
  }
  const nights = Math.max(0, Math.round((parseIsoDate(endDate) - parseIsoDate(startDate)) / (1000 * 60 * 60 * 24)));
  const dayKmNumber = Number(dayKm);
  const sanitizedDayKm = Number.isFinite(dayKmNumber) && dayKmNumber > 0 ? dayKmNumber : 0;
  const cleaningFee = includeCleaningFee ? 100 : 0;
  const total = nights * 100 + cleaningFee + sanitizedDayKm * 0.5;
  return { nights, cleaningFee, total };
};

export const bookingOverlapsDay = (booking, dayIso) => booking.start_date <= dayIso && dayIso < booking.end_date;

export const buildBookingCalendarCells = (visibleBookingMonth, bookings) => {
  const monthStart = new Date(visibleBookingMonth.getFullYear(), visibleBookingMonth.getMonth(), 1);
  const calendarStart = addDays(monthStart, -monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(calendarStart, index);
    const iso = formatDateISO(date);
    const status = bookings.reduce((selectedStatus, booking) => {
      if (!bookingOverlapsDay(booking, iso)) {
        return selectedStatus;
      }
      const resolvedStatus = booking.status === "open_override" ? "open" : booking.status;
      if (bookingStatusPriority[resolvedStatus] > bookingStatusPriority[selectedStatus]) {
        return resolvedStatus;
      }
      return selectedStatus;
    }, "open");

    return {
      iso,
      date,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === monthStart.getMonth(),
      status,
    };
  });
};

export const paymentLabel = (booking) => {
  const status = booking.payment_status || "unpaid";
  if (status === "paid" && booking.paid_by && booking.paid_to) {
    return `Paid · ${booking.paid_by} → ${booking.paid_to}`;
  }
  if (status === "partial" && booking.paid_by && booking.paid_to) {
    return `Partial · ${booking.paid_by} → ${booking.paid_to}`;
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
};
