const {
  getSpotUsdtPriceDetailed,
  STABLE,
  PROVIDER_LABELS,
  normalizeProviderMode,
} = require('./bybit');

const FIAT = new Set(['RUB', 'USD']);

function isFiat(symbol) {
  return FIAT.has(symbol);
}

function providerLabel(id) {
  return PROVIDER_LABELS[id] || id;
}

async function getConversionRate(from, to, settings) {
  const usdRub = parseFloat(settings.usd_rub_rate || '92.5');
  const providerMode = normalizeProviderMode(settings.rate_provider);
  const providers = {};

  if (from === to) return { rate: 1, providers, providerMode };

  if (isFiat(from) && isFiat(to)) {
    if (from === 'USD' && to === 'RUB') {
      providers.usd_rub = 'manual';
      return { rate: usdRub, providers, providerMode };
    }
    if (from === 'RUB' && to === 'USD') {
      providers.usd_rub = 'manual';
      return { rate: 1 / usdRub, providers, providerMode };
    }
    return { rate: 1, providers, providerMode };
  }

  const usdOf = async (sym, amount = 1) => {
    if (sym === 'USD' || sym === 'USDT' || STABLE.has(sym)) return amount;
    if (sym === 'RUB') return amount / usdRub;
    const { price, provider } = await getSpotUsdtPriceDetailed(sym, providerMode);
    providers[sym] = provider;
    return amount * price;
  };

  const unitsOf = async (sym, usd) => {
    if (sym === 'USD' || sym === 'USDT' || STABLE.has(sym)) return usd;
    if (sym === 'RUB') return usd * usdRub;
    const { price, provider } = await getSpotUsdtPriceDetailed(sym, providerMode);
    providers[sym] = provider;
    return usd / price;
  };

  const usdValue = await usdOf(from, 1);
  const rate = await unitsOf(to, usdValue);
  return { rate, providers, providerMode };
}

async function convertAmount(from, to, amount, markupPercent, settings) {
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) throw new Error('Некорректная сумма');

  const { rate: rawRate, providers, providerMode } = await getConversionRate(from, to, settings);
  const factor = 1 - parseFloat(markupPercent) / 100;
  const effectiveRate = rawRate * factor;
  const result = amt * effectiveRate;

  const usedProviders = [...new Set(Object.values(providers))];
  const activeProvider = usedProviders.length === 1 ? usedProviders[0] : usedProviders.join('+');

  return {
    from,
    to,
    amountFrom: amt,
    amountTo: result,
    rawRate,
    effectiveRate,
    markupPercent: parseFloat(markupPercent),
    rateProviderMode: providerMode,
    rateProviders: providers,
    rateSource: activeProvider,
    rateSourceLabel: usedProviders.map(providerLabel).join(' + ') || providerLabel(providerMode),
  };
}

module.exports = {
  isFiat,
  convertAmount,
  getConversionRate,
};
