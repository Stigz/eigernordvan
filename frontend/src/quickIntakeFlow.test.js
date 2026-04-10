import { describe, expect, it } from "vitest";
import { buildKmModeOptions, collectRecentPeople } from "./quickIntakeFlow";

describe("buildKmModeOptions", () => {
  it("returns end + both when open drive exists", () => {
    expect(buildKmModeOptions(true).map((option) => option.id)).toEqual(["end", "both"]);
  });

  it("returns start + both when no open drive exists", () => {
    expect(buildKmModeOptions(false).map((option) => option.id)).toEqual(["start", "both"]);
  });
});

describe("collectRecentPeople", () => {
  it("merges and sorts by most recent activity", () => {
    const result = collectRecentPeople({
      profiles: ["Nic", "Kayla"],
      intakePeople: [{ name: "Lüku" }],
      trips: [{ user_name: "Jeanne", timestamp: "2026-04-09T10:00:00Z" }],
      gasEntries: [{ user_name: "Nic", timestamp: "2026-04-10T10:00:00Z" }],
    });

    expect(result.slice(0, 3)).toEqual(["Nic", "Jeanne", "Lüku"]);
  });
});
