const express = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  getChatSession,
  createChatSession,
  updateChatSessionMeta,
  enrichChatSession,
  listChatMessages,
  addChatMessage,
} = require('../db');
const { getClientIp, lookupGeo } = require('../geo');
const { mergeDeviceInfo } = require('../deviceInfo');
const { buildChatPublicConfig } = require('../settings');

async function touchSession(req, session, devicePayload) {
  const ip = getClientIp(req);
  const geo = await lookupGeo(ip);
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const mergedDevice = mergeDeviceInfo(session.device_info, { ...devicePayload, ua: devicePayload?.ua || ua });
  const fields = {
    user_agent: ua,
    device_info: JSON.stringify(mergedDevice),
  };

  if (!session.country || session.country === '') {
    fields.ip = geo.ip || '';
    fields.country = geo.country || '';
    fields.city = geo.city || '';
  } else if (!session.ip) {
    fields.ip = geo.ip || '';
  }

  return updateChatSessionMeta(session.id, fields);
}

function createChatRouter(notifyChatMessage) {
  const router = express.Router();

  router.get('/config', (_req, res) => {
    res.json(buildChatPublicConfig());
  });

  router.post('/session', async (req, res) => {
    const devicePayload = req.body?.device || {};
    let { sessionId } = req.body || {};

    if (!sessionId || !getChatSession(sessionId)) {
      sessionId = uuidv4();
      const ip = getClientIp(req);
      const geo = await lookupGeo(ip);
      const ua = String(req.headers['user-agent'] || '').slice(0, 300);
      const device = mergeDeviceInfo({}, { ...devicePayload, ua: devicePayload?.ua || ua });
      createChatSession({
        id: sessionId,
        ip: geo.ip,
        country: geo.country,
        city: geo.city,
        user_agent: ua,
        device_info: JSON.stringify(device),
      });
    } else {
      await touchSession(req, getChatSession(sessionId), devicePayload);
    }

    const session = enrichChatSession(getChatSession(sessionId));
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
    const { sessionId, text, device } = req.body || {};
    const body = String(text || '').trim();
    if (!sessionId || !body) {
      return res.status(400).json({ error: 'Укажите сообщение' });
    }

    let session = getChatSession(sessionId);
    if (!session) {
      const ip = getClientIp(req);
      const geo = await lookupGeo(ip);
      const ua = String(req.headers['user-agent'] || '').slice(0, 300);
      const deviceInfo = mergeDeviceInfo({}, { ...device, ua: device?.ua || ua });
      session = createChatSession({
        id: sessionId,
        ip: geo.ip,
        country: geo.country,
        city: geo.city,
        user_agent: ua,
        device_info: JSON.stringify(deviceInfo),
      });
    } else {
      session = await touchSession(req, session, device);
    }

    const msg = addChatMessage(sessionId, 'visitor', body.slice(0, 2000));
    session = enrichChatSession(getChatSession(sessionId));

    if (notifyChatMessage) {
      await notifyChatMessage(session, msg);
    }

    res.status(201).json({ message: msg });
  });

  return router;
}

module.exports = { createChatRouter };
