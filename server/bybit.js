const crypto = require('crypto');

const BASE = 'https://api.bybit.com';

const STABLE = new Set(['USDT', 'USD', 'USDC', 'BUSD', 'USDP', 'TUSD']);

const SPOT_PAIR = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  LTC: 'LTCUSDT',
  XRP: 'XRPUSDT',
  BNB: 'BNBUSDT',
  ADA: 'ADAUSDT',
  DOGE: 'DOGEUSDT',
  SOL: 'SOLUSDT',
  TRX: 'TRXUSDT',
  DOT: 'DOTUSDT',
  MATIC: 'POLUSDT',
  AVAX: 'AVAXUSDT',
  LINK: 'LINKUSDT',
  ATOM: 'ATOMUSDT',
  XLM: 'XLMUSDT',
  BCH: 'BCHUSDT',
  DASH: 'DASHUSDT',
  ZEC: 'ZECUSDT',
  ETC: 'ETCUSDT',
  EOS: 'EOSUSDT',
  FTM: 'FTMUSDT',
  SHIB: 'SHIBUSDT',
  TON: 'TONUSDT',
  XTZ: 'XTZUSDT',
  VET: 'VETUSDT',
  BAT: 'BATUSDT',
  ZRX: 'ZRXUSDT',
  MKR: 'MKRUSDT',
  BTT: 'BTTUSDT',
  CAKE: 'CAKEUSDT',
  TWT: 'TWTUSDT',
};

const priceCache = new Map();
const CACHE_TTL = 15_000;

function getApiCreds() {
  return {
    key: process.env.BYBIT_API_KEY || '',
    secret: process.env.BYBIT_API_SECRET || '',
  };
}

function signRequest(timestamp, apiKey, recvWindow, payload) {
  const { secret } = getApiCreds();
  return crypto.createHmac('sha256', secret).update(timestamp + apiKey + recvWindow + payload).digest('hex');
}

async function publicGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(data.retMsg || `Bybit ${data.retCode}`);
  return data.result;
}

async function privateGet(path, params = {}) {
  const { key, secret } = getApiCreds();
  if (!key || !secret) throw new Error('Bybit API keys not configured');

  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`);
  const queryString = sorted.join('&');
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const signature = signRequest(timestamp, key, recvWindow, queryString);

  const url = `${BASE}${path}?${queryString}`;
  const res = await fetch(url, {
    headers: {
      'X-BAPI-API-KEY': key,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      Accept: 'application/json',
    },
  });
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(data.retMsg || `Bybit ${data.retCode}`);
  return data.result;
}

async function getSpotUsdtPrice(symbol) {
  if (STABLE.has(symbol)) return 1;

  const pair = SPOT_PAIR[symbol] || `${symbol}USDT`;
  const cacheKey = pair;
  const hit = priceCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.price;

  const result = await publicGet('/v5/market/tickers', { category: 'spot', symbol: pair });
  const ticker = result.list?.[0];
  if (!ticker?.lastPrice) throw new Error(`Пара ${pair} не найдена на Bybit`);

  const price = parseFloat(ticker.lastPrice);
  priceCache.set(cacheKey, { ts: Date.now(), price });
  return price;
}

async function getUsdPrices(symbols) {
  const out = {};
  const unique = [...new Set(symbols.filter((s) => !['RUB'].includes(s)))];
  await Promise.all(
    unique.map(async (sym) => {
      out[sym] = await getSpotUsdtPrice(sym);
    })
  );
  return out;
}

async function queryDeposits(limit = 50) {
  const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const result = await privateGet('/v5/asset/deposit/query-record', {
    limit: String(limit),
    startTime: String(startTime),
  });
  return result.rows || [];
}

const DEPOSIT_STATUS = {
  0: 'Неизвестно',
  1: 'Ожидает подтверждений',
  2: 'Обрабатывается',
  3: 'Зачислено',
  4: 'Ошибка',
  10011: 'Отменено',
};

module.exports = {
  STABLE,
  SPOT_PAIR,
  getSpotUsdtPrice,
  getUsdPrices,
  queryDeposits,
  DEPOSIT_STATUS,
};
