import { describe, expect, it } from "vitest";
import {
  buildFuelEfficiencyIntervals,
  findNeighboringKnownFills,
  fuelDataGapFallsBetweenFills,
  fuelEfficiencyStatus,
  isSuspiciousFuelEfficiency,
  missedMarkerFallsBetweenFills,
} from "./fuelTracking";

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

describe("fuelEfficiencyStatus", () => {
  it("marks recorded fills as eligible for efficiency calculations", () => {
    expect(fuelEfficiencyStatus(currentFill)).toBe("Eligible for km/L");
  });

  it("shows that a known missed fill skips the affected interval", () => {
    expect(fuelEfficiencyStatus({ missed: true, odometer_km: 1250 })).toBe("Calculation skipped");
  });

  it("also flags when the missed fill has no kilometer reading", () => {
    expect(fuelEfficiencyStatus({ missed: true, odometer_km: null })).toBe("No odometer · calculation skipped");
  });

  it("keeps partial fills out of standalone intervals", () => {
    expect(fuelEfficiencyStatus({ partial: true, odometer_km: 1250 })).toBe("Partial fill · carried forward");
  });

  it("explains that efficiency is unavailable when a recorded fill has no odometer", () => {
    expect(fuelEfficiencyStatus({ missed: false, partial: false, odometer_km: null })).toBe(
      "No odometer · calculation skipped",
    );
  });
});

describe("buildFuelEfficiencyIntervals", () => {
  const trips = [{ id: "trip", timestamp: "2026-07-02T10:00:00Z", start_km: 1000, end_km: 2000 }];

  it("carries partial-fill liters and cost into the next full fill", () => {
    const intervals = buildFuelEfficiencyIntervals(
      [
        { id: "full-1", timestamp: "2026-07-01T10:00:00Z", odometer_km: 1000, liters: 40, cost_chf: 80 },
        { id: "partial", timestamp: "2026-07-05T10:00:00Z", odometer_km: 1200, liters: 20, cost_chf: 40, partial: true },
        { id: "full-2", timestamp: "2026-07-10T10:00:00Z", odometer_km: 1500, liters: 30, cost_chf: 60 },
      ],
      trips,
    );

    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({
      id: "full-2",
      interval_distance_km: 500,
      liters: 50,
      cost_chf: 100,
      liters_per_100km: 10,
      partial_fill_count: 1,
      suspicious: false,
    });
  });

  it("marks intervals below 10 L/100 km as suspicious", () => {
    const [interval] = buildFuelEfficiencyIntervals(
      [
        { id: "full-1", timestamp: "2026-07-01T10:00:00Z", odometer_km: 1000, liters: 40, cost_chf: 80 },
        { id: "full-2", timestamp: "2026-07-10T10:00:00Z", odometer_km: 1800, liters: 60, cost_chf: 120 },
      ],
      trips,
    );

    expect(interval.liters_per_100km).toBe(7.5);
    expect(interval.suspicious).toBe(true);
    expect(isSuspiciousFuelEfficiency(interval)).toBe(true);
  });

  it("still skips an interval containing a completely missed full fill", () => {
    const intervals = buildFuelEfficiencyIntervals(
      [
        { id: "full-1", timestamp: "2026-07-01T10:00:00Z", odometer_km: 1000, liters: 40, cost_chf: 80 },
        { id: "missed", timestamp: "2026-07-05T10:00:00Z", odometer_km: 1300, missed: true, liters: 0, cost_chf: 0 },
        { id: "full-2", timestamp: "2026-07-10T10:00:00Z", odometer_km: 1800, liters: 60, cost_chf: 120 },
      ],
      trips,
    );

    expect(intervals).toEqual([]);
  });

  it("skips an interval when a saved receipt between full fills has no odometer", () => {
    const noOdometerFill = {
      id: "no-odometer",
      timestamp: "2026-07-05T10:00:00Z",
      odometer_km: null,
      liters: 30,
      cost_chf: 60,
    };
    expect(fuelDataGapFallsBetweenFills(noOdometerFill, previousFill, currentFill)).toBe(true);

    const intervals = buildFuelEfficiencyIntervals(
      [
        { ...previousFill, liters: 40, cost_chf: 80 },
        noOdometerFill,
        { ...currentFill, liters: 60, cost_chf: 120 },
      ],
      trips,
    );

    expect(intervals).toEqual([]);
  });
});
