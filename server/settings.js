const { getSetting, setSetting, getAllSettings, getDepositWallet } = require('./db');

const SETTING_DEFAULTS = {
  markup_percent: '1.5',
  usd_rub_rate: '92.5',
  site_name: 'Bambusito228',
  site_tagline: 'Быстрый обмен криптовалют',
  accent_color: '#22c55e',
  deposit_wallet: '',
  order_ttl_minutes: '30',
  chat_operator_name: 'Bambusito228 Support',
  chat_welcome_message: 'Здравствуйте! Чем можем помочь?',
  chat_offline_message: 'Оператор ответит в ближайшее время.',
  chat_work_hours: '09:00-21:00',
  chat_show_online: '1',
  rate_provider: 'auto',
  rate_refresh_sec: '60',
  exchange_min_usd: '50',
  exchange_max_usd: '50000',
  maintenance_mode: '0',
  maintenance_message: 'Обмен временно приостановлен. Попробуйте позже.',
  contact_telegram: '',
  contact_email: '',
  rules_text: '',
  faq_text: '',
  notif_new_order: '1',
  notif_order_status: '0',
  notif_chat_message: '1',
  notif_bybit_deposit: '1',
  notif_maintenance: '1',
};

function isOn(val) {
  return val === '1' || val === 'true' || val === true;
}

