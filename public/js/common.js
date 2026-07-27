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

  window.App = { $, $$, show, escapeHtml, OPTION_SHAPES, toast, renderLeaderboard, renderDistribution };
})();
