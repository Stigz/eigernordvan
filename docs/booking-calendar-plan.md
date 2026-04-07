# Calendar & Booking System Plan

## Goal
Add a dedicated booking/calendar experience as a separate top-level area in the app, backed by a separate DynamoDB table and API endpoints, with clear visual status colors and price estimates.

## UX recommendation: tab now, route-ready structure
- **Recommendation:** Start with a dedicated **Booking tab** in the current single-page shell for faster delivery.
- Build it as if it were a route (`/booking`) at the component level so it can be moved to a standalone page later with minimal refactor.
- Reasoning:
  - Lowest implementation risk right now.
  - Keeps user flow simple during MVP.
  - Preserves option to expand into a full page (filters, legend, monthly reports) without reworking data contracts.

## Calendar status model
Use three statuses on each day cell:
- `open` → **green** (opaque)
- `booked` → **red** (opaque)
- `blocked` → **yellow** (opaque)

Optional states for future:
- `partial` (half-day overlap)
- `pending` (temporary hold)

## Pricing model (requested)
Per booking estimate should include:
- Nightly charge: **100 CHF/night**
- Cleaning fee: **100 CHF flat**
- Day-use distance fee: **0.50 CHF/km** for daytime kilometers used

Proposed formula:

`total = (nights * 100) + (cleaning_fee_if_applicable) + (day_km * 0.50)`

Where:
- `nights = max(0, checkout_date - checkin_date in days)`
- `cleaning_fee_if_applicable = 100` (default true)
- `day_km >= 0`

## Backend design

### New DynamoDB table
Create a separate table for reservations (do not mix with trip/fuel ledger table):

**Table name**: `van-bookings` (or `${project}-bookings` in Terraform)

Core attributes:
- `id` (PK, string UUID)
- `start_date` (YYYY-MM-DD)
- `end_date` (YYYY-MM-DD, checkout/exclusive)
- `status` (`booked|blocked|open_override`)
- `guest_name` (optional)
- `notes` (optional)
- `day_km` (number, default 0)
- `nightly_rate` (number, default 100)
- `cleaning_fee` (number, default 100)
- `km_rate` (number, default 0.50)
- `estimate_total` (number, computed and stored)
- `created_at`, `updated_at` (RFC3339 UTC)

Suggested indexes:
- `GSI1PK = month_key` (`YYYY-MM`) for fast month view fetches
- `GSI1SK = start_date`

### API endpoints
Add booking endpoints:
- `POST /bookings` → create booking/block
- `GET /bookings?from=YYYY-MM-DD&to=YYYY-MM-DD` → date-range query
- `GET /bookings/:id`
- `PUT /bookings/:id` → adjust status/notes/rates/day_km/date range
- `DELETE /bookings/:id` (or safer: set `status=blocked`/`cancelled`)

Validation rules:
- `end_date > start_date`
- no overlap between active `booked` entries unless explicitly allowed
- `day_km >= 0`
- rates and fees must be non-negative

Conflict logic:
- Hard fail on overlap for `booked` records.
- Allow `blocked` to overlap only if policy says admin blocks can override opens.

## Frontend design

### New UI area
Add a `Booking` tab in the top switcher near existing views.

Page sections:
1. **Calendar grid** (month view first)
2. **Legend** (green/open, red/booked, yellow/blocked)
3. **Booking form**
   - check-in date
   - check-out date
   - status (booked/blocked)
   - day km
   - optional guest/notes
4. **Cost estimate panel** (live calculation)
5. **Booking list** (sortable by start date)

### Visual behavior
- Calendar day color priority when multiple records touch same day:
  1. `booked` (red)
  2. `blocked` (yellow)
  3. `open` (green)
- Opaque fills for all statuses as requested.
- Add accessible text labels and ARIA hints for colorblind accessibility.

## Implementation phases with rough effort

### Phase 1 — Data & API foundation (1.5 to 2.5 days)
- Terraform: bookings table + IAM updates
- Go backend: booking models, handlers, validation, overlap checks
- API wiring and CORS alignment
- Basic unit tests for estimator and overlap detection

### Phase 2 — Booking tab + month calendar (2 to 3 days)
- New Booking tab component
- Month calendar rendering and status coloring
- GET/POST integration
- Live estimate in form

### Phase 3 — Editing, polish, and resilience (1.5 to 2.5 days)
- Edit/cancel flow
- Error states + optimistic refresh
- Keyboard navigation/accessibility + mobile layout fixes
- Extra tests (frontend interactions + backend validation edge cases)

**Total:** ~5 to 8 business days for a solid MVP.

## Cost estimate examples
- Example A: 3 nights, 0 km daytime
  - `3*100 + 100 + 0*0.5 = 400 CHF`
- Example B: 2 nights, 120 km daytime
  - `2*100 + 100 + 120*0.5 = 360 CHF`
- Example C: blocked day (no booking)
  - `0 CHF` (unless you later define internal opportunity cost)

## Suggested acceptance criteria
- Booking tab visible and functional
- Date-range view loads in < 1s for one-month query under normal volume
- Overlapping bookings are rejected with clear message
- Calendar colors exactly match:
  - open = green opaque
  - booked = red opaque
  - blocked = yellow opaque
- Estimate panel updates instantly from form values
- Bookings persisted in a separate table and retrievable by month range

## Future enhancements (after MVP)
- Week/day views
- iCal import/export
- Seasonal or weekend pricing rules
- Deposit + payment status
- Role-based permissions (admin can block, others only request)
