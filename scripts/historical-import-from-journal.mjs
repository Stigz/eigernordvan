#!/usr/bin/env node

import fs from "node:fs/promises";

const EXPECTED = {
  rows: 216,
  sourceTotalChf: 35833.69,
  sollHabenChf: 76127.69,
  account1520SaldoChf: 0,
  account6900SaldoChf: 0,
};

function usage() {
  console.error(`Usage:
  node scripts/historical-import-from-journal.mjs --input <journal.csv|journal.json> [--api <api_base_url>] [--batch historical-sheet] [--output payload.json] [--write] [--allow-mismatch]

Defaults:
  - dry-run mode is used unless --write is passed
  - with --api, the script POSTs to /accounting/import/historical
  - without --api, it only builds and checks the local payload

Input:
  - CSV exported from the Journal tab, with the first row as headers
  - JSON as either an array of objects, or Google Sheets values as array-of-arrays`);
}

function parseArgs(argv) {
  const args = {
    batch: "historical-sheet",
    dryRun: true,
    allowMismatch: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--input") {
      args.input = argv[++index];
    } else if (arg === "--api") {
      args.api = argv[++index];
    } else if (arg === "--batch") {
      args.batch = argv[++index];
    } else if (arg === "--output") {
      args.output = argv[++index];
    } else if (arg === "--write") {
      args.dryRun = false;
    } else if (arg === "--allow-mismatch") {
      args.allowMismatch = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((currentRow) => currentRow.some((value) => String(value).trim() !== ""));
}

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return [];
  }
  const headers = rows[0].map((header) => String(header).trim());
  return rows.slice(1).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index] ?? "";
    });
    return object;
  });
}

async function readInput(path) {
  const text = await fs.readFile(path, "utf8");
  if (path.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
      return rowsToObjects(parsed);
    }
    if (Array.isArray(parsed?.values)) {
      return rowsToObjects(parsed.values);
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
    throw new Error("JSON input must be an array of rows, an array of objects, or a Google values response");
  }
  return rowsToObjects(parseCsv(text));
}

