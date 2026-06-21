const fetch = require('node-fetch');
const { getSetting, getAllSettings } = require('./db');
const {
  getLastWalletCheck,
  saveWalletCheck,
  getWalletCheckCooldownRemaining,
} = require('./db');
const { getConversionRate } = require('./rates');
const { isOn } = require('./settings');

const USDT_ERC20 = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ETH_RPCS = ['https://eth.llamarpc.com', 'https://cloudflare-eth.com'];

const RISK_LABELS = {
  empty: 'Пустой',
  unactivated: 'Не активирован',
  low: 'Мало средств',
  normal: 'Обычный',
  funded: 'Есть средства',
  whale: 'Крупный',
  exchange_like: 'Биржа/активный',
  error: 'Ошибка',
  unknown: 'Неизвестно',
};

const STABLE_SYMBOLS = new Set(['USDT', 'USDD', 'USDJ', 'TUSD', 'USDC']);

async function fetchJson(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function ethRpc(method, params) {
  let lastErr;
  for (const rpc of ETH_RPCS) {
    try {
      const data = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (data.error) throw new Error(data.error.message || 'rpc_error');
      return data.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('eth_rpc_unavailable');
}

function detectNetwork(address, hintCurrency) {
  const a = String(address || '').trim();
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,89}$/i.test(a)) return 'btc';
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return 'eth';
  if (/^T[A-Za-z1-9]{33}$/.test(a)) return 'trx';

  const h = String(hintCurrency || '').toUpperCase();
  if (h === 'BTC') return 'btc';
  if (h === 'ETH') return 'eth';
  if (h === 'TRX') return 'trx';
  if (h === 'USDT') {
    if (a.startsWith('0x')) return 'eth';
    if (a.startsWith('T')) return 'trx';
  }
  return null;
}

async function usdFor(symbol, amount, settings) {
  const amt = parseFloat(amount) || 0;
  if (!amt) return 0;
  const sym = String(symbol || '').toUpperCase();
  if (sym === 'USDT' || sym === 'USD') return amt;
  try {
    const { rate } = await getConversionRate(sym, 'USD', settings);
    return amt * rate;
  } catch {
    return 0;
  }
}

function assessRisk({ usdTotal, txCount }) {
  if (txCount === 0 && usdTotal <= 0) {
    return { label: 'empty', reason: 'Нет транзакций и баланса' };
  }
  if (txCount > 5000 || usdTotal > 100000) {
    return { label: 'exchange_like', reason: 'Очень высокая активность или баланс' };
  }
  if (usdTotal > 10000) {
    return { label: 'whale', reason: `Баланс ≈ $${Math.round(usdTotal).toLocaleString('en-US')}` };
  }
  if (usdTotal > 100) {
    return { label: 'funded', reason: `Баланс ≈ $${Math.round(usdTotal).toLocaleString('en-US')}` };
  }
  if (usdTotal < 10 && txCount < 3) {
    return { label: 'low', reason: 'Мало средств и мало транзакций' };
  }
  return { label: 'normal', reason: 'Типичный кошелёк' };
}

async function checkBtc(address, settings) {
  const data = await fetchJson(`https://blockstream.info/api/address/${encodeURIComponent(address)}`);
  const funded = Number(data.chain_stats?.funded_txo_sum || 0);
  const spent = Number(data.chain_stats?.spent_txo_sum || 0);
  const sats = Math.max(0, funded - spent);
  const btc = sats / 1e8;
  const txCount = Number(data.chain_stats?.tx_count || 0);
  const usd = await usdFor('BTC', btc, settings);
  const native = { symbol: 'BTC', amount: btc, usd };
  const tokens = [];
  const usdTotal = usd;
  const risk = assessRisk({ usdTotal, txCount });
  return {
    network: 'btc',
    native,
    tokens,
    tx_count: txCount,
    usd_total: usdTotal,
    risk,
    api_source: 'blockstream',
  };
}

async function checkEth(address, settings) {
  const addr = address.toLowerCase();
  const [balanceHex, txHex] = await Promise.all([
    ethRpc('eth_getBalance', [addr, 'latest']),
    ethRpc('eth_getTransactionCount', [addr, 'latest']),
  ]);
  const wei = BigInt(balanceHex || '0x0');
  const eth = Number(wei) / 1e18;
  const txCount = parseInt(txHex || '0x0', 16) || 0;

  const balData = `0x70a08231${addr.slice(2).padStart(64, '0')}`;
  let usdtRaw = '0x0';
  try {
    usdtRaw = await ethRpc('eth_call', [{ to: USDT_ERC20, data: balData }, 'latest']);
  } catch { /* ignore */ }
  const usdt = Number(BigInt(usdtRaw || '0x0')) / 1e6;

  const [ethUsd, usdtUsd] = await Promise.all([
    usdFor('ETH', eth, settings),
    usdFor('USDT', usdt, settings),
  ]);

  const tokens = [];
  if (usdt > 0) tokens.push({ symbol: 'USDT', network: 'ERC20', amount: usdt, usd: usdtUsd, contract: USDT_ERC20 });
  const usdTotal = ethUsd + usdtUsd;
  const risk = assessRisk({ usdTotal, txCount });

  return {
    network: 'eth',
    native: { symbol: 'ETH', amount: eth, usd: ethUsd },
    tokens,
    tx_count: txCount,
    usd_total: usdTotal,
    risk,
    api_source: 'eth_rpc',
  };
}

async function fetchTronScanAccount(address) {
  return fetchJson(`https://apilist.tronscan.org/api/account?address=${encodeURIComponent(address)}`);
}

async function fetchTronGetAccount(address) {
  const data = await fetchJson('https://api.trongrid.io/wallet/getaccount', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, visible: true }),
  });
  return data && typeof data === 'object' ? data : {};
}

