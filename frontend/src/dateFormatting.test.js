import { describe, expect, it } from "vitest";
import {
  formatDateISO,
  formatSwissDate,
  formatSwissDateTime,
  formatSwissMonth,
  formatSwissTimestampDate,
  formatZurichDateISO,
} from "./dateFormatting";

describe("formatDateISO", () => {
  it("uses local calendar components instead of shifting through UTC", () => {
    expect(formatDateISO(new Date(2026, 7, 1, 0, 0, 0))).toBe("2026-08-01");
  });
});

describe("Swiss date display", () => {
  it("formats date-only values as DD.MM.YYYY", () => {
    expect(formatSwissDate("2026-08-07")).toBe("07.08.2026");
  });

  it("rejects invalid date-only values", () => {
    expect(formatSwissDate("2026-02-30")).toBe("—");
    expect(formatSwissDate("")).toBe("—");
  });

  it("shows timestamps in Europe/Zurich", () => {
    expect(formatSwissDateTime("2026-08-17T14:30:00Z")).toBe("17.08.2026, 16:30");
    expect(formatSwissDateTime("2026-01-17T14:30:00Z")).toBe("17.01.2026, 15:30");
    expect(formatSwissTimestampDate("2026-08-17T22:30:00Z")).toBe("18.08.2026");
    expect(formatZurichDateISO("2026-08-17T22:30:00Z")).toBe("2026-08-18");
  });

  it("uses the Swiss locale for month labels", () => {
    expect(formatSwissMonth(new Date(2026, 7, 1))).toBe("August 2026");
  });
});
