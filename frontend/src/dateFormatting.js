const swissDateTimeFormatter = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Zurich",
});

const swissTimestampDateFormatter = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Zurich",
});

const swissMonthFormatter = new Intl.DateTimeFormat("de-CH", {
  month: "long",
  year: "numeric",
});

export const formatDateISO = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const formatSwissDate = (value, fallback = "—") => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) {
    return fallback;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return fallback;
  }

  return `${day}.${month}.${year}`;
};

export const formatSwissDateTime = (value, fallback = "—") => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : swissDateTimeFormatter.format(parsed);
};

export const formatSwissTimestampDate = (value, fallback = "—") => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : swissTimestampDateFormatter.format(parsed);
};

export const formatSwissMonth = (date) =>
  date instanceof Date && !Number.isNaN(date.getTime()) ? swissMonthFormatter.format(date) : "—";
