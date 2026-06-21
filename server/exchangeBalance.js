const {
  fetchBybitBalanceReport,
  maskApiKey,
  getApiCreds,
  queryApiKeyInfo,
} = require('./bybit');
const {
  saveExchangeBalanceCheck,
  getExchangeCheckCooldownRemaining,
  getLastExchangeBalanceCheck,
} = require('./db');

const EXCHANGE_LABELS = {
  bybit: 'Bybit',
};

const RISK_LABELS = {
  empty: 'Пустой',
  low: 'Мало средств',
  normal: 'Обычный',
  funded: 'Есть средства',
  whale: 'Крупный',
  error: 'Ошибка',
};

function assessExchangeRisk({ usdTotal, usdtTotal }) {
  const usd = Math.max(usdTotal || 0, usdtTotal || 0);
  if (usd <= 0) {
    return { label: 'empty', reason: 'На бирже нет средств (или только нулевые балансы)' };
  }
  if (usd < 10) {
    return { label: 'low', reason: `Баланс ≈ $${usd.toFixed(2)}` };
  }
  if (usd < 100) {
    return { label: 'normal', reason: `Баланс ≈ $${usd.toFixed(2)}` };
  }
  if (usd < 10000) {
    return { label: 'funded', reason: `Баланс ≈ $${Math.round(usd).toLocaleString('en-US')}` };
  }
  return { label: 'whale', reason: `Крупный баланс ≈ $${Math.round(usd).toLocaleString('en-US')}` };
}

function serializeExchangeCheckRow(row) {
  if (!row) return null;
  let balances = {};
  try {
    balances = JSON.parse(row.balances_json || '{}');
  } catch { /* ignore */ }
  return {
    id: row.id,
    type: 'exchange',
    exchange: row.exchange,
    api_key_mask: row.api_key_mask || '',
    order_id: row.order_id || '',
    source: row.source || 'manual',
    read_only: !!row.read_only,
    total_equity_usd: row.usd_total,
    usdt_total: row.usdt_total,
    coins: balances.coins || [],
    api_note: balances.api_note || '',
    available_usd: balances.available_usd || 0,
    risk: {
      label: row.risk_label,
      label_ru: RISK_LABELS[row.risk_label] || row.risk_label,
      reason: row.risk_reason || '',
    },
    error: row.error || '',
    created_at: row.created_at,
  };
}

async function runExchangeBalanceCheck({
  exchange = 'bybit',
  apiKey,
  apiSecret,
  orderId,
  source = 'manual',
  usePlatformKeys = false,
  force = false,
}) {
  const ex = String(exchange || 'bybit').toLowerCase();
  if (ex !== 'bybit') throw new Error('Пока поддерживается только Bybit');

  let creds;
  if (usePlatformKeys) {
    creds = getApiCreds();
    source = 'platform';
  } else {
    creds = { key: apiKey, secret: apiSecret };
  }

  const keyMask = maskApiKey(creds.key);
  const cooldownMin = 2;
  const remainingMs = getExchangeCheckCooldownRemaining(ex, keyMask, cooldownMin);
  if (!force && remainingMs > 0) {
    const last = getLastExchangeBalanceCheck(ex, keyMask);
    if (last) {
      const check = serializeExchangeCheckRow(last);
      return {
        ...check,
        cached: true,
        cooldown_remaining_sec: Math.ceil(remainingMs / 1000),
        message: `Повторная проверка через ${Math.ceil(remainingMs / 60000) || 1} мин.`,
      };
    }
  }

  let report;
  let error = '';
  try {
    if (!usePlatformKeys) {
      const keyInfo = await queryApiKeyInfo(creds);
      if (keyInfo?.readOnly === 0) {
        throw new Error('Ключ не read-only. Создайте ключ только для чтения в Bybit → API');
      }
    }
    if (!creds.key || !creds.secret) {
      throw new Error('Укажите API Key и Secret (read-only) или используйте «Наш Bybit»');
    }
    report = await fetchBybitBalanceReport(creds);
  } catch (e) {
    error = e.message || 'exchange_check_failed';
    report = {
      exchange: 'bybit',
      read_only: false,
      api_note: '',
      total_equity_usd: 0,
      total_wallet_usd: 0,
      available_usd: 0,
      usdt_total: 0,
      coins: [],
    };
  }

  const usdTotal = report.total_equity_usd || report.total_wallet_usd || 0;
  const risk = error
    ? { label: 'error', reason: error }
    : assessExchangeRisk({ usdTotal, usdtTotal: report.usdt_total });

  const row = saveExchangeBalanceCheck({
    exchange: ex,
    api_key_mask: keyMask,
    order_id: orderId || '',
    source,
    read_only: report.read_only ? 1 : 0,
    balances_json: JSON.stringify({
      coins: report.coins,
      api_note: report.api_note,
      available_usd: report.available_usd,
      total_wallet_usd: report.total_wallet_usd,
    }),
    usd_total: usdTotal,
    usdt_total: report.usdt_total || 0,
    risk_label: risk.label,
    risk_reason: risk.reason,
    error,
  });

  const check = serializeExchangeCheckRow(row);
  return { ...check, cached: false, error: error || check.error };
}

module.exports = {
  EXCHANGE_LABELS,
  RISK_LABELS,
  runExchangeBalanceCheck,
  serializeExchangeCheckRow,
};
