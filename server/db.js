const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { formatDeviceInfo } = require('./deviceInfo');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'bambusito.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    amount_from REAL NOT NULL,
    amount_to REAL NOT NULL,
    rate REAL NOT NULL,
    markup_percent REAL NOT NULL,
    address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bybit_deposits_seen (
    id TEXT PRIMARY KEY,
    coin TEXT,
    amount TEXT,
    status INTEGER,
    seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    ip TEXT DEFAULT '',
    country TEXT DEFAULT '',
    city TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    unread_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const defaults = {
  markup_percent: '1.5',
  usd_rub_rate: '92.5',
  site_name: 'Bambusito228',
  deposit_wallet: '',
  order_ttl_minutes: '30',
  chat_operator_name: 'Bambusito228 Support',
  rate_provider: 'auto',
};

const orderColumns = [
  ['deposit_address', "TEXT NOT NULL DEFAULT ''"],
  ['expires_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['order_type', "TEXT NOT NULL DEFAULT 'float'"],
  ['chat_session_id', "TEXT NOT NULL DEFAULT ''"],
];
for (const [col, def] of orderColumns) {
  try {
    db.prepare(`SELECT ${col} FROM orders LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def}`);
  }
}

const chatColumns = [
  ['seq', 'INTEGER NOT NULL DEFAULT 0'],
  ['order_id', "TEXT NOT NULL DEFAULT ''"],
  ['device_info', "TEXT NOT NULL DEFAULT ''"],
];
for (const [col, def] of chatColumns) {
  try {
    db.prepare(`SELECT ${col} FROM chat_sessions LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN ${col} ${def}`);
  }
}

(function migrateChatSeq() {
  const missing = db.prepare('SELECT id FROM chat_sessions WHERE seq IS NULL OR seq = 0 ORDER BY created_at ASC').all();
  if (!missing.length) return;
  let n = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM chat_sessions').get().m;
  const upd = db.prepare('UPDATE chat_sessions SET seq = ? WHERE id = ?');
  for (const row of missing) {
    n += 1;
    upd.run(n, row.id);
  }
})();

for (const [key, value] of Object.entries(defaults)) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

const adminHash = db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get();
if (!adminHash) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_username', ?)").run(
    process.env.ADMIN_USERNAME || 'admin'
  );
}

if (process.env.ADMIN_PASSWORD) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('admin_password_hash', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10));
} else if (!adminHash) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT INTO settings (key, value) VALUES ('admin_password_hash', ?)").run(hash);
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_username', ?)").run('admin');
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

(function migrateDepositWallet() {
  const walletRow = db.prepare("SELECT value FROM settings WHERE key = 'deposit_wallet'").get();
  if (walletRow?.value) return;
  try {
    const oldRow = db.prepare("SELECT value FROM settings WHERE key = 'deposit_addresses'").get();
    const old = oldRow ? JSON.parse(oldRow.value || '{}') : {};
    const migrated = old.DEFAULT || old.BTC || Object.values(old).find(Boolean) || '';
    if (migrated) setSetting('deposit_wallet', migrated);
  } catch { /* ignore */ }
})();

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function getDepositWallet() {
  return getSetting('deposit_wallet', '') || '';
}

function setDepositWallet(address) {
  setSetting('deposit_wallet', String(address || '').trim());
}

function resolveDepositAddress() {
  return getDepositWallet();
}

function createOrder(data) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO orders (
      id, from_currency, to_currency, amount_from, amount_to, rate, markup_percent,
      address, deposit_address, expires_at, order_type, chat_session_id, status, created_at, updated_at
    )
    VALUES (
      @id, @from_currency, @to_currency, @amount_from, @amount_to, @rate, @markup_percent,
      @address, @deposit_address, @expires_at, @order_type, @chat_session_id, 'pending', @now, @now
    )
  `).run({
    order_type: 'float',
    deposit_address: '',
    expires_at: 0,
    chat_session_id: '',
    ...data,
    now,
  });
  if (data.chat_session_id) {
    linkChatSessionToOrder(data.chat_session_id, data.id);
  }
  return getOrder(data.id);
}

function getOrder(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function listOrders(limit = 50, offset = 0) {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
}

function countOrders(status = null) {
  if (status) {
    return db.prepare('SELECT COUNT(*) as c FROM orders WHERE status = ?').get(status).c;
  }
  return db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
}

function updateOrderStatus(id, status, note = '') {
  const now = Date.now();
  db.prepare('UPDATE orders SET status = ?, note = ?, updated_at = ? WHERE id = ?').run(status, note, now, id);
  return getOrder(id);
}

function updateOrder(id, fields) {
  const allowed = ['status', 'note', 'deposit_address', 'expires_at'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (!sets.length) return getOrder(id);
  values.push(Date.now(), id);
  db.prepare(`UPDATE orders SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values);
  return getOrder(id);
}

function stats() {
  const total = countOrders();
  const pending = countOrders('pending');
  const completed = countOrders('completed');
  const volume = db.prepare(`
    SELECT COALESCE(SUM(amount_from), 0) as vol FROM orders WHERE status = 'completed'
  `).get().vol;
  return { total, pending, completed, volume };
}

