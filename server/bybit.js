const crypto = require('crypto');

const BASE = 'https://api.bybit.com';
const BINANCE_BASE = 'https://api.binance.com';
const OKX_BASE = 'https://www.okx.com';
const COINGECKO_BASE = 'https://api.coingecko.com';

const STABLE = new Set(['USDT', 'USD', 'USDC', 'BUSD', 'USDP', 'TUSD']);

const RATE_PROVIDERS = ['auto', 'bybit', 'binance', 'okx', 'coingecko'];
const PROVIDER_CHAIN = ['bybit', 'binance', 'okx', 'coingecko'];

const PROVIDER_LABELS = {
  auto: 'Авто',
  bybit: 'Bybit',
  binance: 'Binance',
  okx: 'OKX',
  coingecko: 'CoinGecko',
  fixed: 'Фиксированный',
  manual: 'Вручную (USD/RUB)',
};

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

const OKX_PAIR = {
  BTC: 'BTC-USDT',
  ETH: 'ETH-USDT',
  LTC: 'LTC-USDT',
  XRP: 'XRP-USDT',
  BNB: 'BNB-USDT',
  ADA: 'ADA-USDT',
  DOGE: 'DOGE-USDT',
  SOL: 'SOL-USDT',
  TRX: 'TRX-USDT',
  DOT: 'DOT-USDT',
  MATIC: 'POL-USDT',
  AVAX: 'AVAX-USDT',
  LINK: 'LINK-USDT',
  ATOM: 'ATOM-USDT',
  TON: 'TON-USDT',
};

const COINGECKO_ID = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  LTC: 'litecoin',
  XRP: 'ripple',
  BNB: 'binancecoin',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  SOL: 'solana',
  TRX: 'tron',
  DOT: 'polkadot',
  MATIC: 'polygon-ecosystem-token',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  ATOM: 'cosmos',
  TON: 'the-open-network',
};

const PAIR_ALIASES = {
  POLUSDT: ['POLUSDT', 'MATICUSDT'],
  MATICUSDT: ['MATICUSDT', 'POLUSDT'],
};

const priceCache = new Map();
const CACHE_TTL = 15_000;

let lastFetchInfo = { provider: null, symbol: null, at: null };

function normalizeEnv(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function normalizeProviderMode(mode) {
  const v = String(mode || 'auto').toLowerCase();
  return RATE_PROVIDERS.includes(v) ? v : 'auto';
}

function getApiCreds() {
  return {
    key: normalizeEnv(process.env.BYBIT_API_KEY),
    secret: normalizeEnv(process.env.BYBIT_API_SECRET),
  };
}

function pairCandidates(symbol) {
  const primary = SPOT_PAIR[symbol] || `${symbol}USDT`;
  const aliases = PAIR_ALIASES[primary] || [primary];
  return [...new Set(aliases)];
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) throw new Error(`Пустой ответ HTTP ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Некорректный JSON (${res.status}): ${text.slice(0, 120)}`);
  }
}

function signRequest(timestamp, apiKey, recvWindow, payload) {
  const { secret } = getApiCreds();
  return crypto.createHmac('sha256', secret).update(timestamp + apiKey + recvWindow + payload).digest('hex');
}

async function publicGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await readJsonResponse(res);
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
  const data = await readJsonResponse(res);
  if (data.retCode !== 0) throw new Error(data.retMsg || `Bybit ${data.retCode}`);
  return data.result;
}

