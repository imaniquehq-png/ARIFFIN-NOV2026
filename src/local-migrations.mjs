import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function migrateLocalDatabase(db, directory) {
  const journal=JSON.parse(await readFile(path.join(directory,'meta','_journal.json'),'utf8'));
  const migrations=await Promise.all(journal.entries.map(async ({tag})=>({
    tag, script:await readFile(path.join(directory,tag+'.sql'),'utf8'),
  })));
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS aj_local_migrations (tag TEXT PRIMARY KEY NOT NULL)');
    const applied=db.prepare('SELECT tag FROM aj_local_migrations WHERE tag=?');
    const mark=db.prepare('INSERT INTO aj_local_migrations(tag) VALUES(?)');
    // The first local release applied the operations schema in one transaction and used aj_events as its marker.
    const existingBaseline=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='aj_events'").get();
    if (existingBaseline && !applied.get('0000_operations')) mark.run('0000_operations');
    for (const migration of migrations) {
      if (applied.get(migration.tag)) continue;
      db.exec(migration.script);
      mark.run(migration.tag);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
