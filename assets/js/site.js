(function () {
  function initNav() {
    const toggle = document.getElementById('nav_toggle');
    const nav = document.getElementById('site_nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', () => {
      nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', nav.classList.contains('open'));
    });
    nav.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => nav.classList.remove('open'));
    });
  }

  function initFaq() {
    const root = document.getElementById('faq_wrapper');
    if (!root) return;
    root.querySelectorAll('.faq-q').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const open = item.classList.contains('open');
        root.querySelectorAll('.faq-item').forEach((i) => i.classList.remove('open'));
        if (!open) item.classList.add('open');
      });
    });
  }

  function initCarousels() {
    document.querySelectorAll('[data-carousel]').forEach((wrap) => {
      const track = wrap.querySelector('.carousel-track');
      const prev = wrap.querySelector('[data-carousel-prev]');
      const next = wrap.querySelector('[data-carousel-next]');
      if (!track || !prev || !next) return;
      const step = () => track.querySelector('.carousel-card')?.offsetWidth || 320;
      prev.addEventListener('click', () => track.scrollBy({ left: -step() - 16, behavior: 'smooth' }));
      next.addEventListener('click', () => track.scrollBy({ left: step() + 16, behavior: 'smooth' }));
    });
  }

  function initLucide() {
    if (window.lucide) lucide.createIcons();
  }

  function telegramHref(handle) {
    const h = String(handle || '').trim();
    if (!h) return '';
    if (h.startsWith('http')) return h;
    const user = h.replace(/^@/, '');
    return `https://t.me/${user}`;
  }

  function applySiteConfig(cfg) {
    if (!cfg) return;

    if (cfg.site_name) {
      document.title = `${cfg.site_name} — обмен криптовалют`;
      const footName = document.getElementById('foot-site-name');
      if (footName) footName.textContent = cfg.site_name;
    }

    if (cfg.site_tagline) {
      const heroTag = document.getElementById('hero-tagline');
      if (heroTag) heroTag.textContent = cfg.site_tagline;
      const footTag = document.getElementById('foot-tagline');
      if (footTag) footTag.textContent = cfg.site_tagline;
    }

    if (cfg.accent_color) {
      document.documentElement.style.setProperty('--accent', cfg.accent_color);
      document.documentElement.style.setProperty('--accent-glow', `${cfg.accent_color}40`);
    }

    const banner = document.getElementById('maintenance-banner');
    if (banner) {
      if (cfg.maintenance_mode) {
        banner.textContent = cfg.maintenance_message || 'Обмен временно приостановлен.';
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    }

    const tg = cfg.contacts?.telegram;
    if (tg) {
      const href = telegramHref(tg);
      const support = document.getElementById('support-telegram-link');
      const foot = document.getElementById('foot-telegram-link');
      const label = document.getElementById('support-telegram-label');
      if (support) support.href = href;
      if (foot) foot.href = href;
      if (label) label.textContent = tg.startsWith('http') ? tg.replace(/^https?:\/\/t\.me\//, '@') : tg;
    }

    const email = cfg.contacts?.email;
    if (email) {
      const footEmail = document.getElementById('foot-email-link');
      if (footEmail) {
        footEmail.href = `mailto:${email}`;
        footEmail.textContent = email;
        footEmail.classList.remove('hidden');
      }
    }

    if (cfg.rules_text) {
      const section = document.getElementById('rules-section');
      const content = document.getElementById('rules-content');
      if (section && content) {
        content.innerHTML = cfg.rules_text
          .split('\n')
          .filter(Boolean)
          .map((line) => `<p>${line.replace(/</g, '&lt;')}</p>`)
          .join('');
        section.classList.remove('hidden');
      }
    }

    if (cfg.faq_text) {
      const faq = document.getElementById('faq_wrapper');
      if (faq) {
        faq.innerHTML = `<div class="faq-custom">${cfg.faq_text
          .split('\n')
          .filter(Boolean)
          .map((line) => `<p>${line.replace(/</g, '&lt;')}</p>`)
          .join('')}</div>`;
      }
    }

    window.__siteConfig = cfg;
  }

  function loadSiteConfig() {
    return fetch('/api/config')
      .then((r) => r.json())
      .then(applySiteConfig)
      .catch(() => {});
  }

  function boot() {
    initNav();
    initFaq();
    initCarousels();
    loadSiteConfig().finally(initLucide);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
