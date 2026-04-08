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
- **Storage:** DynamoDB tables for ledger, bookings, and work planner state (`id` primary key)
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
  "tasks": [],
  "todos": [],
  "board": []
}
```
This stores and retrieves the full Work workspace state for cross-device persistence.

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
      "historical_only": true
    }
  ]
}
```
This stores and retrieves the Costs workspace state for shared expense, income, and settlement tracking.

## Notes for future features
- **OCR** would attach a new event (`event_type = trip_ocr`) referencing the original trip ID.
- **Fuel costs** would be a new event type with its own fields (never overwriting trips).
- **Confidence flags** and **review states** should be separate events or attributes on new entries, never updates.
