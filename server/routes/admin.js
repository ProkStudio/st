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
  listChatMessages,
  addChatMessage,
  markChatSessionRead,
  countUnreadChats,
} = require('../db');
const { authMiddleware, login, changePassword } = require('../auth');
const { convertAmount } = require('../rates');

function createAdminRouter(notifyOrderUpdate) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const token = login(username, password);
    if (!token) return res.status(401).json({ error: 'Неверный логин или пароль' });
    res.json({ token });
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
      settings: {
        markup_percent: parseFloat(settings.markup_percent),
        usd_rub_rate: parseFloat(settings.usd_rub_rate),
        site_name: settings.site_name,
        order_ttl_minutes: parseInt(settings.order_ttl_minutes || '30', 10),
        deposit_wallet: getDepositWallet(),
        chat_operator_name: settings.chat_operator_name || 'Bambusito228 Support',
        unread_chats: countUnreadChats(),
      },
    });
  });

  router.get('/settings', (_req, res) => {
    const s = getAllSettings();
    res.json({
      markup_percent: parseFloat(s.markup_percent),
      usd_rub_rate: parseFloat(s.usd_rub_rate),
      site_name: s.site_name,
      admin_username: s.admin_username,
      order_ttl_minutes: parseInt(s.order_ttl_minutes || '30', 10),
      deposit_wallet: getDepositWallet(),
      chat_operator_name: s.chat_operator_name || 'Bambusito228 Support',
    });
  });

  router.patch('/settings', (req, res) => {
    const {
      markup_percent,
      usd_rub_rate,
      site_name,
      order_ttl_minutes,
      deposit_wallet,
      chat_operator_name,
    } = req.body;
    if (markup_percent !== undefined) {
      const v = parseFloat(markup_percent);
      if (Number.isNaN(v)) {
        return res.status(400).json({ error: 'Наценка должна быть числом' });
      }
      setSetting('markup_percent', v);
    }
    if (usd_rub_rate !== undefined) {
      const v = parseFloat(usd_rub_rate);
      if (Number.isNaN(v) || v <= 0) {
        return res.status(400).json({ error: 'Некорректный курс USD/RUB' });
      }
      setSetting('usd_rub_rate', v);
    }
    if (site_name) setSetting('site_name', site_name);
    if (order_ttl_minutes !== undefined) {
      const v = parseInt(order_ttl_minutes, 10);
      if (Number.isNaN(v) || v < 5 || v > 180) {
        return res.status(400).json({ error: 'Время ордера: от 5 до 180 минут' });
      }
      setSetting('order_ttl_minutes', v);
    }
    if (deposit_wallet !== undefined) setDepositWallet(deposit_wallet);
    if (chat_operator_name) setSetting('chat_operator_name', chat_operator_name);
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
    res.json({ order });
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
    const session = getChatSession(req.params.id);
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

  return router;
}

module.exports = { createAdminRouter };
