const { queryDeposits, DEPOSIT_STATUS } = require('./bybit');
const { isDepositSeen, markDepositSeen } = require('./db');

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
  if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) {
    console.log('⚠️  Bybit API не задан — мониторинг депозитов отключён');
    return;
  }
  if (!notifyAdmins) return;

  let running = false;

  async function poll() {
    if (running) return;
    running = true;
    try {
      const rows = await queryDeposits(50);
      for (const d of rows) {
        const id = String(d.id || d.txID || `${d.coin}-${d.amount}-${d.createTime}`);
        if (isDepositSeen(id)) continue;
        markDepositSeen(id, d.coin, d.amount, d.status);
        if ([1, 2, 3].includes(Number(d.status))) {
          await notifyAdmins(formatDeposit(d));
        }
      }
    } catch (e) {
      console.error('Bybit deposit poll error:', e.message);
    } finally {
      running = false;
    }
  }

  poll();
  setInterval(poll, POLL_MS);
  console.log('👀 Bybit deposit watcher started (every 30s)');
}

module.exports = { startBybitDepositWatcher };
