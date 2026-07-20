import { describe, expect, it, vi } from "vitest";
import { convertToChf, eurToChfRateUrl, fetchEurToChfRate } from "./currency";

describe("convertToChf", () => {
  it("keeps CHF amounts unchanged and rounded to cents", () => {
    expect(convertToChf("80.129", "CHF", null)).toBe(80.13);
  });

  it("converts EUR amounts to CHF and rounds to cents", () => {
    expect(convertToChf("100", "EUR", 0.9228)).toBe(92.28);
  });

  it("requires a valid exchange rate for EUR", () => {
    expect(convertToChf("100", "EUR", null)).toBeNull();
  });
});

describe("fetchEurToChfRate", () => {
  it("loads the latest EUR to CHF rate", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ date: "2026-07-17", rates: { CHF: 0.9228 } }),
    });

    await expect(fetchEurToChfRate(fetchImpl)).resolves.toEqual({ rate: 0.9228, date: "2026-07-17" });
    expect(fetchImpl).toHaveBeenCalledWith(eurToChfRateUrl);
  });

  it("rejects invalid rate responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: {} }) });

    await expect(fetchEurToChfRate(fetchImpl)).rejects.toThrow("valid CHF rate");
  });
});
