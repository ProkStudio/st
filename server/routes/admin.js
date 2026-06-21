const express = require('express');
const {
  getAllSettings,
  setSetting,
  listOrders,
  getOrder,
  updateOrderStatus,
  updateOrder,
  getDepositWallet,
  setDepositWallet,
  stats,
  listChatSessions,
  getChatSession,
  enrichChatSession,
  listChatMessages,
  addChatMessage,
  markChatSessionRead,
  countUnreadChats,
  listWalletChecks,
  getLastWalletCheck,
  getLastWalletCheckForOrder,
  listExchangeBalanceChecks,
} = require('../db');
const { authMiddleware, login, changePassword, signToken } = require('../auth');
const {
  applySettingsPatch,
  formatAdminSettings,
} = require('../settings');
const { convertAmount } = require('../rates');
const {
  probeAllProviders,
  getSpotUsdtPriceDetailed,
  getLastRateProvider,
  PROVIDER_LABELS,
  RATE_PROVIDERS,
  normalizeProviderMode,
} = require('../bybit');
const { validateTelegramWebAppInitData, parseAdminIds } = require('../telegramWebApp');
const { runWalletCheck, serializeCheckRow, RISK_LABELS } = require('../walletChecker');
const { runExchangeBalanceCheck, serializeExchangeCheckRow, EXCHANGE_LABELS } = require('../exchangeBalance');

