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

    CREATE TABLE IF NOT EXISTS tracked_clans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clan_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      last_trophies INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(clan_name, channel_id)
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

/**
 * Deletes a recap by its tag and recap_number.
 */
function deleteRecap({ tag, recap_number }) {
  const result = db.prepare('DELETE FROM recaps WHERE LOWER(tag) = LOWER(?) AND recap_number = ?')
                   .run(tag.trim(), recap_number);
  return result.changes;
}

/**
 * Adds a new clan to track in a channel.
 */
function addTrackedClan({ clan_name, channel_id, last_trophies }) {
  const timestamp = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO tracked_clans (clan_name, channel_id, last_trophies, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(clan_name, channel_id) DO UPDATE SET
      last_trophies = excluded.last_trophies,
      created_at = excluded.created_at
  `);
  insert.run(clan_name.trim(), channel_id, last_trophies, timestamp);
}

/**
 * Removes a tracked clan from a channel.
 */
function removeTrackedClan({ clan_name, channel_id }) {
  const result = db.prepare('DELETE FROM tracked_clans WHERE LOWER(clan_name) = LOWER(?) AND channel_id = ?')
                   .run(clan_name.trim(), channel_id);
  return result.changes;
}

/**
 * Gets all tracked clans.
 */
function getTrackedClans() {
  return db.prepare('SELECT * FROM tracked_clans').all();
}

/**
 * Updates the last trophy count for all records of a specific clan.
 */
function updateClanTrophies(clan_name, new_trophies) {
  db.prepare('UPDATE tracked_clans SET last_trophies = ? WHERE LOWER(clan_name) = LOWER(?)')
    .run(new_trophies, clan_name.trim());
}

module.exports = {
  setup,
  addRecap,
  getFilteredRecaps,
  deleteRecap,
  addTrackedClan,
  removeTrackedClan,
  getTrackedClans,
  updateClanTrophies,
  db
};
