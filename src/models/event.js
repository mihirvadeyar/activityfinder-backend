/**
 * @typedef {Object} Event
 * @property {number} externalId
 * @property {number} externalActivityId
 * @property {number} externalCentreId
 * @property {Date} startsAt
 * @property {Date} endsAt
 * @property {string|null} title
 * @property {string|null} description
 * @property {string|null} url
 * @property {Object} metadata
 */

/**
 * @param {Partial<Event>} input
 * @returns {Event}
 */
export function createEvent(input) {
  return {
    externalId: input.externalId,
    externalActivityId: input.externalActivityId,
    externalCentreId: input.externalCentreId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    title: input.title ?? null,
    description: input.description ?? null,
    url: input.url ?? null,
    metadata: input.metadata ?? {},
  };
}
