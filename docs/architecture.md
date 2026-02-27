# ActivityFinder — Architecture

## Goal
Backend that ingests recreation activity data (Vancouver Active Communities) and enables AI-driven natural language search.

Stack:
- Node.js backend
- Neon Postgres
- Ollama for query understanding
- Minimal frontend (later)

---

## Provider: Vancouver Active Communities

Important quirks:

### 1. Recurring events
Provider returns recurring "activity items" where:

- `calendar_id` = category grouping (e.g. Racquet Sports = 15)
- `activity_id` (583191) = specific item (Badminton)
- Weekly schedule is defined via patterns
- Occurrences must be distinguished by `start_time`

Therefore:
**external item id is NOT unique per occurrence**

---

### 2. Event identity
Occurrence identity:

(provider, external_item_id, external_centre_id, starts_at)

This is enforced as a UNIQUE constraint.

---

### 3. activity-details endpoint
`/activity-details/{external_item_id}?selected_date=...`

Returns:
- series-level data
- weekly pattern
- availability computed for selected_date

selected_date does NOT change most payload fields.

---

## Data model

### activity (calendar)
Represents provider calendar.

- provider
- external_calendar_id (15)
- name
- category
- tags

UNIQUE(provider, external_calendar_id)

---

### centre
Provider centre / facility.

- provider
- external_centre_id
- address
- geo coordinates

UNIQUE(provider, external_centre_id)

---

### event (occurrence)
Concrete scheduled instance.

Stores BOTH:
- external ids (for provider calls)
- internal FKs (for fast joins)

UNIQUE(provider, external_item_id, external_centre_id, starts_at)

Also contains:
- last_seen_at
- is_active

Used for rolling 30-day window.

---

## Why we keep internal IDs
- smaller joins
- future provider support
- clean referencing for user features

But external IDs are still stored for ingestion and provider calls.

---

## Query pattern
Typical read:

1. User asks in natural language
2. AI extracts intent (sport, time window, location)
3. DB query on event table
4. For top N results → call activity-details for live availability