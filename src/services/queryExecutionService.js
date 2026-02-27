import { createActivityResolutionService } from "./query/activityResolutionService.js";
import { createEventRankingService } from "./query/eventRankingService.js";
import { createQuerySummaryService } from "./query/querySummaryService.js";
import { createTimeWindowResolver } from "./query/timeWindowResolver.js";

export function createQueryExecutionService({
  summaryLlmClient,
  llmClient,
  queryRepository,
  aliasResolver,
  queryUnderstandingService,
  categoryDefaults = {},
  defaultWindowDays = 30,
  candidateLimit = 200,
  rankingThreshold = 0.5,
}) {
  if (!queryUnderstandingService || typeof queryUnderstandingService.understandQuery !== "function") {
    throw new Error("Missing queryUnderstandingService");
  }
  if (!Number.isFinite(candidateLimit) || candidateLimit <= 0) {
    throw new Error("Invalid candidateLimit");
  }

  const activityResolutionService = createActivityResolutionService({
    aliasResolver,
    queryRepository,
    categoryDefaults,
  });
  const rankingService = createEventRankingService({ rankingThreshold });
  const summaryService = createQuerySummaryService({ llmClient: summaryLlmClient || llmClient });
  const timeWindowResolver = createTimeWindowResolver({ defaultWindowDays });

  return {
    async executeQuery(queryText) {
      const startedAtMs = Date.now();
      const normalizedQuery = String(queryText || "").trim();
      if (!normalizedQuery) {
        throw new Error("Query text is required");
      }

      const timings = {};

      const understandingStartedAtMs = Date.now();
      const understanding = await queryUnderstandingService.understandQuery(normalizedQuery);
      timings.understand_query_ms = Date.now() - understandingStartedAtMs;

      const activityTerms = Array.isArray(understanding.activity_terms)
        ? understanding.activity_terms
        : [];

      const resolveTermsStartedAtMs = Date.now();
      const resolution = await activityResolutionService.resolveActivityTerms(activityTerms);
      timings.resolve_activity_terms_ms = Date.now() - resolveTermsStartedAtMs;

      const finalActivityIds = new Set(resolution.mappedActivityIds);

      const scopeCategory = String(understanding.scope_category || "unknown");
      const resolveDefaultsStartedAtMs = Date.now();
      const defaultsResolution = await activityResolutionService.resolveDefaultActivityIds(scopeCategory);
      timings.resolve_default_activity_ids_ms = Date.now() - resolveDefaultsStartedAtMs;

      defaultsResolution.resolvedActivityIds.forEach((id) => finalActivityIds.add(id));
      const finalActivityIdsArray = Array.from(finalActivityIds);

      const resolveWindowStartedAtMs = Date.now();
      const timeWindow = timeWindowResolver.resolveWindowFromTimeHint(
        understanding.time_hint,
        understanding,
      );
      timings.resolve_time_window_ms = Date.now() - resolveWindowStartedAtMs;

      const fetchEventsStartedAtMs = Date.now();
      const events = await queryRepository.listEventsByActivityIdsWithinWindow({
        activityIds: finalActivityIdsArray,
        windowStartIso: timeWindow.windowStartIso,
        windowEndIso: timeWindow.windowEndIso,
        limit: candidateLimit,
      });
      timings.fetch_events_ms = Date.now() - fetchEventsStartedAtMs;

      const rankEventsStartedAtMs = Date.now();
      const rankingResult = rankingService.rankEventsByActivityTerms(
        events,
        activityTerms,
        resolution.mappingDetails,
      );
      timings.rank_events_ms = Date.now() - rankEventsStartedAtMs;

      const rankedEvents = rankingResult.rankedEvents;
      const scoredValues = rankingResult.diagnostics.scoredFetchedEvents
        .map((event) => Number(event.match_score))
        .filter((score) => Number.isFinite(score));
      const scoreBuckets = {
        ge_09: scoredValues.filter((s) => s >= 0.9).length,
        ge_07: scoredValues.filter((s) => s >= 0.7 && s < 0.9).length,
        ge_05: scoredValues.filter((s) => s >= 0.5 && s < 0.7).length,
        lt_05: scoredValues.filter((s) => s < 0.5).length,
      };

      const summaryStartedAtMs = Date.now();
      const summary = await summaryService.generateEventsSummary({
        query: normalizedQuery,
        events: rankedEvents,
        understanding,
        window: timeWindow,
      });
      timings.summary_generation_ms = Date.now() - summaryStartedAtMs;
      timings.total_ms = Date.now() - startedAtMs;

      console.info("[query] execution_stats", {
        timings,
        counters: {
          activity_terms_count: activityTerms.length,
          mapped_activity_ids_count: resolution.mappedActivityIds.length,
          unmapped_terms_count: resolution.unmappedTerms.length,
          default_activity_ids_count: defaultsResolution.resolvedActivityIds.length,
          final_activity_ids_count: finalActivityIdsArray.length,
          fetched_events_count: events.length,
          ranked_events_count: rankedEvents.length,
          score_buckets: scoreBuckets,
        },
        summary: {
          model_generated: summary.model_generated,
          failure_reason: summary.failure_reason || null,
        },
        query_meta: {
          scope_category: scopeCategory,
          ranking_threshold: rankingThreshold,
          candidate_limit: candidateLimit,
          time_window_strategy: timeWindow.strategy,
        },
      });

      return {
        query: normalizedQuery,
        understanding,
        resolution: {
          ...resolution,
          finalActivityIds: finalActivityIdsArray,
          defaultsResolution,
        },
        candidates: {
          window: timeWindow,
          limit: candidateLimit,
          fetchedCount: events.length,
          count: rankedEvents.length,
          events: rankedEvents,
        },
        response: {
          summary,
          events: rankedEvents,
        },
      };
    },
  };
}
