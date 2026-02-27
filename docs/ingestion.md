# ActivityFinder — Ingestion

## Strategy
Rolling 30-day window.

Each batch run:

1. Fetch calendars
2. Fetch centres for calendar
3. Fetch events for calendar + centres
4. Filter occurrences within next 30 days
5. UPSERT occurrences
6. Delete occurrences outside window

No incremental API support required.

---

## Why not incremental ingestion
Provider ignores date filters and returns season schedule.

Therefore:
- simplest and safest approach is window filtering client-side
- UPSERT handles overlap cheaply

---

## Occurrence generation
Events endpoint already returns occurrences.

If future provider only returns patterns:
- expand weekly pattern
- skip exception dates

---

## Idempotency
UPSERT key:

(provider, external_item_id, external_centre_id, starts_at)

Ensures:
- recurring duplicates avoided
- edits update existing rows
- ingestion is safe to rerun

---

## last_seen_at usage
Every ingestion refresh sets:

last_seen_at = now()
is_active = true

Optional future cleanup:
mark events inactive if not seen for N runs.

---

## Cleanup
After ingestion:

DELETE events where:
starts_at < now()
OR starts_at >= now() + 30 days

Keeps DB bounded.

---

## Performance approach
- Load centres and activities into memory maps once per run
- Avoid per-row DB lookups
- UPSERT directly

Streaming JSON parsing can be added if payload becomes large.

---

## Future improvements
- pagination if vendor adds it
- weekly reconciliation job
- availability caching
- pattern-based occurrence generation