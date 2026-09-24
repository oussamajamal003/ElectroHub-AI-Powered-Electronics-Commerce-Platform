import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("UPDATE _prisma_migrations SET finished_at = NOW(), applied_steps_count = 1, logs = NULL WHERE migration_name = '20240101000000_database_foundation'");
    await client.query("INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('20240103000000', 'checksum', NOW(), '20240103000000_email_otp_foundation', NULL, NULL, NOW(), 1) ON CONFLICT DO NOTHING");
    console.log('Resolved migrations in _prisma_migrations');
  } catch(e) {
    console.error('Error resolving:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}
main();
