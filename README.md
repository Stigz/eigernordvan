# Van Usage Logging MVP

## MVP intent
This repository contains a minimal vehicle usage logging system. It is designed for a low-traffic, high-trust environment where the goal is habit formation, not automation. The user manually logs odometer readings, and the backend calculates distance and cost.

## Append-only philosophy
The ledger is append-only. Every entry is a new event. **No updates or deletes.**
If a correction is needed in the future, the system should write a new event that references the original.

## Architecture
- **Frontend:** React + Vite single-page form (`frontend/`)
- **Backend:** Go AWS Lambda (`backend/`)
- **API:** API Gateway HTTP (`/trip`, `/trips`, `/bookings`, `/work`, `/costs`)
- **Storage:** DynamoDB tables for ledger, bookings, monthly work log, and costs (`id` primary key)
- **Infrastructure:** Terraform (`infra/`)

## Data model (MVP)
Each ledger entry stores:
- `id` (UUID)
- `timestamp` (RFC3339 UTC)
- `user_name`
- `start_km`
- `end_km`
- `delta_km`
- `trip_cost_chf`
- `event_type` = `trip_manual`

## Future extensions (documented only)
These are intentionally **not** implemented yet. They should attach as new ledger events or extra attributes without changing existing rows:
- Odometer photo + OCR
- Fuel cost logging
- Confidence flags
- Review states
- Admin dashboard

## Local development
### Frontend
```bash
cd frontend
npm install
npm run dev
```
Set `VITE_API_URL` to the API Gateway URL (see Terraform outputs).

### Backend (local build)
```bash
cd backend
go build -o dist/main
```

## Deployment (AWS)
The Makefile has targets that build and deploy with Terraform.

```bash
make deploy
```

This runs:
1. `go build` for the Lambda binary
2. `zip` packaging
3. `terraform init` and `terraform apply` in `infra/`
4. frontend build, S3 sync, and CloudFront invalidation

## API contract
`POST /trip`
```json
{
  "user_name": "Alex",
  "start_km": 12345,
  "end_km": 12410
}
```

Response includes calculated `delta_km` and `trip_cost_chf`.

`GET /trips`
```json
{
  "items": [
    {
      "id": "uuid",
      "timestamp": "2026-03-21T10:00:00Z",
      "user_name": "Alex",
      "start_km": 12345,
      "end_km": 12410,
      "delta_km": 65,
      "trip_cost_chf": 32.5,
      "event_type": "trip_manual"
    }
  ]
}
```

`PUT /trip/{id}` and `DELETE /trip/{id}` are also supported for correcting or removing existing entries.

`GET /work` and `PUT /work`
```json
{
  "entries": [
    {
      "id": "uuid",
      "person": "Nic",
      "month": "2026-05",
      "days": 1.5,
      "work_notes": "Insulated side walls and fixed wiring"
    }
  ]
}
```
This stores and retrieves the monthly Work log state from the dedicated work table. Days must be non-negative and use half-day increments.

`GET /costs` and `PUT /costs`
```json
{
  "entries": [
    {
      "id": "uuid",
      "date": "2026-04-08",
      "type": "expense",
      "amount_chf": 120.5,
      "description": "Insurance",
      "category": "insurance",
      "paid_by": "Nic",
      "participants": ["Nic", "Kayla"],
      "historical_only": false,
      "bucket": "shared_running",
      "funding_account": "personal",
      "allocation_basis": "equal",
      "affects_live_balance": true
    }
  ]
}
```
This stores and retrieves the Costs workspace state for shared expense, income, and settlement tracking from the dedicated costs table. On first read after the table split, legacy cost entries are copied from the old shared work table into the costs table.

`POST /costs`, `PUT /costs/{id}`, and `DELETE /costs/{id}` are also supported for per-entry create/update/delete operations.

For private accounting, use `shared_pot` as the virtual shared konto in settlement transfers. A monthly payment from Nic into the pot is recorded as `type: "transfer"`, `from_person: "Nic"`, `to_person: "shared_pot"`, `bucket: "settlement"`, and `allocation_basis: "none"`. A reimbursement from the pot to someone who paid a shared bill personally uses `from_person: "shared_pot"` and `to_person` as that person.

`GET /accounting/settings` and `PUT /accounting/settings`
```json
{
  "schema_version": "2026-06-05",
  "km_rate_chf": 0.5,
  "night_rate_chf": 50,
  "workday_rate_chf": 100,
  "monthly_payment_chf": 50,
  "reserve_target_chf": 2000,
  "surplus_reserve_percent": 70,
  "surplus_historical_repayment_percent": 30
}
```
`PUT /accounting/settings` merges supplied fields with the current settings, so omitted rates keep their previous/default values while explicit zero values are preserved.

