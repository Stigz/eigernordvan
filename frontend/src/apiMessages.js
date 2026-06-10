export const messageFromApiPayload = (payload, fallback) => {
  const raw = typeof payload?.error === "string" ? payload.error : "";
  if (raw.includes("accounting period is closed")) {
    return "That accounting month is already closed. Add an adjustment in an open month instead.";
  }
  return raw || fallback;
};
