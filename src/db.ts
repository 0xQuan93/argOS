import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { join } from 'path';

let dbInstance: Database | null = null;

export async function initDB() {
  if (dbInstance) return dbInstance;

  const db = await open({
    filename: join(process.cwd(), 'backrooms.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS backrooms (
      id INTEGER PRIMARY KEY,
      name TEXT,
      state TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance = db;
  return db;
}

export async function saveBackroomState(id: number, name: string, state: any) {
  const db = await initDB();
  await db.run(
    'INSERT OR REPLACE INTO backrooms (id, name, state, last_updated) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
    id,
    name,
    JSON.stringify(state)
  );
}

export async function loadBackroomState(id: number) {
  const db = await initDB();
  const row = await db.get('SELECT state FROM backrooms WHERE id = ?', id);
  return row ? JSON.parse(row.state) : null;
}

