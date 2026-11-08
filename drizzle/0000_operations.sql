CREATE TABLE aj_events (seq INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE aj_members (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL, password TEXT, active INTEGER NOT NULL DEFAULT 1);
--> statement-breakpoint
CREATE TABLE aj_sessions (token TEXT PRIMARY KEY, member_id TEXT NOT NULL, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE aj_files (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, creator TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE aj_attempts (email TEXT PRIMARY KEY, attempts INTEGER NOT NULL, until_time INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE aj_access_log (id TEXT PRIMARY KEY, stamp TEXT NOT NULL, actor TEXT NOT NULL, member_id TEXT NOT NULL, description TEXT NOT NULL);
