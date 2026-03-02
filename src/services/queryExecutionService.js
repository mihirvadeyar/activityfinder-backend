import { createActivityResolutionService } from "./query/activityResolutionService.js";
import { createEventRankingService } from "./query/eventRankingService.js";
import { createQuerySummaryService } from "./query/querySummaryService.js";
import { createTimeWindowResolver } from "./query/timeWindowResolver.js";

/**
 * Query orchestration service: understanding -> activity resolution -> time window ->
 * candidate fetch -> ranking -> NL summary.
 *
 * @param {Object} deps
 * @param {Object} deps.summaryLlmClient
 * @param {Object} deps.llmClient
 * @param {Object} deps.queryRepository
 * @param {Object} deps.aliasResolver
 * @param {Object} deps.queryUnderstandingService
 * @param {Object} [deps.categoryDefaults]
 * @param {number} [deps.defaultWindowDays]
 * @param {string} [deps.queryTimeZone]
 * @param {number} [deps.candidateLimit]
 * @param {number} [deps.rankingThreshold]
 */
export function createQueryExecutionService({
  summaryLlmClient,
  llmClient,
  queryRepository,
  aliasResolver,
  queryUnderstandingService,
  categoryDefaults = {},
  defaultWindowDays = 30,
  queryTimeZone = "America/Vancouver",
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
  const timeWindowResolver = createTimeWindowResolver({
    defaultWindowDays,
    timeZone: queryTimeZone,
  });

  function toIsoInTimeZone(isoText) {
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) return isoText;

    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: queryTimeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "shortOffset",
    });
    const parts = dtf.formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const rawOffset = String(map.timeZoneName || "GMT+00:00");
    const offsetMatch = rawOffset.match(/^GMT([+-]\d{1,2})(?::?(\d{2}))?$/i);
    let offset = "+00:00";
    if (offsetMatch) {
      const signedHour = offsetMatch[1];
      const sign = signedHour.startsWith("-") ? "-" : "+";
      const hour = String(Math.abs(Number(signedHour))).padStart(2, "0");
      const minute = String(offsetMatch[2] || "00").padStart(2, "0");
      offset = `${sign}${hour}:${minute}`;
    }

    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}${offset}`;
  }

  function localizeUnderstanding(understanding) {
    return {
      ...understanding,
      start_date_iso: understanding?.start_date_iso
        ? toIsoInTimeZone(understanding.start_date_iso)
        : null,
      end_date_iso: understanding?.end_date_iso
        ? toIsoInTimeZone(understanding.end_date_iso)
        : null,
      time_zone: queryTimeZone,
    };
  }

  function localizeWindow(window) {
    return {
      ...window,
      windowStartIso: toIsoInTimeZone(window.windowStartIso),
      windowEndIso: toIsoInTimeZone(window.windowEndIso),
      start_date_iso: window.start_date_iso ? toIsoInTimeZone(window.start_date_iso) : null,
      end_date_iso: window.end_date_iso ? toIsoInTimeZone(window.end_date_iso) : null,
      time_zone: queryTimeZone,
    };
  }

  function localizeEvents(events) {
    return events.map((event) => ({
      ...event,
      starts_at: toIsoInTimeZone(event.starts_at),
      ends_at: toIsoInTimeZone(event.ends_at),
      time_zone: queryTimeZone,
    }));
  }

  return {
    /**
     * Executes an end-to-end user query against indexed activities/events.
     *
     * @param {string} queryText
     */
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
      const localizedUnderstanding = localizeUnderstanding(understanding);
      const localizedWindow = localizeWindow(timeWindow);
      const localizedEvents = localizeEvents(rankedEvents);
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
        events: localizedEvents,
        understanding: localizedUnderstanding,
        window: localizedWindow,
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
        understanding: localizedUnderstanding,
        resolution: {
          ...resolution,
          finalActivityIds: finalActivityIdsArray,
          defaultsResolution,
        },
        candidates: {
          window: localizedWindow,
          limit: candidateLimit,
          fetchedCount: events.length,
          count: rankedEvents.length,
        },
        events: localizedEvents,
        response: {
          summary,
        },
      };
    },
  };
}

