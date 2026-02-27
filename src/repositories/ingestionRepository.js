export function createIngestionRepository({ sql, provider }) {
  return {
    /**
     * @param {import("../models/activity.js").Activity} activity
     */
    async upsertActivity(activity) {
      const [row] = await sql`
        insert into activity (
          name, category, description, tags, external_id, provider, created_at, updated_at
        ) values (
          ${activity.name},
          ${activity.category},
          ${activity.description},
          ${activity.tags},
          ${activity.externalId},
          ${provider},
          now(),
          now()
        )
        on conflict (external_id, provider)
        do update set
          name = excluded.name,
          category = excluded.category,
          description = excluded.description,
          tags = excluded.tags,
          updated_at = now()
        returning id;
      `;

      return row.id;
    },

    /**
     * @param {import("../models/centre.js").Centre} centre
     */
    async upsertCentre(centre) {
      const [row] = await sql`
        insert into centre (
          name, description, street, city, state, country, zip_code, phone, external_id, provider, created_at, updated_at
        ) values (
          ${centre.name},
          ${centre.description},
          ${centre.street},
          ${centre.city},
          ${centre.state},
          ${centre.country},
          ${centre.zipCode},
          ${centre.phone},
          ${centre.externalId},
          ${provider},
          now(),
          now()
        )
        on conflict (external_id, provider)
        do update set
          name = excluded.name,
          description = excluded.description,
          street = excluded.street,
          city = excluded.city,
          state = excluded.state,
          country = excluded.country,
          zip_code = excluded.zip_code,
          phone = excluded.phone,
          updated_at = now()
        returning id;
      `;

      return row.id;
    },

    /**
     * @param {import("../models/event.js").Event} event
     * @param {number} activityId
     * @param {number} centreId
     */
    async upsertEvent(event, activityId, centreId) {
      await sql`
        insert into event (
          external_activity_id, external_centre_id, starts_at, ends_at,
          title, description, url, metadata, provider, activity_id, centre_id, external_id,
          created_at, updated_at
        ) values (
          ${event.externalActivityId},
          ${event.externalCentreId},
          ${event.startsAt.toISOString()},
          ${event.endsAt.toISOString()},
          ${event.title},
          ${event.description},
          ${event.url},
          ${JSON.stringify(event.metadata)}::jsonb,
          ${provider},
          ${activityId},
          ${centreId},
          ${event.externalId},
          now(),
          now()
        )
        on conflict (external_activity_id, external_centre_id, starts_at, external_id, provider)
        do update set
          ends_at = excluded.ends_at,
          title = excluded.title,
          description = excluded.description,
          url = excluded.url,
          metadata = excluded.metadata,
          activity_id = excluded.activity_id,
          centre_id = excluded.centre_id,
          updated_at = now();
      `;
    },

    async cleanupEventsOutsideWindow(nowIso, windowEndIso) {
      return sql`
        delete from event
        where provider = ${provider}
          and (
            starts_at < ${nowIso}::timestamptz
            or starts_at >= ${windowEndIso}::timestamptz
          );
      `;
    },

    async getHealthDbTime() {
      const [row] = await sql`select now() as now;`;
      return row.now;
    },
  };
}
