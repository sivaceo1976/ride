import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://ride_admin:ride_password_secret@localhost:5432/ridehailing_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function runMigrations(): Promise<void> {
  const migrationFilePath = path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20261106000000_init_postgis',
    'migration.sql'
  );

  if (!fs.existsSync(migrationFilePath)) {
    throw new Error(`Migration file not found at ${migrationFilePath}`);
  }

  const sql = fs.readFileSync(migrationFilePath, 'utf8');
  console.log('Running PostGIS schema migration...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
