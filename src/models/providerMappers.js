import { createActivity } from "./activity.js";
import { createCentre } from "./centre.js";
import { createEvent } from "./event.js";

const SUPPORTED_ACTIVITY_CATEGORIES = new Set(["Sports"]);

function decodeHtmlEntities(value) {
  if (!value) return value;

  const namedEntities = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (!entity) return match;

    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const codePointText = isHex ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(codePointText, isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0) return match;
      return String.fromCodePoint(codePoint);
    }

    const normalizedEntity = String(entity).toLowerCase();
    return Object.hasOwn(namedEntities, normalizedEntity)
      ? namedEntities[normalizedEntity]
      : match;
  });
}

function normalizeHtmlToPlainText(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;

  const input = String(rawValue);
  if (!input.trim()) return null;

  let text = input;

  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|section|article|h[1-6]|li|ul|ol|tr)>/gi, "\n");
  text = text.replace(/<(li)\b[^>]*>/gi, "- ");
  text = text.replace(/<\/(td|th)>/gi, "\t");

  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);

  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");

  const normalized = text.trim();
  return normalized || null;
}

function toBigIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseActivityName(rawName) {
  const name = String(rawName || "").trim();
  if (!name) return null;

  const hasCategorySeparator = name.includes(":");
  if (!hasCategorySeparator) {
    return null; // require category prefix e.g. "Sports: Soccer". Uncategorized activities are currently unsupported!
  }

  const [categoryRaw = "", activityNameRaw = ""] = name.split(":", 2);
  const category = categoryRaw.trim() || null;
  const activityName = activityNameRaw.trim();
  if (!activityName) return null;
  if (!category || !SUPPORTED_ACTIVITY_CATEGORIES.has(category)) return null;

  return {
    category,
    activityName,
  };
}

export function normalizeActivity(raw) {
  const externalId = toBigIntOrNull(raw?.calendar_id);
  const parsedActivity = parseActivityName(raw?.name);

  if (!externalId || !parsedActivity) return null;

  return createActivity({
    externalId,
    name: parsedActivity.activityName,
    category: parsedActivity.category,
    description: normalizeHtmlToPlainText(raw?.description),
    tags: Array.isArray(raw?.tags) ? raw.tags.map((t) => String(t)) : null,
  });
}

export function normalizeCentre(raw) {
  const externalId = toBigIntOrNull(raw?.center_id ?? raw?.centre_id ?? raw?.id);

  if (!externalId) return null;

  return createCentre({
    externalId,
    name: String(raw?.name || `Centre ${externalId}`),
    description: normalizeHtmlToPlainText(raw?.description),
    street: raw?.street ?? null,
    city: raw?.city || "Vancouver",
    state: raw?.state || "BC",
    country: raw?.country || "Canada",
    zipCode: raw?.zip_code ?? null,
    phone: raw?.phone ?? null,
  });
}

export function mergeFilterCentreWithDetails(filterCentreRaw, centreDetailsRaw) {
  return {
    id: filterCentreRaw?.id ?? centreDetailsRaw?.id,
    name: centreDetailsRaw?.name ?? filterCentreRaw?.name,
    description: centreDetailsRaw?.description ?? null,
    street: centreDetailsRaw?.address1 ?? null,
    city: centreDetailsRaw?.city ?? null,
    state: centreDetailsRaw?.state ?? null,
    country: centreDetailsRaw?.country ?? null,
    zip_code: centreDetailsRaw?.zip_code ?? null,
    phone: centreDetailsRaw?.phone ?? null,
  };
}

export function normalizeEvent(raw, fallbackActivityExternalId, fallbackCentreExternalId) {
  const externalId = toBigIntOrNull(raw?.event_item_id);
  const externalActivityId = toBigIntOrNull(raw?.calendar_id) || fallbackActivityExternalId;
  const externalCentreId = toBigIntOrNull(raw?.center_id) || fallbackCentreExternalId;

  const startsAt = toDateOrNull(raw?.start_time);
  let endsAt = toDateOrNull(raw?.end_time);

  if (!endsAt && startsAt) {
    const durationMinutes = Number(raw?.duration_minutes || 60);
    endsAt = new Date(startsAt.getTime() + Math.max(durationMinutes, 1) * 60000);
  }

  if (!externalId || !externalActivityId || !externalCentreId || !startsAt || !endsAt) return null;

  return createEvent({
    externalId,
    externalActivityId,
    externalCentreId,
    startsAt,
    endsAt,
    title: raw?.title ?? null,
    description: normalizeHtmlToPlainText(raw?.description),
    url: raw?.activity_detail_url ?? null,
    metadata: raw,
  });
}

export function chunkArray(values, size) {
  const safeSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let i = 0; i < values.length; i += safeSize) {
    chunks.push(values.slice(i, i + safeSize));
  }
  return chunks;
}

export function toExternalCentreId(rawCenterEvent) {
  return toBigIntOrNull(rawCenterEvent?.center_id);
}

export function toCentreName(rawCenterEvent, fallbackExternalCentreId) {
  return String(rawCenterEvent?.center_name || `Centre ${fallbackExternalCentreId}`);
}
