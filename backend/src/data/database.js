const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { DB } = require('../config/constants');

const dbFile = path.isAbsolute(DB.FILE) ? DB.FILE : path.join(__dirname, '..', '..', DB.FILE);
const dataDir = path.dirname(dbFile);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pen_name TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    parent_id INTEGER,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    kind TEXT NOT NULL DEFAULT 'normal',
    sealed INTEGER NOT NULL DEFAULT 0,
    sealed_by INTEGER,
    sealed_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES letters(id)
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    letter_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, letter_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_letters_sender ON letters(sender_id);
  CREATE INDEX IF NOT EXISTS idx_letters_receiver ON letters(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_letters_parent ON letters(parent_id);
`);

// Migrate databases created before farewell letters were introduced
const letterColumns = db.prepare('PRAGMA table_info(letters)').all();
const hasColumn = (name) => letterColumns.some((c) => c.name === name);
if (!hasColumn('kind')) {
  db.exec(`ALTER TABLE letters ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal'`);
}
if (!hasColumn('sealed')) {
  db.exec(`ALTER TABLE letters ADD COLUMN sealed INTEGER NOT NULL DEFAULT 0`);
}
if (!hasColumn('sealed_by')) {
  db.exec('ALTER TABLE letters ADD COLUMN sealed_by INTEGER');
}
if (!hasColumn('sealed_at')) {
  db.exec('ALTER TABLE letters ADD COLUMN sealed_at INTEGER');
}

module.exports = db;
