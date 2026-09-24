import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const client = await pool.connect();
  try {
    await client.query("ALTER ROLE postgres WITH PASSWORD 'ElectroHub_Dev_2026_Secure!'");
    console.log('Password rotated successfully in DB');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}
main();