function isDepositSeen(id) {
  return !!db.prepare('SELECT id FROM bybit_deposits_seen WHERE id = ?').get(id);
}

function markDepositSeen(id, coin, amount, status) {
  db.prepare(`
    INSERT OR IGNORE INTO bybit_deposits_seen (id, coin, amount, status, seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, coin || '', String(amount || ''), Number(status) || 0, Date.now());
}

function getChatSession(id) {
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
}

function nextChatSeq() {
  return db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM chat_sessions').get().n;
}

function createChatSession(data) {
  const now = Date.now();
  const seq = data.seq || nextChatSeq();
  db.prepare(`
    INSERT INTO chat_sessions (
      id, seq, order_id, ip, country, city, user_agent, device_info,
      unread_admin, created_at, last_message_at
    )
    VALUES (
      @id, @seq, @order_id, @ip, @country, @city, @user_agent, @device_info,
      0, @now, @now
    )
  `).run({
    order_id: '',
    ip: '',
    country: '',
    city: '',
    user_agent: '',
    device_info: '',
    ...data,
    seq,
    now,
  });
  return getChatSession(data.id);
}

function updateChatSessionMeta(id, fields) {
  const allowed = ['ip', 'country', 'city', 'user_agent', 'device_info', 'order_id'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (!sets.length) return getChatSession(id);
  vals.push(id);
  db.prepare(`UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getChatSession(id);
}

function linkChatSessionToOrder(sessionId, orderId) {
  if (!sessionId || !orderId) return null;
  db.prepare('UPDATE chat_sessions SET order_id = ? WHERE id = ?').run(orderId, sessionId);
  db.prepare('UPDATE orders SET chat_session_id = ? WHERE id = ?').run(sessionId, orderId);
  return getChatSession(sessionId);
}

function syncChatSessionOrder(sessionId) {
  const session = getChatSession(sessionId);
  if (!session) return null;

  const linked = db.prepare(`
    SELECT id FROM orders
    WHERE chat_session_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId);

  if (linked && linked.id !== session.order_id) {
    db.prepare('UPDATE chat_sessions SET order_id = ? WHERE id = ?').run(linked.id, sessionId);
    return getChatSession(sessionId);
  }

  if (session.order_id && getOrder(session.order_id)) {
    return session;
  }

  if (linked) {
    db.prepare('UPDATE chat_sessions SET order_id = ? WHERE id = ?').run(linked.id, sessionId);
    return getChatSession(sessionId);
  }

  return session;
}

function enrichChatSession(session) {
  if (!session) return null;
  const synced = syncChatSessionOrder(session.id) || session;
  let order = null;
  if (synced.order_id) order = getOrder(synced.order_id);
  return {
    ...synced,
    order,
    device_label: formatDeviceInfo(synced.device_info, synced.user_agent),
  };
}

function upsertChatSessionGeo(id, geo) {
  db.prepare(`
    UPDATE chat_sessions SET ip = ?, country = ?, city = ? WHERE id = ?
  `).run(geo.ip || '', geo.country || '', geo.city || '', id);
  return getChatSession(id);
}

function listChatSessions(limit = 50) {
  const rows = db.prepare(`
    SELECT s.*, (
      SELECT body FROM chat_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1
    ) AS last_preview
    FROM chat_sessions s
    ORDER BY s.last_message_at DESC
    LIMIT ?
  `).all(limit);
  return rows.map((s) => enrichChatSession(s));
}

function listChatMessages(sessionId, since = 0) {
  if (since) {
    return db.prepare(`
      SELECT * FROM chat_messages WHERE session_id = ? AND created_at > ? ORDER BY created_at ASC
    `).all(sessionId, since);
  }
  return db.prepare(`
    SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC
  `).all(sessionId);
}

function addChatMessage(sessionId, sender, body) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO chat_messages (session_id, sender, body, created_at) VALUES (?, ?, ?, ?)
  `).run(sessionId, sender, body, now);
  const unreadDelta = sender === 'visitor' ? 1 : 0;
  db.prepare(`
    UPDATE chat_sessions SET last_message_at = ?, unread_admin = unread_admin + ? WHERE id = ?
  `).run(now, unreadDelta, sessionId);
  return db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
}

function markChatSessionRead(sessionId) {
  db.prepare('UPDATE chat_sessions SET unread_admin = 0 WHERE id = ?').run(sessionId);
}

function countUnreadChats() {
  return db.prepare('SELECT COUNT(*) as c FROM chat_sessions WHERE unread_admin > 0').get().c;
}

module.exports = {
  db,
  getSetting,
  setSetting,
  getAllSettings,
  getDepositWallet,
  setDepositWallet,
  resolveDepositAddress,
  createOrder,
  getOrder,
  listOrders,
  countOrders,
  updateOrderStatus,
  updateOrder,
  stats,
  isDepositSeen,
  markDepositSeen,
  getChatSession,
  createChatSession,
  updateChatSessionMeta,
  linkChatSessionToOrder,
  syncChatSessionOrder,
  enrichChatSession,
  upsertChatSessionGeo,
  listChatSessions,
  listChatMessages,
  addChatMessage,
  markChatSessionRead,
  countUnreadChats,
};
