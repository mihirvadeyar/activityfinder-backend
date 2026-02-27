import {
  chunkArray,
  mergeFilterCentreWithDetails,
  normalizeActivity,
  normalizeCentre,
  normalizeEvent,
  toCentreName,
  toExternalCentreId,
} from "../models/providerMappers.js";
import { createCentre } from "../models/centre.js";

const MS_IN_DAY = 24 * 60 * 60 * 1000;

export function createIngestionService({
  providerClient,
  repository,
  provider,
  windowDays,
  centerChunkSize,
}) {
  function logIngestionSummary(summary) {
    console.info("[ingestion] completed", {
      provider: summary.provider,
      windowDays: summary.windowDays,
      windowStartUtc: summary.windowStartUtc,
      windowEndUtc: summary.windowEndUtc,
      activitiesUpserted: summary.activitiesUpserted,
      centresUpserted: summary.centresUpserted,
      eventsUpserted: summary.eventsUpserted,
      eventsSkippedOutOfWindow: summary.eventsSkippedOutOfWindow,
      eventsSkippedInvalid: summary.eventsSkippedInvalid,
      eventsDeletedOutsideWindow: summary.eventsDeletedOutsideWindow,
    });
  }

  return {
    async runIngestion() {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + windowDays * MS_IN_DAY);
      console.info("[ingestion] started", {
        provider,
        windowDays,
        windowStartUtc: now.toISOString(),
        windowEndUtc: windowEnd.toISOString(),
      });

      const counters = {
        activitiesUpserted: 0,
        centresUpserted: 0,
        eventsUpserted: 0,
        eventsSkippedOutOfWindow: 0,
        eventsSkippedInvalid: 0,
      };

      const centreIdByExternal = new Map();

      console.info("[ingestion] step=fetch_activities");
      const activities = (await providerClient.fetchActivities())
        .map(normalizeActivity)
        .filter(Boolean);
      console.info("[ingestion] step=fetch_activities_done", { activitiesFound: activities.length });

      for (const activity of activities) {
        console.info("[ingestion] step=activity_start", {
          activityExternalId: activity.externalId,
          activityName: activity.name,
        });
        const activityId = await repository.upsertActivity(activity);
        counters.activitiesUpserted += 1;
        console.info("[ingestion] step=activity_upserted", {
          activityExternalId: activity.externalId,
          activityId,
        });

        console.info("[ingestion] step=fetch_filters", { activityExternalId: activity.externalId });
        const filters = await providerClient.fetchFiltersByActivity(activity.externalId);
        const filterCentres = Array.isArray(filters.centres) ? filters.centres : [];
        const filterCentreIds = filterCentres
          .map((c) => Number(c?.id))
          .filter((id) => Number.isFinite(id));
        console.info("[ingestion] step=fetch_centre_details", {
          activityExternalId: activity.externalId,
          requestedCentreIds: filterCentreIds.length,
        });
        const centreDetails = await providerClient.fetchCentreDetailsByCentres(filterCentreIds);
        const centreDetailsById = new Map(
          centreDetails
            .map((d) => [Number(d?.id), d])
            .filter(([id]) => Number.isFinite(id)),
        );
        const centres = filterCentres
          .map((filterCentre) => {
            const details = centreDetailsById.get(Number(filterCentre?.id)) || null;
            return normalizeCentre(mergeFilterCentreWithDetails(filterCentre, details));
          })
          .filter(Boolean);
        console.info("[ingestion] step=fetch_filters_done", {
          activityExternalId: activity.externalId,
          filterCentresFound: filterCentres.length,
          centreDetailsFound: centreDetails.length,
          centresFound: centres.length,
          activitiesFoundInFilters: Array.isArray(filters.activities) ? filters.activities.length : 0,
        });

        for (const centre of centres) {
          if (!centreIdByExternal.has(centre.externalId)) {
            const centreId = await repository.upsertCentre(centre);
            centreIdByExternal.set(centre.externalId, centreId);
            counters.centresUpserted += 1;
          }
        }

        const centerIds = centres.map((c) => c.externalId);
        if (centerIds.length === 0) {
          console.info("[ingestion] step=activity_no_centres", { activityExternalId: activity.externalId });
          continue;
        }

        const centerIdChunks = chunkArray(centerIds, centerChunkSize);
        console.info("[ingestion] step=events_chunking", {
          activityExternalId: activity.externalId,
          totalCenters: centerIds.length,
          chunkSize: centerChunkSize,
          totalChunks: centerIdChunks.length,
        });
        for (const centerIdChunk of centerIdChunks) {
          console.info("[ingestion] step=fetch_events_chunk", {
            activityExternalId: activity.externalId,
            centersInChunk: centerIdChunk.length,
          });
          const centerEvents = await providerClient.fetchEventsByActivityAndCentres(
            activity.externalId,
            centerIdChunk,
          );
          console.info("[ingestion] step=fetch_events_chunk_done", {
            activityExternalId: activity.externalId,
            centerEventGroups: centerEvents.length,
          });

          for (const centerEvent of centerEvents) {
            const fallbackCentreExternalId = toExternalCentreId(centerEvent);
            const nestedEvents = Array.isArray(centerEvent?.events) ? centerEvent.events : [];

            for (const rawEvent of nestedEvents) {
              const event = normalizeEvent(rawEvent, activity.externalId, fallbackCentreExternalId);
              if (!event) {
                counters.eventsSkippedInvalid += 1;
                continue;
              }

              if (event.startsAt < now || event.startsAt >= windowEnd) {
                counters.eventsSkippedOutOfWindow += 1;
                continue;
              }

              let centreId = centreIdByExternal.get(event.externalCentreId);
              if (!centreId) {
                const fallbackCentre = createCentre({
                  externalId: event.externalCentreId,
                  name: toCentreName(centerEvent, event.externalCentreId),
                  description: null,
                  street: null,
                  city: "Vancouver",
                  state: "BC",
                  country: "Canada",
                  zipCode: null,
                  phone: null,
                });
                centreId = await repository.upsertCentre(fallbackCentre);
                centreIdByExternal.set(event.externalCentreId, centreId);
                counters.centresUpserted += 1;
              }

              await repository.upsertEvent(event, activityId, centreId);
              counters.eventsUpserted += 1;
            }
          }
        }
        console.info("[ingestion] step=activity_done", {
          activityExternalId: activity.externalId,
        });
      }

      console.info("[ingestion] step=cleanup_outside_window");
      const cleanupResult = await repository.cleanupEventsOutsideWindow(
        now.toISOString(),
        windowEnd.toISOString(),
      );
      console.info("[ingestion] step=cleanup_outside_window_done", {
        deletedRows: cleanupResult.count ?? 0,
      });

      const summary = {
        ...counters,
        eventsDeletedOutsideWindow: cleanupResult.count ?? 0,
        provider,
        windowDays,
        windowStartUtc: now.toISOString(),
        windowEndUtc: windowEnd.toISOString(),
      };

      logIngestionSummary(summary);
      return summary;
    },
  };
}
