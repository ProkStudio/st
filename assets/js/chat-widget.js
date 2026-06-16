(function () {
  const STORAGE_KEY = 'bambus_chat_session';

  function collectDevice() {
    return {
      ua: navigator.userAgent,
      platform: navigator.platform || '',
      language: navigator.language || '',
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    };
  }

  let sessionId = localStorage.getItem(STORAGE_KEY);
  let config = { operatorName: 'Bambusito228 Support', statusText: 'Мы отвечаем сразу же' };
  let lastTs = 0;
  let pollTimer = null;
  let panelOpen = false;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function renderMessages(container, messages, appendOnly) {
    if (!appendOnly) container.innerHTML = '';
    messages.forEach((m) => {
      if (appendOnly && m.created_at <= lastTs) return;
      const div = el('div', `bambus-chat-msg ${m.sender}`, '');
      div.innerHTML = `${escapeHtml(m.body)}<time>${fmtTime(m.created_at)}</time>`;
      container.appendChild(div);
      if (m.created_at > lastTs) lastTs = m.created_at;
    });
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function ensureSession() {
    const res = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, device: collectDevice() }),
    });
    const data = await res.json();
    sessionId = data.sessionId;
    localStorage.setItem(STORAGE_KEY, sessionId);
    return data;
  }

  async function pollMessages(box) {
    if (!sessionId || !panelOpen) return;
    try {
      const res = await fetch(`/api/chat/messages?sessionId=${encodeURIComponent(sessionId)}&since=${lastTs}`);
      const data = await res.json();
      if (data.messages?.length) renderMessages(box, data.messages, true);
    } catch { /* ignore */ }
  }

  async function sendMessage(text, box) {
    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, text, device: collectDevice() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка отправки');
    renderMessages(box, [data.message], true);
  }

  function buildWidget() {
    const root = el('div');
    root.id = 'bambus-chat-root';

    const btn = el('button', 'bambus-chat-btn', `
      <span class="online-dot"></span>
      <svg viewBox="0 0 24 24" stroke="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    `);

    const panel = el('div', 'bambus-chat-panel');
    const initials = (config.operatorName || 'B').slice(0, 1).toUpperCase();
    panel.innerHTML = `
      <div class="bambus-chat-head">
        <div class="bambus-chat-avatar">${initials}</div>
        <div class="bambus-chat-head-info">
          <strong>${escapeHtml(config.operatorName)}</strong>
          <span><i class="dot"></i>${escapeHtml(config.statusText)}</span>
        </div>
        <button type="button" class="bambus-chat-close" aria-label="Закрыть">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="bambus-chat-messages"></div>
      <div class="bambus-chat-foot">
        <form>
          <input type="text" placeholder="Напишите своё сообщение здесь" maxlength="2000" autocomplete="off">
          <button type="submit" title="Отправить" aria-label="Отправить">
            <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
        </form>
      </div>
      <div class="bambus-chat-powered">Bambusito228 Support</div>
    `;

    root.appendChild(panel);
    root.appendChild(btn);
    document.body.appendChild(root);

    const box = panel.querySelector('.bambus-chat-messages');
    const form = panel.querySelector('form');
    const input = panel.querySelector('input');

    btn.onclick = async () => {
      panelOpen = !panelOpen;
      panel.classList.toggle('open', panelOpen);
      if (panelOpen) {
        const data = await ensureSession();
        lastTs = 0;
        renderMessages(box, data.messages || [], false);
        input.focus();
        if (!pollTimer) pollTimer = setInterval(() => pollMessages(box), 3000);
      }
    };

    panel.querySelector('.bambus-chat-close').onclick = () => {
      panelOpen = false;
      panel.classList.remove('open');
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        if (!sessionId) await ensureSession();
        await sendMessage(text, box);
      } catch (err) {
        alert(err.message);
      }
    };
  }

  fetch('/api/chat/config')
    .then((r) => r.json())
    .then((c) => { config = { ...config, ...c }; })
    .finally(buildWidget);

  window.getBambusChatSessionId = () => sessionId || localStorage.getItem(STORAGE_KEY);
})();
