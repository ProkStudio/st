const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const nativeFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : fetch;

const PROXY_CANDIDATES = [
  () => process.env.TELEGRAM_PROXY,
  () => process.env.HTTPS_PROXY,
  () => process.env.ALL_PROXY,
  () => 'http://127.0.0.1:10809',
  () => 'socks5://127.0.0.1:10808',
  () => 'http://127.0.0.1:7890',
  () => 'http://127.0.0.1:7897',
  () => 'socks5://127.0.0.1:1080',
];

function createFetchWithProxy(proxyUrl) {
  const agent = proxyUrl.startsWith('socks')
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);
  return (url, init = {}) => fetch(url, { ...init, agent });
}

async function testTelegram(token, customFetch, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await customFetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: controller.signal,
    });
    const data = await res.json();
    return data.ok ? data.result : null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTelegramFetch(token) {
  const tried = new Set();

  try {
    const me = await testTelegram(token, nativeFetch);
    if (me) return { fetchFn: nativeFetch, me, label: 'direct' };
  } catch (e) {
    console.log('⚠️  Telegram API напрямую недоступен:', e.cause?.code || e.message);
  }

  for (const getProxy of PROXY_CANDIDATES) {
    const proxy = getProxy();
    if (!proxy || tried.has(proxy)) continue;
    tried.add(proxy);
    try {
      const fetchFn = createFetchWithProxy(proxy);
      const me = await testTelegram(token, fetchFn);
      if (me) return { fetchFn, me, label: proxy };
    } catch {
      // try next
    }
  }

  throw new Error(
    'Не удалось подключиться к Telegram API. Включите VPN или добавьте TELEGRAM_PROXY=http://127.0.0.1:7890 в .env'
  );
}

module.exports = { resolveTelegramFetch, createFetchWithProxy };
