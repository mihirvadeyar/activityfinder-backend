import * as chrono from "chrono-node";

/**
 * @typedef {Object} LlmClient
 * @property {(request: object) => Promise<any>} chat
 */

/**
 * @param {Object} deps
 * @param {LlmClient} deps.llmClient
 * @param {number} [deps.understandingTimeoutMs]
 */
export function createQueryUnderstandingService({ llmClient, understandingTimeoutMs = 20000 }) {
  if (!llmClient || typeof llmClient.chat !== "function") {
    throw new Error("Missing llmClient implementation with chat()");
  }
  if (!llmClient.model) throw new Error("Missing Ollama model");
  if (!Number.isFinite(llmClient.requestTimeoutMs) || llmClient.requestTimeoutMs <= 0) {
    throw new Error("Invalid timeoutMs");
  }
  if (!Number.isFinite(understandingTimeoutMs) || understandingTimeoutMs <= 0) {
    throw new Error("Invalid understandingTimeoutMs");
  }

  const safeUnderstandingTimeoutMs = Math.min(
    Math.max(1000, Math.floor(understandingTimeoutMs)),
    llmClient.requestTimeoutMs,
  );

  return {
    async understandQuery(userQuery) {
      const queryText = String(userQuery || "").trim();
      if (!queryText) throw new Error("Query text is required");

      const schema = {
        type: "object",
        required: [
          "activity_terms",
          "time_hint",
          "time_range_type",
          "start_date_iso",
          "end_date_iso",
          "duration_value",
          "duration_unit",
          "duration_modifier",
          "location_hint",
          "scope_category",
          "confidence",
        ],
        properties: {
          activity_terms: { type: "array", items: { type: "string" } },
          time_hint: { type: ["string", "null"] },
          time_range_type: { type: "string", enum: ["relative", "absolute", "none"] },
          start_date_iso: { type: ["string", "null"] },
          end_date_iso: { type: ["string", "null"] },
          duration_value: { type: ["number", "null"] },
          duration_unit: { type: ["string", "null"], enum: ["day", "week", "month", null] },
          duration_modifier: { type: ["string", "null"], enum: ["half", "next", "this", null] },
          location_hint: { type: ["string", "null"] },
          scope_category: { type: "string", enum: ["sports", "unknown"] },
          confidence: { type: "number" },
        },
        additionalProperties: false,
      };

      try {
        const response = await withTimeout(
          llmClient.chat({
            model: llmClient.model,
            format: schema,
            options: { temperature: 0, num_ctx: 1536, num_predict: 120 },
            messages: [
              {
                role: "system",
                content:
                  "Extract structured intent from user recreation queries into activity_terms, time_hint, time_range_type, start_date_iso, end_date_iso, duration_value, duration_unit, duration_modifier, location_hint, scope_category, confidence. Use time_range_type='absolute' when dates can be resolved, 'relative' when only relative duration is known, 'none' if no time signal. For relative hints, fill duration fields (e.g. 'half week' => duration_value=1, duration_unit='week', duration_modifier='half'). Use scope_category='sports' for sports-related queries, otherwise 'unknown'. Return only valid JSON matching the provided schema.",
              },
              {
                role: "user",
                content: queryText,
              },
            ],
          }),
          safeUnderstandingTimeoutMs,
          "understanding_timeout",
        );

        const text = response?.message?.content;
        if (!text) throw new Error("Empty response from LLM");

        const parsed = JSON.parse(text);
        const normalizedUnderstanding = normalizeUnderstanding(parsed);
        return reconcileTemporalUnderstandingWithChrono(queryText, normalizedUnderstanding);
      } catch (error) {
        console.warn("[query] understanding_fallback_used", {
          error: error?.message || String(error),
        });
        return buildHeuristicUnderstanding(queryText);
      }
    },
  };
}

/**
 * Applies an upper bound to an async operation.
 *
 * @param {Promise<any>} promise
 * @param {number} timeoutMs
 * @param {string} timeoutCode
 */
function withTimeout(promise, timeoutMs, timeoutCode) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
    }),
  ]);
}

/**
 * Heuristic fallback understanding used when LLM parsing fails/times out.
 *
 * @param {string} queryText
 */
function buildHeuristicUnderstanding(queryText) {
  const normalized = String(queryText || "").trim().toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);

  const stopwords = new Set([
    "i",
    "me",
    "my",
    "want",
    "need",
    "find",
    "show",
    "looking",
    "for",
    "to",
    "play",
    "do",
    "in",
    "at",
    "near",
    "around",
    "on",
    "this",
    "next",
    "today",
    "tomorrow",
    "week",
    "month",
    "weekend",
    "days",
    "day",
    "a",
    "an",
    "the",
  ]);

  const candidates = words.filter((word) => /^[a-z][a-z0-9-]*$/.test(word) && !stopwords.has(word));
  const activity_terms = [...new Set(candidates.slice(0, 3))];

  const hasToday = normalized.includes("today");
  const hasTomorrow = normalized.includes("tomorrow");
  const hasWeekend = normalized.includes("weekend");
  const hasWeek = normalized.includes("week");
  const hasMonth = normalized.includes("month");
  const daysMatch = normalized.match(/(?:next\s+)?(\d{1,2})\s*days?\b/);

  let time_hint = null;
  let time_range_type = "none";
  let duration_value = null;
  let duration_unit = null;

  if (hasToday) {
    time_hint = "today";
    time_range_type = "relative";
    duration_value = 1;
    duration_unit = "day";
  } else if (hasTomorrow) {
    time_hint = "tomorrow";
    time_range_type = "relative";
    duration_value = 1;
    duration_unit = "day";
  } else if (hasWeekend || hasWeek) {
    time_hint = hasWeekend ? "this weekend" : "this week";
    time_range_type = "relative";
    duration_value = 1;
    duration_unit = "week";
  } else if (hasMonth) {
    time_hint = "this month";
    time_range_type = "relative";
    duration_value = 1;
    duration_unit = "month";
  } else if (daysMatch) {
    time_hint = `${daysMatch[1]} days`;
    time_range_type = "relative";
    duration_value = Number(daysMatch[1]);
    duration_unit = "day";
  }

  const sportsKeywords = [
    "sport",
    "sports",
    "badminton",
    "pickleball",
    "basketball",
    "soccer",
    "football",
    "volleyball",
    "tennis",
    "hockey",
    "baseball",
    "cricket",
    "swim",
    "swimming",
    "yoga",
    "gym",
  ];
  const scope_category = sportsKeywords.some((keyword) => normalized.includes(keyword))
    ? "sports"
    : "unknown";

  return {
    activity_terms,
    time_hint,
    time_range_type,
    start_date_iso: null,
    end_date_iso: null,
    duration_value,
    duration_unit,
    duration_modifier: null,
    location_hint: null,
    scope_category,
    confidence: 0.35,
  };
}

