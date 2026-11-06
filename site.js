(() => {
  'use strict';
  const store = {
    get(k, f = null) { try { return localStorage.getItem(k) ?? f; } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };
  const params = new URLSearchParams(location.search);
  let lang = params.get('lang') || store.get('ds_lang') || (/^zh/i.test(navigator.language) ? 'zh' : 'en');
  if (!['zh', 'en'].includes(lang)) lang = 'zh';

  const library = window.DATA_SEA_LIBRARY || { chapters: [], artwork: { scenes: {}, items: [] } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const icons = {
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    sound: '<path d="m11 5-5 4H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    mute: '<path d="m11 5-5 4H3v6h3l5 4V5Z"/><path d="m16 9 5 6m0-6-5 6"/>',
    picture: '<rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 3-4 6 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    left: '<path d="m14 5-7 7 7 7"/>',
    right: '<path d="m10 5 7 7-7 7"/>'
  };

  const ds = window.DS = {
    library,
    store,
    esc,
    get lang() { return lang; },
    t: (zh, en) => lang === 'en' ? en : zh,
    icon: name => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.arrow) + '</svg>',
    href(file) {
      const [base, fragment] = file.split('#');
      const [name, q = ''] = base.split('?');
      const p = new URLSearchParams(q);
      p.set('lang', lang);
      return name + '?' + p + (fragment ? '#' + fragment : '');
    },
    chapterLabel(c) { return ds.t(c.label, c.labelEn); },
    title(c) { return ds.t(c.title, c.titleEn); },
    art(id) { return library.artwork.items.find(a => a.id === id) || library.artwork.scenes[id] || library.artwork.scenes.quiet; },
    scene(c) { return ds.art(c.scene); },
    text(value) { return typeof value === 'string' ? value : ds.t(value?.zh || '', value?.en || value?.zh || ''); }
  };

  function translate() {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-zh][data-en]').forEach(el => el.textContent = ds.t(el.dataset.zh, el.dataset.en));
    document.querySelectorAll('[data-alt-zh]').forEach(el => el.alt = ds.t(el.dataset.altZh, el.dataset.altEn));
  }

  function shell() {
    const page = document.body.dataset.page;
    const header = document.getElementById('site-header');
    if (header) {
      header.className = 'site-header';
      header.innerHTML = '<a class="wordmark" href="' + ds.href('index.html') + '" aria-label="' + ds.t('残响沙盒 · 若明日未至', 'Residual Sandbox') + '">' +
        '<span class="brand-text">' + ds.t('残响沙盒 · 若明日未至', 'RESIDUAL SANDBOX') + '</span>' +
        '</a>' +
        '<div class="languages" role="group" aria-label="' + ds.t('语言', 'Language') + '">' +
        '<button type="button" data-language="zh" aria-pressed="' + (lang === 'zh') + '">中文</button>' +
        '<span aria-hidden="true">/</span>' +
        '<button type="button" data-language="en" aria-pressed="' + (lang === 'en') + '">EN</button>' +
        '</div>';

      header.querySelectorAll('[data-language]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.language === lang) return;
        lang = b.dataset.language;
        store.set('ds_lang', lang);
        const u = new URL(location.href);
        u.searchParams.set('lang', lang);
        history.replaceState(null, '', u);
        shell();
        translate();
        document.dispatchEvent(new CustomEvent('ds:language'));
      }));
    }

    const footer = document.getElementById('site-footer');
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML = '<a class="wordmark-foot" href="' + ds.href('index.html') + '">' + ds.t('残响沙盒 · 若明日未至', 'RESIDUAL SANDBOX') + '</a>' +
        '<p>' + ds.t('若明日未至，我亦不松手。', 'If tomorrow never calls, I will never let go.') + '</p>' +
        '<a href="' + ds.href('read.html') + '">' + ds.t('下沉', 'Descend') + '</a>';
    }

    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (/^[^/:#?]+\.html(?:[?#]|$)/.test(href)) a.href = ds.href(href);
    });
    translate();
  }

  // 全站通用纯净电影式过场（缓慢黑屏后亮屏）
  function initCinemaVeil() {
    let veil = document.getElementById('cinemaVeil');
    if (!veil) {
      veil = document.createElement('div');
      veil.id = 'cinemaVeil';
      veil.className = 'cinema-veil active';
      veil.setAttribute('aria-hidden', 'true');
      document.body.prepend(veil);
    }

    // 页面载入时缓慢亮屏 (Fade in from black)
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (veil) veil.classList.remove('active');
      }, 50);
    });

    // 拦截站内页面跳转，统一执行 380ms 柔和黑屏过渡
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (e.target.closest('#previous, #next, #btnSubmerge, .reading-hud button')) return;

      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
      if (/^[^/:#?]+\.html(?:[?#]|$)/.test(href)) {
        e.preventDefault();
        const targetUrl = a.href;
        if (veil) {
          veil.classList.add('active'); // 缓慢黑屏
          setTimeout(() => {
            window.location.href = targetUrl;
          }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
        } else {
          window.location.href = targetUrl;
        }
      }
    });
  }

  shell();
  initCinemaVeil();
  window.addEventListener('pageshow', () => document.getElementById('cinemaVeil')?.classList.remove('active'));

  if (/^https?:$/.test(location.protocol) && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    const eventSource = new EventSource('/api/events');
    eventSource.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        if (!message.generatedAt || message.generatedAt === library.generatedAt || message.error) return;
        let notice = document.getElementById('content-update');
        if (!notice) {
          notice = document.createElement('button');
          notice.type = 'button';
          notice.id = 'content-update';
          notice.className = 'content-update';
          notice.onclick = () => location.reload();
          document.body.append(notice);
        }
        notice.textContent = ds.t('有新的内容 · 点击载入', 'New content · Reload');
      } catch {}
    });
    eventSource.onerror = () => eventSource.close();
  }
})();
