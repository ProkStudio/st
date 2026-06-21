const fetch = require('node-fetch');

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(str) {
  const bytes = [0];
  for (const c of String(str)) {
    const val = BASE58.indexOf(c);
    if (val < 0) throw new Error('invalid_base58');
    let carry = val;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const c of String(str)) {
    if (c === '1') bytes.push(0);
    else break;
  }
  return Buffer.from(bytes.reverse());
}

function tronAddressToAbiParam(base58Address) {
  const hex = decodeBase58(base58Address).toString('hex');
  const body = hex.startsWith('41') ? hex.slice(2) : hex.slice(-40);
  return body.padStart(64, '0');
}

async function tronPost(path, body, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.trongrid.io${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, visible: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrxBalanceSun(address) {
  const acc = await tronPost('/wallet/getaccount', { address });
  if (!acc || !Object.keys(acc).length) return { sun: 0, active: false };
  return { sun: Number(acc.balance || 0), active: true };
}

async function fetchTrc20BalanceRaw(address, contractAddress) {
  const parameter = tronAddressToAbiParam(address);
  const data = await tronPost('/wallet/triggerconstantcontract', {
    owner_address: address,
    contract_address: contractAddress,
    function_selector: 'balanceOf(address)',
    parameter,
  });
  const hex = data?.constant_result?.[0] || '0';
  try {
    return BigInt(`0x${hex}`).toString();
  } catch {
    return '0';
  }
}

function tronExplorerAddressUrl(address) {
  return `https://tronscan.org/#/address/${encodeURIComponent(address)}`;
}

module.exports = {
  decodeBase58,
  tronAddressToAbiParam,
  fetchTrxBalanceSun,
  fetchTrc20BalanceRaw,
  tronExplorerAddressUrl,
};
