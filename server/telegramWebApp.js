const crypto = require('crypto');

const INIT_DATA_MAX_AGE_SEC = 86400;

function parseAdminIds() {
  const raw = process.env.TELEGRAM_ADMIN_IDS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Boolean);
}

function validateTelegramWebAppInitData(initData, botToken, maxAgeSec = INIT_DATA_MAX_AGE_SEC) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(String(initData));
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calculatedHash !== hash) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
  if (!user?.id) return null;

  return { user, authDate, queryId: params.get('query_id') || null };
}

function getPublicUrl() {
  return (process.env.PUBLIC_URL || 'https://bambusito.up.railway.app').replace(/\/$/, '');
}

function getMiniAppUrl() {
  return `${getPublicUrl()}/admin/tg`;
}

module.exports = {
  parseAdminIds,
  validateTelegramWebAppInitData,
  getPublicUrl,
  getMiniAppUrl,
};
