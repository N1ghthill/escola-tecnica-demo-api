import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { env } from "./env.js";
import { buildPoolConfig, shouldWarnAboutSupabaseDirectConnection } from "./dbConfig.js";

const connectionString = env("DATABASE_URL");

if (shouldWarnAboutSupabaseDirectConnection(connectionString) && process.env.NODE_ENV !== "test") {
  console.warn(
    "DATABASE_URL appears to use direct Supabase Postgres host. Prefer Supabase pooler (port 6543) for production."
  );
}

const pool = new Pool(buildPoolConfig(connectionString));

export type DbClient = PoolClient;

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      throw error;
    }
  });
}
