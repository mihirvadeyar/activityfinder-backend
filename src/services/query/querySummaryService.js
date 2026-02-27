/**
 * Builds summary generation service for producing natural language from ranked events.
 *
 * @param {Object} deps
 * @param {Object} deps.llmClient
 */
export function createQuerySummaryService({ llmClient }) {
  if (!llmClient || typeof llmClient.chat !== "function") {
    throw new Error("Missing llmClient implementation with chat()");
  }

  /**
   * Buckets timestamp into one-hour slot label.
   */
  function getHourBucketLabel(isoDateTime) {
    const date = new Date(isoDateTime);
    if (Number.isNaN(date.getTime())) return null;
    const hour = date.getHours();
    const startHourLabel = `${String(hour).padStart(2, "0")}:00`;
    const endHourLabel = `${String((hour + 1) % 24).padStart(2, "0")}:00`;
    return `${startHourLabel}-${endHourLabel}`;
  }

  /**
   * Returns top-N labels by frequency.
   */
  function getTopBucketLabels(values, limit) {
    const counts = new Map();
    values.forEach((value) => {
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });

    return Array.from(counts.entries())
      .sort((a, b) => {
        if (a[1] !== b[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .slice(0, limit)
      .map(([value]) => value);
  }

  /**
   * Computes compact statistical signals used to guide summary generation.
   */
  function buildSummarySignals(events) {
    const topTimeSlots = getTopBucketLabels(
      events.map((event) => getHourBucketLabel(event.starts_at)),
      3,
    );
    const topCentres = getTopBucketLabels(
      events.map((event) => String(event.centre_name || "").trim() || null),
      5,
    );
    const topActivities = getTopBucketLabels(
      events.map((event) => String(event.activity_name || "").trim() || null),
      5,
    );

    return {
      total_events: events.length,
      top_time_slots: topTimeSlots,
      top_centres: topCentres,
      top_activities: topActivities,
    };
  }

  /**
   * Generates the user-facing summary with retry/fallback behavior.
   */
  async function generateEventsSummary({ query, events, understanding, window }) {
    const signals = buildSummarySignals(events);
    const summaryEventContextLimit = 20;

    const eventsForSummary = events.slice(0, summaryEventContextLimit).map((event) => ({
      title: event.event_title || null,
      starts_at: event.starts_at,
      centre_name: event.centre_name || null,
      activity_name: event.activity_name || null,
      match_score: Number.isFinite(Number(event.match_score)) ? Number(event.match_score) : null,
    }));

    try {
      const response = await llmClient.chat({
        model: llmClient.model,
        options: { temperature: 0.75, top_p: 0.92, num_ctx: 2048, num_predict: 140 },
        messages: [
          {
            role: "system",
            content:
              "You summarize activity search results. Write one concise, natural paragraph (2-4 sentences) based only on provided data. Prioritize decision-useful patterns (timing concentration, centre distribution, activity mix, standout matches). Keep it factual. Vary phrasing and sentence structure across responses for similar inputs. If no events exist, clearly say so and suggest broadening date/activity. Return only plain text with no markdown.",
          },
          {
            role: "user",
            content: JSON.stringify({
              query,
              understanding,
              window: {
                start: window.windowStartIso,
                end: window.windowEndIso,
                strategy: window.strategy,
              },
              signals,
              summary_context: {
                total_ranked_events: events.length,
                included_events_count: eventsForSummary.length,
              },
              events_for_summary: eventsForSummary,
            }),
          },
        ],
      });

      const content = String(response?.message?.content || "").trim();
      if (content) {
        return {
          text: content,
          signals,
          model_generated: true,
        };
      }

      const retrySummary = await generateSummaryRetry({ llmClient, query, signals, eventsForSummary });
      if (retrySummary) {
        return {
          text: retrySummary,
          signals,
          model_generated: true,
          used_retry: true,
        };
      }

      return {
        text: buildDeterministicSummary({ query, signals, events }),
        signals,
        model_generated: false,
        failure_reason: "empty_or_unparseable_summary",
      };
    } catch (error) {
      console.warn("[query] summary_generation_failed", {
        error: error?.message || String(error),
      });

      const retrySummary = await generateSummaryRetry({ llmClient, query, signals, eventsForSummary });
      if (retrySummary) {
        return {
          text: retrySummary,
          signals,
          model_generated: true,
          used_retry: true,
        };
      }

      return {
        text: buildDeterministicSummary({ query, signals, events }),
        signals,
        model_generated: false,
        failure_reason: error?.message || "summary_generation_failed",
      };
    }
  }

  return {
    generateEventsSummary,
  };
}

/**
 * Secondary lower-context retry for summary generation.
 */
async function generateSummaryRetry({ llmClient, query, signals, eventsForSummary }) {
  try {
    const response = await llmClient.chat({
      model: llmClient.model,
      options: { temperature: 0.5, top_p: 0.9, num_ctx: 1024, num_predict: 90 },
      messages: [
        {
          role: "system",
          content:
            "Write a concise user-facing summary in 2-3 sentences based only on provided activity results. Keep it factual and useful. No markdown.",
        },
        {
          role: "user",
          content: JSON.stringify({
            query,
            signals,
            events_for_summary: eventsForSummary,
          }),
        },
      ],
    });

    const text = String(response?.message?.content || "").trim();
    return text || null;
  } catch (error) {
    console.warn("[query] summary_retry_failed", {
      error: error?.message || String(error),
    });
    return null;
  }
}

/**
 * Deterministic fallback summary used when model output is unavailable.
 */
function buildDeterministicSummary({ query, signals, events }) {
  if (!signals.total_events) {
    return `No matching events were found for "${query}". Try a broader date range or different activity.`;
  }

  const parts = [`I found ${signals.total_events} matching events for "${query}".`];

  if (signals.top_time_slots.length) {
    parts.push(`Most options cluster around ${signals.top_time_slots.slice(0, 2).join(" and ")}.`);
  }

  if (signals.top_centres.length) {
    parts.push(`Frequent centres include ${signals.top_centres.slice(0, 3).join(", ")}.`);
  }

  const topEvent = events[0];
  if (topEvent?.event_title) {
    const centre = topEvent.centre_name ? ` at ${topEvent.centre_name}` : "";
    parts.push(`A strong match is "${topEvent.event_title}"${centre}.`);
  }

  return parts.join(" ");
}
