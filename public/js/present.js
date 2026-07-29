/* Écran public (projeté / partagé). Ne reçoit AUCUNE donnée du serveur :
   il est piloté par la fenêtre de contrôle de l'hôte via BroadcastChannel
   (même origine, même navigateur). Il n'affiche jamais la vidéo. */
(function () {
  const { $, show, escapeHtml, OPTION_SHAPES, renderLeaderboard, renderDistribution, renderPodium } = window.App;

  if (!('BroadcastChannel' in window)) {
    $('#present-idle').innerHTML =
      '<div class="card center"><h1>Navigateur non compatible</h1>' +
      "<p class=\"muted\">Cet écran public nécessite un navigateur récent (BroadcastChannel).</p></div>";
    return;
  }

  const channel = new BroadcastChannel('bt-present');
  let mode = 'solo';
  let lastRoundOptions = []; // propositions de la manche, dévoilées seulement au vrai départ

  function renderPlayers(players, teams) {
    const box = $('#p-lobby-players');
    box.innerHTML = '';
    box.style.display = mode === 'teams' ? 'block' : 'flex';
    if (mode === 'teams') {
      (teams || []).forEach((t) => {
        const card = document.createElement('div');
        card.className = 'team-card';
        card.innerHTML =
          `<div class="team-card__head"><span class="team-card__name">👥 ${escapeHtml(t.name)}</span>` +
          `<span class="team-card__count">${t.memberCount} joueur(s)</span></div>`;
        const mem = document.createElement('div');
        mem.className = 'team-card__members';
        (players || []).filter((p) => p.teamId === t.id).forEach((pl) => {
          const chip = document.createElement('span');
          chip.className = 'player-chip' + (pl.connected ? '' : ' offline');
          chip.innerHTML = `<span class="dot"></span>${escapeHtml(pl.pseudo)}`;
          mem.appendChild(chip);
        });
        card.appendChild(mem);
        box.appendChild(card);
      });
      if (!teams || teams.length === 0) box.innerHTML = '<p class="muted">En attente des équipes…</p>';
    } else {
      (players || []).forEach((pl) => {
        const chip = document.createElement('span');
        chip.className = 'player-chip' + (pl.connected ? '' : ' offline');
        chip.innerHTML = `<span class="dot"></span>${escapeHtml(pl.pseudo)}`;
        box.appendChild(chip);
      });
    }
    $('#p-player-count').textContent = String((players || []).length);
  }

  function renderOptions(options) {
    const box = $('#p-round-options');
    box.innerHTML = '';
    (options || []).forEach((opt, i) => {
      const el = document.createElement('div');
      el.className = 'option';
      el.dataset.c = String(i % 6);
      el.dataset.i = String(i);
      el.innerHTML = `<span class="option__shape">${OPTION_SHAPES[i % 6]}</span><span>${escapeHtml(opt)}</span>`;
      box.appendChild(el);
    });
  }

  function updateTimer(remaining, total) {
    const t = Math.max(0, remaining);
    $('#p-round-timer').textContent = t;
    if (total > 0) $('#p-round-bar').style.width = `${Math.max(0, (t / total) * 100)}%`;
  }

  function setPaused(paused) {
    const stage = $('#p-audio-stage');
    stage.classList.toggle('paused', !!paused);
    $('#p-audio-label').textContent = paused ? '⏸️ En pause…' : '🎵 À l\'écoute…';
  }

  const handlers = {
    idle() { show('present-idle'); },

    lobby(m) {
      mode = m.mode || 'solo';
      show('present-lobby');
      const suffix = mode === 'teams' ? ' · mode équipes' : '';
      $('#p-lobby-title').textContent = (m.quizTitle || '') + suffix;
      $('#p-lobby-code').textContent = m.code || '-----';
      $('#p-lobby-code-inline').textContent = m.code || '';
      if (m.code) $('#p-lobby-qr').src = `/api/room/${m.code}/qr`;
      $('#p-lobby-url').textContent = m.joinUrl || '';
      renderPlayers(m.players, m.teams);
    },

    players(m) {
      mode = m.mode || mode;
      renderPlayers(m.players, m.teams);
    },

    round(m) {
      mode = m.mode || 'solo';
      show('present-round');
      setPaused(false);
      $('#p-round-progress').textContent = `Manche ${m.roundIndex + 1} / ${m.totalRounds}`;
      $('#p-round-question').textContent = m.question || '';
      $('#p-answer-count').textContent = `0 / ${m.playerCount}`;
      $('#p-round-timer').textContent = '…';
      $('#p-round-bar').style.width = '100%';
      lastRoundOptions = m.options || [];
      if (m.started) {
        $('#p-audio-label').textContent = '🎵 À l\'écoute…';
        renderOptions(lastRoundOptions);
      } else {
        // Le morceau n'a pas encore démarré : on ne dévoile PAS les propositions.
        $('#p-audio-label').textContent = '🎧 Prépare-toi…';
        $('#p-round-options').innerHTML = '';
      }
    },

    // Le morceau démarre réellement : on dévoile les propositions.
    roundGo() {
      $('#p-audio-label').textContent = '🎵 À l\'écoute…';
      renderOptions(lastRoundOptions);
    },

    timer(m) { updateTimer(m.remaining, m.total); },

    answers(m) { $('#p-answer-count').textContent = `${m.answered} / ${m.playerCount}`; },

    paused(m) { setPaused(m.paused); },

    result(m) {
      mode = m.mode || mode;
      show('present-result');
      $('#p-result-answer').textContent = m.skipped ? (m.title || '⏭️ Manche passée') : m.answerLabel;
      // Payoff : miniature du morceau dévoilée seulement maintenant (pas de spoiler avant).
      const thumb = $('#p-result-thumb');
      if (!m.skipped && m.youtubeId) {
        thumb.src = `https://img.youtube.com/vi/${m.youtubeId}/hqdefault.jpg`;
        thumb.hidden = false;
      } else {
        thumb.hidden = true;
        thumb.removeAttribute('src');
      }
      // « Main la plus rapide » de la manche.
      const fast = $('#p-result-fastest');
      if (!m.skipped && m.fastest && m.fastest.name) {
        fast.textContent = `⚡ Main la plus rapide : ${m.fastest.name}`;
        fast.hidden = false;
      } else {
        fast.hidden = true;
      }
      if (m.skipped) {
        $('#p-result-dist-card').style.display = 'none';
      } else {
        $('#p-result-dist-card').style.display = '';
        renderDistribution($('#p-result-distribution'), {
          options: m.options,
          distribution: m.distribution,
          correctIndex: m.correctIndex,
        });
        const unit = mode === 'teams' ? 'équipes ont trouvé' : 'ont trouvé';
        $('#p-result-correct-count').textContent = `${m.correctCount} / ${m.totalPlayers} ${unit}`;
      }
      renderLeaderboard($('#p-result-leaderboard'), m.leaderboard || [], null);
    },

    ended(m) {
      show('present-ended');
      // Le podium se révèle 3 → 2 → 1 (animation CSS par rang) ; les confettis
      // partent quand la 1re place apparaît, pour le payoff.
      renderPodium($('#p-final-podium'), m.leaderboard || [], null);
      const rest = (m.leaderboard || []).slice(3);
      if (rest.length) renderLeaderboard($('#p-final-leaderboard'), rest, null);
      else $('#p-final-leaderboard').innerHTML = '';
      setTimeout(() => window.App.confetti(), 1400);
    },
  };

  channel.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg.type !== 'string') return;
    const fn = handlers[msg.type];
    if (fn) fn(msg);
  };

  // Signale à la fenêtre de contrôle qu'on est prêt : elle (re)pousse l'état courant.
  channel.postMessage({ type: 'ready' });
})();
