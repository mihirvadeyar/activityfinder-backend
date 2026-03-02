import test from "node:test";
import assert from "node:assert/strict";

import { createQueryExecutionService } from "../src/services/queryExecutionService.js";

test("queryExecution returns a single events list with Pacific-formatted timestamps", async () => {
  const queryUnderstandingService = {
    async understandQuery() {
      return {
        activity_terms: ["badminton"],
        time_hint: "tomorrow",
        time_range_type: "absolute",
        start_date_iso: "2026-01-15T20:00:00.000Z",
        end_date_iso: "2026-01-16T20:00:00.000Z",
        duration_value: null,
        duration_unit: null,
        duration_modifier: null,
        location_hint: null,
        scope_category: "sports",
        confidence: 0.95,
      };
    },
  };

  const queryRepository = {
    async findActivitiesByNames() {
      return [];
    },
    async findActivityIdsByNamesAndCategory() {
      return [];
    },
    async listEventsByActivityIdsWithinWindow() {
      return [
        {
          event_id: "3183",
          event_external_id: "583191",
          event_title: "Badminton",
          event_description: "Drop-in badminton",
          starts_at: "2026-01-15T20:00:00.000Z",
          ends_at: "2026-01-15T21:30:00.000Z",
          activity_id: "1",
          activity_name: "Racquet Sports",
          activity_category: "Sports",
          centre_id: "6",
          centre_name: "*Coal Harbour Community Centre",
          centre_city: "Vancouver",
          centre_state: "BC",
          centre_country: "Canada",
        },
      ];
    },
  };

  const aliasResolver = {
    resolveActivitiesByAlias() {
      return {
        normalizedAlias: "badminton",
        activityIds: [1],
        activities: [{ id: 1, name: "Racquet Sports" }],
      };
    },
  };

  const summaryLlmClient = {
    model: "summary-test",
    async chat() {
      return { message: { content: "Summary ok." } };
    },
  };

  const service = createQueryExecutionService({
    summaryLlmClient,
    queryRepository,
    aliasResolver,
    queryUnderstandingService,
    categoryDefaults: { sports: { categoryName: "Sports", activityNames: ["Other"] } },
    queryTimeZone: "America/Vancouver",
  });

  const result = await service.executeQuery("Where can I play badminton tomorrow");

  assert.ok(Array.isArray(result.events));
  assert.equal(result.events.length, 1);
  assert.equal(result.response.summary.text, "Summary ok.");
  assert.equal(result.response.events, undefined);
  assert.equal(result.candidates.events, undefined);

  assert.match(result.understanding.start_date_iso, /-08:00|-07:00/);
  assert.match(result.candidates.window.windowStartIso, /-08:00|-07:00/);
  assert.match(result.events[0].starts_at, /-08:00|-07:00/);
  assert.doesNotMatch(result.events[0].starts_at, /Z$/);
});
