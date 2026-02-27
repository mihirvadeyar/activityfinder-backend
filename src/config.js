import "dotenv/config";

/**
 * Centralized runtime configuration from environment variables.
 */
export const config = {
  port: Number(process.env.PORT || 3000),
  adminToken: process.env.ADMIN_TOKEN || "devsecret",
  provider: process.env.PROVIDER || "activeCommunities",
  query: {
    categoryDefaults: {
      sports: {
        categoryName: "Sports",
        activityNames: ["Other"],
      },
      unknown: {
        categoryName: "Sports",
        activityNames: ["Other"],
      },
    },
  },
  ingestion: {
    windowDays: Number(process.env.INGEST_WINDOW_DAYS || 30),
    apiBaseUrl: process.env.PROVIDER_API_BASE_URL || "https://anc.ca.apm.activecommunities.com/vancouver",
    activitiesPath:
      process.env.PROVIDER_ACTIVITIES_PATH ||
      process.env.PROVIDER_CALENDARS_PATH ||
      "/rest/onlinecalendar/calendars",
    filtersPath: process.env.PROVIDER_FILTERS_PATH || "/rest/onlinecalendar/filters",
    centreDetailsPath:
      process.env.PROVIDER_CENTRE_DETAILS_PATH || "/rest/onlinecalendar/centerdetails",
    eventsPath: process.env.PROVIDER_EVENTS_PATH || "/rest/onlinecalendar/multicenter/events",
    activityDetailsPathPrefix: process.env.PROVIDER_ACTIVITY_DETAILS_PATH_PREFIX || "/rest/onlinecalendar/activity-details",
    requestTimeoutMs: Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 30000),
    centerChunkSize: Number(process.env.PROVIDER_CENTER_CHUNK_SIZE || 50),
  },
  ai: {
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
      requestTimeoutMs: Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS || 20000),
      models: {
        understanding:
          process.env.OLLAMA_MODEL_UNDERSTANDING ||
          process.env.OLLAMA_MODEL ||
          "qwen2.5:3b",
        summary:
          process.env.OLLAMA_MODEL_SUMMARY ||
          process.env.OLLAMA_MODEL ||
          "llama3.2:3b",
      },
    },
  },
};
