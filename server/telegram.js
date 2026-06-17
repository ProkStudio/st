const { Bot, Keyboard } = require('grammy');
const { resolveTelegramFetch } = require('./telegramProxy');
const { getMiniAppUrl } = require('./telegramWebApp');
const { shouldNotify } = require('./settings');
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
} = require('./db');

const STATUS_LABELS = {
  pending: '⏳ Ожидает',
  processing: '🔄 В работе',
  completed: '✅ Выполнен',
  cancelled: '❌ Отменён',
};

const STATUS_ALIASES = {
  pending: 'pending',
  ожидает: 'pending',
  wait: 'pending',
  processing: 'processing',
  работа: 'processing',
  вработе: 'processing',
  work: 'processing',
  completed: 'completed',
  готово: 'completed',
  выполнен: 'completed',
  done: 'completed',
  cancelled: 'cancelled',
  отмена: 'cancelled',
  отменён: 'cancelled',
  cancel: 'cancelled',
};

/** @type {Map<number, { action: string }>} */
const adminState = new Map();

function parseAdminIds() {
  const raw = process.env.TELEGRAM_ADMIN_IDS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter(Boolean);
}

function formatOrder(o) {
  const lines = [
    `🆔 <b>#${o.id}</b>`,
    `💱 ${o.amount_from} ${o.from_currency} → ${o.amount_to.toFixed(8)} ${o.to_currency}`,
    `📊 Курс: ${o.rate.toFixed(8)} (наценка ${o.markup_percent}%)`,
    `📬 Получение: <code>${o.address}</code>`,
  ];
  if (o.deposit_address) {
    lines.push(`💰 Оплата на: <code>${o.deposit_address}</code>`);
  }
  lines.push(
    `📌 Статус: ${STATUS_LABELS[o.status] || o.status}`,
    `🕐 ${new Date(o.created_at).toLocaleString('ru-RU')}`
  );
  return lines.join('\n');
}

function mainKeyboard() {
  return new Keyboard()
    .text('📋 Ордера')
    .text('📊 Статистика')
    .row()
    .text('💳 Кошелёк')
    .text('⚙️ Настройки')
    .row()
    .text('✅ Статус ордера')
    .resized()
    .persistent();
}

function settingsKeyboard() {
  return new Keyboard()
    .text('📈 Наценка')
    .text('💵 USD/RUB')
    .row()
    .text('✏️ Кошелёк')
    .row()
    .text('◀️ Главное меню')
    .resized()
    .persistent();
}

function panelText() {
  const s = getAllSettings();
  const st = stats();
  return (
    `🎛 <b>Bambusito228 Admin</b>\n\n` +
    `Наценка: <b>${s.markup_percent}%</b>\n` +
    `USD/RUB: <b>${s.usd_rub_rate}</b>\n` +
    `Кошелёк: ${getDepositWallet() ? '✅ задан' : '❌ не задан'}\n\n` +
    `Ордеров: ${st.total} | ⏳ ${st.pending} | ✅ ${st.completed}\n\n` +
    `Используйте кнопки ниже 👇`
  );
}

function settingsText() {
  const s = getAllSettings();
  const wallet = getDepositWallet();
  return (
    `⚙️ <b>Настройки</b>\n\n` +
    `📈 Наценка: <b>${s.markup_percent}%</b>\n` +
    `💵 USD/RUB: <b>${s.usd_rub_rate}</b>\n` +
    `💳 Кошелёк:\n<code>${wallet || '— не задан —'}</code>\n\n` +
    `Выберите, что изменить, или введите значение после выбора пункта.`
  );
}

function formatOrdersList(orders) {
  if (!orders.length) return '📋 Ордеров пока нет.';
  const blocks = orders.map((o) => formatOrder(o));
  return `📋 <b>Последние ордера</b>\n\n${blocks.join('\n\n—\n\n')}`;
}

