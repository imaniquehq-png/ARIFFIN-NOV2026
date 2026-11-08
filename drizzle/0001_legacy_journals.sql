CREATE TABLE aj_legacy_sources (id TEXT PRIMARY KEY NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, imported_by TEXT NOT NULL, imported_at TEXT NOT NULL, UNIQUE(id, hash));
--> statement-breakpoint
CREATE TABLE aj_legacy_sheets (source_id TEXT NOT NULL, sheet_id TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, imported_by TEXT NOT NULL, imported_at TEXT NOT NULL, PRIMARY KEY(source_id, sheet_id), UNIQUE(source_id, sheet_id, hash), FOREIGN KEY(source_id) REFERENCES aj_legacy_sources(id));
--> statement-breakpoint
CREATE TABLE aj_legacy_rows (source_id TEXT NOT NULL, sheet_id TEXT NOT NULL, row_no INTEGER NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, imported_by TEXT NOT NULL, imported_at TEXT NOT NULL, PRIMARY KEY(source_id, sheet_id, row_no), UNIQUE(source_id, sheet_id, row_no, hash), FOREIGN KEY(source_id, sheet_id) REFERENCES aj_legacy_sheets(source_id, sheet_id));
