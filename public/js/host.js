/* global io, YT */
(function () {
  const { $, $$, show, escapeHtml, OPTION_SHAPES, toast, renderLeaderboard } = window.App;
  // Le socket ne se connecte qu'après login, pour que le handshake porte le
  // cookie de session (l'auth de l'hôte est vérifiée côté serveur au handshake).
  const socket = io({ autoConnect: false });

  const state = {
    code: null,
    hostToken: null,
    round: null,
    timer: null,
    yt: null,
    ytReady: false,
    lastResults: null,
    authed: false,
    editingQuizId: null,
    clipStarted: false,
    clipFallback: null,
    total: 0,
    remaining: 0,
    paused: false,
    mode: 'solo', // mode choisi pour la prochaine salle
    roomMode: 'solo', // mode de la salle en cours
    combo: true, // bonus de série activé pour la prochaine salle
  };

  // --- API YouTube IFrame -------------------------------------------------
  window.onYouTubeIframeAPIReady = function () {
    state.ytReady = true;
  };

  // Lance la lecture de l'extrait (logique éprouvée : loadVideoById + playVideo).
  // Le minuteur ne partira qu'au vrai début de lecture (onClipStarted, via
  // l'événement PLAYING), pour ne pas voler de secondes aux joueurs.
  function loadClip() {
    const r = state.round;
    clearInterval(state.timer);
    $('#round-timer').textContent = '…';
    $('#round-bar').style.width = '100%';
    if (state.ytReady && window.YT && window.YT.Player) {
      try {
        if (!state.yt) {
          state.yt = new YT.Player('yt-player', {
            videoId: r.youtubeId,
            playerVars: { start: r.startSeconds, autoplay: 1, controls: 1, rel: 0, modestbranding: 1 },
            events: {
              onReady: (e) => { try { e.target.seekTo(state.round.startSeconds, true); e.target.playVideo(); } catch (_) {} },
              onStateChange: (e) => { if (e.data === 1) onClipStarted(); }, // 1 = PLAYING
              onError: () => onClipStarted(),
            },
          });
        } else {
          state.yt.loadVideoById({ videoId: r.youtubeId, startSeconds: r.startSeconds });
          state.yt.playVideo();
        }
      } catch (_) { onClipStarted(); }
    } else {
      // Pas de lecteur YouTube disponible : on ouvre la manche directement.
      setTimeout(onClipStarted, 400);
    }
    // Sécurité : si la lecture ne démarre jamais (bloquée, autoplay refusé…), on
    // ouvre la manche après 12 s pour ne pas rester coincé.
    clearTimeout(state.clipFallback);
    state.clipFallback = setTimeout(onClipStarted, 12000);
  }

  // Appelé au vrai démarrage de l'extrait : ouvre la manche (joueurs + minuteur).
  function onClipStarted() {
    if (state.clipStarted) return;
    state.clipStarted = true;
    clearTimeout(state.clipFallback);
    socket.emit('host:clipStarted');
    startCountdown(state.round.durationSeconds);
  }

  function startCountdown(total) {
    state.total = total;
    state.remaining = total;
    updateTimer(state.remaining, state.total);
    runCountdown();
  }

  function runCountdown() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      state.remaining -= 1;
      updateTimer(state.remaining, state.total);
      if (state.remaining <= 0) {
        clearInterval(state.timer);
        stopClip();
        socket.emit('host:endRound');
      }
    }, 1000);
  }

  function replayClip() {
    try { if (state.yt) { state.yt.seekTo(state.round.startSeconds, true); state.yt.playVideo(); } } catch (_) {}
  }

  function togglePause() {
    if (state.paused) {
      state.paused = false;
      try { if (state.yt) state.yt.playVideo(); } catch (_) {}
      runCountdown();
      socket.emit('host:resumeRound', { remainingSeconds: state.remaining });
      $('#pause-round').textContent = '⏸️ Pause';
    } else {
      state.paused = true;
      clearInterval(state.timer);
      try { if (state.yt) state.yt.pauseVideo(); } catch (_) {}
      socket.emit('host:pauseRound');
      $('#pause-round').textContent = '▶️ Reprendre';
    }
  }

  function stopClip() {
    clearInterval(state.timer);
    clearTimeout(state.clipFallback);
    state.clipStarted = true; // empêche un démarrage tardif après clôture
    try { if (state.yt) state.yt.pauseVideo(); } catch (_) {}
  }

  function updateTimer(remaining, total) {
    $('#round-timer').textContent = Math.max(0, remaining);
    $('#round-bar').style.width = `${Math.max(0, (remaining / total) * 100)}%`;
  }

  // --- Liste des quiz -----------------------------------------------------
  async function loadQuizzes() {
    try {
      const res = await fetch('/api/quizzes');
      if (res.status === 401) { state.authed = false; show('screen-login'); return; }
      const data = await res.json();
      const list = $('#quiz-list');
      list.innerHTML = '';
      data.quizzes.forEach((q) => {
        const item = document.createElement('div');
        item.className = 'quiz-item';
        item.innerHTML =
          `<div class="quiz-item__meta">` +
          `<div class="quiz-item__title">${escapeHtml(q.title)}</div>` +
          `<div class="badge">${q.roundCount} manche(s)${q.isDemo ? ' · démo' : ''}</div></div>`;
        const actions = document.createElement('div');
        actions.className = 'quiz-item__actions';

        const open = document.createElement('button');
        open.className = 'btn';
        open.textContent = 'Ouvrir une salle';
        open.onclick = () => socket.emit('host:createRoom', { quizId: q.id, mode: state.mode, combo: state.combo });
        actions.appendChild(open);

        if (!q.isDemo) {
          const edit = document.createElement('button');
          edit.className = 'btn btn--ghost btn--sm';
          edit.textContent = '✏️ Éditer';
          edit.onclick = () => editQuiz(q.id);
          actions.appendChild(edit);

          const del = document.createElement('button');
          del.className = 'btn btn--ghost btn--sm';
          del.textContent = '🗑️';
          del.setAttribute('aria-label', `Supprimer ${q.title}`);
          del.onclick = () => deleteQuiz(q.id, q.title);
          actions.appendChild(del);
        }
        item.appendChild(actions);
        list.appendChild(item);
      });
      if (data.quizzes.length === 0) list.innerHTML = '<p class="muted">Aucun quiz. Crée-en un ci-dessous.</p>';
    } catch (_) {
      $('#quiz-list').innerHTML = '<p class="muted">Impossible de charger les quiz.</p>';
    }
  }

  // --- Authentification ---------------------------------------------------
  async function checkAuth() {
    try {
      const res = await fetch('/api/me');
      if (res.ok) { onAuthed(); return; }
    } catch (_) { /* réseau : on montre le login */ }
    show('screen-login');
  }

  function onAuthed() {
    state.authed = true;
    $('#logout-btn').style.display = '';
    show('screen-home');
    loadQuizzes();
    socket.connect(); // le handshake porte désormais le cookie de session
  }

  async function doLogin() {
    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;
    $('#login-error').textContent = '';
    if (!username || !password) { $('#login-error').textContent = 'Identifiant et mot de passe requis.'; return; }
    const btn = $('#login-btn');
    btn.disabled = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) { $('#login-error').textContent = 'Identifiant ou mot de passe incorrect.'; return; }
      $('#login-password').value = '';
      onAuthed();
    } catch (_) {
      $('#login-error').textContent = 'Erreur réseau.';
    } finally {
      btn.disabled = false;
    }
  }

  async function doLogout() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
    localStorage.removeItem('bt_host');
    location.reload();
  }

  // --- Constructeur de quiz ----------------------------------------------
  let roundCount = 0;
  function addRoundBlock(data) {
    // `data` n'est utilisé que si c'est bien un objet de manche (jamais un event).
    const d = data && typeof data === 'object' && 'youtube' in data ? data : null;
    roundCount += 1;
    const n = roundCount;
    const opts = d?.options?.length ? d.options : ['', '', '', ''];
    const correct = d?.correctIndex ?? 0;
    const block = document.createElement('div');
    block.className = 'builder-round';
    block.dataset.round = String(n);
    block.innerHTML =
      `<div class="builder-round__head">` +
      `<h3 class="builder-round__title">Manche ${n}</h3>` +
      `<div class="builder-round__ctrls">` +
      `<button type="button" class="btn btn--ghost btn--sm r-up" aria-label="Monter la manche" title="Monter">↑</button>` +
      `<button type="button" class="btn btn--ghost btn--sm r-down" aria-label="Descendre la manche" title="Descendre">↓</button>` +
      `<button type="button" class="btn btn--ghost btn--sm r-del" aria-label="Supprimer la manche" title="Supprimer">🗑️</button>` +
      `</div></div>` +
      `<label>Lien YouTube (ou ID)</label><input class="r-yt" placeholder="https://youtu.be/..." value="${escapeHtml(d?.youtube ?? '')}" />` +
      `<div style="display:flex; gap:10px;">` +
      `<div style="flex:1"><label>Départ (s)</label><input class="r-start" type="number" min="0" value="${d?.startSeconds ?? 0}" /></div>` +
      `<div style="flex:1"><label>Durée (s)</label><input class="r-dur" type="number" min="5" max="60" value="${d?.durationSeconds ?? 20}" /></div></div>` +
      `<label>Question posée aux joueurs</label><input class="r-q" value="${escapeHtml(d?.question ?? 'Quel est ce morceau ?')}" />` +
      `<label>Propositions (coche la bonne réponse)</label>` +
      `<div class="r-options">` +
      opts.map((val, i) => optionInput(n, i, val, i === correct)).join('') +
      `</div>` +
      `<label>Réponse révélée — facultatif <span style="font-weight:400; color:var(--text-muted)">(vide = la bonne proposition)</span></label><input class="r-answer" placeholder="Laisse vide, ou détaille : Artiste — Titre (année)" value="${escapeHtml(d?.answerLabel ?? '')}" />`;
    $('#builder-rounds').appendChild(block);
    renumberRounds();
  }

  function optionInput(n, i, value, checked) {
    return (
      `<div class="option-input-row">` +
      `<input type="radio" name="correct-${n}" value="${i}" ${checked ? 'checked' : ''} />` +
      `<input class="r-opt" placeholder="Proposition ${i + 1}" value="${escapeHtml(value || '')}" />` +
      `</div>`
    );
  }

  // Renumérote les titres « Manche N » selon l'ordre courant et met à jour l'état
  // des flèches (désactivées en haut/bas).
  function renumberRounds() {
    const blocks = $$('.builder-round');
    blocks.forEach((b, i) => {
      const title = b.querySelector('.builder-round__title');
      if (title) title.textContent = `Manche ${i + 1}`;
      const up = b.querySelector('.r-up');
      const down = b.querySelector('.r-down');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === blocks.length - 1;
    });
  }

  function moveRound(block, dir) {
    if (dir < 0 && block.previousElementSibling) {
      block.parentNode.insertBefore(block, block.previousElementSibling);
    } else if (dir > 0 && block.nextElementSibling) {
      block.parentNode.insertBefore(block.nextElementSibling, block);
    }
    renumberRounds();
  }

  function removeRound(block) {
    if ($$('.builder-round').length <= 1) { toast('Il faut au moins une manche.'); return; }
    block.remove();
    renumberRounds();
  }

  // Délégation des clics sur les contrôles de manche (↑ ↓ 🗑️).
  function onBuilderRoundsClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const block = btn.closest('.builder-round');
    if (!block) return;
    if (btn.classList.contains('r-up')) moveRound(block, -1);
    else if (btn.classList.contains('r-down')) moveRound(block, 1);
    else if (btn.classList.contains('r-del')) removeRound(block);
  }

  function resetBuilder() {
    state.editingQuizId = null;
    $('#quiz-title').value = '';
    $('#builder-rounds').innerHTML = '';
    roundCount = 0;
    addRoundBlock();
    $('#save-quiz').textContent = '💾 Enregistrer le quiz';
    $('#builder-heading').textContent = 'Nouveau quiz';
  }

  async function editQuiz(id) {
    try {
      const res = await fetch(`/api/quizzes/${id}`);
      if (!res.ok) { toast('Impossible de charger la playlist.'); return; }
      const quiz = await res.json();
      state.editingQuizId = id;
      $('#builder').style.display = 'block';
      $('#builder-heading').textContent = `Modifier « ${quiz.title} »`;
      $('#quiz-title').value = quiz.title;
      $('#builder-rounds').innerHTML = '';
      roundCount = 0;
      quiz.rounds.forEach((r) => addRoundBlock({
        youtube: r.youtubeId,
        startSeconds: r.startSeconds,
        durationSeconds: r.durationSeconds,
        question: r.question,
        options: r.options,
        correctIndex: r.correctIndex,
        answerLabel: r.answerLabel,
      }));
      $('#save-quiz').textContent = '💾 Mettre à jour';
      $('#builder').scrollIntoView({ behavior: 'smooth' });
    } catch (_) { toast('Erreur réseau.'); }
  }

  async function deleteQuiz(id, title) {
    if (!window.confirm(`Supprimer la playlist « ${title} » ? Cette action est définitive.`)) return;
    try {
      const res = await fetch(`/api/quizzes/${id}`, { method: 'DELETE' });
      if (!res.ok) { toast('Suppression impossible.'); return; }
      toast('Playlist supprimée.');
      await loadQuizzes();
    } catch (_) { toast('Erreur réseau.'); }
  }

  async function saveQuiz() {
    const title = $('#quiz-title').value.trim();
    if (!title) { toast('Donne un titre au quiz.'); return; }
    const rounds = [];
    for (const block of $$('.builder-round')) {
      const opts = $$('.r-opt', block).map((el) => el.value.trim()).filter(Boolean);
      const correctEl = $(`input[name="correct-${block.dataset.round}"]:checked`, block);
      rounds.push({
        youtube: $('.r-yt', block).value.trim(),
        startSeconds: Number($('.r-start', block).value) || 0,
        durationSeconds: Number($('.r-dur', block).value) || 20,
        question: $('.r-q', block).value.trim(),
        options: opts,
        correctIndex: correctEl ? Number(correctEl.value) : 0,
        answerLabel: $('.r-answer', block).value.trim(),
      });
    }
    if (rounds.length === 0) { toast('Ajoute au moins une manche.'); return; }
    const editingId = state.editingQuizId;
    const btn = $('#save-quiz');
    btn.disabled = true;
    try {
      const res = await fetch(editingId ? `/api/quizzes/${editingId}` : '/api/quizzes', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, rounds }),
      });
      if (!res.ok) { toast('Quiz invalide : vérifie les liens, propositions et réponses.'); return; }
      toast(editingId ? 'Playlist mise à jour !' : 'Quiz enregistré !');
      $('#builder').style.display = 'none';
      resetBuilder();
      await loadQuizzes();
    } catch (_) {
      toast('Erreur réseau.');
    } finally {
      btn.disabled = false;
    }
  }

  // --- Rendu des propositions (affichage hôte) ---------------------------
  function renderHostOptions(options) {
    const box = $('#round-options');
    box.innerHTML = '';
    options.forEach((opt, i) => {
      const el = document.createElement('div');
      el.className = 'option';
      el.dataset.c = String(i % 6);
      el.dataset.i = String(i);
      el.innerHTML = `<span class="option__shape">${OPTION_SHAPES[i % 6]}</span><span>${escapeHtml(opt)}</span>`;
      box.appendChild(el);
    });
  }

  // --- Événements Socket --------------------------------------------------
  socket.on('host:roomCreated', (p) => {
    state.code = p.code;
    state.hostToken = p.hostToken;
    state.roomMode = p.mode || 'solo';
    localStorage.setItem('bt_host', JSON.stringify({ code: p.code, hostToken: p.hostToken }));
    enterLobby(p.quizTitle, p.players, p.teams);
  });

  socket.on('host:snapshot', (p) => {
    state.code = p.code;
    state.roomMode = p.mode || 'solo';
    if (p.state === 'lobby') {
      enterLobby(p.quizTitle, p.players, p.teams);
    } else if (p.state === 'ended') {
      show('screen-ended');
      window.App.renderPodium($('#final-podium'), p.leaderboard, null);
      const rest = p.leaderboard.slice(3);
      if (rest.length) renderLeaderboard($('#final-leaderboard'), rest, null);
      else $('#final-leaderboard').innerHTML = '';
    } else {
      // En pleine partie : on montre le classement, l'hôte relance la manche suivante.
      show('screen-result');
      $('#result-answer').textContent = 'Reprise de la partie…';
      renderLeaderboard($('#result-leaderboard'), p.leaderboard, null);
      $('#next-round').style.display = '';
      $('#end-game').style.display = '';
    }
  });

  socket.on('room:players', (p) => updatePlayers(p.players, p.teams));

  socket.on('host:roundStarted', (p) => {
    state.round = p.hostRound;
    state.clipStarted = false;
    state.paused = false;
    $('#pause-round').textContent = '⏸️ Pause';
    show('screen-round');
    $('#round-progress').textContent = `Manche ${p.hostRound.roundIndex + 1} / ${p.hostRound.totalRounds}`;
    $('#round-question').textContent = p.hostRound.question;
    $('#answer-count').textContent = `0 / ${p.playerCount}`;
    $('#reveal-answer').disabled = false;
    renderHostOptions(p.hostRound.options);
    if (p.hostRound.roundIndex === 0) {
      // 1re manche : décompte « 3·2·1 » PUIS lecture.
      socket.emit('host:beginCountdown');
      window.App.playCountdown(3, loadClip);
    } else {
      // Manches suivantes : lecture immédiate, sans décompte.
      loadClip();
    }
  });

  socket.on('host:answerUpdate', (p) => {
    $('#answer-count').textContent = `${p.answered} / ${p.playerCount}`;
  });

  socket.on('round:result', (p) => {
    stopClip();
    // Surligne la bonne réponse sur l'écran hôte.
    $$('#round-options .option').forEach((el) => {
      const i = Number(el.dataset.i);
      if (i === p.correctIndex) el.classList.add('correct');
      else el.classList.add('dimmed');
    });
    setTimeout(() => {
      show('screen-result');
      window.App.Sound.reveal();
      $('#result-answer').textContent = p.answerLabel;
      window.App.renderDistribution($('#result-distribution'), {
        options: p.options,
        distribution: p.distribution,
        correctIndex: p.correctIndex,
      });
      const unit = state.roomMode === 'teams' ? 'équipes ont trouvé' : 'ont trouvé';
      $('#result-correct-count').textContent = `${p.correctCount} / ${p.totalPlayers} ${unit}`;
      renderLeaderboard($('#result-leaderboard'), p.leaderboard, null);
      $('#next-round').style.display = p.isLastRound ? 'none' : '';
    }, 1200);
  });

  socket.on('round:skipped', (p) => {
    stopClip();
    show('screen-result');
    $('#result-answer').textContent = '⏭️ Manche passée';
    $('#result-distribution').innerHTML = '';
    $('#result-correct-count').textContent = '';
    renderLeaderboard($('#result-leaderboard'), p.leaderboard, null);
    $('#next-round').style.display = p.isLastRound ? 'none' : '';
  });

  socket.on('game:ended', (p) => {
    show('screen-ended');
    window.App.renderPodium($('#final-podium'), p.leaderboard, null);
    const rest = p.leaderboard.slice(3);
    if (rest.length) renderLeaderboard($('#final-leaderboard'), rest, null);
    else $('#final-leaderboard').innerHTML = '';
    window.App.confetti();
    window.App.Sound.fanfare();
    localStorage.removeItem('bt_host');
  });

  socket.on('host:error', (p) => {
    toast(p.message || 'Erreur.');
    if (p.fatal) localStorage.removeItem('bt_host');
  });

  // --- Écrans -------------------------------------------------------------
  function enterLobby(quizTitle, players, teams) {
    show('screen-lobby');
    const suffix = state.roomMode === 'teams' ? ' · mode équipes' : '';
    $('#lobby-quiz-title').textContent = (quizTitle || '') + suffix;
    $('#lobby-code').textContent = state.code;
    $('#lobby-code-inline').textContent = state.code;
    $('#lobby-qr').src = `/api/room/${state.code}/qr`;
    const joinUrl = `${location.origin}/join?code=${state.code}`;
    $('#lobby-url').textContent = joinUrl;
    updatePlayers(players || [], teams || []);
  }

  function playerChip(pl) {
    const chip = document.createElement('span');
    chip.className = 'player-chip' + (pl.connected ? '' : ' offline');
    chip.innerHTML = `<span class="dot"></span>${escapeHtml(pl.pseudo)}`;
    const kick = document.createElement('button');
    kick.className = 'chip-kick';
    kick.textContent = '✕';
    kick.setAttribute('aria-label', `Exclure ${pl.pseudo}`);
    kick.onclick = (e) => {
      e.stopPropagation();
      if (window.confirm(`Exclure ${pl.pseudo} de la partie ?`)) {
        socket.emit('host:kickPlayer', { playerId: pl.id });
      }
    };
    chip.appendChild(kick);
    return chip;
  }

  function updatePlayers(players, teams) {
    const box = $('#lobby-players');
    if (!box) return;
    box.innerHTML = '';
    box.style.display = state.roomMode === 'teams' ? 'block' : 'flex';

    if (state.roomMode === 'teams') {
      (teams || []).forEach((t) => {
        const card = document.createElement('div');
        card.className = 'team-card';
        card.innerHTML =
          `<div class="team-card__head"><span class="team-card__name">👥 ${escapeHtml(t.name)}</span>` +
          `<span class="team-card__count">${t.memberCount} joueur(s)</span></div>`;
        const mem = document.createElement('div');
        mem.className = 'team-card__members';
        players.filter((p) => p.teamId === t.id).forEach((pl) => mem.appendChild(playerChip(pl)));
        card.appendChild(mem);
        box.appendChild(card);
      });
      if (!teams || teams.length === 0) {
        box.innerHTML = '<p class="muted">En attente des équipes…</p>';
      }
    } else {
      players.forEach((pl) => box.appendChild(playerChip(pl)));
    }

    $('#player-count').textContent = String(players.length);
    const can = players.length > 0;
    $('#start-game').disabled = !can;
    $('#start-hint').textContent = can ? 'Prêt à démarrer quand tu veux.' : "En attente d'au moins un joueur…";
  }

  function setMode(m) {
    state.mode = m;
    $('#mode-solo').classList.toggle('active', m === 'solo');
    $('#mode-teams').classList.toggle('active', m === 'teams');
  }

  function setCombo(on) {
    state.combo = on;
    $('#combo-on').classList.toggle('active', on);
    $('#combo-off').classList.toggle('active', !on);
  }

  // --- Contrôles ----------------------------------------------------------
  $('#toggle-builder').onclick = () => {
    const b = $('#builder');
    if (b.style.display === 'none' || b.style.display === '') {
      resetBuilder();
      b.style.display = 'block';
    } else {
      b.style.display = 'none';
    }
  };
  $('#add-round').onclick = () => addRoundBlock();
  $('#builder-rounds').addEventListener('click', onBuilderRoundsClick);
  $('#save-quiz').onclick = saveQuiz;
  $('#start-game').onclick = () => socket.emit('host:startRound');
  $('#reveal-answer').onclick = () => { $('#reveal-answer').disabled = true; stopClip(); socket.emit('host:endRound'); };
  $('#replay-clip').onclick = replayClip;
  $('#pause-round').onclick = togglePause;
  $('#skip-round').onclick = () => { if (window.confirm('Passer cette manche (aucun point) ?')) socket.emit('host:skipRound'); };
  $('#next-round').onclick = () => socket.emit('host:startRound');
  $('#end-game').onclick = () => socket.emit('host:endGame');
  $('#mode-solo').onclick = () => setMode('solo');
  $('#mode-teams').onclick = () => setMode('teams');
  $('#combo-on').onclick = () => setCombo(true);
  $('#combo-off').onclick = () => setCombo(false);
  $('#login-btn').onclick = doLogin;
  $('#login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('#logout-btn').onclick = doLogout;

  // --- Reprise après rechargement ----------------------------------------
  function tryReconnect() {
    if (!state.authed) return;
    const raw = localStorage.getItem('bt_host');
    if (!raw) return;
    try {
      const { code, hostToken } = JSON.parse(raw);
      if (code && hostToken) {
        state.hostToken = hostToken;
        socket.emit('host:reconnect', { code, hostToken });
      }
    } catch (_) { localStorage.removeItem('bt_host'); }
  }

  checkAuth();
  socket.on('connect', tryReconnect);
})();
