export function createProviderClient(options) {
  const {
    apiBaseUrl,
    activitiesPath,
    filtersPath,
    centreDetailsPath,
    eventsPath,
    activityDetailsPathPrefix,
    requestTimeoutMs,
  } = options;

  if (!apiBaseUrl) {
    throw new Error("Missing PROVIDER_API_BASE_URL in .env");
  }

  async function requestJson({ method, path, query = {}, body = null }) {
    const normalizedBase = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
    const normalizedPath = String(path || "").replace(/^\/+/, "");
    const url = new URL(normalizedPath, normalizedBase);
    Object.entries(query).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") {
        url.searchParams.set(k, String(v));
      }
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      const contentType = response.headers.get("content-type") || "";
      const rawText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Provider request failed (${response.status}) for ${url.pathname}. Content-Type=${contentType}. Body=${rawText.slice(0, 300)}`,
        );
      }

      if (!contentType.includes("application/json")) {
        throw new Error(
          `Provider returned non-JSON response for ${url.pathname}. Content-Type=${contentType}. Body=${rawText.slice(0, 300)}`,
        );
      }

      try {
        return JSON.parse(rawText);
      } catch (error) {
        throw new Error(
          `Provider returned invalid JSON for ${url.pathname}. Content-Type=${contentType}. Body=${rawText.slice(0, 300)}. ParseError=${error.message}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async fetchActivities() {
      const payload = await requestJson({ method: "GET", path: activitiesPath });
      return Array.isArray(payload?.body?.calendars) ? payload.body.calendars : [];
    },
    async fetchFiltersByActivity(activityExternalId) {
      const payload = await requestJson({
        method: "POST",
        path: filtersPath,
        body: { calendar_id: activityExternalId },
      });
      return {
        centres: Array.isArray(payload?.body?.center) ? payload.body.center : [],
        activities: Array.isArray(payload?.body?.activity) ? payload.body.activity : [],
      };
    },
    async fetchCentreDetailsByCentres(centreExternalIds) {
      const centerIds = (centreExternalIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));

      if (centerIds.length === 0) return [];

      const payload = await requestJson({
        method: "GET",
        path: centreDetailsPath,
        query: {
          center_ids: centerIds.join(","),
        },
      });
      return Array.isArray(payload?.body?.center_details) ? payload.body.center_details : [];
    },
    async fetchEventsByActivityAndCentres(activityExternalId, centreExternalIds) {
      const payload = await requestJson({
        method: "POST",
        path: eventsPath,
        body: {
          calendar_id: activityExternalId,
          center_ids: centreExternalIds,
        },
      });
      return Array.isArray(payload?.body?.center_events) ? payload.body.center_events : [];
    },
    async fetchActivityDetails(activityItemId, selectedDate) {
      const path = `${activityDetailsPathPrefix}/${activityItemId}`;
      const query = selectedDate ? { selected_date: selectedDate } : {};
      const payload = await requestJson({ method: "GET", path, query });
      return payload?.body?.activity_detail || null;
    },
  };
}