function parseMoney(value) {
  if (typeof value === "number") {
    return value;
  }
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\u2212/g, "-")
    .replace(/[^\d.,'-]/g, "")
    .replace(/'/g, "");

  if (cleaned === "" || cleaned === "-" || cleaned === ".") {
    return 0;
  }

  const normalized = cleaned.includes(".") && cleaned.includes(",")
    ? cleaned.replace(/,/g, "")
    : cleaned.replace(/,/g, ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    throw new Error(`Could not parse money value: ${value}`);
  }
  return number;
}

function clean(value) {
  return String(value ?? "").trim();
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function journalRowToEntry(row) {
  return {
    booking_id: clean(row.Buchung),
    person: clean(row.Person),
    description: clean(row.Beschreibung),
    note: clean(row.Bemerkung),
    category: clean(row.Kategorie),
    debit_account: clean(row["Konto Soll"]),
    debit_name: clean(row["Name Soll"]),
    credit_account: clean(row["Konto Haben"]),
    credit_name: clean(row["Name Haben"]),
    debit_chf: parseMoney(row["Soll CHF"]),
    credit_chf: parseMoney(row["Haben CHF"]),
    source_amount: parseMoney(row.Quellbetrag),
    source_ref: clean(row.Quelle),
    year: clean(row.Jahr),
  };
}

function addAccount(totals, account, field, amount) {
  if (!account) {
    return;
  }
  totals[account] ??= { debit_chf: 0, credit_chf: 0, saldo_chf: 0 };
  totals[account][field] = roundMoney(totals[account][field] + amount);
}

function summarize(entries) {
  const accountTotals = {};
  const personTotals = {};
  let sourceTotal = 0;
  let debitTotal = 0;
  let creditTotal = 0;

  for (const entry of entries) {
    sourceTotal += entry.source_amount;
    debitTotal += entry.debit_chf;
    creditTotal += entry.credit_chf;
    personTotals[entry.person] = roundMoney((personTotals[entry.person] ?? 0) + entry.source_amount);
    addAccount(accountTotals, entry.debit_account, "debit_chf", entry.debit_chf);
    addAccount(accountTotals, entry.credit_account, "credit_chf", entry.credit_chf);
  }

  for (const account of Object.keys(accountTotals)) {
    accountTotals[account].saldo_chf = roundMoney(accountTotals[account].debit_chf - accountTotals[account].credit_chf);
  }

  const reconciliation = {
    expected_rows: EXPECTED.rows,
    actual_rows: entries.length,
    expected_source_total_chf: EXPECTED.sourceTotalChf,
    actual_source_total_chf: roundMoney(sourceTotal),
    expected_soll_haben_chf: EXPECTED.sollHabenChf,
    actual_soll_chf: roundMoney(debitTotal),
    actual_haben_chf: roundMoney(creditTotal),
    account_1520_saldo_chf: roundMoney(accountTotals["1520"]?.saldo_chf ?? 0),
    account_6900_saldo_chf: roundMoney(accountTotals["6900"]?.saldo_chf ?? 0),
  };
  reconciliation.matches_expected =
    reconciliation.actual_rows === reconciliation.expected_rows &&
    reconciliation.actual_source_total_chf === reconciliation.expected_source_total_chf &&
    reconciliation.actual_soll_chf === reconciliation.expected_soll_haben_chf &&
    reconciliation.actual_haben_chf === reconciliation.expected_soll_haben_chf &&
    reconciliation.account_1520_saldo_chf === EXPECTED.account1520SaldoChf &&
    reconciliation.account_6900_saldo_chf === EXPECTED.account6900SaldoChf;

  return {
    accountTotals,
    personTotals,
    reconciliation,
  };
}

async function postImport(apiBaseUrl, payload) {
  const url = `${apiBaseUrl.replace(/\/$/, "")}/accounting/import/historical`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`Import request failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function printSummary(title, summary) {
  const reconciliation = summary.reconciliation;
  console.log(title);
  console.log(`  rows: ${reconciliation.actual_rows} / ${reconciliation.expected_rows}`);
  console.log(`  source total CHF: ${reconciliation.actual_source_total_chf.toFixed(2)} / ${reconciliation.expected_source_total_chf.toFixed(2)}`);
  console.log(`  soll CHF: ${reconciliation.actual_soll_chf.toFixed(2)} / ${reconciliation.expected_soll_haben_chf.toFixed(2)}`);
  console.log(`  haben CHF: ${reconciliation.actual_haben_chf.toFixed(2)} / ${reconciliation.expected_soll_haben_chf.toFixed(2)}`);
  console.log(`  1520 saldo CHF: ${reconciliation.account_1520_saldo_chf.toFixed(2)}`);
  console.log(`  6900 saldo CHF: ${reconciliation.account_6900_saldo_chf.toFixed(2)}`);
  console.log(`  matches expected: ${reconciliation.matches_expected ? "yes" : "no"}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.input) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const rows = await readInput(args.input);
  const entries = rows
    .map(journalRowToEntry)
    .filter((entry) => entry.booking_id !== "");

  const summary = summarize(entries);
  printSummary("Local journal check", summary);

  if (!summary.reconciliation.matches_expected && !args.allowMismatch) {
    throw new Error("Local reconciliation did not match expected Sheet totals. Pass --allow-mismatch only for investigation.");
  }

  const payload = {
    dry_run: args.dryRun,
    import_batch_id: args.batch,
    entries,
  };

  if (args.output) {
    await fs.writeFile(args.output, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Payload written to ${args.output}`);
  }

  if (args.api) {
    const response = await postImport(args.api, payload);
    printSummary(args.dryRun ? "API dry-run reconciliation" : "API import reconciliation", {
      reconciliation: response.reconciliation,
    });
    console.log(`  would import: ${response.would_import_count}`);
    console.log(`  imported: ${response.imported_count}`);
    console.log(`  skipped: ${response.skipped_count}`);
    console.log(`  duplicate source IDs: ${(response.duplicate_source_ids ?? []).length}`);
    if (!response.reconciliation.matches_expected && !args.allowMismatch) {
      throw new Error("API reconciliation did not match expected Sheet totals.");
    }
  }

  if (!args.api && !args.output) {
    console.log("No --api or --output supplied, so no data was sent or written.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