function parseStatusToken(token) {
  return STATUS_ALIASES[String(token || '').toLowerCase().replace(/\s+/g, '')];
}

function escapeTelegramHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const noop = async () => {};
  if (!token) {
    console.log('⚠️  TELEGRAM_BOT_TOKEN не задан — бот отключён');
    return { bot: null, notifyAdmins: noop, notifyNewOrder: noop, notifyOrderUpdate: noop, notifyChatMessage: noop };
  }

  let bot = null;
  let botReady = false;
  let notifyAdmins = noop;
  let notifyNewOrder = noop;
  let notifyOrderUpdate = noop;
  let notifyChatMessage = noop;

  const adminIds = parseAdminIds();

  notifyChatMessage = async (session, msg) => {
    if (!shouldNotify('notif_chat_message')) return;
    if (!botReady) {
      for (let i = 0; i < 10 && !botReady; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!botReady) {
        console.error('Chat TG notify skipped: bot not ready');
        return;
      }
    }
    const loc = [session.country, session.city].filter(Boolean).join(', ');
    const { formatDeviceInfo } = require('../deviceInfo');
    const deviceLine = escapeTelegramHtml(formatDeviceInfo(session.device_info, session.user_agent));
    const orderLine = session.order_id
      ? `📦 Ордер: <b>#${escapeTelegramHtml(session.order_id)}</b>`
      : '📦 Ордер: <i>ещё не создан</i>';
    const body = escapeTelegramHtml(msg?.body || '');
    if (!body) return;
    await notifyAdmins(
      `💬 <b>Диалог #${escapeTelegramHtml(session.seq || '—')}</b> · ${orderLine}\n` +
        `🌍 ${escapeTelegramHtml(loc || '—')} | IP: <code>${escapeTelegramHtml(session.ip || '—')}</code>\n` +
        `📱 ${deviceLine}\n\n` +
        body
    );
  };

  function isAdmin(ctx) {
    return adminIds.includes(ctx.from?.id);
  }

  async function replyPanel(ctx) {
    await ctx.reply(panelText(), { parse_mode: 'HTML', reply_markup: mainKeyboard() });
  }

  async function handleAdminInput(ctx) {
    const uid = ctx.from.id;
    const state = adminState.get(uid);
    if (!state) return false;

    const text = (ctx.message?.text || '').trim();
    if (!text || text.startsWith('/')) return false;

    if (state.action === 'setfee') {
      const val = parseFloat(text.replace(',', '.'));
      adminState.delete(uid);
      if (Number.isNaN(val)) {
        await ctx.reply('❌ Некорректное число. Пример: 1.5 или -3', { reply_markup: settingsKeyboard() });
        return true;
      }
      setSetting('markup_percent', val);
      await ctx.reply(`✅ Наценка: <b>${val}%</b>\n\n${settingsText()}`, {
        parse_mode: 'HTML',
        reply_markup: settingsKeyboard(),
      });
      return true;
    }

    if (state.action === 'setrate') {
      const val = parseFloat(text.replace(',', '.'));
      adminState.delete(uid);
      if (Number.isNaN(val) || val <= 0) {
        await ctx.reply('❌ Введите положительное число. Пример: 95', { reply_markup: settingsKeyboard() });
        return true;
      }
      setSetting('usd_rub_rate', val);
      await ctx.reply(`✅ USD/RUB = <b>${val}</b>\n\n${settingsText()}`, {
        parse_mode: 'HTML',
        reply_markup: settingsKeyboard(),
      });
      return true;
    }

    if (state.action === 'setwallet') {
      adminState.delete(uid);
      if (text.length < 8) {
        await ctx.reply('❌ Адрес слишком короткий', { reply_markup: settingsKeyboard() });
        return true;
      }
      setDepositWallet(text);
      await ctx.reply(`✅ Кошелёк обновлён:\n<code>${text}</code>`, {
        parse_mode: 'HTML',
        reply_markup: settingsKeyboard(),
      });
      return true;
    }

    if (state.action === 'orderstatus') {
      const parts = text.split(/\s+/);
      const id = (parts[0] || '').toUpperCase();
      const status = parseStatusToken(parts[1]);
      adminState.delete(uid);
      if (!id || !status) {
        await ctx.reply(
          '❌ Формат: <code>ID статус</code>\nПример: <code>BC1E5F2C готово</code>\nСтатусы: ожидает, работа, готово, отмена',
          { parse_mode: 'HTML', reply_markup: mainKeyboard() }
        );
        return true;
      }
      const order = updateOrderStatus(id, status);
      if (!order) {
        await ctx.reply('❌ Ордер не найден', { reply_markup: mainKeyboard() });
        return true;
      }
      await ctx.reply(`✅ Статус обновлён\n\n${formatOrder(order)}`, {
        parse_mode: 'HTML',
        reply_markup: mainKeyboard(),
      });
      return true;
    }

    if (state.action === 'orderaddr') {
      const parts = text.split(/\s+/);
      const id = (parts[0] || '').toUpperCase();
      const addr = parts.slice(1).join(' ').trim();
      adminState.delete(uid);
      if (!id || !addr) {
        await ctx.reply('❌ Формат: <code>ID адрес</code>', { parse_mode: 'HTML', reply_markup: mainKeyboard() });
        return true;
      }
      const order = updateOrder(id, { deposit_address: addr });
      if (!order) {
        await ctx.reply('❌ Ордер не найден', { reply_markup: mainKeyboard() });
        return true;
      }
      await ctx.reply(`✅ Адрес оплаты #${id} обновлён\n<code>${addr}</code>`, {
        parse_mode: 'HTML',
        reply_markup: mainKeyboard(),
      });
      return true;
    }

    return false;
  }

  async function handleMenuButton(ctx) {
    const text = (ctx.message?.text || '').trim();
    if (!text || text.startsWith('/')) return false;

    switch (text) {
      case '📋 Ордера': {
        const orders = listOrders(5);
        await ctx.reply(formatOrdersList(orders), { parse_mode: 'HTML', reply_markup: mainKeyboard() });
        return true;
      }
      case '📊 Статистика': {
        const st = stats();
        await ctx.reply(
          `📊 <b>Статистика</b>\n\nВсего: ${st.total}\n⏳ Ожидают: ${st.pending}\n✅ Выполнено: ${st.completed}\n💰 Объём: ${st.volume.toFixed(4)}`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard() }
        );
        return true;
      }
      case '💳 Кошелёк': {
        const addr = getDepositWallet();
        await ctx.reply(
          addr
            ? `💳 <b>Кошелёк для оплаты</b>\n<code>${addr}</code>`
            : '💳 Кошелёк не задан.\n⚙️ Настройки → ✏️ Кошелёк',
          { parse_mode: 'HTML', reply_markup: mainKeyboard() }
        );
        return true;
      }
      case '⚙️ Настройки':
        await ctx.reply(settingsText(), { parse_mode: 'HTML', reply_markup: settingsKeyboard() });
        return true;
      case '◀️ Главное меню':
        adminState.delete(ctx.from.id);
        await replyPanel(ctx);
        return true;
      case '📈 Наценка':
        adminState.set(ctx.from.id, { action: 'setfee' });
        await ctx.reply(
          `📈 Текущая наценка: <b>${getAllSettings().markup_percent}%</b>\n\nОтправьте новое значение (можно отрицательное):\nПример: <code>1.5</code> или <code>-3</code>`,
          { parse_mode: 'HTML', reply_markup: settingsKeyboard() }
        );
        return true;
      case '💵 USD/RUB':
        adminState.set(ctx.from.id, { action: 'setrate' });
        await ctx.reply(
          `💵 Текущий курс: <b>${getAllSettings().usd_rub_rate}</b>\n\nОтправьте новый USD/RUB:\nПример: <code>95</code>`,
          { parse_mode: 'HTML', reply_markup: settingsKeyboard() }
        );
        return true;
      case '✏️ Кошелёк':
        adminState.set(ctx.from.id, { action: 'setwallet' });
        await ctx.reply('✏️ Отправьте адрес кошелька для приёма оплат:', { reply_markup: settingsKeyboard() });
        return true;
      case '✅ Статус ордера':
        adminState.set(ctx.from.id, { action: 'orderstatus' });
        await ctx.reply(
          '✅ <b>Смена статуса</b>\n\nОтправьте одной строкой:\n<code>ID статус</code>\n\nПример:\n<code>BC1E5F2C готово</code>\n\nСтатусы: ожидает, работа, готово, отмена',
          { parse_mode: 'HTML', reply_markup: mainKeyboard() }
        );
        return true;
      default:
        return false;
    }
  }

  async function initBot() {
    try {
      const { fetchFn, me, label } = await resolveTelegramFetch(token);
      if (label !== 'direct') {
        console.log(`🌐 Telegram подключён через прокси: ${label}`);
      }
      bot = new Bot(token, { client: { fetch: fetchFn } });

      try {
        const miniAppUrl = getMiniAppUrl();
        await bot.api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: '🎛 Админка',
            web_app: { url: miniAppUrl },
          },
        });
        console.log(`📱 Mini App menu → ${miniAppUrl}`);
      } catch (e) {
        console.error('Menu button setup failed:', e.message);
      }

      notifyAdmins = async (text, extra = {}) => {
        for (const id of adminIds) {
          try {
            await bot.api.sendMessage(id, text, {
              parse_mode: 'HTML',
              ...extra,
              reply_markup: extra.reply_markup ?? mainKeyboard(),
            });
          } catch (e) {
            console.error('TG notify error', id, e.message);
            try {
              const plain = text.replace(/<[^>]*>/g, '');
              await bot.api.sendMessage(id, plain, {
                ...extra,
                reply_markup: extra.reply_markup ?? mainKeyboard(),
              });
            } catch (e2) {
              console.error('TG notify fallback error', id, e2.message);
            }
          }
        }
      };

      notifyNewOrder = async (order) => {
        if (!shouldNotify('notif_new_order')) return;
        await notifyAdmins(`🆕 <b>Новый ордер!</b>\n\n${formatOrder(order)}`);
      };

      notifyOrderUpdate = noop;

      bot.command('start', async (ctx) => {
        if (!isAdmin(ctx)) {
          return ctx.reply('👋 Bambusito228 Exchange Bot\nДоступ только для администраторов.');
        }
        adminState.delete(ctx.from.id);
        await replyPanel(ctx);
      });

      bot.command('admin', async (ctx) => {
        if (!isAdmin(ctx)) return;
        adminState.delete(ctx.from.id);
        await replyPanel(ctx);
      });

      bot.command('orders', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const orders = listOrders(8);
        await ctx.reply(formatOrdersList(orders), { parse_mode: 'HTML', reply_markup: mainKeyboard() });
      });

      bot.command('stats', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const st = stats();
        await ctx.reply(
          `📊 <b>Статистика</b>\n\nВсего: ${st.total}\nОжидают: ${st.pending}\nВыполнено: ${st.completed}\nОбъём: ${st.volume.toFixed(4)}`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard() }
        );
      });

      bot.command('fee', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const s = getAllSettings();
        await ctx.reply(`Текущая наценка: <b>${s.markup_percent}%</b>`, {
          parse_mode: 'HTML',
          reply_markup: settingsKeyboard(),
        });
      });

      bot.command('setfee', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const parts = (ctx.message?.text || '').split(/\s+/);
        const val = parseFloat(parts[1]);
        if (Number.isNaN(val)) {
          return ctx.reply('Использование: /setfee 2.5 (можно отрицательное)', { reply_markup: settingsKeyboard() });
        }
        setSetting('markup_percent', val);
        await ctx.reply(`✅ Наценка: <b>${val}%</b>`, { parse_mode: 'HTML', reply_markup: settingsKeyboard() });
      });

      bot.command('rate', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const s = getAllSettings();
        await ctx.reply(`USD/RUB: <b>${s.usd_rub_rate}</b>`, { parse_mode: 'HTML', reply_markup: settingsKeyboard() });
      });

      bot.command('setrate', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const parts = (ctx.message?.text || '').split(/\s+/);
        const val = parseFloat(parts[1]);
        if (Number.isNaN(val) || val <= 0) {
          return ctx.reply('Использование: /setrate 95', { reply_markup: settingsKeyboard() });
        }
        setSetting('usd_rub_rate', val);
        await ctx.reply(`✅ USD/RUB = <b>${val}</b>`, { parse_mode: 'HTML', reply_markup: settingsKeyboard() });
      });

      bot.command('wallet', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const addr = getDepositWallet();
        await ctx.reply(
          addr ? `💳 <b>Кошелёк:</b>\n<code>${addr}</code>` : 'Кошелёк не задан',
          { parse_mode: 'HTML', reply_markup: mainKeyboard() }
        );
      });

      bot.command('setwallet', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const addr = (ctx.message?.text || '').split(/\s+/).slice(1).join(' ').trim();
        if (!addr) return ctx.reply('Использование: /setwallet адрес', { reply_markup: settingsKeyboard() });
        setDepositWallet(addr);
        await ctx.reply('✅ Кошелёк обновлён', { parse_mode: 'HTML', reply_markup: settingsKeyboard() });
      });

      bot.command('orderaddr', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const parts = (ctx.message?.text || '').split(/\s+/);
        const id = (parts[1] || '').toUpperCase();
        const addr = parts.slice(2).join(' ').trim();
        if (!id || !addr) return ctx.reply('Использование: /orderaddr ID адрес', { reply_markup: mainKeyboard() });
        const order = updateOrder(id, { deposit_address: addr });
        if (!order) return ctx.reply('Ордер не найден', { reply_markup: mainKeyboard() });
        await ctx.reply(`✅ #${id} → <code>${addr}</code>`, { parse_mode: 'HTML', reply_markup: mainKeyboard() });
      });

      bot.command('status', async (ctx) => {
        if (!isAdmin(ctx)) return;
        const parts = (ctx.message?.text || '').split(/\s+/);
        const id = (parts[1] || '').toUpperCase();
        const status = parseStatusToken(parts[2]);
        if (!id || !status) {
          return ctx.reply('Использование: /status ID готово', { reply_markup: mainKeyboard() });
        }
        const order = updateOrderStatus(id, status);
        if (!order) return ctx.reply('Ордер не найден', { reply_markup: mainKeyboard() });
        await ctx.reply(`✅ Обновлено\n\n${formatOrder(order)}`, { parse_mode: 'HTML', reply_markup: mainKeyboard() });
      });

      bot.on('message:text', async (ctx) => {
        if (!isAdmin(ctx)) return;
        if (await handleAdminInput(ctx)) return;
        await handleMenuButton(ctx);
      });

      bot.catch((err) => console.error('Telegram bot error:', err));

      bot.start();
      botReady = true;
      console.log(`🤖 Telegram bot @${me.username} запущен (admins: ${adminIds.join(', ')})`);
    } catch (e) {
      console.error('❌ Telegram bot не запустился:', e.message);
    }
  }

  initBot();

  return {
    get bot() { return bot; },
    notifyAdmins: (...args) => notifyAdmins(...args),
    notifyNewOrder: (...args) => notifyNewOrder(...args),
    notifyOrderUpdate: (...args) => notifyOrderUpdate(...args),
    notifyChatMessage: (...args) => notifyChatMessage(...args),
  };
}

module.exports = { createTelegramBot };
