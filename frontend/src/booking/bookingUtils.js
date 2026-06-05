export const sharedOwnerNames = ["Luki", "Nic", "Kayla", "Jeanne"];

export const bookingStatusPriority = {
  open: 0,
  blocked: 1,
  booked: 2,
};

export const formatDateISO = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

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

export const isInternalBooking = (booking) => {
  const ownerName = String(booking?.internal_owner || booking?.guest_name || "").trim();
  if (!sharedOwnerNames.includes(ownerName)) {
    return false;
  }

  const estimateTotal = Number(booking?.estimate_total ?? 0);
  const nightlyRate = Number(booking?.nightly_rate ?? 0);
  const cleaningFee = Number(booking?.cleaning_fee ?? 0);
  const dayKm = Number(booking?.day_km ?? 0);

  return estimateTotal === 0 && nightlyRate === 0 && cleaningFee === 0 && dayKm === 0;
};

export const calculateBookingPreview = (startDate, endDate, dayKm, includeCleaningFee = true, pricing = {}) => {
  const rawNightlyRate = Number(pricing.nightlyRate ?? 100);
  const rawCleaningFee = Number(pricing.cleaningFee ?? 100);
  const rawKmRate = Number(pricing.kmRate ?? 0.5);
  const nightlyRate = Number.isFinite(rawNightlyRate) && rawNightlyRate >= 0 ? rawNightlyRate : 100;
  const cleaningFeeAmount = Number.isFinite(rawCleaningFee) && rawCleaningFee >= 0 ? rawCleaningFee : 100;
  const kmRate = Number.isFinite(rawKmRate) && rawKmRate >= 0 ? rawKmRate : 0.5;

  if (!startDate || !endDate) {
    return { nights: 0, cleaningFee: includeCleaningFee ? cleaningFeeAmount : 0, total: 0 };
  }

  const nights = Math.max(0, Math.round((parseIsoDate(endDate) - parseIsoDate(startDate)) / (1000 * 60 * 60 * 24)));
  const dayKmNumber = Number(dayKm);
  const sanitizedDayKm = Number.isFinite(dayKmNumber) && dayKmNumber > 0 ? dayKmNumber : 0;
  const cleaningFee = includeCleaningFee ? cleaningFeeAmount : 0;
  const total = nights * nightlyRate + cleaningFee + sanitizedDayKm * kmRate;
  return { nights, cleaningFee, total };
};

export const bookingOverlapsDay = (booking, dayIso) => booking.start_date <= dayIso && dayIso < booking.end_date;

export const buildBookingCalendarCells = (visibleBookingMonth, bookings, selection = {}) => {
  const monthStart = new Date(visibleBookingMonth.getFullYear(), visibleBookingMonth.getMonth(), 1);
  const calendarStart = addDays(monthStart, -monthStart.getDay());
  const selectedStart = selection.start_date || "";
  const selectedEnd = selection.end_date || "";
  const lastSelectedNight = selectedEnd ? formatDateISO(addDays(parseIsoDate(selectedEnd), -1)) : "";

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
    const isSelected = selectedStart ? (selectedEnd ? selectedStart <= iso && iso < selectedEnd : iso === selectedStart) : false;

    return {
      iso,
      date,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === monthStart.getMonth(),
      status,
      isSelected,
      isSelectionStart: selectedStart === iso,
      isSelectionEnd: lastSelectedNight === iso,
    };
  });
};

export const paymentLabel = (booking) => {
  if (isInternalBooking(booking)) {
    return "Internal";
  }

  const status = booking.payment_status || "unpaid";
  if (status === "paid" && booking.paid_by && booking.paid_to) {
    return `Paid · ${booking.paid_by} → ${booking.paid_to}`;
  }
  if (status === "partial" && booking.paid_by && booking.paid_to) {
    return `Partial · ${booking.paid_by} → ${booking.paid_to}`;
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
};