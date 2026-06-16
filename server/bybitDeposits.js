const { queryDeposits, DEPOSIT_STATUS } = require('./bybit');
const { isDepositSeen, markDepositSeen } = require('./db');
const { shouldNotify } = require('./settings');

const POLL_MS = 30_000;

function formatDeposit(d) {
  const status = DEPOSIT_STATUS[d.status] || `Статус ${d.status}`;
  const time = d.successAt
    ? new Date(Number(d.successAt)).toLocaleString('ru-RU')
    : d.createTime
      ? new Date(Number(d.createTime)).toLocaleString('ru-RU')
      : '—';

  return [
    '💰 <b>Поступление на Bybit</b>',
    `🪙 ${d.amount} ${d.coin}`,
    `📊 Статус: ${status}`,
    d.chain ? `⛓ Сеть: ${d.chain}` : null,
    d.toAddress ? `📬 Адрес: <code>${d.toAddress}</code>` : null,
    d.txID ? `🔗 TX: <code>${d.txID}</code>` : null,
    `🕐 ${time}`,
  ].filter(Boolean).join('\n');
}

function startBybitDepositWatcher(notifyAdmins) {
  const key = String(process.env.BYBIT_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
  const secret = String(process.env.BYBIT_API_SECRET || '').trim().replace(/^['"]|['"]$/g, '');
  if (!key || !secret) {
    console.log('⚠️  Bybit API не задан — мониторинг депозитов отключён');
    return;
  }
  if (!notifyAdmins) return;

  let running = false;
  let failures = 0;
  let timer = null;

  async function poll() {
    if (running) return;
    running = true;
    try {
      const rows = await queryDeposits(50);
      failures = 0;
      for (const d of rows) {
        const id = String(d.id || d.txID || `${d.coin}-${d.amount}-${d.createTime}`);
        if (isDepositSeen(id)) continue;
        markDepositSeen(id, d.coin, d.amount, d.status);
        if ([1, 2, 3].includes(Number(d.status)) && shouldNotify('notif_bybit_deposit')) {
          await notifyAdmins(formatDeposit(d));
        }
      }
    } catch (e) {
      failures += 1;
      console.error('Bybit deposit poll error:', e.message);
      if (failures >= 5) {
        if (timer) clearInterval(timer);
        console.error('⚠️  Bybit deposit watcher остановлен после 5 ошибок. Проверьте BYBIT_API_KEY/BYBIT_API_SECRET в Railway.');
      }
    } finally {
      running = false;
    }
  }

  poll();
  timer = setInterval(poll, POLL_MS);
  console.log('👀 Bybit deposit watcher started (every 30s)');
}

module.exports = { startBybitDepositWatcher };
