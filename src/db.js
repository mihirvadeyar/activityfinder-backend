import "dotenv/config";
import postgres from "postgres";

/**
 * Postgres client singleton used by repositories.
 */
const { PGHOST, PGDATABASE, PGUSER, PGPASSWORD, PGPORT } = process.env;

if (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD) {
  throw new Error("Missing one or more required Postgres env vars: PGHOST, PGDATABASE, PGUSER, PGPASSWORD");
}

export const sql = postgres({
  host: PGHOST,
  database: PGDATABASE,
  username: PGUSER,
  password: PGPASSWORD,
  port: Number(PGPORT || 5432),
  ssl: 'require',
  max: 5,              // small pool for Neon
  idle_timeout: 20,
  connect_timeout: 10,
});
