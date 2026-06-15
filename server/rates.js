const { getSpotUsdtPrice, STABLE } = require('./bybit');

const FIAT = new Set(['RUB', 'USD']);

function isFiat(symbol) {
  return FIAT.has(symbol);
}

async function getConversionRate(from, to, settings) {
  const usdRub = parseFloat(settings.usd_rub_rate || '92.5');

  if (from === to) return 1;

  if (isFiat(from) && isFiat(to)) {
    if (from === 'USD' && to === 'RUB') return usdRub;
    if (from === 'RUB' && to === 'USD') return 1 / usdRub;
    return 1;
  }

  const usdOf = async (sym, amount = 1) => {
    if (sym === 'USD' || sym === 'USDT' || STABLE.has(sym)) return amount;
    if (sym === 'RUB') return amount / usdRub;
    const p = await getSpotUsdtPrice(sym);
    return amount * p;
  };

  const unitsOf = async (sym, usd) => {
    if (sym === 'USD' || sym === 'USDT' || STABLE.has(sym)) return usd;
    if (sym === 'RUB') return usd * usdRub;
    const p = await getSpotUsdtPrice(sym);
    return usd / p;
  };

  const usdValue = await usdOf(from, 1);
  return unitsOf(to, usdValue);
}

async function convertAmount(from, to, amount, markupPercent, settings) {
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) throw new Error('Некорректная сумма');

  const rawRate = await getConversionRate(from, to, settings);
  const factor = 1 - parseFloat(markupPercent) / 100;
  const effectiveRate = rawRate * factor;
  const result = amt * effectiveRate;

  return {
    from,
    to,
    amountFrom: amt,
    amountTo: result,
    rawRate,
    effectiveRate,
    markupPercent: parseFloat(markupPercent),
    source: 'bybit',
  };
}

module.exports = {
  isFiat,
  convertAmount,
  getConversionRate,
};
