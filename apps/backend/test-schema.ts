import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

async function main() {
  const client = await pool.connect();
  try {
    const migrations = await client.query('SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5');
    console.log('--- Migrations ---');
    console.table(migrations.rows);

    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('otp_challenges', 'email_deliveries')
    `);
    console.log('--- Target Tables ---');
    console.table(tables.rows);

    const checkColumn = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'emailVerifiedAt'
    `);
    console.log('--- emailVerifiedAt Column ---');
    console.table(checkColumn.rows);

  } finally {
    client.release();
    pool.end();
  }
}

main().catch(console.error);
