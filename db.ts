import pg from 'pg';

const { Pool } = pg;

// ── PostgreSQL pool (primary database) ──────────────────────────────────
const connectionString = process.env.DATABASE_URL || "postgresql://localhost:5432/edupay";

// Hosted Postgres (Render, Neon, Supabase, RDS, etc.) almost always requires TLS.
const hostNeedsSsl =
  /supabase\.|neon\.tech|render\.com|amazonaws\.com|aiven\.cloud|cockroachlabs\.cloud/i.test(
    connectionString,
  );
const useSsl =
  process.env.NODE_ENV === "production" || hostNeedsSsl || connectionString.includes("sslmode=require");

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  // Some environments only resolve/allow IPv6 for Supabase DB hosts.
  // If you have IPv4-only connectivity, set PGFAMILY=4 and use the pooler host instead.
  ...(connectionString.includes("supabase.")
    ? { family: parseInt(process.env.PGFAMILY || "6", 10) }
    : null),
});

export default pool;
