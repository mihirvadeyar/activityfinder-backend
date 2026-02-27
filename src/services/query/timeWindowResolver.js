import * as chrono from "chrono-node";

const MS_IN_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolves query temporal understanding/hints into concrete fetch window boundaries.
 *
 * @param {Object} deps
 * @param {number} [deps.defaultWindowDays]
 */
export function createTimeWindowResolver({ defaultWindowDays = 30 }) {
  if (!Number.isFinite(defaultWindowDays) || defaultWindowDays <= 0) {
    throw new Error("Invalid defaultWindowDays");
  }

  /**
   * Converts structured understanding fields into an explicit window when possible.
   */
  function toWindowFromStructuredTime(understanding, now) {
    const rangeType = understanding?.time_range_type;

    if (rangeType === "absolute") {
      const startDate = understanding?.start_date_iso
        ? new Date(understanding.start_date_iso)
        : now;
      const endDate = understanding?.end_date_iso
        ? new Date(understanding.end_date_iso)
        : null;

      const safeStart = Number.isNaN(startDate.getTime()) ? now : startDate;
      if (endDate && !Number.isNaN(endDate.getTime()) && endDate > safeStart) {
        return {
          strategy: "structured_absolute",
          windowStartIso: safeStart.toISOString(),
          windowEndIso: endDate.toISOString(),
          start_date_iso: understanding.start_date_iso || null,
          end_date_iso: understanding.end_date_iso || null,
        };
      }
    }

    if (rangeType === "relative") {
      const unit = understanding?.duration_unit;
      const modifier = understanding?.duration_modifier;
      const value = Number(understanding?.duration_value);
      if (!["day", "week", "month"].includes(unit)) return null;
      if (!Number.isFinite(value) || value <= 0) return null;

      let daysPerUnit = 1;
      if (unit === "week") daysPerUnit = 7;
      if (unit === "month") daysPerUnit = 30;

      const modifierFactor = modifier === "half" ? 0.5 : 1;
      const days = Math.max(1, Math.min(60, Math.ceil(value * daysPerUnit * modifierFactor)));

      return {
        strategy: "structured_relative",
        duration_value: value,
        duration_unit: unit,
        duration_modifier: modifier || null,
        hintDays: days,
        windowStartIso: now.toISOString(),
        windowEndIso: new Date(now.getTime() + days * MS_IN_DAY).toISOString(),
      };
    }

    return null;
  }

  /**
   * Resolves fallback window strategies from free-form time hints and defaults.
   */
  function resolveWindowFromTimeHint(timeHint, understanding) {
    const now = new Date();
    const structuredWindow = toWindowFromStructuredTime(understanding, now);
    if (structuredWindow) return structuredWindow;

    const hint = String(timeHint || "").trim().toLowerCase();

    if (hint.includes("today")) {
      return {
        strategy: "today",
        windowStartIso: now.toISOString(),
        windowEndIso: new Date(now.getTime() + MS_IN_DAY).toISOString(),
      };
    }

    if (hint.includes("week")) {
      return {
        strategy: "week_hint",
        windowStartIso: now.toISOString(),
        windowEndIso: new Date(now.getTime() + 7 * MS_IN_DAY).toISOString(),
      };
    }

    if (hint.includes("month")) {
      return {
        strategy: "month_hint",
        windowStartIso: now.toISOString(),
        windowEndIso: new Date(now.getTime() + 30 * MS_IN_DAY).toISOString(),
      };
    }

    const daysHintMatch = hint.match(/(?:next\s+)?(\d{1,2})\s*days?\b/);
    if (daysHintMatch) {
      const days = Math.max(1, Math.min(Number(daysHintMatch[1]), 60));
      return {
        strategy: "days_hint",
        hintDays: days,
        windowStartIso: now.toISOString(),
        windowEndIso: new Date(now.getTime() + days * MS_IN_DAY).toISOString(),
      };
    }

    if (hint) {
      const chronoResult = chrono.parse(hint, now, { forwardDate: true })[0];
      if (chronoResult) {
        const startDate = chronoResult.start?.date?.();
        const endDateRaw = chronoResult.end?.date?.();
        const endDate = endDateRaw
          ? new Date(endDateRaw.getTime() + MS_IN_DAY)
          : startDate
            ? new Date(startDate.getTime() + MS_IN_DAY)
            : null;

        if (endDate && endDate > now) {
          return {
            strategy: "chrono_hint",
            parsedText: chronoResult.text,
            windowStartIso: now.toISOString(),
            windowEndIso: endDate.toISOString(),
          };
        }
      }
    }

    return {
      strategy: "default_window",
      windowStartIso: now.toISOString(),
      windowEndIso: new Date(now.getTime() + defaultWindowDays * MS_IN_DAY).toISOString(),
    };
  }

  return {
    resolveWindowFromTimeHint,
  };
}
