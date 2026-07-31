// Helpers partagés entre la vue hôte et la vue joueur.
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function show(id) {
    $$('.screen').forEach((s) => s.classList.remove('screen--active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('screen--active');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // Formes associées aux propositions du QCM (rappel visuel côté joueur/hôte).
  const OPTION_SHAPES = ['▲', '◆', '●', '■', '★', '✚'];

  let toastTimer = null;
  function toast(message) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3200);
  }

  function renderLeaderboard(container, entries, myId) {
    container.innerHTML = '';
    entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (e.playerId === myId ? ' me' : '');
      row.innerHTML =
        `<div class="lb-rank">${e.rank}</div>` +
        `<div class="lb-name">${escapeHtml(e.pseudo)}</div>` +
        `<div class="lb-score">${e.score}</div>`;
      container.appendChild(row);
    });
    if (entries.length === 0) {
      container.innerHTML = '<p class="muted center">Aucun joueur pour l\'instant.</p>';
    }
  }

  // Répartition des réponses par proposition (barres façon Kahoot).
  function renderDistribution(container, { options, distribution, correctIndex, chosenIndex }) {
    container.innerHTML = '';
    const counts = distribution || [];
    const max = Math.max(1, ...counts);
    options.forEach((opt, i) => {
      const count = counts[i] || 0;
      const row = document.createElement('div');
      row.className = 'dist-row' + (i === correctIndex ? ' correct' : '');
      const tags =
        (i === correctIndex ? '<span class="dist-tag good">bonne réponse</span>' : '') +
        (chosenIndex === i ? '<span class="dist-tag you">ton choix</span>' : '');
      row.innerHTML =
        `<div class="dist-label"><span class="option__shape">${OPTION_SHAPES[i % 6]}</span>` +
        `<span class="dist-text">${escapeHtml(opt)}</span>${tags}</div>` +
        `<div class="dist-track"><div class="dist-bar" data-c="${i % 6}" style="width:${(count / max) * 100}%"></div></div>` +
        `<div class="dist-count">${count}</div>`;
      container.appendChild(row);
    });
  }

  // --- Sons (Web Audio, aucun fichier) ------------------------------------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let actx = null;
  function ctx() {
    if (!AudioCtx) return null;
    if (!actx) actx = new AudioCtx();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(freq, dur, type, gain, when) {
    const c = ctx();
    if (!c || !Sound.enabled) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    o.connect(g); g.connect(c.destination);
    const t = c.currentTime + (when || 0);
    g.gain.setValueAtTime(gain || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur);
  }
  const Sound = {
    enabled: localStorage.getItem('bt_muted') !== '1',
    tick() { beep(620, 0.12, 'square', 0.07); },
    go() { beep(940, 0.28, 'square', 0.11); },
    correct() { beep(660, 0.14, 'sine', 0.14, 0); beep(990, 0.28, 'sine', 0.14, 0.12); },
    wrong() { beep(160, 0.38, 'sawtooth', 0.11); },
    reveal() { beep(440, 0.1, 'sine', 0.1, 0); beep(554, 0.1, 'sine', 0.1, 0.1); beep(659, 0.22, 'sine', 0.12, 0.2); },
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.3, 'triangle', 0.13, i * 0.14));
    },
  };
  // Débloque l'audio au 1er geste utilisateur (politique navigateur).
  window.addEventListener('pointerdown', () => { try { ctx(); } catch (_) {} }, { once: true });

  function initMute() {
    const btn = document.getElementById('mute-btn');
    if (!btn) return;
    const render = () => { btn.textContent = Sound.enabled ? '🔊' : '🔇'; };
    render();
    btn.onclick = () => {
      Sound.enabled = !Sound.enabled;
      localStorage.setItem('bt_muted', Sound.enabled ? '0' : '1');
      if (Sound.enabled) Sound.tick();
      render();
    };
  }

  // --- Décompte « 3·2·1 » plein écran -------------------------------------
  function playCountdown(seconds, onDone) {
    const overlay = document.createElement('div');
    overlay.className = 'countdown-overlay';
    document.body.appendChild(overlay);
    let n = seconds;
    const step = () => {
      if (n > 0) {
        overlay.innerHTML = `<div class="countdown-num">${n}</div>`;
        Sound.tick();
        n -= 1;
        setTimeout(step, 1000);
      } else {
        overlay.innerHTML = '<div class="countdown-num go">GO&nbsp;!</div>';
        Sound.go();
        setTimeout(() => { overlay.remove(); if (onDone) onDone(); }, 650);
      }
    };
    step();
  }

  // --- Confettis (canvas, sans dépendance) --------------------------------
  function confetti(durationMs) {
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    document.body.appendChild(canvas);
    const g = canvas.getContext('2d');
    let W, H;
    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const colors = ['#7c3aed', '#ec4899', '#22c55e', '#f59e0b', '#2563eb', '#e11d48'];
    const parts = Array.from({ length: 160 }, () => ({
      x: Math.random() * W, y: Math.random() * -H, r: 5 + Math.random() * 7,
      c: colors[(Math.random() * colors.length) | 0], vy: 2 + Math.random() * 4,
      vx: -2 + Math.random() * 4, rot: Math.random() * 6, vr: -0.2 + Math.random() * 0.4,
    }));
    const start = Date.now();
    (function frame() {
      g.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = p.c; g.fillRect(-p.r / 2, -p.r / 2, p.r, p.r); g.restore();
        if (p.y > H + 20) { p.y = -10; p.x = Math.random() * W; }
      });
      if (Date.now() - start < (durationMs || 3500)) requestAnimationFrame(frame);
      else { window.removeEventListener('resize', resize); canvas.remove(); }
    })();
  }

  // --- Podium (top 3) -----------------------------------------------------
  function renderPodium(container, entries, myId) {
    const top = entries.slice(0, 3);
    const order = [top[1], top[0], top[2]].filter(Boolean); // 2e, 1er, 3e
    container.innerHTML = '';
    const podium = document.createElement('div');
    podium.className = 'podium';
    order.forEach((e) => {
      const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : '🥉';
      const col = document.createElement('div');
      col.className = `podium-col rank-${e.rank}` + (e.playerId === myId ? ' me' : '');
      col.innerHTML =
        `<div class="podium-medal">${medal}</div>` +
        `<div class="podium-name">${escapeHtml(e.pseudo)}</div>` +
        `<div class="podium-bar"><span class="podium-rank">${e.rank}</span></div>` +
        `<div class="podium-score">${e.score}</div>`;
      podium.appendChild(col);
    });
    container.appendChild(podium);
  }

  // Palmarès : cartes de titres décernés en fin de partie (⚡ Éclair, 🔥 série…).
  function renderAwards(container, awards) {
    if (!container) return;
    container.innerHTML = '';
    if (!awards || !awards.length) return;
    const title = document.createElement('h2');
    title.className = 'awards-title';
    title.textContent = '🏅 Palmarès';
    container.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'awards-grid';
    awards.forEach((a, i) => {
      const card = document.createElement('div');
      card.className = 'award-card';
      card.style.animationDelay = `${i * 0.15}s`;
      card.innerHTML =
        `<div class="award-emoji">${escapeHtml(a.emoji || '🏅')}</div>` +
        `<div class="award-body">` +
        `<div class="award-title">${escapeHtml(a.title || '')}</div>` +
        `<div class="award-winner">${escapeHtml(a.winner || '')}</div>` +
        `<div class="award-detail">${escapeHtml(a.detail || '')}</div>` +
        `</div>`;
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }

  initMute();

  // Indice progressif : floute l'image au début de la manche, la dé-floute au fil
  // du minuteur (blur proportionnel au temps restant). L'image démarre nette à 0.
  const CLUE_MAX_BLUR = 20;
  function applyClueBlur(img, remaining, total) {
    if (!img || img.hidden) return;
    const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
    img.style.filter = ratio > 0 ? `blur(${(CLUE_MAX_BLUR * ratio).toFixed(1)}px)` : 'none';
  }

  // --- Thème clair / sombre (persisté, partagé par toutes les pages) ------
  // Le <head> pose déjà data-theme avant le rendu (anti-flash) ; ici on
  // synchronise l'icône du bouton et on branche le clic.
  const THEME_KEY = 'bt-theme';
  function applyTheme(theme) {
    const light = theme === 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    const btn = $('#theme-toggle');
    if (btn) {
      btn.textContent = light ? '🌙' : '☀️';
      const label = light ? 'Passer en thème sombre' : 'Passer en thème clair';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* stockage indispo */ }
    applyTheme(next);
  }
  (function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (_) { /* ignore */ }
    applyTheme(saved);
    const btn = $('#theme-toggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  })();

  window.App = {
    $, $$, show, escapeHtml, OPTION_SHAPES, toast, renderLeaderboard, renderDistribution,
    Sound, playCountdown, confetti, renderPodium, renderAwards, applyClueBlur, toggleTheme,
  };
})();
