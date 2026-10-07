import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

// Return numeric/bigint aggregates as JS numbers (amounts here are far below 2^53).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number.parseFloat(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

export function createDb(url: string, max = 10): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