/**
 * Reconciles model temporal output with chrono parser interpretation.
 *
 * @param {string} queryText
 * @param {Object} understanding
 */
function reconcileTemporalUnderstandingWithChrono(queryText, understanding) {
  const now = new Date();
  const chronoResult = chrono.parse(String(queryText || ""), now, { forwardDate: true })[0];
  if (!chronoResult) return understanding;

  const parsedStart = chronoResult.start?.date?.();
  if (!parsedStart || Number.isNaN(parsedStart.getTime())) return understanding;
  const parsedEndRaw = chronoResult.end?.date?.();
  const parsedEnd = parsedEndRaw && !Number.isNaN(parsedEndRaw.getTime())
    ? parsedEndRaw
    : new Date(parsedStart.getTime() + 24 * 60 * 60 * 1000);

  const parsedDays = Math.max(1, Math.ceil((parsedEnd.getTime() - parsedStart.getTime()) / (24 * 60 * 60 * 1000)));
  const modelDays = estimateModelDurationDays(understanding);

  const modelHasTemporalSignal =
    understanding.time_range_type !== "none" ||
    Boolean(understanding.time_hint) ||
    Boolean(understanding.start_date_iso) ||
    Boolean(understanding.end_date_iso);

  const isInconsistent =
    Number.isFinite(modelDays) && Math.abs(modelDays - parsedDays) >= 2;
  const chronoIsSingleDay = !parsedEndRaw || parsedDays === 1;
  const modelIsBroadRelative =
    understanding.time_range_type === "relative" && Number.isFinite(modelDays) && modelDays > 1;

  if (modelHasTemporalSignal && !isInconsistent && !(chronoIsSingleDay && modelIsBroadRelative)) {
    return understanding;
  }

  return {
    ...understanding,
    time_hint: chronoResult.text || understanding.time_hint || null,
    time_range_type: "absolute",
    start_date_iso: parsedStart.toISOString(),
    end_date_iso: parsedEnd.toISOString(),
    duration_value: null,
    duration_unit: null,
    duration_modifier: null,
    confidence: Math.max(Number(understanding.confidence) || 0, 0.8),
  };
}

/**
 * Converts relative duration fields into approximate day count for comparison.
 *
 * @param {Object} understanding
 */
function estimateModelDurationDays(understanding) {
  if (understanding?.time_range_type !== "relative") return null;
  const value = Number(understanding?.duration_value);
  const unit = understanding?.duration_unit;
  const modifier = understanding?.duration_modifier;
  if (!Number.isFinite(value) || value <= 0) return null;

  let daysPerUnit = 1;
  if (unit === "week") daysPerUnit = 7;
  if (unit === "month") daysPerUnit = 30;
  const modifierFactor = modifier === "half" ? 0.5 : 1;

  return Math.max(1, Math.ceil(value * daysPerUnit * modifierFactor));
}

/**
 * Normalizes raw LLM JSON into the canonical understanding shape.
 *
 * @param {Object} raw
 */
function normalizeUnderstanding(raw) {
  const activity_terms = Array.isArray(raw?.activity_terms)
    ? raw.activity_terms
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean)
    : [];

  const timeHint = raw?.time_hint ? String(raw.time_hint).trim() : null;
  const timeRangeType = ["relative", "absolute", "none"].includes(raw?.time_range_type)
    ? raw.time_range_type
    : "none";
  const startDateIso = raw?.start_date_iso ? String(raw.start_date_iso).trim() : null;
  const endDateIso = raw?.end_date_iso ? String(raw.end_date_iso).trim() : null;
  const durationValueRaw = raw?.duration_value;
  const durationUnit = ["day", "week", "month"].includes(raw?.duration_unit) ? raw.duration_unit : null;
  const durationModifier = ["half", "next", "this"].includes(raw?.duration_modifier)
    ? raw.duration_modifier
    : null;
  const locationHint = raw?.location_hint ? String(raw.location_hint).trim() : null;
  const scopeCategory = raw?.scope_category === "sports" ? "sports" : "unknown";
  const durationValue = Number.isFinite(Number(durationValueRaw)) ? Number(durationValueRaw) : null;

  let confidence = Number(raw?.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    activity_terms: [...new Set(activity_terms)],
    time_hint: timeHint || null,
    time_range_type: timeRangeType,
    start_date_iso: startDateIso || null,
    end_date_iso: endDateIso || null,
    duration_value: durationValue,
    duration_unit: durationUnit,
    duration_modifier: durationModifier,
    location_hint: locationHint || null,
    scope_category: scopeCategory,
    confidence,
  };
}
