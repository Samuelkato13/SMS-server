import pg from 'pg';

const { Pool } = pg;

// ── PostgreSQL pool (primary database) ──────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/edupay',
  // Supabase Postgres requires SSL even in development.
  ssl: process.env.NODE_ENV === 'production' || (process.env.DATABASE_URL?.includes("supabase.") ?? false)
    ? { rejectUnauthorized: false }
    : false,
  // Some environments only resolve/allow IPv6 for Supabase DB hosts.
  // If you have IPv4-only connectivity, set PGFAMILY=4 and use the pooler host instead.
  ...(process.env.DATABASE_URL?.includes("supabase.")
    ? { family: parseInt(process.env.PGFAMILY || "6", 10) }
    : null),
});

export default pool;
