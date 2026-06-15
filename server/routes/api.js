const express = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  getAllSettings,
  getSetting,
  createOrder,
  getOrder,
  resolveDepositAddress,
  updateOrderStatus,
} = require('../db');
const { convertAmount } = require('../rates');

function createApiRouter(notifyOrder, notifyOrderUpdate) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'Bambusito228' });
  });

  router.get('/settings/public', (_req, res) => {
    res.json({
      markup_percent: parseFloat(getSetting('markup_percent', '1.5')),
      site_name: getSetting('site_name', 'Bambusito228'),
    });
  });

  router.get('/price', async (req, res) => {
    try {
      const { from, to, amount = '1' } = req.query;
      if (!from || !to) return res.status(400).json({ error: 'from and to required' });

      const settings = getAllSettings();
      const markup = settings.markup_percent || '1.5';
      const result = await convertAmount(from, to, amount, markup, settings);

      const payload = { [to]: result.effectiveRate };
      if (parseFloat(amount) !== 1) {
        payload.amountTo = result.amountTo;
        payload.rawRate = result.rawRate;
        payload.markupPercent = result.markupPercent;
      }
      res.json(payload);
    } catch (e) {
      res.status(502).json({ error: e.message || 'rate_unavailable' });
    }
  });

  router.get('/price.php', async (req, res) => {
    try {
      const from = req.query.fsym;
      const to = req.query.tsyms;
      const settings = getAllSettings();
      const result = await convertAmount(from, to, 1, settings.markup_percent, settings);
      res.json({ [to]: result.effectiveRate });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  router.post('/orders', async (req, res) => {
    try {
      const { from, to, amountFrom, address } = req.body;
      if (!from || !to || !amountFrom || !address) {
        return res.status(400).json({ error: 'Заполните все поля' });
      }

      const settings = getAllSettings();
      const markup = settings.markup_percent || '1.5';
      const conversion = await convertAmount(from, to, amountFrom, markup, settings);
      const ttlMin = parseInt(getSetting('order_ttl_minutes', '30'), 10) || 30;
      const deposit_address = resolveDepositAddress();

      const order = createOrder({
        id: uuidv4().slice(0, 8).toUpperCase(),
        from_currency: from,
        to_currency: to,
        amount_from: conversion.amountFrom,
        amount_to: conversion.amountTo,
        rate: conversion.effectiveRate,
        markup_percent: conversion.markupPercent,
        address: String(address).trim(),
        deposit_address,
        expires_at: Date.now() + ttlMin * 60 * 1000,
        order_type: 'float',
      });

      if (notifyOrder) await notifyOrder(order);

      res.status(201).json({ order });
    } catch (e) {
      res.status(400).json({ error: e.message || 'order_failed' });
    }
  });

  router.get('/orders/:id', (req, res) => {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'not_found' });
    res.json({ order });
  });

  router.post('/orders/:id/confirm', async (req, res) => {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'not_found' });
    if (order.status === 'completed' || order.status === 'cancelled') {
      return res.status(400).json({ error: 'Ордер уже закрыт' });
    }
    const updated = updateOrderStatus(order.id, 'processing', 'Клиент подтвердил отправку');
    if (notifyOrderUpdate) await notifyOrderUpdate(updated);
    res.json({ order: updated });
  });

  return router;
}

module.exports = { createApiRouter };
