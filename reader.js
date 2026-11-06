(() => {
  'use strict';
  const ds = window.DS, chapters = ds.library.chapters, items = ds.library.artwork.items;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  let saved = null;
  try { saved = JSON.parse(ds.store.get('ds_progress', 'null')); } catch {}

  let index = params.has('id')
    ? chapters.findIndex(c => c.id === params.get('id'))
    : params.has('chapter')
      ? Number(params.get('chapter'))
      : saved?.id
        ? chapters.findIndex(c => c.id === saved.id)
        : Number(saved?.chapter ?? ds.store.get('ds_cur', '0'));

  if (!Number.isInteger(index) || index < 0 || index >= chapters.length) index = 0;

  let theme = ds.store.get('ds_theme', 'dark');
  let streamDelayMs = 50; // 标准舒适流速 50ms
  let suppress = false;
  let scrollTimer;
  let autoAdvanceTimer = null;
  let isShifting = false;
  let isNavigating = false;
  let shiftTimer, revealTimer;
  const transitionMs = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420;

  const split = text => text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const readingEdge = () => Math.max(80, ($('site-header')?.getBoundingClientRect().bottom || 0) + 16);

  if (!['light', 'dark'].includes(theme)) theme = 'dark';
  document.body.dataset.theme = theme;

  const font = ds.store.get('ds_font', '20');
  if ($('font-size')) {
    $('font-size').value = ['18', '20', '22', '24'].includes(font) ? font : '20';
    document.documentElement.style.setProperty('--font-size', $('font-size').value + 'px');
  }

  // 流式运行态状态
  let activeStreamInterval = null;
  let isCurrentlyStreaming = false;
  let nextParaIndex = 0;
  let currentParagraphs = [];
  let currentPositions = new Map();
  let currentArtList = [];
  let activeStreamingTask = null;

  function url(push = false) {
    const u = new URL(location.href);
    u.searchParams.set('id', chapters[index].id);
    u.searchParams.set('lang', ds.lang);
    u.searchParams.delete('chapter');
    u.searchParams.delete('restart');
    history[push ? 'pushState' : 'replaceState']({ id: chapters[index].id }, '', u);
  }

  function capture() {
    const edge = readingEdge();
    const paragraphs = [...document.querySelectorAll('[data-paragraph], [data-art-id]')];
    const p = paragraphs.find(el => el.getBoundingClientRect().bottom > edge) || paragraphs.at(-1);
    return {
      id: chapters[index]?.id,
      atTop: window.scrollY < 50,
      revealed: nextParaIndex,
      paragraph: Number(p?.dataset.paragraph || p?.dataset.afterParagraph || 0),
      artwork: p?.dataset.artId || null,
      fraction: p ? Math.max(0, Math.min(1, (edge - p.getBoundingClientRect().top) / Math.max(1, p.getBoundingClientRect().height))) : 0
    };
  }

  function save() {
    if (suppress || !chapters[index]) return;
    ds.store.set('ds_progress', JSON.stringify(capture()));
    ds.store.set('ds_cur', String(index));
  }

  function restorePosition(position) {
    suppress = true;
    requestAnimationFrame(() => {
      const p = (position.artwork && [...document.querySelectorAll('[data-art-id]')].find(el => el.dataset.artId === position.artwork))
        || document.querySelector('[data-paragraph="' + Number(position.paragraph || 0) + '"]');
      const fraction = Math.max(0, Math.min(1, Number(position.fraction) || 0));
      const top = !position.atTop && p
        ? window.scrollY + p.getBoundingClientRect().top + p.getBoundingClientRect().height * fraction - readingEdge() : 0;
      window.scrollTo({ top, behavior: 'instant' });
      suppress = false;
    });
  }

  const figureHtml = (a, paraIdx) => '<figure class="fade-in-figure" data-art-id="' + ds.esc(a.id) + '" data-after-paragraph="' + paraIdx + '"><img src="' + ds.esc(a.src) + '" alt="' + ds.esc(ds.text(a.alt || a.title)) + '" loading="lazy" decoding="async"' + (a.width && a.height ? ' width="' + a.width + '" height="' + a.height + '"' : '') + '><figcaption>' + ds.esc(ds.text(a.title)) + '</figcaption></figure>';

  function stopStreaming() {
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
    if (activeStreamInterval) {
      clearInterval(activeStreamInterval);
      activeStreamInterval = null;
    }
    isCurrentlyStreaming = false;
    activeStreamingTask = null;
    document.querySelectorAll('.stream-caret').forEach(c => c.remove());
  }

  function updateProgressTop() {
    const bar = $('topProgressBar');
    if (bar && currentParagraphs.length > 0) {
      const pct = Math.round((nextParaIndex / currentParagraphs.length) * 100);
      bar.style.width = `${pct}%`;
    }
  }

  function render(focus = false, position = null) {
    stopStreaming();
    const c = chapters[index];
    if (!c) {
      if ($('chapter-title')) $('chapter-title').textContent = ds.t('正文未能载入', 'The story could not load');
      if ($('chapter-body')) $('chapter-body').textContent = ds.t('请返回首页重新打开。', 'Return home and open the story again.');
      return;
    }

    const english = ds.lang === 'en' && c.translationStatus === 'ready' && c.en;
    const text = english ? c.en : c.text;
    const source = split(c.text);
    const paragraphs = split(text);
    const art = items.filter(a => a.chapterId === c.id);
    const positions = new Map();

    for (const a of art) {
      let at = source.findIndex(p => p.includes(a.anchor));
      if (at < 0) at = source.length - 1;
      if (english && source.length !== paragraphs.length) {
        at = Math.min(paragraphs.length - 1, Math.round(at / Math.max(1, source.length - 1) * (paragraphs.length - 1)));
      }
      if (!positions.has(at)) positions.set(at, []);
      positions.get(at).push(a);
    }

    currentParagraphs = paragraphs;
    currentPositions = positions;
    currentArtList = art;

    const body = $('chapter-body');
    if (body) body.lang = english ? 'en' : 'zh-CN';
    if ($('chapter-title')) $('chapter-title').textContent = ds.title(c);

    // 图1：右下角 HUD 显示章节标签与阅读耗时
    if ($('reading-label')) $('reading-label').textContent = ds.chapterLabel(c) + ' / ' + (index + 1) + ' ' + ds.t('共', 'of') + ' ' + chapters.length;

    const minutes = Math.max(1, Math.ceil(english ? text.split(/\s+/).length / 220 : c.chars / 400));
    if ($('reading-meta')) $('reading-meta').textContent = ds.t('约 ' + minutes + ' 分钟阅读 · ' + art.length + ' 幅插画', 'About ' + minutes + ' min read · ' + art.length + ' illustration' + (art.length === 1 ? '' : 's'));

    if ($('translation-note')) {
      $('translation-note').hidden = ds.lang !== 'en' || !!english;
      $('translation-note').textContent = c.translationStatus === 'ready'
        ? ''
        : 'This chapter is shown in the original Chinese. Its English translation has not been added yet.';
    }

    // 图3：右下角 HUD 翻页导航
    if ($('previous')) {
      $('previous').textContent = ds.t('上一篇', 'Previous');
      $('previous').disabled = index === 0;
    }
    if ($('next')) {
      $('next').textContent = ds.t('下一篇', 'Next');
      $('next').hidden = index === chapters.length - 1;
    }
    if ($('finish')) $('finish').hidden = index !== chapters.length - 1;
    if ($('theme-toggle')) $('theme-toggle').textContent = theme === 'dark' ? ds.t('日间阅读', 'Light theme') : ds.t('夜间阅读', 'Dark theme');

    document.title = ds.title(c) + ' · ' + ds.t('残响沙盒 · 若明日未至', 'Residual Sandbox: If Tomorrow Never Calls');

    startStreamMode(position);

    if (focus) {
      const h1 = $('chapter-title');
      if (h1) h1.focus();
    }
  }

  function startStreamMode(position) {
    stopStreaming();
    const triggerWrap = $('triggerWrap');
    if (triggerWrap) triggerWrap.hidden = false;

    const body = $('chapter-body');
    if (body) body.innerHTML = '';
    nextParaIndex = 0;

    resetTriggerPrompt();
    if (position && position.id === chapters[index].id) {
      const count = Number(position.revealed ?? (Number(position.paragraph || 0) + 1));
      const revealed = Number.isInteger(count) ? Math.max(1, Math.min(currentParagraphs.length, count)) : 1;
      while (nextParaIndex < revealed) {
        const paraIdx = nextParaIndex++;
        appendCompleteParagraph(paraIdx);
        onParagraphStreamFinished(paraIdx, false);
      }
      updateProgressTop();
      restorePosition(position);
      return;
    }
    updateProgressTop();
    streamNextParagraph();
  }

  function fillParagraph(p, rawText) {
    p.replaceChildren();
    rawText.split('\n').forEach((line, i) => {
      if (i) p.appendChild(document.createElement('br'));
      const span = document.createElement('span');
      span.className = 'char-loaded';
      span.textContent = line;
      p.appendChild(span);
    });
  }

  function appendCompleteParagraph(paraIdx) {
    const rawText = currentParagraphs[paraIdx];
    const separator = /^[◆—~·\*\s-]+$/.test(rawText.trim());
    const p = document.createElement(separator ? 'div' : 'p');
    p.className = separator ? 'separator' : 'prose-p';
    p.dataset.paragraph = String(paraIdx);
    if (separator) p.textContent = '—';
    else fillParagraph(p, rawText);
    $('chapter-body').appendChild(p);
  }

  function resetTriggerPrompt() {
    $('triggerBtn')?.setAttribute('aria-label', ds.t('继续阅读', 'Continue reading'));
    if ($('triggerTitleText')) $('triggerTitleText').textContent = 'Checkpoints';
    if ($('progressCounter')) $('progressCounter').textContent = `(1 / ${currentParagraphs.length || 1})`;
  }

  function streamNextParagraph() {
    if (nextParaIndex >= currentParagraphs.length) {
      return;
    }

    isCurrentlyStreaming = true;
    const paraIdx = nextParaIndex;
    const rawText = currentParagraphs[paraIdx];
    nextParaIndex++;

    if ($('progressCounter')) $('progressCounter').textContent = `(${nextParaIndex} / ${currentParagraphs.length})`;
    if ($('triggerTitleText')) $('triggerTitleText').textContent = 'Checkpoints';
    updateProgressTop();

    const body = $('chapter-body');
    if (!body) return;

    if (/^[◆—~·\*\s-]+$/.test(rawText.trim())) {
      const sep = document.createElement('div');
      sep.className = 'separator';
      sep.dataset.paragraph = String(paraIdx);
      sep.textContent = '—';
      body.appendChild(sep);
      onParagraphStreamFinished(paraIdx);
      return;
    }

    const p = document.createElement('p');
    p.className = 'prose-p';
    p.dataset.paragraph = String(paraIdx);
    body.appendChild(p);

    const caret = document.createElement('span');
    caret.className = 'stream-caret';
    p.appendChild(caret);

    let charIndex = 0;
    const chars = Array.from(rawText);
    const totalCount = chars.length;

    activeStreamingTask = {
      finishImmediately: () => {
        if (activeStreamInterval) clearInterval(activeStreamInterval);
        activeStreamInterval = null;
        if (caret.parentNode) caret.remove();
        fillParagraph(p, rawText);
        onParagraphStreamFinished(paraIdx);
      }
    };

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      activeStreamingTask.finishImmediately();
      return;
    }

    activeStreamInterval = setInterval(() => {
      const step = 2; // 一次平滑输出 2 字
      for (let s = 0; s < step && charIndex < totalCount; s++) {
        const char = chars[charIndex];
        charIndex++;

        if (char === '\n') {
          p.insertBefore(document.createElement('br'), caret);
        } else {
          const charSpan = document.createElement('span');
          charSpan.className = 'char-loaded';
          charSpan.textContent = char;
          p.insertBefore(charSpan, caret);
        }
      }

      // 平滑自动跟读滚动
      const caretRect = caret.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (caretRect.bottom > viewportHeight - 140) {
        window.scrollBy({ top: caretRect.bottom - (viewportHeight - 140), behavior: 'smooth' });
      }

      if (charIndex >= totalCount) {
        if (activeStreamInterval) clearInterval(activeStreamInterval);
        activeStreamInterval = null;
        if (caret.parentNode) caret.remove();
        onParagraphStreamFinished(paraIdx);
        return;
      }
    }, streamDelayMs);
  }

  function onParagraphStreamFinished(paraIdx, allowAutoAdvance = true) {
    isCurrentlyStreaming = false;
    activeStreamingTask = null;

    const artItems = currentPositions.get(paraIdx);
    if (artItems && artItems.length > 0) {
      const body = $('chapter-body');
      artItems.forEach(a => {
        const div = document.createElement('div');
        div.innerHTML = figureHtml(a, paraIdx);
        body.appendChild(div.firstElementChild);
      });
    }

    if (nextParaIndex >= currentParagraphs.length) {
      updateProgressTop();
      if (index < chapters.length - 1) {
        if ($('triggerTitleText')) $('triggerTitleText').textContent = 'Checkpoints';
        if ($('progressCounter')) $('progressCounter').textContent = `(${currentParagraphs.length} / ${currentParagraphs.length})`;

        if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
        // 留 2.0 秒阅读呼吸时间，随后自动缓慢黑屏切入下一章
        if (allowAutoAdvance) {
          autoAdvanceTimer = setTimeout(() => {
            go(index + 1);
          }, 2000);
        }
      } else {
        // 最终章结束：温和呈现结语与回到海面
        if ($('triggerTitleText')) $('triggerTitleText').textContent = ds.t('故事已完结 · 回到海面', 'Story Complete · Surface');
        if ($('progressCounter')) $('progressCounter').textContent = '✦';

        const body = $('chapter-body');
        if (body && !$('story-finale')) {
          const fin = document.createElement('div');
          fin.id = 'story-finale';
          fin.className = 'story-finale';
          fin.innerHTML = `
            <p class="finale-title">${ds.t('— 《残响沙盒 · 若明日未至》 全文完 —', '— Residual Sandbox: If Tomorrow Never Calls · End —')}</p>
            <p class="finale-quote">${ds.t('“若明日未至，我亦不松手。”', '“If tomorrow never calls, I will never let go.”')}</p>
          `;
          body.appendChild(fin);
        }
      }
    } else {
      if ($('triggerTitleText')) $('triggerTitleText').textContent = 'Checkpoints';
      if ($('progressCounter')) $('progressCounter').textContent = `(${nextParaIndex} / ${currentParagraphs.length})`;
    }
  }

  function resetTriggerWrap() {
    const wrap = $('triggerWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <button type="button" class="stream-prompt-btn" id="triggerBtn" aria-label="${ds.t('继续阅读', 'Continue reading')}">
        <span style="color: #4ea8ff;">✦</span>
        <span class="prompt-text" id="triggerTitleText">Checkpoints</span>
        <span class="prompt-meta" id="progressCounter">(1 / ${currentParagraphs.length || 1})</span>
        <span class="prompt-kbd">SPACE</span>
      </button>
    `;
    const btn = $('triggerBtn');
    if (btn) btn.onclick = handleUserNextAction;
  }

  function handleUserNextAction() {
    if (isShifting || isNavigating) return;
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
    if (isCurrentlyStreaming) {
      if (activeStreamingTask) activeStreamingTask.finishImmediately();
    } else {
      if (nextParaIndex < currentParagraphs.length) {
        streamNextParagraph();
      } else if (index < chapters.length - 1) {
        go(index + 1);
      } else {
        triggerSurfaceTransition(ds.href('index.html'));
      }
    }
  }

  // 核心过场动画：缓慢黑屏后亮屏（上一章 / 下一章 / 自动连读）
  function go(next, push = true) {
    if (isShifting || isNavigating) return;
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }

    const targetIdx = Math.max(0, Math.min(chapters.length - 1, next));
    if (targetIdx === index && document.getElementById('chapter-body')?.hasChildNodes()) {
      return;
    }

    save();
    isShifting = true;
    stopStreaming();

    const veil = $('cinemaVeil');
    if (veil) veil.classList.add('active'); // 1. 缓慢黑屏 (Fade to black)

    shiftTimer = setTimeout(() => {
      // 2. 在完全黑屏中更新章节、重置滚动条至顶部
      index = targetIdx;
      resetTriggerWrap();
      url(push);
      render(true);
      window.scrollTo({ top: 0, behavior: 'instant' });
      save();

      // 3. 缓慢亮屏 (Fade in from black)
      revealTimer = setTimeout(() => {
        if (veil) veil.classList.remove('active');
        revealTimer = setTimeout(() => { isShifting = false; }, transitionMs());
      }, 60);

    }, transitionMs());
  }

  // 回到海面过场：缓慢黑屏后跳转
  function triggerSurfaceTransition(targetUrl) {
    if (isNavigating || isShifting) return;
    isNavigating = true;
    stopStreaming();
    save();

    const veil = $('cinemaVeil');
    if (veil) veil.classList.add('active'); // 缓慢黑屏

    setTimeout(() => {
      window.location.href = targetUrl;
    }, transitionMs());
  }

  // 绑定翻页控制
  if ($('previous')) {
    $('previous').onclick = (e) => {
      e.preventDefault();
      go(index - 1);
    };
  }
  if ($('next')) {
    $('next').onclick = (e) => {
      e.preventDefault();
      go(index + 1);
    };
  }

  // 绑定回到海面链接
  function bindSurfaceTriggers() {
    const triggers = ['scene-return', 'hud-surface-link', 'finish'];
    triggers.forEach(id => {
      const el = $(id);
      if (el) {
        el.onclick = (e) => {
          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          triggerSurfaceTransition(ds.href('index.html#' + chapters[index].id));
        };
      }
    });

  }

  // 委托给稳定的页眉，语言切换重建字标后仍能回到当前章节场景。
  $('site-header')?.addEventListener('click', e => {
    if (!e.target.closest('.wordmark') || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    triggerSurfaceTransition(ds.href('index.html#' + chapters[index].id));
  });

  if ($('font-size')) {
    $('font-size').onchange = e => {
      const position = capture();
      document.documentElement.style.setProperty('--font-size', e.target.value + 'px');
      ds.store.set('ds_font', e.target.value);
      restorePosition(position);
    };
  }

  if ($('theme-toggle')) {
    $('theme-toggle').onclick = () => {
      const position = capture();
      theme = theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = theme;
      ds.store.set('ds_theme', theme);
      $('theme-toggle').textContent = theme === 'dark' ? ds.t('日间阅读', 'Light theme') : ds.t('夜间阅读', 'Dark theme');
      restorePosition(position);
    };
  }

  document.addEventListener('ds:language', () => {
    const position = capture();
    resetTriggerWrap();
    render(false, position);
  });

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.target.closest('header, .reading-toolbar, .reading-hud, figure, select, button, a')) return;
    handleUserNextAction();
  });

  document.addEventListener('keydown', e => {
    if (e.repeat || isShifting || isNavigating) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,select,textarea,[contenteditable]') || document.querySelector('dialog[open]')) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      triggerSurfaceTransition(ds.href('index.html#' + chapters[index].id));
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('a,button,input,select,summary,textarea,[contenteditable]')) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      handleUserNextAction();
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      go(index - 1);
    }
    if (e.key === 'ArrowRight' && index < chapters.length - 1) {
      e.preventDefault();
      go(index + 1);
    }
  });

  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(save, 180);
  }, { passive: true });

  window.addEventListener('pagehide', save);

  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    clearTimeout(shiftTimer);
    clearTimeout(revealTimer);
    isNavigating = false;
    isShifting = false;
    let position = capture();
    try { position = JSON.parse(ds.store.get('ds_progress', 'null')) || position; } catch {}
    resetTriggerWrap();
    render(false, position);
  });

  window.addEventListener('popstate', () => {
    clearTimeout(shiftTimer);
    clearTimeout(revealTimer);
    isShifting = false;
    $('cinemaVeil')?.classList.remove('active');
    const id = new URLSearchParams(location.search).get('id');
    const found = chapters.findIndex(c => c.id === id);
    index = found < 0 ? 0 : found;
    resetTriggerWrap();
    render(true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  });

  resetTriggerWrap();
  render(false, params.get('restart') === '1' ? null : saved);
  url();
  bindSurfaceTriggers();

  // 页面初次载入：平滑亮屏 (Fade in from black)
  const veil = $('cinemaVeil');
  if (veil) {
    requestAnimationFrame(() => {
      setTimeout(() => veil.classList.remove('active'), 60);
    });
  }
})();
