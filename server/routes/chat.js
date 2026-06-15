const express = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  getSetting,
  getChatSession,
  createChatSession,
  upsertChatSessionGeo,
  listChatMessages,
  addChatMessage,
} = require('../db');
const { getClientIp, lookupGeo } = require('../geo');

function createChatRouter(notifyChatMessage) {
  const router = express.Router();

  router.get('/config', (_req, res) => {
    res.json({
      operatorName: getSetting('chat_operator_name', 'Bambusito228 Support'),
      statusText: 'Мы отвечаем сразу же',
    });
  });

  router.post('/session', async (req, res) => {
    let { sessionId } = req.body || {};
    if (!sessionId || !getChatSession(sessionId)) {
      sessionId = uuidv4();
      const ip = getClientIp(req);
      const geo = await lookupGeo(ip);
      createChatSession({
        id: sessionId,
        ip: geo.ip,
        country: geo.country,
        city: geo.city,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      });
    }
    const session = getChatSession(sessionId);
    const messages = listChatMessages(sessionId);
    res.json({ sessionId, session, messages });
  });

  router.get('/messages', (req, res) => {
    const { sessionId, since } = req.query;
    if (!sessionId || !getChatSession(sessionId)) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    const sinceTs = parseInt(since, 10) || 0;
    res.json({ messages: listChatMessages(sessionId, sinceTs) });
  });

  router.post('/messages', async (req, res) => {
    const { sessionId, text } = req.body || {};
    const body = String(text || '').trim();
    if (!sessionId || !body) {
      return res.status(400).json({ error: 'Укажите сообщение' });
    }
    let session = getChatSession(sessionId);
    if (!session) {
      const ip = getClientIp(req);
      const geo = await lookupGeo(ip);
      session = createChatSession({
        id: sessionId,
        ip: geo.ip,
        country: geo.country,
        city: geo.city,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      });
    } else if (!session.country || session.country === '') {
      const geo = await lookupGeo(getClientIp(req));
      session = upsertChatSessionGeo(sessionId, geo);
    }

    const msg = addChatMessage(sessionId, 'visitor', body.slice(0, 2000));
    session = getChatSession(sessionId);

    if (notifyChatMessage) {
      await notifyChatMessage(session, msg);
    }

    res.status(201).json({ message: msg });
  });

  return router;
}

module.exports = { createChatRouter };