async function fetchBybitPrice(pair) {
  const result = await publicGet('/v5/market/tickers', { category: 'spot', symbol: pair });
  const ticker = result.list?.[0];
  const price = parseFloat(ticker?.lastPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Bybit: пара ${pair} не найдена`);
  return price;
}

async function fetchBinancePrice(pair) {
  const url = `${BINANCE_BASE}/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await readJsonResponse(res);
  const price = parseFloat(data?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Binance: пара ${pair} не найдена`);
  return price;
}

async function fetchOkxPrice(symbol) {
  const instId = OKX_PAIR[symbol] || `${symbol}-USDT`;
  const url = `${OKX_BASE}/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await readJsonResponse(res);
  const price = parseFloat(data?.data?.[0]?.last);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`OKX: пара ${instId} не найдена`);
  return price;
}

async function fetchCoinGeckoPrice(symbol) {
  const id = COINGECKO_ID[symbol];
  if (!id) throw new Error(`CoinGecko: нет id для ${symbol}`);
  const url = `${COINGECKO_BASE}/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await readJsonResponse(res);
  const price = parseFloat(data?.[id]?.usd);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`CoinGecko: нет цены для ${symbol}`);
  return price;
}

async function fetchPriceFromProvider(symbol, provider, pair) {
  if (provider === 'bybit') return fetchBybitPrice(pair);
  if (provider === 'binance') return fetchBinancePrice(pair);
  if (provider === 'okx') return fetchOkxPrice(symbol);
  if (provider === 'coingecko') return fetchCoinGeckoPrice(symbol);
  throw new Error(`Неизвестный провайдер: ${provider}`);
}

function rememberFetch(provider, symbol) {
  lastFetchInfo = { provider, symbol, at: Date.now() };
}

function getLastRateProvider() {
  return { ...lastFetchInfo };
}

async function getSpotUsdtPriceDetailed(symbol, providerMode = 'auto', skipCache = false) {
  if (STABLE.has(symbol)) {
    rememberFetch('fixed', symbol);
    return { price: 1, provider: 'fixed' };
  }

  const mode = normalizeProviderMode(providerMode);
  const pairs = pairCandidates(symbol);
  const cacheKey = `${mode}:${pairs[0]}`;
  if (!skipCache) {
    const hit = priceCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      rememberFetch(hit.provider, symbol);
      return { price: hit.price, provider: hit.provider };
    }
  }

  const errors = [];
  const providersToTry = mode === 'auto' ? PROVIDER_CHAIN : [mode];

  for (const provider of providersToTry) {
    if (provider === 'okx' || provider === 'coingecko') {
      try {
        const price = await fetchPriceFromProvider(symbol, provider, pairs[0]);
        priceCache.set(cacheKey, { ts: Date.now(), price, provider });
        rememberFetch(provider, symbol);
        return { price, provider };
      } catch (e) {
        errors.push(e.message);
      }
      continue;
    }

    for (const pair of pairs) {
      try {
        const price = await fetchPriceFromProvider(symbol, provider, pair);
        priceCache.set(cacheKey, { ts: Date.now(), price, provider });
        rememberFetch(provider, symbol);
        return { price, provider };
      } catch (e) {
        errors.push(e.message);
      }
    }
  }

  throw new Error(`Не удалось получить цену ${symbol}: ${errors[errors.length - 1] || 'нет источников'}`);
}

async function getSpotUsdtPrice(symbol, providerMode = 'auto') {
  const { price } = await getSpotUsdtPriceDetailed(symbol, providerMode);
  return price;
}

async function probeProvider(symbol, provider) {
  const started = Date.now();
  try {
    const { price } = await getSpotUsdtPriceDetailed(symbol, provider, true);
    return {
      provider,
      label: PROVIDER_LABELS[provider] || provider,
      ok: true,
      price,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    return {
      provider,
      label: PROVIDER_LABELS[provider] || provider,
      ok: false,
      error: e.message,
      latencyMs: Date.now() - started,
    };
  }
}

async function probeAllProviders(symbol = 'BTC') {
  const probes = await Promise.all(PROVIDER_CHAIN.map((p) => probeProvider(symbol, p)));
  return probes;
}

async function getUsdPrices(symbols, providerMode = 'auto') {
  const out = {};
  const unique = [...new Set(symbols.filter((s) => !['RUB'].includes(s)))];
  await Promise.all(
    unique.map(async (sym) => {
      out[sym] = await getSpotUsdtPrice(sym, providerMode);
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
  RATE_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_CHAIN,
  getSpotUsdtPrice,
  getSpotUsdtPriceDetailed,
  getLastRateProvider,
  probeProvider,
  probeAllProviders,
  normalizeProviderMode,
  getUsdPrices,
  queryDeposits,
  DEPOSIT_STATUS,
};