`GET /accounting/preview?period=2026-06` returns a read-only monthly accounting projection calculated from stored costs, bookings, trips, work entries, and the current accounting settings. It includes the shared pot, usage and work by person, source entry counts, historical summary, balances, and suggested settlements. If `period` is omitted, the current UTC month is used. The dashboard uses this live preview when saved settings match; unsaved setting edits stay as a local preview until saved.

`POST /accounting/import/historical`
```json
{
  "dry_run": true,
  "import_batch_id": "historical-sheet",
  "entries": [
    {
      "booking_id": "B0001",
      "person": "Nic",
      "description": "Sprinter 4x4",
      "category": "Fahrzeug Anschaffung",
      "debit_account": "1400",
      "credit_account": "2001",
      "debit_chf": 8900,
      "credit_chf": 8900,
      "source_amount": 8900,
      "source_ref": "Quelle_Kosten!B3"
    }
  ]
}
```
Dry-run mode returns row counts, account totals, person totals, duplicates, and reconciliation against the historical sheet acceptance totals. A non-dry-run import writes deterministic historical cost IDs such as `historical-sheet:B0001` and skips existing IDs.

`GET /accounting/monthly-closes` and `POST /accounting/monthly-closes` store immutable monthly accounting snapshots. To close a month, post `{ "period": "2026-06" }`; the backend recalculates the live accounting preview from stored data and snapshots that result. The period must use `YYYY-MM`, and the stored close ID is the same value, so a month can only be closed once. The snapshot includes settings, totals, source entry counts, people-only balances, shared-pot settlement balances, and suggested settlements. The dashboard shows recent closed snapshots in a read-only table. After a month is closed, cost, trip, booking, and work mutations touching that period return `409`; bulk replacement requests may carry unchanged closed rows forward but cannot change or delete them. Corrections should be entered as new cost/settlement entries in an open month rather than overwriting closed history.

`GET /backup/export`
```json
{
  "schema_version": "2026-06-05",
  "generated_at": "2026-06-05T08:00:00Z",
  "tables": {
    "ledger_events": { "table_name": "...", "items": [] },
    "bookings": { "table_name": "...", "items": [] },
    "work": { "table_name": "...", "items": [] },
    "costs": { "table_name": "...", "items": [] }
  },
  "trips": [],
  "fuel": [],
  "bookings": [],
  "work": { "entries": [] },
  "costs": { "entries": [] },
  "accounting_entries": [],
  "accounting_settings": {},
  "accounting_monthly_closes": [],
  "historical_import_batches": []
}
```
This exports a portable full snapshot of all major data domains (km/trips, fuel/diesel, bookings, work, costs, normalized accounting entries, accounting settings, monthly closes, historical import batches) plus raw, paginated exports of every configured DynamoDB table for archival backup. The frontend download button turns those raw table exports and accounting recovery sections into an Excel workbook.

To create compressed artifacts locally:
```bash
./scripts/export-backup.sh "$API_BASE_URL" backups
```

Before deploying accounting changes or importing historical rows, run the preflight gate:
```bash
API_BASE_URL=https://your-api.execute-api.region.amazonaws.com make accounting-preflight
```
If you have exported the `Journal` tab locally, include it for a dry-run reconciliation:
```bash
JOURNAL_CSV=private/journal.local.csv API_BASE_URL=https://your-api.execute-api.region.amazonaws.com make accounting-preflight
```
The preflight command runs backend/frontend checks, exports a live backup, and only dry-runs historical import data. Keep local backup and Journal files out of Git.

If you do not want to run this locally, use the manual GitHub Actions workflow:

1. Open GitHub Actions.
2. Run **Accounting Preflight**.
3. Leave the API override empty to use Terraform output, or paste the API base URL.
4. Keep **Upload backup** enabled.

The workflow uses the same AWS role as deploy, exports `/backup/export`, and uploads the compressed backup plus checksum to the Terraform-managed backup S3 bucket under `accounting-preflight/<run-id>/`. It does not commit backup data to GitHub.

To dry-run the historical Google Sheet import after exporting the `Journal` tab as CSV:
```bash
node scripts/historical-import-from-journal.mjs --input private/journal.local.csv --api "$API_BASE_URL"
```
The script checks the same acceptance totals as the API before sending anything. It uses dry-run mode by default; a real write requires the explicit `--write` flag:
```bash
node scripts/historical-import-from-journal.mjs --input private/journal.local.csv --api "$API_BASE_URL" --write
```

Suggested monthly cron:
```bash
0 2 1 * * /path/to/repo/scripts/export-backup.sh https://your-api.execute-api.region.amazonaws.com /var/backups/van
```

## Notes for future features
- **OCR** would attach a new event (`event_type = trip_ocr`) referencing the original trip ID.
- **Fuel costs** would be a new event type with its own fields (never overwriting trips).
- **Confidence flags** and **review states** should be separate events or attributes on new entries, never updates.
