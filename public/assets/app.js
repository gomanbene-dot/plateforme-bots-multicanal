/* Script commun : connexion, thème, icônes et petits utilitaires.
   Chargé dans le <head>, avant les scripts de page. */
(function () {
  const store = {
    get(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k); } catch { return null; } },
    set(k, v, remember) { try { (remember ? localStorage : sessionStorage).setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch {} }
  };

  // ---- Thème : clair, sombre ou automatique (préférence du téléphone) ----
  const savedTheme = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })();
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;

  // ---- Toutes les requêtes /api/ portent le code d'accès de l'entreprise ----
  const nativeFetch = window.fetch.bind(window);
  const loginUrl = () => '/connexion?next=' + encodeURIComponent(location.pathname + location.search);
  window.fetch = async function (input, options = {}) {
    const target = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (target.origin === location.origin && target.pathname.startsWith('/api/')) {
      const token = store.get('bot-access');
      // Sans code : redirection vers la connexion ; la requête reste en attente pendant le changement de page
      if (!token) { location.href = loginUrl(); return new Promise(() => {}); }
      options.headers = new Headers(options.headers);
      options.headers.set('Authorization', 'Bearer ' + token);
    }
    const res = await nativeFetch(input, options);
    if (res.status === 401 && target.pathname.startsWith('/api/')) { store.del('bot-access'); location.href = loginUrl(); }
    return res;
  };

  // ---- Icônes (traits simples, héritent de la couleur du texte) ----
  const P = {
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M17 14h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 21h.01"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
  };
  window.icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;

  // ---- Utilitaires ----
  window.esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  window.toast = (msg, type) => {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast' + (type === 'error' ? ' error' : ''); t.textContent = msg;
    box.appendChild(t); setTimeout(() => t.remove(), 3800);
  };
  window.copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copié dans le presse-papier'); }
    catch { toast('Copie impossible : sélectionnez le texte manuellement', 'error'); }
  };
  window.api = async (path, body) => {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    let data = {}; try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  };
  window.auth = {
    token: () => store.get('bot-access'),
    save: (t, remember) => { store.del('bot-access'); store.set('bot-access', t, remember); },
    logout: () => { store.del('bot-access'); location.href = '/connexion'; },
    nativeFetch
  };
  window.theme = {
    current: () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    toggle() {
      const next = this.current() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch {}
      document.dispatchEvent(new CustomEvent('themechange'));
      return next;
    }
  };
})();
