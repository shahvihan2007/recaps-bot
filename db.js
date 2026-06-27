const Database = require('better-sqlite3');
const path = require('path');

const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'recaps.db');

// Ensure parent directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Initialize database table
function setup() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL,
      link TEXT NOT NULL,
      map TEXT NOT NULL,
      duration TEXT NOT NULL,
      mode TEXT NOT NULL,
      winners TEXT NOT NULL,
      players TEXT NOT NULL,
      comment TEXT,
      uuid TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      recap_number INTEGER NOT NULL
    );
  `);
}

/**
 * Inserts a new recap, calculating the next recap_number for the tag.
 */
function addRecap({ tag, link, map, duration, mode, winners, players, comment, uuid }) {
  // Calculate next recap number for the tag
  const numRow = db.prepare('SELECT COALESCE(MAX(recap_number), 0) + 1 AS nextNum FROM recaps WHERE LOWER(tag) = LOWER(?)')
                   .get(tag);
  const nextRecapNum = numRow ? numRow.nextNum : 1;
  const timestamp = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO recaps (tag, link, map, duration, mode, winners, players, comment, uuid, timestamp, recap_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    tag,
    link,
    map,
    duration,
    mode,
    winners,
    players,
    comment || null,
    uuid,
    timestamp,
    nextRecapNum
  );

  return {
    recap_number: nextRecapNum,
    timestamp
  };
}

/**
 * Query recaps with filters: player, tag, month.
 */
function getFilteredRecaps({ player, tag, month }) {
  let query = 'SELECT * FROM recaps WHERE 1=1';
  const params = {};

  if (tag) {
    query += ' AND LOWER(tag) = LOWER(:tag)';
    params.tag = tag.trim();
  }

  if (player) {
    query += ' AND players LIKE :player';
    params.player = `%${player.trim()}%`;
  }

  if (month) {
    // month is expected to be a 2-digit string e.g. "01", "02", ..., "12"
    query += " AND strftime('%m', timestamp) = :month";
    params.month = month;
  }

  query += ' ORDER BY id DESC';

  return db.prepare(query).all(params);
}

module.exports = {
  setup,
  addRecap,
  getFilteredRecaps,
  db
};
