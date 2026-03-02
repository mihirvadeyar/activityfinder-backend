import test from "node:test";
import assert from "node:assert/strict";

import { createTimeWindowResolver } from "../src/services/query/timeWindowResolver.js";
import { withMockedNow } from "./helpers/mockNow.js";

test("timeWindowResolver uses Vancouver day boundaries for today/tomorrow", async () => {
  await withMockedNow("2026-03-02T07:46:21.000Z", async () => {
    const resolver = createTimeWindowResolver({
      defaultWindowDays: 30,
      timeZone: "America/Vancouver",
    });

    const today = resolver.resolveWindowFromTimeHint("today", {
      time_range_type: "none",
    });
    const tomorrow = resolver.resolveWindowFromTimeHint("tomorrow", {
      time_range_type: "none",
    });

    assert.equal(today.windowStartIso, "2026-03-01T08:00:00.000Z");
    assert.equal(today.windowEndIso, "2026-03-02T08:00:00.000Z");
    assert.equal(tomorrow.windowStartIso, "2026-03-02T08:00:00.000Z");
    assert.equal(tomorrow.windowEndIso, "2026-03-03T08:00:00.000Z");
  });
});

test("timeWindowResolver uses day windows for relative durations", async () => {
  await withMockedNow("2026-01-15T18:30:00.000Z", async () => {
    const resolver = createTimeWindowResolver({
      defaultWindowDays: 30,
      timeZone: "America/Vancouver",
    });

    const window = resolver.resolveWindowFromTimeHint("next 3 days", {
      time_range_type: "relative",
      duration_value: 3,
      duration_unit: "day",
      duration_modifier: null,
    });

    assert.equal(window.windowStartIso, "2026-01-15T08:00:00.000Z");
    assert.equal(window.windowEndIso, "2026-01-18T08:00:00.000Z");
  });
});
