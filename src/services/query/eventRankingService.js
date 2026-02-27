import Fuse from "fuse.js";
import { normalizeText } from "./textProcessing.js";

export function createEventRankingService({ rankingThreshold = 0.5 }) {
  if (!Number.isFinite(rankingThreshold) || rankingThreshold < 0 || rankingThreshold > 1) {
    throw new Error("Invalid rankingThreshold");
  }

  function buildRankingTerms(activityTerms, mappingDetails) {
    const baseTerms = Array.isArray(activityTerms) ? activityTerms : [];
    const aliasTerms = Array.isArray(mappingDetails)
      ? mappingDetails.flatMap((detail) => (Array.isArray(detail.matchedAliases) ? detail.matchedAliases : []))
      : [];

    const normalizedAliasTerms = aliasTerms.map(normalizeText).filter(Boolean);
    const normalizedBaseTerms = baseTerms.map(normalizeText).filter(Boolean);

    const aliasSet = new Set(normalizedAliasTerms);
    const seen = new Set();
    const ordered = [];

    [...normalizedAliasTerms, ...normalizedBaseTerms].forEach((term) => {
      if (!term || seen.has(term)) return;
      seen.add(term);
      ordered.push(term);
    });

    return {
      ordered,
      aliasSet,
    };
  }

  function hasExactNormalizedPhrase(normalizedTitle, normalizedTerm) {
    if (!normalizedTitle || !normalizedTerm) return false;
    return ` ${normalizedTitle} `.includes(` ${normalizedTerm} `);
  }

  function rankEventsByActivityTerms(events, activityTerms, mappingDetails) {
    if (!Array.isArray(events) || events.length === 0) {
      return {
        rankedEvents: [],
        diagnostics: {
          normalizedTerms: [],
          aliasTerms: [],
          scoredFetchedEvents: [],
        },
      };
    }

    const rankingTerms = buildRankingTerms(activityTerms, mappingDetails);
    const normalizedTerms = rankingTerms.ordered;
    const aliasTerms = rankingTerms.aliasSet;
    const aliasRankingThreshold = Math.min(0.65, rankingThreshold + 0.15);

    const indexedEvents = events.map((event) => ({
      ...event,
      _search_title: normalizeText(event.event_title),
    }));

    if (!normalizedTerms.length) {
      const rankedEvents = indexedEvents
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
        .map((event) => {
          const { _search_title, ...rest } = event;
          return {
            ...rest,
            match_score: null,
          };
        });
      return {
        rankedEvents,
        diagnostics: {
          normalizedTerms,
          aliasTerms: Array.from(aliasTerms),
          scoredFetchedEvents: indexedEvents.map((event) => ({
            event_id: event.event_id,
            event_title: event.event_title,
            best_score: null,
            match_score: null,
            matched_term: null,
            term_is_alias: false,
            exact_alias_hit: false,
            included_by_exact_alias_override: false,
          })),
        },
      };
    }

    const fuse = new Fuse(indexedEvents, {
      includeScore: true,
      threshold: aliasRankingThreshold,
      ignoreLocation: true,
      minMatchCharLength: 2,
      keys: ["_search_title"],
    });
    const bestByEventId = new Map();
    const perTermLimit = indexedEvents.length;

    normalizedTerms.forEach((term) => {
      const termIsAlias = aliasTerms.has(term);
      const termThreshold = termIsAlias ? aliasRankingThreshold : rankingThreshold;
      const results = fuse.search(term, { limit: perTermLimit });

      results.forEach((result) => {
        if (!Number.isFinite(result.score) || result.score > termThreshold) return;
        const eventId = String(result.item.event_id);
        const existing = bestByEventId.get(eventId);
        if (!existing || result.score < existing.score) {
          bestByEventId.set(eventId, {
            item: result.item,
            score: result.score,
            matchedTerm: term,
            thresholdUsed: termThreshold,
            termIsAlias,
          });
        }
      });
    });

    // Deterministic override: include events that exactly contain an alias term in title.
    if (aliasTerms.size > 0) {
      indexedEvents.forEach((event) => {
        const matchedAlias = Array.from(aliasTerms).find((term) =>
          hasExactNormalizedPhrase(event._search_title, term)
        );
        if (!matchedAlias) return;

        const eventId = String(event.event_id);
        if (!bestByEventId.has(eventId)) {
          bestByEventId.set(eventId, {
            item: event,
            score: 0,
            matchedTerm: matchedAlias,
            thresholdUsed: aliasRankingThreshold,
            termIsAlias: true,
            includedByExactAliasOverride: true,
            exactAliasHit: true,
          });
        } else {
          const existing = bestByEventId.get(eventId);
          bestByEventId.set(eventId, {
            ...existing,
            exactAliasHit: true,
          });
        }
      });
    }

    const scoredFetchedEvents = indexedEvents.map((event) => {
      const eventId = String(event.event_id);
      const best = bestByEventId.get(eventId);
      const exactAliasHit = Array.from(aliasTerms).some((term) =>
        hasExactNormalizedPhrase(event._search_title, term)
      );
      return {
        event_id: event.event_id,
        event_title: event.event_title,
        best_score: best ? Number(best.score.toFixed(4)) : null,
        match_score: best ? Number((1 - best.score).toFixed(4)) : null,
        matched_term: best?.matchedTerm || null,
        term_is_alias: Boolean(best?.termIsAlias),
        exact_alias_hit: exactAliasHit,
        included_by_exact_alias_override: Boolean(best?.includedByExactAliasOverride),
      };
    });

    const rankedEvents = Array.from(bestByEventId.values())
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return new Date(a.item.starts_at).getTime() - new Date(b.item.starts_at).getTime();
      })
      .map((result) => {
        const { _search_title, ...event } = result.item;
        return {
          ...event,
          match_score: Number((1 - result.score).toFixed(4)),
          match_meta: {
            matched_term: result.matchedTerm,
            term_is_alias: result.termIsAlias,
            threshold_used: result.thresholdUsed,
            included_by_exact_alias_override: Boolean(result.includedByExactAliasOverride),
            exact_alias_hit: Boolean(result.exactAliasHit),
          },
        };
      });

    return {
      rankedEvents,
      diagnostics: {
        normalizedTerms,
        aliasTerms: Array.from(aliasTerms),
        scoredFetchedEvents,
      },
    };
  }

  return {
    rankEventsByActivityTerms,
  };
}
