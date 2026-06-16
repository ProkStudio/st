function pickUa(ua, re, fallback = '') {
  const m = String(ua || '').match(re);
  return m ? m[1].replace(/_/g, '.') : fallback;
}

function parseUserAgent(ua) {
  const s = String(ua || '');
  if (!s) return { browser: '', os: '', raw: '' };

  let browser = 'Браузер';
  if (/Edg\//i.test(s)) browser = `Edge ${pickUa(s, /Edg\/([\d.]+)/)}`.trim();
  else if (/OPR\//i.test(s)) browser = `Opera ${pickUa(s, /OPR\/([\d.]+)/)}`.trim();
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = `Chrome ${pickUa(s, /Chrome\/([\d.]+)/)}`.trim();
  else if (/Firefox\//i.test(s)) browser = `Firefox ${pickUa(s, /Firefox\/([\d.]+)/)}`.trim();
  else if (/Safari\//i.test(s) && !/Chrome/i.test(s)) browser = `Safari ${pickUa(s, /Version\/([\d.]+)/)}`.trim();
  else if (/Telegram/i.test(s)) browser = 'Telegram In-App';

  let os = 'ОС неизвестна';
  if (/Windows NT 10/i.test(s)) os = 'Windows 10/11';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/Android ([\d.]+)/i.test(s)) os = `Android ${pickUa(s, /Android ([\d.]+)/)}`.trim();
  else if (/iPhone|iPad|iPod/i.test(s)) os = `iOS ${pickUa(s, /OS ([\d_]+)/)}`.trim();
  else if (/Mac OS X/i.test(s)) os = `macOS ${pickUa(s, /Mac OS X ([\d_]+)/)}`.trim();
  else if (/Linux/i.test(s)) os = 'Linux';

  return { browser: browser.trim(), os: os.trim(), raw: s.slice(0, 300) };
}

function normalizeClientDevice(payload = {}) {
  const ua = String(payload.ua || payload.userAgent || '').slice(0, 300);
  const parsed = parseUserAgent(ua);
  return {
    browser: String(payload.browser || parsed.browser || '').slice(0, 80),
    os: String(payload.os || parsed.os || '').slice(0, 80),
    platform: String(payload.platform || '').slice(0, 80),
    language: String(payload.language || '').slice(0, 32),
    screen: String(payload.screen || '').slice(0, 32),
    timezone: String(payload.timezone || payload.tz || '').slice(0, 64),
    ua: parsed.raw || ua,
  };
}

function formatDeviceInfo(device, userAgent = '') {
  const d = typeof device === 'string'
    ? (() => { try { return JSON.parse(device); } catch { return {}; } })()
    : (device || {});

  if (!d.browser && !d.os && userAgent) {
    const parsed = parseUserAgent(userAgent);
    d.browser = parsed.browser;
    d.os = parsed.os;
  }

  const parts = [];
  if (d.browser) parts.push(d.browser);
  else if (d.os) parts.push(d.os);
  if (d.os && d.browser) parts.push(d.os);
  if (d.screen) parts.push(d.screen);
  if (d.language) parts.push(d.language);
  if (d.platform && !parts.includes(d.platform)) parts.push(d.platform);
  if (d.timezone) parts.push(d.timezone);

  return parts.filter(Boolean).join(' · ') || 'Устройство неизвестно';
}

function mergeDeviceInfo(existing, incoming) {
  const base = typeof existing === 'string'
    ? (() => { try { return JSON.parse(existing); } catch { return {}; } })()
    : (existing || {});
  const next = normalizeClientDevice(incoming);
  const merged = { ...base };
  for (const [k, v] of Object.entries(next)) {
    if (v) merged[k] = v;
  }
  return merged;
}

module.exports = {
  parseUserAgent,
  normalizeClientDevice,
  formatDeviceInfo,
  mergeDeviceInfo,
};
