import { describe, expect, it } from "vitest";
import { buildBackupExcelFile } from "./backupExcel";

describe("buildBackupExcelFile", () => {
  it("creates an Excel workbook with metadata and one sheet per raw table", async () => {
    const { blob, fileName } = buildBackupExcelFile({
      schema_version: "2026-04-23",
      generated_at: "2026-05-13T12:00:00Z",
      tables: {
        ledger_events: { table_name: "ledger-prod", items: [{ id: "trip-1", delta_km: 12.5 }] },
        bookings: { table_name: "booking-prod", items: [{ id: "booking-1", guest_name: "Alex & Kayla" }] },
      },
    });

    const xml = await blob.text();

    expect(fileName).toBe("van-backup-2026-05-13T12-00-00Z.xls");
    expect(xml).toContain('Worksheet ss:Name="backup_meta"');
    expect(xml).toContain('Worksheet ss:Name="bookings"');
    expect(xml).toContain('Worksheet ss:Name="ledger_events"');
    expect(xml).toContain("Alex &amp; Kayla");
  });

  it("falls back to domain sheets if a legacy backup response has no raw tables", async () => {
    const { blob } = buildBackupExcelFile({
      generated_at: "2026-05-13T12:00:00Z",
      trips: [{ id: "trip-1" }],
      fuel: [{ id: "fuel-1" }],
      bookings: [],
      work: { entries: [{ person: "Nic" }] },
      costs: { entries: [{ id: "cost-1" }] },
    });

    const xml = await blob.text();

    expect(xml).toContain('Worksheet ss:Name="trips"');
    expect(xml).toContain('Worksheet ss:Name="fuel"');
    expect(xml).toContain('Worksheet ss:Name="bookings"');
    expect(xml).toContain('Worksheet ss:Name="work"');
    expect(xml).toContain('Worksheet ss:Name="costs"');
  });

  it("keeps generated sheet names valid and unique", async () => {
    const { blob } = buildBackupExcelFile({
      generated_at: "2026-05-13T12:00:00Z",
      tables: {
        "name/with?invalid*characters": { items: [{ id: "a" }] },
        "name:with[invalid]characters": { items: [{ id: "b" }] },
      },
    });

    const xml = await blob.text();

    expect(xml).toContain('Worksheet ss:Name="name with invalid characters"');
    expect(xml).toContain('Worksheet ss:Name="name with invalid characters 2"');
  });
});
