import test from "node:test";
import assert from "node:assert/strict";

import { normalizeEvent } from "../src/models/providerMappers.js";

test("normalizeEvent parses Vancouver-local provider timestamps into UTC", () => {
  const event = normalizeEvent(
    {
      event_item_id: 583191,
      calendar_id: 15,
      center_id: 6,
      start_time: "2026-03-02 12:00:00",
      end_time: "2026-03-02 13:30:00",
      title: "Badminton",
    },
    15,
    6,
    "America/Vancouver",
  );

  assert.ok(event);
  assert.equal(event.startsAt.toISOString(), "2026-03-02T20:00:00.000Z");
  assert.equal(event.endsAt.toISOString(), "2026-03-02T21:30:00.000Z");
});
