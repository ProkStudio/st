const { getSetting, setSetting } = require('./db');

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
  chat_work_start: '09:00',
  chat_work_end: '21:00',
  chat_show_online: '1',
  rate_provider: 'auto',
  rate_refresh_sec: '60',
  exchange_min_usd: '50',
  exchange_max_usd: '50000',
  maintenance_mode: '0',
  maintenance_message: 'Обмен временно приостановлен. Попробуйте позже.',
  maintenance_schedule_enabled: '0',
  maintenance_schedule_start: '02:00',
  maintenance_schedule_end: '08:00',
  contact_telegram: '',
  contact_email: '',
  rules_text: '',
  faq_text: '',
  notif_new_order: '1',
  notif_order_status: '0',
  notif_chat_message: '1',
  notif_bybit_deposit: '1',
  notif_maintenance: '1',
  wallet_check_enabled: '1',
  wallet_check_auto_on_order: '1',
  wallet_check_cooldown_minutes: '5',
};

const TZ_MOSCOW = 'Europe/Moscow';

function isOn(val) {
  return val === '1' || val === 'true' || val === true;
}

function parseHexColor(v) {
  const s = String(v || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  return s.toLowerCase();
}

function looksLikeHexColor(v) {
  return /^#[0-9a-fA-F]{6}$/i.test(String(v || '').trim());
}

function sanitizeEmailValue(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (looksLikeHexColor(s)) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s.slice(0, 120);
}

function normalizeTimeHHMM(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseLegacyRange(str) {
  const m = String(str || '').match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
  if (!m) return { start: '09:00', end: '21:00' };
  const start = normalizeTimeHHMM(m[1]);
  const end = normalizeTimeHHMM(m[2]);
  return { start: start || '09:00', end: end || '21:00' };
}

function getMoscowMinutesNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ_MOSCOW,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  return hour * 60 + minute;
}

function timeToMinutes(hhmm) {
  const t = normalizeTimeHHMM(hhmm);
  if (!t) return 0;
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

/** true if current Moscow time is inside [start, end). Supports overnight when start > end. */
function isTimeInRange(startHHMM, endHHMM) {
  const start = timeToMinutes(startHHMM);
  const end = timeToMinutes(endHHMM);
  const now = getMoscowMinutesNow();
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

function getChatWorkRange() {
  let start = normalizeTimeHHMM(getSetting('chat_work_start', ''));
  let end = normalizeTimeHHMM(getSetting('chat_work_end', ''));
  if (!start || !end) {
    const legacy = parseLegacyRange(getSetting('chat_work_hours', '09:00-21:00'));
    start = legacy.start;
    end = legacy.end;
  }
  return { start, end, label: `${start}–${end}` };
}

function isWithinChatWorkHours() {
  const { start, end } = getChatWorkRange();
  return isTimeInRange(start, end);
}

function isManualMaintenanceOn() {
  return isOn(getSetting('maintenance_mode', '0'));
}

function isMaintenanceScheduleActive() {
  if (!isOn(getSetting('maintenance_schedule_enabled', '0'))) return false;
  const start = normalizeTimeHHMM(getSetting('maintenance_schedule_start', '02:00')) || '02:00';
  const end = normalizeTimeHHMM(getSetting('maintenance_schedule_end', '08:00')) || '08:00';
  return isTimeInRange(start, end);
}

function isMaintenanceActive() {
  return isManualMaintenanceOn() || isMaintenanceScheduleActive();
}

function getMaintenanceMessage() {
  return getSetting('maintenance_message', 'Обмен временно приостановлен. Попробуйте позже.');
}

function syncChatWorkHoursString(start, end) {
  setSetting('chat_work_start', start);
  setSetting('chat_work_end', end);
  setSetting('chat_work_hours', `${start}-${end}`);
}

function buildChatPublicConfig() {
  const showOnline = isOn(getSetting('chat_show_online', '1'));
  const { start, end, label } = getChatWorkRange();
  const within = isWithinChatWorkHours();
  const online = showOnline && within;
  return {
    operatorName: getSetting('chat_operator_name', 'Bambusito228 Support'),
    welcomeMessage: getSetting('chat_welcome_message', 'Здравствуйте! Чем можем помочь?'),
    offlineMessage: getSetting('chat_offline_message', 'Оператор ответит в ближайшее время.'),
    workHours: label,
    workStart: start,
    workEnd: end,
    showOnline,
    online,
    statusText: online ? 'Мы отвечаем сразу же' : getSetting('chat_offline_message', 'Оператор ответит в ближайшее время.'),
  };
}

function buildPublicConfig() {
  const schedStart = normalizeTimeHHMM(getSetting('maintenance_schedule_start', '02:00')) || '02:00';
  const schedEnd = normalizeTimeHHMM(getSetting('maintenance_schedule_end', '08:00')) || '08:00';
  return {
    site_name: getSetting('site_name', 'Bambusito228'),
    site_tagline: getSetting('site_tagline', 'Быстрый обмен криптовалют'),
    accent_color: getSetting('accent_color', '#22c55e'),
    markup_percent: parseFloat(getSetting('markup_percent', '1.5')),
    exchange_min_usd: parseFloat(getSetting('exchange_min_usd', '50')),
    exchange_max_usd: parseFloat(getSetting('exchange_max_usd', '50000')),
    maintenance_mode: isMaintenanceActive(),
    maintenance_manual: isManualMaintenanceOn(),
    maintenance_scheduled: isMaintenanceScheduleActive(),
    maintenance_message: getMaintenanceMessage(),
    maintenance_schedule_enabled: isOn(getSetting('maintenance_schedule_enabled', '0')),
    maintenance_schedule_start: schedStart,
    maintenance_schedule_end: schedEnd,
    chat: buildChatPublicConfig(),
    contacts: {
      telegram: getSetting('contact_telegram', ''),
      email: sanitizeEmailValue(getSetting('contact_email', '')) || '',
    },
    rules_text: getSetting('rules_text', ''),
    faq_text: getSetting('faq_text', ''),
  };
}

function formatAdminSettings(raw, extras = {}) {
  const work = getChatWorkRange();
  const emailRaw = raw.contact_email || '';
  const email = looksLikeHexColor(emailRaw) ? '' : emailRaw;
  const schedStart = normalizeTimeHHMM(raw.maintenance_schedule_start || '02:00') || '02:00';
  const schedEnd = normalizeTimeHHMM(raw.maintenance_schedule_end || '08:00') || '08:00';

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
    chat_work_hours: raw.chat_work_hours || work.label.replace('–', '-'),
    chat_work_start: work.start,
    chat_work_end: work.end,
    chat_show_online: isOn(raw.chat_show_online ?? '1'),
    rate_provider: extras.rate_provider ?? raw.rate_provider ?? 'auto',
    rate_refresh_sec: parseInt(raw.rate_refresh_sec || '60', 10),
    exchange_min_usd: parseFloat(raw.exchange_min_usd || '50'),
    exchange_max_usd: parseFloat(raw.exchange_max_usd || '50000'),
    maintenance_mode: isOn(raw.maintenance_mode ?? '0'),
    maintenance_effective:
      isOn(raw.maintenance_mode ?? '0')
      || (isOn(raw.maintenance_schedule_enabled ?? '0') && isTimeInRange(schedStart, schedEnd)),
    maintenance_message: raw.maintenance_message || 'Обмен временно приостановлен. Попробуйте позже.',
    maintenance_schedule_enabled: isOn(raw.maintenance_schedule_enabled ?? '0'),
    maintenance_schedule_start: schedStart,
    maintenance_schedule_end: schedEnd,
    contact_telegram: raw.contact_telegram || '',
    contact_email: email,
    rules_text: raw.rules_text || '',
    faq_text: raw.faq_text || '',
    notif_new_order: isOn(raw.notif_new_order ?? '1'),
    notif_order_status: isOn(raw.notif_order_status ?? '0'),
    notif_chat_message: isOn(raw.notif_chat_message ?? '1'),
    notif_bybit_deposit: isOn(raw.notif_bybit_deposit ?? '1'),
    notif_maintenance: isOn(raw.notif_maintenance ?? '1'),
    wallet_check_enabled: isOn(raw.wallet_check_enabled ?? '1'),
    wallet_check_auto_on_order: isOn(raw.wallet_check_auto_on_order ?? '1'),
    wallet_check_cooldown_minutes: parseInt(raw.wallet_check_cooldown_minutes || '5', 10),
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

  if (b.chat_work_start !== undefined || b.chat_work_end !== undefined) {
    const current = getChatWorkRange();
    const start = normalizeTimeHHMM(b.chat_work_start !== undefined ? b.chat_work_start : current.start);
    const end = normalizeTimeHHMM(b.chat_work_end !== undefined ? b.chat_work_end : current.end);
    if (!start || !end) errors.push('Укажите корректное время работы');
    else if (start === end) errors.push('Начало и конец работы не могут совпадать');
    else syncChatWorkHoursString(start, end);
  } else if (b.chat_work_hours !== undefined) {
    const legacy = parseLegacyRange(String(b.chat_work_hours).trim());
    if (legacy.start === legacy.end) errors.push('Некорректные часы работы');
    else syncChatWorkHoursString(legacy.start, legacy.end);
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
    const wasOff = !isManualMaintenanceOn();
    const turningOn = !!b.maintenance_mode;
    setSetting('maintenance_mode', turningOn ? '1' : '0');
    if (wasOff && turningOn && shouldNotify('notif_maintenance')) {
      maintenanceActivated = true;
    }
  }
  if (b.maintenance_message !== undefined) {
    setSetting('maintenance_message', String(b.maintenance_message).trim().slice(0, 500));
  }
  if (b.maintenance_schedule_enabled !== undefined) {
    setSetting('maintenance_schedule_enabled', b.maintenance_schedule_enabled ? '1' : '0');
  }
  if (b.maintenance_schedule_start !== undefined) {
    const t = normalizeTimeHHMM(b.maintenance_schedule_start);
    if (!t) errors.push('Некорректное время начала паузы');
    else setSetting('maintenance_schedule_start', t);
  }
  if (b.maintenance_schedule_end !== undefined) {
    const t = normalizeTimeHHMM(b.maintenance_schedule_end);
    if (!t) errors.push('Некорректное время конца паузы');
    else setSetting('maintenance_schedule_end', t);
  }

  if (b.contact_telegram !== undefined) {
    setSetting('contact_telegram', String(b.contact_telegram).trim().slice(0, 120));
  }
  if (b.contact_email !== undefined) {
    const email = sanitizeEmailValue(b.contact_email);
    if (email === null) errors.push('Некорректный email (или оставьте пустым)');
    else setSetting('contact_email', email);
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

  if (b.wallet_check_enabled !== undefined) {
    setSetting('wallet_check_enabled', b.wallet_check_enabled ? '1' : '0');
  }
  if (b.wallet_check_auto_on_order !== undefined) {
    setSetting('wallet_check_auto_on_order', b.wallet_check_auto_on_order ? '1' : '0');
  }
  if (b.wallet_check_cooldown_minutes !== undefined) {
    const v = parseInt(b.wallet_check_cooldown_minutes, 10);
    if (Number.isNaN(v) || v < 1 || v > 60) errors.push('Кулдаун проверки: 1–60 минут');
    else setSetting('wallet_check_cooldown_minutes', v);
  }

  return { errors, maintenanceActivated };
}

module.exports = {
  SETTING_DEFAULTS,
  isOn,
  isTimeInRange,
  isWithinChatWorkHours,
  isMaintenanceActive,
  isManualMaintenanceOn,
  isMaintenanceScheduleActive,
  getMaintenanceMessage,
  getChatWorkRange,
  buildPublicConfig,
  buildChatPublicConfig,
  formatAdminSettings,
  shouldNotify,
  getRateCacheTtlMs,
  applySettingsPatch,
  sanitizeEmailValue,
  normalizeTimeHHMM,
};
