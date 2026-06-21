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
  CREATE TABLE IF NOT EXISTS wallet_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    network TEXT NOT NULL,
    order_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    balances_json TEXT NOT NULL DEFAULT '{}',
    usd_total REAL NOT NULL DEFAULT 0,
    tx_count INTEGER NOT NULL DEFAULT 0,
    risk_label TEXT NOT NULL DEFAULT '',
    risk_reason TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wallet_checks_address ON wallet_checks(address, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wallet_checks_order ON wallet_checks(order_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS exchange_balance_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL,
    api_key_mask TEXT NOT NULL DEFAULT '',
    order_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    read_only INTEGER NOT NULL DEFAULT 0,
    balances_json TEXT NOT NULL DEFAULT '{}',
    usd_total REAL NOT NULL DEFAULT 0,
    usdt_total REAL NOT NULL DEFAULT 0,
    risk_label TEXT NOT NULL DEFAULT '',
    risk_reason TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_exchange_checks_created ON exchange_balance_checks(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_exchange_checks_mask ON exchange_balance_checks(exchange, api_key_mask, created_at DESC);
`);

const defaults = {
  markup_percent: '1.5',
  usd_rub_rate: '92.5',
  site_name: 'Bambusito228',
  site_tagline: 'Быстрый обмен криптовалют',
  accent_color: '#22c55e',
  deposit_wallet: '',
  order_ttl_minutes: '30',
  chat_operator_name: 'Bambusito228 Support',
  chat_welcome_message: 'Здравствуйте! Чем можем помочь?',
  chat_offline_message: 'Оператор ответит в ближайшее время.',
  chat_work_hours: '09:00-21:00',
  chat_work_start: '09:00',
  chat_work_end: '21:00',
  chat_show_online: '1',
  rate_provider: 'auto',
  rate_refresh_sec: '60',
  exchange_min_usd: '50',
  exchange_max_usd: '50000',
  maintenance_mode: '0',
  maintenance_message: 'Обмен временно приостановлен. Попробуйте позже.',
  maintenance_schedule_enabled: '0',
  maintenance_schedule_start: '02:00',
  maintenance_schedule_end: '08:00',
  contact_telegram: '',
  contact_email: '',
  rules_text: '',
  faq_text: '',
  notif_new_order: '1',
  notif_order_status: '0',
  notif_chat_message: '1',
  notif_bybit_deposit: '1',
  notif_maintenance: '1',
  wallet_check_enabled: '1',
  wallet_check_auto_on_order: '1',
  wallet_check_cooldown_minutes: '5',
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

(function migrateSettingsCleanup() {
  const email = db.prepare("SELECT value FROM settings WHERE key = 'contact_email'").get();
  if (email && /^#[0-9a-fA-F]{6}$/i.test(String(email.value).trim())) {
    db.prepare("UPDATE settings SET value = '' WHERE key = 'contact_email'").run();
  }
  const hasStart = db.prepare("SELECT 1 FROM settings WHERE key = 'chat_work_start'").get();
  if (!hasStart) {
    const legacy = db.prepare("SELECT value FROM settings WHERE key = 'chat_work_hours'").get();
    const m = String(legacy?.value || '09:00-21:00').match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
    const start = m ? m[1] : '09:00';
    const end = m ? m[2] : '21:00';
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('chat_work_start', ?)").run(start);
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('chat_work_end', ?)").run(end);
  }
})();

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

function saveWalletCheck(data) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO wallet_checks (
      address, network, order_id, source, balances_json,
      usd_total, tx_count, risk_label, risk_reason, error, created_at
    ) VALUES (
      @address, @network, @order_id, @source, @balances_json,
      @usd_total, @tx_count, @risk_label, @risk_reason, @error, @now
    )
  `).run({
    order_id: '',
    source: 'manual',
    error: '',
    ...data,
    now,
  });
  return db.prepare('SELECT * FROM wallet_checks WHERE id = ?').get(info.lastInsertRowid);
}

function getLastWalletCheck(address, network = null) {
  const addr = String(address || '').trim();
  if (!addr) return null;
  if (network) {
    return db.prepare(`
      SELECT * FROM wallet_checks WHERE address = ? AND network = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(addr, network);
  }
  return db.prepare(`
    SELECT * FROM wallet_checks WHERE address = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(addr);
}

function getLastWalletCheckForOrder(orderId) {
  if (!orderId) return null;
  return db.prepare(`
    SELECT * FROM wallet_checks WHERE order_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(orderId);
}

function listWalletChecks(limit = 50, offset = 0) {
  return db.prepare(`
    SELECT * FROM wallet_checks ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(Math.min(limit, 200), offset);
}

function getWalletCheckCooldownRemaining(address, network, cooldownMinutes) {
  const last = getLastWalletCheck(address, network);
  if (!last) return 0;
  const cooldownMs = Math.max(1, cooldownMinutes) * 60 * 1000;
  const elapsed = Date.now() - last.created_at;
  return Math.max(0, cooldownMs - elapsed);
}

function saveExchangeBalanceCheck(data) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO exchange_balance_checks (
      exchange, api_key_mask, order_id, source, read_only, balances_json,
      usd_total, usdt_total, risk_label, risk_reason, error, created_at
    ) VALUES (
      @exchange, @api_key_mask, @order_id, @source, @read_only, @balances_json,
      @usd_total, @usdt_total, @risk_label, @risk_reason, @error, @now
    )
  `).run({
    order_id: '',
    source: 'manual',
    read_only: 0,
    error: '',
    ...data,
    now,
  });
  return db.prepare('SELECT * FROM exchange_balance_checks WHERE id = ?').get(info.lastInsertRowid);
}

function getLastExchangeBalanceCheck(exchange, apiKeyMask) {
  return db.prepare(`
    SELECT * FROM exchange_balance_checks
    WHERE exchange = ? AND api_key_mask = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(exchange, apiKeyMask);
}

function listExchangeBalanceChecks(limit = 50, offset = 0) {
  return db.prepare(`
    SELECT * FROM exchange_balance_checks ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(Math.min(limit, 200), offset);
}

function getExchangeCheckCooldownRemaining(exchange, apiKeyMask, cooldownMinutes) {
  const last = getLastExchangeBalanceCheck(exchange, apiKeyMask);
  if (!last) return 0;
  const cooldownMs = Math.max(1, cooldownMinutes) * 60 * 1000;
  return Math.max(0, cooldownMs - (Date.now() - last.created_at));
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
  saveWalletCheck,
  getLastWalletCheck,
  getLastWalletCheckForOrder,
  listWalletChecks,
  getWalletCheckCooldownRemaining,
  saveExchangeBalanceCheck,
  getLastExchangeBalanceCheck,
  listExchangeBalanceChecks,
  getExchangeCheckCooldownRemaining,
};
