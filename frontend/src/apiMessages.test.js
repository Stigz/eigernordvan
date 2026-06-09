import { describe, expect, it } from "vitest";
import { messageFromApiPayload } from "./apiMessages";

describe("messageFromApiPayload", () => {
  it("turns closed accounting period errors into a user-facing instruction", () => {
    expect(messageFromApiPayload({ error: "accounting period is closed: 2026-06" }, "Fallback")).toBe(
      "That accounting month is already closed. Add an adjustment in an open month instead.",
    );
  });

  it("keeps other backend errors visible", () => {
    expect(messageFromApiPayload({ error: "booking overlaps existing booking" }, "Fallback")).toBe("booking overlaps existing booking");
  });

  it("uses the fallback when the response has no error message", () => {
    expect(messageFromApiPayload({}, "Fallback")).toBe("Fallback");
    expect(messageFromApiPayload(null, "Fallback")).toBe("Fallback");
  });
});
