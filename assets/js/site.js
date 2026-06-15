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

  function boot() {
    initNav();
    initFaq();
    initCarousels();
    initLucide();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
