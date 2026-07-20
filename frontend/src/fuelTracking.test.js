import { describe, expect, it } from "vitest";
import { findNeighboringKnownFills, missedMarkerFallsBetweenFills } from "./fuelTracking";

const previousFill = { id: "previous", timestamp: "2026-07-01T10:00:00Z", odometer_km: 1000, missed: false };
const currentFill = { id: "current", timestamp: "2026-07-10T10:00:00Z", odometer_km: 1500, missed: false };

describe("missedMarkerFallsBetweenFills", () => {
  it("uses time to place a marker when its odometer is unknown", () => {
    const marker = { missed: true, timestamp: "2026-07-05T10:00:00Z", odometer_km: null };
    expect(missedMarkerFallsBetweenFills(marker, previousFill, currentFill)).toBe(true);
  });

  it("uses an optional odometer to place an older marker precisely", () => {
    const marker = { missed: true, timestamp: "2026-07-20T10:00:00Z", odometer_km: 1250 };
    expect(missedMarkerFallsBetweenFills(marker, previousFill, currentFill)).toBe(true);
  });

  it("does not invalidate an unrelated interval", () => {
    const marker = { missed: true, timestamp: "2026-07-20T10:00:00Z", odometer_km: null };
    expect(missedMarkerFallsBetweenFills(marker, previousFill, currentFill)).toBe(false);
  });
});

describe("findNeighboringKnownFills", () => {
  it("finds neighboring fills by time for a marker without kilometers", () => {
    const marker = { missed: true, timestamp: "2026-07-05T10:00:00Z", odometer_km: null };
    expect(findNeighboringKnownFills(marker, [currentFill, marker, previousFill])).toEqual({
      previous: previousFill,
      next: currentFill,
    });
  });
});
