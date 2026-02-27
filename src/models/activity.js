/**
 * @typedef {Object} Activity
 * @property {number} externalId
 * @property {string} name
 * @property {string|null} category
 * @property {string|null} description
 * @property {string[]|null} tags
 */

/**
 * @param {Partial<Activity>} input
 * @returns {Activity}
 */
export function createActivity(input) {
  return {
    externalId: input.externalId,
    name: input.name,
    category: input.category ?? null,
    description: input.description ?? null,
    tags: input.tags ?? null,
  };
}
