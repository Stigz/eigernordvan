import { describe, expect, it } from "vitest";
import { buildKmModeOptions, namePresets } from "./quickIntakeFlow";

describe("buildKmModeOptions", () => {
  it("returns end + both when open drive exists", () => {
    expect(buildKmModeOptions(true).map((option) => option.id)).toEqual(["end", "both"]);
  });

  it("returns start + both when no open drive exists", () => {
    expect(buildKmModeOptions(false).map((option) => option.id)).toEqual(["start", "both"]);
  });
});

describe("namePresets", () => {
  it("uses fixed suggestions for KM and gas name entry", () => {
    expect(namePresets).toEqual(["Nic", "Luki", "Kayla", "Jeanne", "Vermietung"]);
  });
});