async function fetchTronGridV1Account(address) {
  const data = await fetchJson(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}`);
  return data.data?.[0] || null;
}

function parseTrc20FromGrid(acc) {
  const out = [];
  for (const entry of acc?.trc20 || []) {
    const [contract, rawBal] = Object.entries(entry)[0] || [];
    const raw = Number(rawBal || 0);
    if (!contract || !raw) continue;
    out.push({
      tokenId: contract,
      balance: String(rawBal),
      tokenDecimal: contract.toUpperCase() === USDT_TRC20 ? 6 : 6,
      tokenAbbr: contract.toUpperCase() === USDT_TRC20 ? 'USDT' : 'TOKEN',
    });
  }
  return out;
}

async function tokenUsdFromTronScan(t, settings) {
  const raw = Number(t.balance || 0);
  if (!raw) return { amount: 0, usd: 0 };
  const dec = Number(t.tokenDecimal ?? 6);
  const amount = raw / (10 ** dec);
  if (amount <= 0) return { amount: 0, usd: 0 };

  const sym = String(t.tokenAbbr || '').toUpperCase();
  if (STABLE_SYMBOLS.has(sym)) {
    return { amount, usd: amount };
  }
  if (t.amount && Number(t.amount) > 0) {
    const usd = await usdFor('TRX', Number(t.amount), settings);
    return { amount, usd };
  }
  return { amount, usd: 0 };
}

async function checkTrx(address, settings) {
  const [scan, getAcc, gridAcc] = await Promise.all([
    fetchTronScanAccount(address).catch(() => null),
    fetchTronGetAccount(address).catch(() => ({})),
    fetchTronGridV1Account(address).catch(() => null),
  ]);

  if (!scan?.address && !Object.keys(getAcc || {}).length && !gridAcc) {
    throw new Error('tron_api_unavailable');
  }

  const balanceSun = Number(
    getAcc?.balance ?? gridAcc?.balance ?? scan?.balance ?? 0
  );
  const trx = balanceSun / 1e6;
  const txCount = Number(scan?.totalTransactionCount || 0);
  const getAccActive = !!(getAcc && Object.keys(getAcc).length > 0);

  const trc20Raw = (scan?.trc20token_balances?.length
    ? scan.trc20token_balances
    : parseTrc20FromGrid(gridAcc));

  const tokens = [];
  let tokensUsd = 0;
  for (const t of trc20Raw) {
    const { amount, usd } = await tokenUsdFromTronScan(t, settings);
    if (amount <= 0) continue;
    tokensUsd += usd;
    if (tokens.length < 25) {
      tokens.push({
        symbol: String(t.tokenAbbr || t.tokenName || 'TOKEN').toUpperCase(),
        network: 'TRC20',
        amount,
        usd,
        contract: t.tokenId || '',
      });
    }
  }

  const trxUsd = await usdFor('TRX', trx, settings);
  const usdTotal = trxUsd + tokensUsd;
  const unactivated = !getAccActive && txCount === 0 && balanceSun === 0 && tokens.length === 0;

  let risk;
  if (unactivated) {
    risk = {
      label: 'unactivated',
      reason: 'Адрес не активирован в TRON: в блокчейне нет ни одной транзакции. Баланс в приложении-кошельке может относиться к другой сети (BTC, ETH и т.д.).',
    };
  } else {
    risk = assessRisk({ usdTotal, txCount });
  }

  return {
    network: 'trx',
    native: { symbol: 'TRX', amount: trx, usd: trxUsd },
    tokens,
    tx_count: txCount,
    usd_total: usdTotal,
    risk,
    api_source: 'tronscan+trongrid',
    unactivated,
  };
}

function serializeCheckRow(row) {
  if (!row) return null;
  let balances = {};
  try {
    balances = JSON.parse(row.balances_json || '{}');
  } catch { /* ignore */ }
  return {
    id: row.id,
    address: row.address,
    network: row.network,
    order_id: row.order_id || '',
    source: row.source || 'manual',
    native: balances.native || null,
    tokens: balances.tokens || [],
    tx_count: row.tx_count,
    usd_total: row.usd_total,
    risk: {
      label: row.risk_label,
      label_ru: RISK_LABELS[row.risk_label] || row.risk_label,
      reason: row.risk_reason || '',
    },
    error: row.error || '',
    api_source: balances.api_source || '',
    created_at: row.created_at,
  };
}

async function runWalletCheck({ address, network, hintCurrency, orderId, source = 'manual', force = false }) {
  if (!isOn(getSetting('wallet_check_enabled', '1'))) {
    throw new Error('Проверка кошельков отключена в настройках');
  }

  const addr = String(address || '').trim();
  if (!addr) throw new Error('Укажите адрес');

  const net = network || detectNetwork(addr, hintCurrency);
  if (!net) throw new Error('Не удалось определить сеть (поддерживаются BTC, ETH, TRX)');

  const cooldownMin = parseInt(getSetting('wallet_check_cooldown_minutes', '5'), 10) || 5;
  const remainingMs = getWalletCheckCooldownRemaining(addr, net, cooldownMin);
  if (!force && remainingMs > 0) {
    const last = getLastWalletCheck(addr, net);
    if (last) {
      const check = serializeCheckRow(last);
      return {
        ...check,
        cached: true,
        cooldown_remaining_sec: Math.ceil(remainingMs / 1000),
        message: `Повторная проверка через ${Math.ceil(remainingMs / 60000)} мин.`,
      };
    }
    throw new Error(`Подождите ${Math.ceil(remainingMs / 60000)} мин. перед повторной проверкой`);
  }

  const settings = getAllSettings();
  let result;
  let error = '';

  try {
    if (net === 'btc') result = await checkBtc(addr, settings);
    else if (net === 'eth') result = await checkEth(addr, settings);
    else if (net === 'trx') result = await checkTrx(addr, settings);
    else throw new Error('unsupported_network');
  } catch (e) {
    error = e.message || 'check_failed';
    result = {
      network: net,
      native: null,
      tokens: [],
      tx_count: 0,
      usd_total: 0,
      risk: { label: 'error', reason: error },
      api_source: '',
    };
  }

  const balancesJson = JSON.stringify({
    native: result.native,
    tokens: result.tokens,
    api_source: result.api_source,
  });

  const row = saveWalletCheck({
    address: addr,
    network: net,
    order_id: orderId || '',
    source,
    balances_json: balancesJson,
    usd_total: result.usd_total || 0,
    tx_count: result.tx_count || 0,
    risk_label: result.risk?.label || 'error',
    risk_reason: result.risk?.reason || '',
    error,
  });

  const check = serializeCheckRow(row);
  return { ...check, cached: false, error: error || check.error };
}

function scheduleWalletCheckForOrder(order) {
  if (!order?.address) return;
  if (!isOn(getSetting('wallet_check_enabled', '1'))) return;
  if (!isOn(getSetting('wallet_check_auto_on_order', '1'))) return;

  setImmediate(() => {
    runWalletCheck({
      address: order.address,
      hintCurrency: order.to_currency,
      orderId: order.id,
      source: 'order_auto',
    }).catch((e) => console.error('Wallet check auto failed:', e.message));
  });
}

module.exports = {
  RISK_LABELS,
  detectNetwork,
  runWalletCheck,
  scheduleWalletCheckForOrder,
  serializeCheckRow,
};