function parseHexColor(v) {
  const s = String(v || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  return s.toLowerCase();
}

function isWithinWorkHours(workHours) {
  const m = String(workHours || '').match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return true;
  const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  const now = hour * 60 + minute;
  if (start <= end) return now >= start && now < end;
  return now >= start || now < end;
}

function buildChatPublicConfig() {
  const showOnline = isOn(getSetting('chat_show_online', '1'));
  const within = isWithinWorkHours(getSetting('chat_work_hours', '09:00-21:00'));
  const online = showOnline && within;
  return {
    operatorName: getSetting('chat_operator_name', 'Bambusito228 Support'),
    welcomeMessage: getSetting('chat_welcome_message', 'Здравствуйте! Чем можем помочь?'),
    offlineMessage: getSetting('chat_offline_message', 'Оператор ответит в ближайшее время.'),
    workHours: getSetting('chat_work_hours', '09:00-21:00'),
    showOnline,
    online,
    statusText: online ? 'Мы отвечаем сразу же' : getSetting('chat_offline_message', 'Оператор ответит в ближайшее время.'),
  };
}

function buildPublicConfig() {
  return {
    site_name: getSetting('site_name', 'Bambusito228'),
    site_tagline: getSetting('site_tagline', 'Быстрый обмен криптовалют'),
    accent_color: getSetting('accent_color', '#22c55e'),
    markup_percent: parseFloat(getSetting('markup_percent', '1.5')),
    exchange_min_usd: parseFloat(getSetting('exchange_min_usd', '50')),
    exchange_max_usd: parseFloat(getSetting('exchange_max_usd', '50000')),
    maintenance_mode: isOn(getSetting('maintenance_mode', '0')),
    maintenance_message: getSetting('maintenance_message', 'Обмен временно приостановлен. Попробуйте позже.'),
    chat: buildChatPublicConfig(),
    contacts: {
      telegram: getSetting('contact_telegram', ''),
      email: getSetting('contact_email', ''),
    },
    rules_text: getSetting('rules_text', ''),
    faq_text: getSetting('faq_text', ''),
  };
}

function formatAdminSettings(raw, extras = {}) {
  return {
    markup_percent: parseFloat(raw.markup_percent || '1.5'),
    usd_rub_rate: parseFloat(raw.usd_rub_rate || '92.5'),
    site_name: raw.site_name || 'Bambusito228',
    site_tagline: raw.site_tagline || 'Быстрый обмен криптовалют',
    accent_color: raw.accent_color || '#22c55e',
    order_ttl_minutes: parseInt(raw.order_ttl_minutes || '30', 10),
    deposit_wallet: extras.deposit_wallet ?? raw.deposit_wallet ?? '',
    chat_operator_name: raw.chat_operator_name || 'Bambusito228 Support',
    chat_welcome_message: raw.chat_welcome_message || 'Здравствуйте! Чем можем помочь?',
    chat_offline_message: raw.chat_offline_message || 'Оператор ответит в ближайшее время.',
    chat_work_hours: raw.chat_work_hours || '09:00-21:00',
    chat_show_online: isOn(raw.chat_show_online ?? '1'),
    rate_provider: extras.rate_provider ?? raw.rate_provider ?? 'auto',
    rate_refresh_sec: parseInt(raw.rate_refresh_sec || '60', 10),
    exchange_min_usd: parseFloat(raw.exchange_min_usd || '50'),
    exchange_max_usd: parseFloat(raw.exchange_max_usd || '50000'),
    maintenance_mode: isOn(raw.maintenance_mode ?? '0'),
    maintenance_message: raw.maintenance_message || 'Обмен временно приостановлен. Попробуйте позже.',
    contact_telegram: raw.contact_telegram || '',
    contact_email: raw.contact_email || '',
    rules_text: raw.rules_text || '',
    faq_text: raw.faq_text || '',
    notif_new_order: isOn(raw.notif_new_order ?? '1'),
    notif_order_status: isOn(raw.notif_order_status ?? '0'),
    notif_chat_message: isOn(raw.notif_chat_message ?? '1'),
    notif_bybit_deposit: isOn(raw.notif_bybit_deposit ?? '1'),
    notif_maintenance: isOn(raw.notif_maintenance ?? '1'),
    admin_username: raw.admin_username || 'admin',
    ...extras,
  };
}

function shouldNotify(key) {
  const def = SETTING_DEFAULTS[key] ?? '1';
  return isOn(getSetting(key, def));
}

function getRateCacheTtlMs() {
  const sec = parseInt(getSetting('rate_refresh_sec', '60'), 10);
  if (Number.isNaN(sec)) return 60_000;
  return Math.min(300, Math.max(30, sec)) * 1000;
}

function applySettingsPatch(body, { setDepositWallet } = {}) {
  const errors = [];
  const b = body || {};

  if (b.markup_percent !== undefined) {
    const v = parseFloat(b.markup_percent);
    if (Number.isNaN(v)) errors.push('Наценка должна быть числом');
    else setSetting('markup_percent', v);
  }
  if (b.usd_rub_rate !== undefined) {
    const v = parseFloat(b.usd_rub_rate);
    if (Number.isNaN(v) || v <= 0) errors.push('Некорректный курс USD/RUB');
    else setSetting('usd_rub_rate', v);
  }
  if (b.site_name !== undefined) setSetting('site_name', String(b.site_name).trim().slice(0, 80));
  if (b.site_tagline !== undefined) setSetting('site_tagline', String(b.site_tagline).trim().slice(0, 200));
  if (b.accent_color !== undefined) {
    const c = parseHexColor(b.accent_color);
    if (!c) errors.push('Цвет: формат #RRGGBB');
    else setSetting('accent_color', c);
  }
  if (b.order_ttl_minutes !== undefined) {
    const v = parseInt(b.order_ttl_minutes, 10);
    if (Number.isNaN(v) || v < 5 || v > 180) errors.push('Время ордера: от 5 до 180 минут');
    else setSetting('order_ttl_minutes', v);
  }
  if (b.deposit_wallet !== undefined && setDepositWallet) setDepositWallet(b.deposit_wallet);
  if (b.chat_operator_name !== undefined) {
    setSetting('chat_operator_name', String(b.chat_operator_name).trim().slice(0, 80));
  }
  if (b.chat_welcome_message !== undefined) {
    setSetting('chat_welcome_message', String(b.chat_welcome_message).trim().slice(0, 500));
  }
  if (b.chat_offline_message !== undefined) {
    setSetting('chat_offline_message', String(b.chat_offline_message).trim().slice(0, 500));
  }
  if (b.chat_work_hours !== undefined) {
    const wh = String(b.chat_work_hours).trim();
    if (!/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(wh)) errors.push('Часы работы: формат 09:00-21:00');
    else setSetting('chat_work_hours', wh);
  }
  if (b.chat_show_online !== undefined) {
    setSetting('chat_show_online', b.chat_show_online ? '1' : '0');
  }
  if (b.rate_provider !== undefined) setSetting('rate_provider', String(b.rate_provider));
  if (b.rate_refresh_sec !== undefined) {
    const v = parseInt(b.rate_refresh_sec, 10);
    if (Number.isNaN(v) || v < 30 || v > 300) errors.push('Кэш курса: 30–300 секунд');
    else setSetting('rate_refresh_sec', v);
  }
  if (b.exchange_min_usd !== undefined) {
    const v = parseFloat(b.exchange_min_usd);
    if (Number.isNaN(v) || v < 0) errors.push('Мин. сумма: число ≥ 0');
    else setSetting('exchange_min_usd', v);
  }
  if (b.exchange_max_usd !== undefined) {
    const v = parseFloat(b.exchange_max_usd);
    if (Number.isNaN(v) || v <= 0) errors.push('Макс. сумма: число > 0');
    else setSetting('exchange_max_usd', v);
  }
  const minAfter = parseFloat(getSetting('exchange_min_usd', '50'));
  const maxAfter = parseFloat(getSetting('exchange_max_usd', '50000'));
  if (minAfter >= maxAfter) errors.push('Мин. сумма должна быть меньше макс.');

  let maintenanceActivated = false;

  if (b.maintenance_mode !== undefined) {
    const wasOff = !isOn(getSetting('maintenance_mode', '0'));
    const turningOn = !!b.maintenance_mode;
    setSetting('maintenance_mode', turningOn ? '1' : '0');
    if (wasOff && turningOn && shouldNotify('notif_maintenance')) {
      maintenanceActivated = true;
    }
  }
  if (b.maintenance_message !== undefined) {
    setSetting('maintenance_message', String(b.maintenance_message).trim().slice(0, 500));
  }
  if (b.contact_telegram !== undefined) {
    setSetting('contact_telegram', String(b.contact_telegram).trim().slice(0, 120));
  }
  if (b.contact_email !== undefined) {
    setSetting('contact_email', String(b.contact_email).trim().slice(0, 120));
  }
  if (b.rules_text !== undefined) setSetting('rules_text', String(b.rules_text).slice(0, 8000));
  if (b.faq_text !== undefined) setSetting('faq_text', String(b.faq_text).slice(0, 8000));

  const boolKeys = [
    'notif_new_order',
    'notif_order_status',
    'notif_chat_message',
    'notif_bybit_deposit',
    'notif_maintenance',
  ];
  for (const key of boolKeys) {
    if (b[key] !== undefined) setSetting(key, b[key] ? '1' : '0');
  }

  return { errors, maintenanceActivated };
}

module.exports = {
  SETTING_DEFAULTS,
  isOn,
  isWithinWorkHours,
  buildPublicConfig,
  buildChatPublicConfig,
  formatAdminSettings,
  shouldNotify,
  getRateCacheTtlMs,
  applySettingsPatch,
};
