import { describe, expect, it } from "vitest";
import { buildBookingCalendarCells, calculateBookingPreview, isInternalBooking, sharedOwnerNames } from "./bookingUtils";

describe("calculateBookingPreview", () => {
  it("can calculate zero-rate internal bookings while keeping the day count", () => {
    const preview = calculateBookingPreview("2026-07-10", "2026-07-13", 200, false, {
      nightlyRate: 0,
      cleaningFee: 0,
      kmRate: 0,
    });

    expect(preview).toEqual({ nights: 3, cleaningFee: 0, total: 0 });
  });
});

describe("isInternalBooking", () => {
  it("matches fixed Mitinhaber names only when stored as a zero-rate booking", () => {
    expect(sharedOwnerNames).toEqual(["Luki", "Nic", "Kayla", "Jeanne"]);
    expect(
      isInternalBooking({
        guest_name: "Luki",
        estimate_total: 0,
        nightly_rate: 0,
        cleaning_fee: 0,
        day_km: 0,
      }),
    ).toBe(true);
    expect(
      isInternalBooking({
        guest_name: "Luki",
        estimate_total: 100,
        nightly_rate: 100,
        cleaning_fee: 0,
        day_km: 0,
      }),
    ).toBe(false);
  });
});

describe("buildBookingCalendarCells", () => {
  it("marks the selected from/to range", () => {
    const cells = buildBookingCalendarCells(new Date("2026-07-01T00:00:00"), [], {
      start_date: "2026-07-10",
      end_date: "2026-07-13",
    });
    const selectedDays = cells.filter((cell) => cell.isSelected).map((cell) => cell.iso);

    expect(selectedDays).toEqual(["2026-07-10", "2026-07-11", "2026-07-12"]);
    expect(cells.find((cell) => cell.iso === "2026-07-10").isSelectionStart).toBe(true);
    expect(cells.find((cell) => cell.iso === "2026-07-12").isSelectionEnd).toBe(true);
  });
});
