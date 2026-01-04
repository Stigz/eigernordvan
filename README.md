# Van Usage Logging MVP

## MVP intent
This repository contains a minimal vehicle usage logging system. It is designed for a low-traffic, high-trust environment where the goal is habit formation, not automation. The user manually logs odometer readings, and the backend calculates distance and cost.

## Append-only philosophy
The ledger is append-only. Every entry is a new event. **No updates or deletes.**
If a correction is needed in the future, the system should write a new event that references the original.

## Architecture
- **Frontend:** React + Vite single-page form (`frontend/`)
- **Backend:** Go AWS Lambda (`backend/`)
- **API:** API Gateway HTTP `POST /trip`
- **Storage:** DynamoDB append-only ledger (`id` primary key)
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

## Notes for future features
- **OCR** would attach a new event (`event_type = trip_ocr`) referencing the original trip ID.
- **Fuel costs** would be a new event type with its own fields (never overwriting trips).
- **Confidence flags** and **review states** should be separate events or attributes on new entries, never updates.
