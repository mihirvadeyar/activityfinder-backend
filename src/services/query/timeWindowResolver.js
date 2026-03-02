import * as chrono from "chrono-node";

const MS_IN_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolves query temporal understanding/hints into concrete fetch window boundaries.
 *
 * @param {Object} deps
 * @param {number} [deps.defaultWindowDays]
 * @param {string} [deps.timeZone]
 */
export function createTimeWindowResolver({ defaultWindowDays = 30, timeZone = "America/Vancouver" }) {
  if (!Number.isFinite(defaultWindowDays) || defaultWindowDays <= 0) {
    throw new Error("Invalid defaultWindowDays");
  }

  function getTimeZoneOffsetMs(date) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    return asUtc - date.getTime();
  }

  function zonedDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }) {
    const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    let utcMs = localAsUtcMs;
    for (let i = 0; i < 3; i += 1) {
      utcMs = localAsUtcMs - getTimeZoneOffsetMs(new Date(utcMs));
    }
    return new Date(utcMs);
  }

  function getZonedYmd(date) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
    };
  }

  function shiftZonedYmd({ year, month, day }, deltaDays) {
    const shiftedUtc = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0));
    return {
      year: shiftedUtc.getUTCFullYear(),
      month: shiftedUtc.getUTCMonth() + 1,
      day: shiftedUtc.getUTCDate(),
    };
  }

  function startOfZonedDay(date) {
    const ymd = getZonedYmd(date);
    return zonedDateTimeToUtc({ ...ymd, hour: 0, minute: 0, second: 0 });
  }

  function dayWindowFromNow(now, startOffsetDays, spanDays, strategy, extra = {}) {
    const todayYmd = getZonedYmd(now);
    const startYmd = shiftZonedYmd(todayYmd, startOffsetDays);
    const endYmd = shiftZonedYmd(startYmd, spanDays);
    return {
      strategy,
      ...extra,
      windowStartIso: zonedDateTimeToUtc({ ...startYmd, hour: 0, minute: 0, second: 0 }).toISOString(),
      windowEndIso: zonedDateTimeToUtc({ ...endYmd, hour: 0, minute: 0, second: 0 }).toISOString(),
    };
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

      return dayWindowFromNow(now, 0, days, "structured_relative", {
        duration_value: value,
        duration_unit: unit,
        duration_modifier: modifier || null,
        hintDays: days,
      });
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
      return dayWindowFromNow(now, 0, 1, "today");
    }

    if (hint.includes("tomorrow")) {
      return dayWindowFromNow(now, 1, 1, "tomorrow");
    }

    if (hint.includes("week")) {
      return dayWindowFromNow(now, 0, 7, "week_hint");
    }

    if (hint.includes("month")) {
      return dayWindowFromNow(now, 0, 30, "month_hint");
    }

    const daysHintMatch = hint.match(/(?:next\s+)?(\d{1,2})\s*days?\b/);
    if (daysHintMatch) {
      const days = Math.max(1, Math.min(Number(daysHintMatch[1]), 60));
      return dayWindowFromNow(now, 0, days, "days_hint", {
        hintDays: days,
      });
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
            windowStartIso: startOfZonedDay(now).toISOString(),
            windowEndIso: endDate.toISOString(),
          };
        }
      }
    }

    return dayWindowFromNow(now, 0, defaultWindowDays, "default_window");
  }

  return {
    resolveWindowFromTimeHint,
  };
}
