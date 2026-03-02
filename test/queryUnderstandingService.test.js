import test from "node:test";
import assert from "node:assert/strict";

import { createQueryUnderstandingService } from "../src/services/queryUnderstandingService.js";
import { withMockedNow } from "./helpers/mockNow.js";

test("understanding reconciles relative hint in Vancouver time", async () => {
  await withMockedNow("2026-03-02T07:46:21.000Z", async () => {
    const llmClient = {
      model: "test",
      requestTimeoutMs: 5000,
      async chat() {
        return {
          message: {
            content: JSON.stringify({
              activity_terms: ["badminton"],
              time_hint: "tomorrow",
              time_range_type: "absolute",
              start_date_iso: "2026-03-02T19:21:51.000Z",
              end_date_iso: "2026-03-03T19:21:51.000Z",
              duration_value: null,
              duration_unit: null,
              duration_modifier: null,
              location_hint: null,
              scope_category: "sports",
              confidence: 0.95,
            }),
          },
        };
      },
    };

    const service = createQueryUnderstandingService({
      llmClient,
      timeZone: "America/Vancouver",
    });

    const understanding = await service.understandQuery("Where can I play badminton tomorrow");

    assert.equal(understanding.time_range_type, "absolute");
    assert.equal(understanding.start_date_iso, "2026-03-03T07:46:21.000Z");
    assert.equal(understanding.end_date_iso, "2026-03-04T07:46:21.000Z");
  });
});
