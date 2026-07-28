/* global io */
(function () {
  const { $, $$, show, escapeHtml, OPTION_SHAPES, toast, renderLeaderboard } = window.App;
  const socket = io();

  const state = {
    code: null, playerId: null, pseudo: null, answered: false, lastChoice: null, timer: null,
    awaiting: false, mode: 'solo', teamId: null, teamName: null,
    options: [], myVote: null, teamLocked: false, teamAnswerIndex: null, streak: 0, paused: false,
  };

  // Identifiant utilisé pour surligner « moi » dans le classement : l'équipe en
  // mode équipes, le joueur en mode solo.
  function lbId() { return state.mode === 'teams' ? state.teamId : state.playerId; }

  // --- Minuteur visible (compte à rebours côté joueur) --------------------
  function startTimer(total) {
    clearInterval(state.timer);
    let remaining = total;
    updateTimer(remaining, total);
    state.timer = setInterval(() => {
      remaining -= 1;
      updateTimer(remaining, total);
      if (remaining <= 0) {
        clearInterval(state.timer);
        onTimeout();
      }
    }, 1000);
  }
  function updateTimer(remaining, total) {
    const t = $('#q-timer');
    if (t) t.textContent = Math.max(0, remaining);
    const bar = $('#q-bar');
    if (bar) bar.style.width = `${Math.max(0, (remaining / total) * 100)}%`;
  }
  function stopTimer() { clearInterval(state.timer); }
  function onTimeout() {
    if (state.answered) return;
    state.answered = true;
    $$('#q-options .option').forEach((b) => { b.disabled = true; });
    $('#q-status').textContent = '⏱️ Temps écoulé !';
  }

  // Pré-remplissage du code depuis l'URL (QR code -> /join?code=XXXXX).
  const params = new URLSearchParams(location.search);
  const codeFromUrl = (params.get('code') || '').toUpperCase();
  if (codeFromUrl) $('#join-code').value = codeFromUrl;

  // --- Rendu des propositions (cliquables) --------------------------------
  function renderOptions(options) {
    const box = $('#q-options');
    box.innerHTML = '';
    options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.dataset.c = String(i % 6);
      btn.dataset.i = String(i);
      btn.innerHTML =
        `<span class="option__shape">${OPTION_SHAPES[i % 6]}</span>` +
        `<span>${escapeHtml(opt)}</span>` +
        `<span class="vote-count" data-count="${i}" style="display:none"></span>`;
      btn.onclick = () => submitAnswer(i, btn);
      box.appendChild(btn);
    });
  }

  function renderVoteCounts(counts) {
    $$('#q-options .vote-count').forEach((el) => {
      const n = counts[Number(el.dataset.count)] || 0;
      el.textContent = n > 0 ? String(n) : '';
      el.style.display = n > 0 ? 'inline-flex' : 'none';
    });
  }

  function submitAnswer(i, btn) {
    if (state.paused || state.teamLocked) return;

    if (state.mode === 'teams') {
      // Vote d'équipe : modifiable tant que l'équipe n'est pas verrouillée.
      state.myVote = i;
      socket.emit('player:answer', { optionIndex: i });
      window.App.Sound.tick();
      $$('#q-options .option').forEach((b) => b.classList.toggle('chosen', Number(b.dataset.i) === i));
      return;
    }

    // Solo : le tap verrouille définitivement.
    if (state.answered) return;
    state.answered = true;
    state.lastChoice = i;
    socket.emit('player:answer', { optionIndex: i });
    $$('#q-options .option').forEach((b) => {
      b.disabled = true;
      if (Number(b.dataset.i) !== i) b.classList.add('dimmed');
    });
    btn.classList.add('chosen', 'locked');
    if (!btn.querySelector('.option-lock')) {
      btn.insertAdjacentHTML('beforeend', '<span class="option-lock">🔒</span>');
    }
    window.App.Sound.tick();
    $('#q-status').textContent = '🔒 Réponse verrouillée · en attente des autres…';
  }

  function lockOptions(message) {
    $$('#q-options .option').forEach((b) => { b.disabled = true; });
    $('#q-status').textContent = message;
    state.answered = true;
  }

  function enterQuestion(pr) {
    state.answered = false;
    state.lastChoice = null;
    state.awaiting = false; // la manche est ouverte : ne plus clobberer les propositions
    state.options = pr.options;
    state.myVote = null;
    state.teamLocked = false;
    state.teamAnswerIndex = null;
    show('screen-question');
    $('#q-progress').textContent = `Manche ${pr.roundIndex + 1} / ${pr.totalRounds}`;
    const streakBadge = $('#q-streak');
    if (state.streak >= 2) {
      streakBadge.style.display = '';
      streakBadge.textContent = `🔥 ×${state.streak}`;
    } else {
      streakBadge.style.display = 'none';
    }
    $('#q-text').textContent = pr.question;
    $('#q-status').textContent = state.mode === 'teams' ? '🗳️ Votez pour votre équipe !' : 'À toi de jouer !';
    const lockBtn = $('#team-lock-btn');
    if (state.mode === 'teams') {
      lockBtn.style.display = '';
      lockBtn.disabled = true;
      lockBtn.textContent = '🔒 Verrouiller la réponse';
    } else {
      lockBtn.style.display = 'none';
    }
    renderOptions(pr.options);
    startTimer(pr.durationSeconds);
  }

  // --- Événements Socket --------------------------------------------------
  socket.on('player:joined', (p) => {
    state.playerId = p.playerId;
    state.code = p.code;
    state.mode = p.mode || 'solo';
    state.teamId = p.teamId || null;
    state.teamName = p.teamName || null;
    state.pseudo = $('#join-pseudo').value.trim();
    localStorage.setItem('bt_player', JSON.stringify({ code: p.code, playerId: p.playerId }));
    show('screen-wait');
    $('#wait-pseudo').textContent = state.pseudo;
    $('#wait-quiz').textContent =
      (p.quizTitle ? `Quiz : ${p.quizTitle}` : '') + (state.teamName ? ` · 👥 ${state.teamName}` : '');
  });

  socket.on('player:snapshot', (p) => {
    state.playerId = p.playerId;
    state.code = p.code;
    state.mode = p.mode || 'solo';
    state.teamId = p.teamId || null;
    state.teamName = p.teamName || null;
    if (p.state === 'playing' && p.publicRound) {
      enterQuestion(p.publicRound);
      if (p.alreadyAnswered) lockOptions('Réponse déjà envoyée ✓ En attente des autres…');
    } else if (p.state === 'playing' && p.loading) {
      show('screen-question');
      $('#q-timer').textContent = '…';
      $('#q-bar').style.width = '100%';
      $('#q-text').textContent = '🎵 Prépare-toi…';
      $('#q-options').innerHTML = '';
      $('#q-status').textContent = "L'extrait va démarrer…";
    } else if (p.state === 'ended') {
      showFinal(p.leaderboard);
    } else if (p.state === 'roundResult') {
      show('screen-wait');
      $('#wait-pseudo').textContent = '';
      $('#wait-quiz').textContent = 'Manche terminée';
      $('#screen-wait .card p:last-child').textContent = 'En attente de la manche suivante…';
    } else {
      show('screen-wait');
      $('#wait-quiz').textContent = p.quizTitle ? `Quiz : ${p.quizTitle}` : '';
    }
  });

  // La manche se prépare (la vidéo charge chez l'hôte) : on patiente, pas de
  // minuteur ni de propositions tant que l'extrait n'a pas démarré.
  socket.on('player:roundLoading', (p) => {
    stopTimer();
    state.answered = false;
    state.lastChoice = null;
    state.awaiting = true;
    show('screen-question');
    $('#q-progress').textContent = `Manche ${p.roundIndex + 1} / ${p.totalRounds}`;
    $('#q-timer').textContent = '…';
    $('#q-bar').style.width = '100%';
    $('#q-text').textContent = '🎵 Prépare-toi…';
    $('#q-options').innerHTML = '';
    $('#q-status').textContent = "L'extrait va démarrer…";
  });

  // Décompte « 3·2·1 » synchronisé, puis on attend le vrai départ de l'extrait.
  socket.on('player:countdown', () => {
    state.awaiting = true;
    window.App.playCountdown(3, () => {
      // Si la manche s'est déjà ouverte pendant le décompte, ne rien écraser.
      if (!state.awaiting) return;
      show('screen-question');
      $('#q-timer').textContent = '…';
      $('#q-bar').style.width = '100%';
      $('#q-text').textContent = '🎧 Écoute !';
      $('#q-options').innerHTML = '';
      $('#q-status').textContent = 'Prépare ta réponse…';
    });
  });

  socket.on('player:roundStarted', (p) => enterQuestion(p.publicRound));

  // --- Contrôles hôte côté joueur -----------------------------------------
  socket.on('round:paused', () => {
    state.paused = true;
    stopTimer();
    $$('#q-options .option').forEach((b) => { b.disabled = true; });
    $('#q-status').textContent = '⏸️ En pause…';
  });

  socket.on('round:resumed', (p) => {
    state.paused = false;
    startTimer(Math.max(1, p.remainingSeconds || 1));
    const canAnswer = state.mode === 'teams' ? !state.teamLocked : !state.answered;
    if (canAnswer) {
      $$('#q-options .option').forEach((b) => { b.disabled = false; });
      $('#q-status').textContent = state.mode === 'teams' ? '🗳️ Votez, puis verrouillez' : 'À toi de jouer !';
    }
  });

  socket.on('round:skipped', (p) => {
    stopTimer();
    state.paused = false;
    show('screen-feedback');
    $('#feedback-banner').className = 'result-banner';
    $('#feedback-title').textContent = '⏭️ Manche passée';
    $('#feedback-points').textContent = '';
    $('#feedback-streak').textContent = '';
    $('#feedback-answer').textContent = '';
    $('#feedback-distribution').innerHTML = '';
    renderLeaderboard($('#feedback-leaderboard'), p.leaderboard, lbId());
  });

  socket.on('player:kicked', () => {
    localStorage.removeItem('bt_player');
    stopTimer();
    show('screen-join');
    $('#code-error').textContent = "Tu as été exclu de la partie par l'hôte.";
  });

  socket.on('player:answerRejected', (p) => toast(p.reason || 'Réponse refusée.'));

  // Mode équipes : tally de vote en direct ; un membre verrouille quand il veut.
  socket.on('player:teamVotes', (p) => {
    const counts = p.counts || [];
    renderVoteCounts(counts);
    const lockBtn = $('#team-lock-btn');
    if (p.locked) {
      state.teamLocked = true;
      state.answered = true;
      state.teamAnswerIndex = p.lockedIndex;
      $$('#q-options .option').forEach((b) => {
        b.disabled = true;
        const idx = Number(b.dataset.i);
        b.classList.toggle('chosen', idx === p.lockedIndex);
        if (idx !== p.lockedIndex) b.classList.add('dimmed');
      });
      lockBtn.style.display = 'none';
      $('#q-status').textContent = `🔒 Équipe verrouillée sur : ${state.options[p.lockedIndex] ?? ''}`;
      window.App.Sound.go();
    } else {
      // Leader courant (plus de voix, 1er index si égalité) pour le libellé du bouton.
      let leader = -1;
      let max = 0;
      counts.forEach((n, i) => { if (n > max) { max = n; leader = i; } });
      lockBtn.disabled = p.voted === 0;
      lockBtn.textContent = leader >= 0 ? `🔒 Verrouiller : ${state.options[leader]}` : '🔒 Verrouiller la réponse';
      $('#q-status').textContent = `🗳️ Votez, puis verrouillez (${p.voted}/${p.connected} ont voté)`;
    }
  });

  socket.on('round:result', (p) => {
    stopTimer();
    const mine = state.playerId ? p.results[state.playerId] : null;
    window.App.Sound[mine && mine.correct ? 'correct' : 'wrong']();
    show('screen-feedback');
    const banner = $('#feedback-banner');
    if (mine && mine.correct) {
      banner.className = 'result-banner good';
      $('#feedback-title').textContent = 'Bonne réponse ! 🎉';
      $('#feedback-points').textContent = `+${mine.pointsAwarded}`;
    } else {
      banner.className = 'result-banner bad';
      $('#feedback-title').textContent = mine ? 'Raté 😬' : 'Manche terminée';
      $('#feedback-points').textContent = '+0';
    }
    if (state.mode === 'teams' && mine && mine.answeredBy && mine.answeredBy !== state.pseudo) {
      $('#feedback-title').textContent += ` · répondu par ${mine.answeredBy}`;
    }
    // Série / combo.
    state.streak = mine ? mine.streak || 0 : 0;
    const streakEl = $('#feedback-streak');
    if (mine && mine.correct && mine.comboBonus > 0) {
      streakEl.textContent = `🔥 Série ×${mine.streak} · +${mine.comboBonus} de combo !`;
    } else if (mine && mine.correct && mine.streak >= 2) {
      streakEl.textContent = `🔥 Série ×${mine.streak}`;
    } else {
      streakEl.textContent = '';
    }
    $('#feedback-answer').textContent = `La réponse : ${p.answerLabel}`;
    window.App.renderDistribution($('#feedback-distribution'), {
      options: p.options,
      distribution: p.distribution,
      correctIndex: p.correctIndex,
      chosenIndex: state.mode === 'teams' ? state.teamAnswerIndex : state.lastChoice,
    });
    renderLeaderboard($('#feedback-leaderboard'), p.leaderboard, lbId());
  });

  socket.on('game:ended', (p) => showFinal(p.leaderboard));

  socket.on('player:error', (p) => {
    if (p.fatal) {
      localStorage.removeItem('bt_player');
      show('screen-join');
      $('#code-error').textContent = p.message || 'Erreur.';
    } else {
      toast(p.message || 'Erreur.');
    }
  });

  function showFinal(leaderboard) {
    show('screen-final');
    const me = leaderboard.find((e) => e.playerId === lbId());
    $('#final-rank').textContent = me ? `#${me.rank}` : '—';
    $('#final-score').textContent = me
      ? `${me.score} points${state.mode === 'teams' ? ` · 👥 ${me.pseudo}` : ''}`
      : '';
    window.App.renderPodium($('#player-podium'), leaderboard, lbId());
    const rest = leaderboard.slice(3);
    if (rest.length) renderLeaderboard($('#final-board'), rest, lbId());
    else $('#final-board').innerHTML = '';
    window.App.confetti();
    window.App.Sound.fanfare();
    localStorage.removeItem('bt_player');
  }

  // --- Connexion ----------------------------------------------------------
  let joinInfo = null; // infos de la salle (mode, équipes) une fois récupérées

  function renderTeamPicker(teams) {
    const box = $('#team-chips');
    box.innerHTML = '';
    (teams || []).forEach((t) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'team-chip';
      chip.dataset.name = t.name;
      chip.textContent = `${t.name} · ${t.memberCount}`;
      chip.onclick = () => {
        $$('#team-chips .team-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        $('#new-team').value = '';
      };
      box.appendChild(chip);
    });
  }
  function selectedChipName() {
    const sel = $('#team-chips .team-chip.selected');
    return sel ? sel.dataset.name : '';
  }

  async function doJoin() {
    const code = $('#join-code').value.trim().toUpperCase();
    const pseudo = $('#join-pseudo').value.trim();
    $('#code-error').textContent = '';
    $('#pseudo-error').textContent = '';
    $('#team-error').textContent = '';
    if (code.length < 3) { $('#code-error').textContent = 'Entre le code de la salle.'; $('#join-code').focus(); return; }
    if (!pseudo) { $('#pseudo-error').textContent = 'Choisis un pseudo.'; $('#join-pseudo').focus(); return; }

    if (!joinInfo || joinInfo.code !== code) {
      try {
        const res = await fetch(`/api/room/${code}`);
        if (!res.ok) { $('#code-error').textContent = "Cette salle n'existe pas."; return; }
        joinInfo = await res.json();
      } catch (_) { toast('Erreur réseau.'); return; }
    }

    if (joinInfo.mode === 'teams') {
      const section = $('#team-section');
      if (!section.style.display || section.style.display === 'none') {
        renderTeamPicker(joinInfo.teams);
        section.style.display = 'block';
        $('#join-btn').textContent = "C'est parti !";
        $('#new-team').focus();
        return;
      }
      const team = $('#new-team').value.trim() || selectedChipName();
      if (!team) { $('#team-error').textContent = 'Choisis une équipe existante ou crée la tienne.'; return; }
      socket.emit('player:join', { code, pseudo, team });
    } else {
      socket.emit('player:join', { code, pseudo });
    }
  }

  $('#team-lock-btn').onclick = () => {
    if (state.teamLocked) return;
    socket.emit('player:teamLock');
  };
  $('#join-btn').onclick = doJoin;
  $('#new-team').addEventListener('input', () => {
    $$('#team-chips .team-chip').forEach((c) => c.classList.remove('selected'));
  });
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join-pseudo').focus(); });
  $('#join-pseudo').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  // --- Reprise après rechargement / perte de connexion --------------------
  function tryReconnect() {
    const raw = localStorage.getItem('bt_player');
    if (!raw) return;
    try {
      const { code, playerId } = JSON.parse(raw);
      if (code && playerId) socket.emit('player:reconnect', { code, playerId });
    } catch (_) { localStorage.removeItem('bt_player'); }
  }
  socket.on('connect', tryReconnect);
})();
