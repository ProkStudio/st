function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress?.replace('::ffff:', '') || req.ip || '';
}

function isPrivateIp(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) return true;
  return false;
}

async function lookupGeo(ip) {
  if (isPrivateIp(ip)) {
    return { ip, country: 'Локальная сеть', city: '', countryCode: 'LO' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,city,query&lang=ru`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const data = await res.json();
    if (data.status === 'success') {
      return {
        ip: data.query || ip,
        country: data.country || 'Неизвестно',
        city: data.city || '',
        countryCode: data.countryCode || '',
      };
    }
  } catch { /* ignore */ }
  return { ip, country: 'Неизвестно', city: '', countryCode: '' };
}

module.exports = { getClientIp, lookupGeo, isPrivateIp };
