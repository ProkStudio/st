require('dotenv').config();
const express = require('express');
const path = require('path');
const { createApiRouter } = require('./routes/api');
const { createAdminRouter } = require('./routes/admin');
const { createTelegramBot } = require('./telegram');
const { startBybitDepositWatcher } = require('./bybitDeposits');
const { createChatRouter } = require('./routes/chat');

const PORT = process.env.PORT || 3000;
const root = path.join(__dirname, '..');

const { notifyAdmins, notifyNewOrder, notifyOrderUpdate, notifyChatMessage } = createTelegramBot();
startBybitDepositWatcher(notifyAdmins);

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', createApiRouter(notifyNewOrder, notifyOrderUpdate));
app.use('/api/chat', createChatRouter(notifyChatMessage));
app.use('/api/admin', createAdminRouter(notifyOrderUpdate));

app.use(express.static(root));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(root, 'admin', 'index.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(root, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bambusito228 → http://localhost:${PORT}`);
  console.log(`🎛  Admin panel → http://localhost:${PORT}/admin`);
});
