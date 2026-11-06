(() => {
  'use strict';
  const ds = window.DS, chapters = ds.library.chapters;
  const $ = id => document.getElementById(id);

  let savedTargetId = 'chapter-00';
  let hasCache = false;

  // 1. 读取用户阅读进度缓存（缓存制）
  try {
    const rawProgress = ds.store.get('ds_progress');
    const rawCur = ds.store.get('ds_cur');
    let targetIndex = 0;

    if (rawProgress) {
      const p = JSON.parse(rawProgress);
      if (p && p.id) {
        const found = chapters.findIndex(c => c.id === p.id);
        if (found >= 0) {
          targetIndex = found;
          hasCache = true;
        }
      }
    } else if (rawCur !== null && rawCur !== undefined) {
      const idx = Number(rawCur);
      if (Number.isInteger(idx) && idx >= 0 && idx < chapters.length) {
        targetIndex = idx;
        hasCache = true;
      }
    }

    if (hasCache && targetIndex > 0) {
      savedTargetId = chapters[targetIndex].id;
    } else {
      hasCache = false;
      savedTargetId = 'chapter-00';
    }
  } catch {
    hasCache = false;
    savedTargetId = 'chapter-00';
  }

  function initUI() {
    const isEn = (ds.lang === 'en');
    document.title = ds.t('残响沙盒 · 若明日未至', 'Residual Sandbox: If Tomorrow Never Calls') + ' · ' + ds.t('在被记住的地方', 'A story that remembers');

    const submergeTextEl = $('submergeText');
    const cacheHintEl = $('cacheHint');

    if (hasCache) {
      const chap = chapters.find(c => c.id === savedTargetId) || chapters[0];
      const chapLabel = isEn ? (chap.labelEn || chap.label) : chap.label;
      submergeTextEl.textContent = isEn ? `Submerge · Resume (${chapLabel})` : `下沉 · 回到记忆 (${chapLabel})`;
      cacheHintEl.innerHTML = isEn
        ? `Last read at ${chapLabel} · <button type="button" class="btn-reset-cache" id="btnRestartZero">Restart from Prologue</button>`
        : `已定位上次停留章节 · <button type="button" class="btn-reset-cache" id="btnRestartZero">从序章重新下沉</button>`;

      const btnRestart = $('btnRestartZero');
      if (btnRestart) {
        btnRestart.onclick = (e) => {
          e.stopPropagation();
          triggerSubmergeTransition('chapter-00', true);
        };
      }
    } else {
      submergeTextEl.textContent = isEn ? 'Submerge' : '下沉';
      cacheHintEl.innerHTML = isEn ? 'Begin the journey from the prologue' : '初次连入，将从序章沉入深渊';
    }

    soundUI();

    // 页面初次载入：平滑亮屏 (Fade in from black)
    const veil = $('cinemaVeil');
    if (veil) {
      requestAnimationFrame(() => {
        setTimeout(() => veil.classList.remove('active'), 60);
      });
    }
  }

  // 2. 电影式缓慢黑屏过场（下沉）
  let isNavigating = false;

  function triggerSubmergeTransition(targetId, restart = false) {
    if (isNavigating) return;
    isNavigating = true;

    const veil = $('cinemaVeil');
    if (veil) veil.classList.add('active'); // 缓慢黑屏

    if (audio && !audio.paused) {
      const fadeInterval = setInterval(() => {
        if (audio.volume > 0.05) audio.volume -= 0.05;
        else clearInterval(fadeInterval);
      }, 50);
    }

    // 450ms 缓慢淡黑后平滑接入阅读器
    setTimeout(() => {
      window.location.href = ds.href('read.html?id=' + (targetId || savedTargetId) + (restart ? '&restart=1' : ''));
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
  }

  const btnSubmerge = $('btnSubmerge');
  if (btnSubmerge) {
    btnSubmerge.onclick = () => {
      triggerSubmergeTransition(savedTargetId);
    };
  }

  // 音频控制
  const audio = document.getElementById('soundtrack');
  if (audio) audio.volume = 0.35;

  function soundUI() {
    const b = $('sound-toggle');
    if (!b || !audio) return;
    b.innerHTML = ds.icon(audio.paused ? 'sound' : 'mute');
    b.setAttribute('aria-pressed', String(!audio.paused));
    b.setAttribute('aria-label', audio.paused ? ds.t('播放配乐', 'Play soundtrack') : ds.t('暂停配乐', 'Pause soundtrack'));
    b.title = b.getAttribute('aria-label');
  }

  async function sound() {
    if (!audio) return;
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
      const status = $('audio-status');
      if (status) status.textContent = '';
    } catch {
      const status = $('audio-status');
      if (status) status.textContent = ds.t('配乐暂时无法播放，请稍后再试。', 'The soundtrack could not play. Please try again later.');
    }
    soundUI();
  }

  const soundBtn = $('sound-toggle');
  if (soundBtn) soundBtn.onclick = sound;
  if (audio) {
    audio.addEventListener('pause', soundUI);
    audio.addEventListener('play', soundUI);
  }

  const artworkLink = $('artwork-link');
  if (artworkLink) {
    artworkLink.innerHTML = ds.icon('picture');
    artworkLink.href = ds.href('gallery.html');
    artworkLink.setAttribute('aria-label', ds.t('浏览插画', 'Browse artwork'));
  }

  document.addEventListener('ds:language', initUI);
  initUI();
})();