function createAdminRouter(notifyOrderUpdate, notifyAdmins) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const token = login(username, password);
    if (!token) return res.status(401).json({ error: 'Неверный логин или пароль' });
    res.json({ token });
  });

  router.post('/tg-auth', (req, res) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(503).json({ error: 'Telegram бот не настроен' });
    }

    const parsed = validateTelegramWebAppInitData(req.body?.initData, botToken);
    if (!parsed) {
      return res.status(401).json({ error: 'Недействительные данные Telegram' });
    }

    const adminIds = parseAdminIds();
    if (!adminIds.includes(parsed.user.id)) {
      return res.status(403).json({ error: 'Доступ только для администраторов' });
    }

    const name = [parsed.user.first_name, parsed.user.last_name].filter(Boolean).join(' ');
    const token = signToken({
      role: 'admin',
      username: `tg_${parsed.user.id}`,
      tgId: parsed.user.id,
    });

    res.json({
      token,
      user: {
        id: parsed.user.id,
        name,
        username: parsed.user.username || null,
      },
    });
  });

  router.use(authMiddleware);

  router.get('/me', (req, res) => {
    res.json({ admin: req.admin });
  });

  router.get('/dashboard', (_req, res) => {
    const s = stats();
    const settings = getAllSettings();
    res.json({
      stats: s,
      settings: formatAdminSettings(settings, {
        deposit_wallet: getDepositWallet(),
        unread_chats: countUnreadChats(),
        rate_provider: normalizeProviderMode(settings.rate_provider),
      }),
    });
  });

  router.get('/rate-status', async (_req, res) => {
    try {
      const settings = getAllSettings();
      const mode = normalizeProviderMode(settings.rate_provider);
      const probes = await probeAllProviders('BTC');
      let active = null;
      let activePrice = null;
      let activeError = null;
      try {
        const result = await getSpotUsdtPriceDetailed('BTC', mode);
        active = result.provider;
        activePrice = result.price;
      } catch (e) {
        activeError = e.message;
      }
      res.json({
        mode,
        modeLabel: PROVIDER_LABELS[mode] || mode,
        activeProvider: active,
        activeProviderLabel: active ? PROVIDER_LABELS[active] || active : null,
        activePrice,
        activeError,
        lastFetch: getLastRateProvider(),
        probes,
        providers: RATE_PROVIDERS.map((id) => ({
          id,
          label: PROVIDER_LABELS[id] || id,
        })),
      });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  router.get('/settings', (_req, res) => {
    const s = getAllSettings();
    res.json(formatAdminSettings(s, { deposit_wallet: getDepositWallet() }));
  });

  router.patch('/settings', async (req, res) => {
    const { errors, maintenanceActivated } = applySettingsPatch(req.body, { setDepositWallet });
    if (errors.length) return res.status(400).json({ error: errors[0] });

    if (req.body.rate_provider !== undefined) {
      const mode = normalizeProviderMode(req.body.rate_provider);
      if (!RATE_PROVIDERS.includes(mode)) {
        return res.status(400).json({ error: 'Некорректный источник курса' });
      }
      setSetting('rate_provider', mode);
    }

    if (maintenanceActivated && notifyAdmins) {
      const msg = getAllSettings().maintenance_message || 'Обмен временно приостановлен.';
      await notifyAdmins(`⚠️ <b>Техрежим включён</b>\n\n${msg}`);
    }

    res.json({ ok: true });
  });

  router.post('/change-password', (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    }
    if (!changePassword(currentPassword, newPassword)) {
      return res.status(401).json({ error: 'Текущий пароль неверен' });
    }
    res.json({ ok: true });
  });

  router.get('/orders', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    res.json({ orders: listOrders(limit, offset) });
  });

  router.get('/orders/:id', (req, res) => {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'not_found' });
    const wallet_check = serializeCheckRow(getLastWalletCheckForOrder(order.id))
      || serializeCheckRow(getLastWalletCheck(order.address));
    res.json({ order, wallet_check });
  });

  router.patch('/orders/:id', async (req, res) => {
    const { status, note, deposit_address, expires_at } = req.body;
    const allowed = ['pending', 'processing', 'completed', 'cancelled'];
    let order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'not_found' });

    if (status !== undefined) {
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }
      order = updateOrderStatus(req.params.id, status, note || order.note || '');
    } else if (deposit_address !== undefined || expires_at !== undefined) {
      order = updateOrder(req.params.id, { deposit_address, expires_at, note });
    }
    if (notifyOrderUpdate) await notifyOrderUpdate(order);
    res.json({ order });
  });

  router.get('/preview-rate', async (req, res) => {
    try {
      const { from, to, amount = '1' } = req.query;
      const settings = getAllSettings();
      const result = await convertAmount(from, to, amount, settings.markup_percent, settings);
      res.json(result);
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  router.get('/chat/sessions', (_req, res) => {
    res.json({ sessions: listChatSessions(100) });
  });

  router.get('/chat/sessions/:id', (req, res) => {
    const session = enrichChatSession(getChatSession(req.params.id));
    if (!session) return res.status(404).json({ error: 'not_found' });
    markChatSessionRead(req.params.id);
    res.json({ session, messages: listChatMessages(req.params.id) });
  });

  router.post('/chat/sessions/:id/messages', (req, res) => {
    const session = getChatSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'not_found' });
    const body = String(req.body?.text || '').trim();
    if (!body) return res.status(400).json({ error: 'Пустое сообщение' });
    const msg = addChatMessage(req.params.id, 'admin', body.slice(0, 2000));
    res.status(201).json({ message: msg });
  });

  router.get('/wallet-checks', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const checks = listWalletChecks(limit, offset).map(serializeCheckRow);
    res.json({ checks, risk_labels: RISK_LABELS });
  });

  router.get('/wallet-checks/latest', (req, res) => {
    const { address, order_id: orderId, network } = req.query;
    let row = null;
    if (orderId) row = getLastWalletCheckForOrder(String(orderId));
    if (!row && address) row = getLastWalletCheck(String(address).trim(), network || null);
    res.json({ check: serializeCheckRow(row) });
  });

  router.post('/wallet-check', async (req, res) => {
    try {
      const { address, network, order_id: orderId, force } = req.body || {};
      const check = await runWalletCheck({
        address,
        network,
        orderId,
        hintCurrency: req.body?.hint_currency,
        source: orderId ? 'order_manual' : 'manual',
        force: !!force,
      });
      res.json({ check });
    } catch (e) {
      res.status(400).json({ error: e.message || 'check_failed' });
    }
  });

  router.get('/exchange-checks', (_req, res) => {
    const limit = Math.min(parseInt(_req.query.limit, 10) || 50, 200);
    const offset = parseInt(_req.query.offset, 10) || 0;
    const checks = listExchangeBalanceChecks(limit, offset).map(serializeExchangeCheckRow);
    res.json({ checks, exchanges: EXCHANGE_LABELS });
  });

  router.post('/exchange-check', async (req, res) => {
    try {
      const {
        exchange = 'bybit',
        api_key: apiKey,
        api_secret: apiSecret,
        order_id: orderId,
        use_platform_keys: usePlatformKeys,
        force,
      } = req.body || {};
      const check = await runExchangeBalanceCheck({
        exchange,
        apiKey,
        apiSecret,
        orderId,
        usePlatformKeys: !!usePlatformKeys,
        force: !!force,
      });
      res.json({ check });
    } catch (e) {
      res.status(400).json({ error: e.message || 'exchange_check_failed' });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
