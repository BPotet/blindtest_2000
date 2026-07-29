/* global io, YT */
(function () {
  const { $, $$, show, escapeHtml, OPTION_SHAPES, toast, renderLeaderboard } = window.App;
  const socket = io();

  const state = {
    code: null, playerId: null, pseudo: null, answered: false, lastChoice: null, timer: null,
    awaiting: false, mode: 'solo', teamId: null, teamName: null,
    options: [], myVote: null, teamLocked: false, teamAnswerIndex: null, streak: 0, paused: false,
    autoNextTimer: null,
    // Son sur le téléphone (si l'hôte l'a activé).
    playerAudio: false, ytReady: false, yt: null, audioVideoId: null, audioStart: 0, audioFallbackTimer: null,
  };

  // --- Son sur le téléphone du joueur (lecteur YouTube caché, audio seul) ----
  // On tente la lecture AUTOMATIQUEMENT à chaque manche. Le bouton « Écouter »
  // n'apparait qu'en secours si le navigateur bloque l'autoplay (mobile strict).
  window.onYouTubeIframeAPIReady = function () { state.ytReady = true; };

  function setAudioPlayingLabel(playing) {
    const label = $('#player-audio-label');
    if (label) label.textContent = playing ? '🎧 Son en cours…' : '🎧 Son du blindtest';
  }
  function showAudioFallback() {
    const btn = $('#player-audio-btn');
    if (btn) { btn.style.display = ''; btn.textContent = '🔊 Appuie pour lancer le son'; }
  }
  function hideAudioFallback() {
    const btn = $('#player-audio-btn');
    if (btn) btn.style.display = 'none';
  }
  function isAudioPlaying() {
    try { return state.yt && typeof state.yt.getPlayerState === 'function' && state.yt.getPlayerState() === 1; }
    catch (_) { return false; }
  }

  function playAudio(videoId, start) {
    if (!videoId) return;
    try {
      if (!state.yt) {
        if (!state.ytReady || !window.YT || !window.YT.Player) { showAudioFallback(); return; }
        state.yt = new YT.Player('player-audio', {
          videoId,
          playerVars: { start, autoplay: 1, controls: 0, playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: (e) => { try { e.target.seekTo(start, true); e.target.playVideo(); } catch (_) {} },
            // 1 = PLAYING : la lecture a démarré, on retire le bouton de secours.
            onStateChange: (e) => { if (e.data === 1) { setAudioPlayingLabel(true); hideAudioFallback(); } },
          },
        });
      } else {
        state.yt.loadVideoById({ videoId, startSeconds: start });
        state.yt.playVideo();
      }
    } catch (_) { showAudioFallback(); }
  }

  function stopAudio() {
    clearTimeout(state.audioFallbackTimer);
    try { if (state.yt) state.yt.pauseVideo(); } catch (_) {}
    setAudioPlayingLabel(false);
    hideAudioFallback();
  }

  // Prépare le son de la manche : affiche le bloc, mémorise l'extrait, et LANCE
  // la lecture automatiquement. Si rien ne joue après 1,5 s (autoplay bloqué),
  // on affiche le bouton de secours à taper.
  function setupRoundAudio(pr) {
    const section = $('#player-audio-section');
    if (!pr || !pr.audioYoutubeId) { if (section) section.style.display = 'none'; return; }
    state.audioVideoId = pr.audioYoutubeId;
    state.audioStart = pr.audioStartSeconds || 0;
    if (section) section.style.display = '';
    setAudioPlayingLabel(false);
    hideAudioFallback();
    clearTimeout(state.audioFallbackTimer);
    playAudio(state.audioVideoId, state.audioStart);
    state.audioFallbackTimer = setTimeout(() => { if (!isAudioPlaying()) showAudioFallback(); }, 1500);
  }

  // Mode auto : décompte visible côté joueur avant la manche suivante.
  function clearAutoNext() {
    clearInterval(state.autoNextTimer);
    state.autoNextTimer = null;
    const el = $('#feedback-autonext');
    if (el) el.style.display = 'none';
  }
  function startAutoNextCountdown(seconds, isLast) {
    clearAutoNext();
    const el = $('#feedback-autonext');
    if (!el) return;
    let remaining = Math.max(1, Number(seconds) || 0);
    const label = () => {
      el.textContent = isLast
        ? `🏁 Classement final dans ${remaining}…`
        : `⏭️ Prochaine chanson dans ${remaining}…`;
    };
    el.style.display = '';
    label();
    state.autoNextTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        el.textContent = isLast ? '🏁 Classement final…' : '⏭️ Chanson suivante…';
        clearInterval(state.autoNextTimer);
        state.autoNextTimer = null;
      } else {
        label();
      }
    }, 1000);
  }

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
      socket.emit(BT_EVENTS.PLAYER_ANSWER, { optionIndex: i });
      window.App.Sound.tick();
      $$('#q-options .option').forEach((b) => b.classList.toggle('chosen', Number(b.dataset.i) === i));
      return;
    }

    // Solo : le tap verrouille définitivement.
    if (state.answered) return;
    state.answered = true;
    state.lastChoice = i;
    socket.emit(BT_EVENTS.PLAYER_ANSWER, { optionIndex: i });
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
    clearAutoNext();
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
    setupRoundAudio(pr); // son sur le téléphone si l'hôte l'a activé
    startTimer(pr.durationSeconds);
  }

  // --- Événements Socket --------------------------------------------------
  socket.on(BT_EVENTS.PLAYER_JOINED, (p) => {
    state.playerId = p.playerId;
    state.code = p.code;
    state.mode = p.mode || 'solo';
    state.teamId = p.teamId || null;
    state.teamName = p.teamName || null;
    state.pseudo = $('#join-pseudo').value.trim();
    state.playerAudio = !!p.playerAudio;
    localStorage.setItem('bt_player', JSON.stringify({ code: p.code, playerId: p.playerId }));
    show('screen-wait');
    $('#wait-pseudo').textContent = state.pseudo;
    $('#wait-quiz').textContent =
      (p.quizTitle ? `Quiz : ${p.quizTitle}` : '') + (state.teamName ? ` · 👥 ${state.teamName}` : '')
      + (state.playerAudio ? ' · 🎧 son sur ton tél' : '');
  });

  socket.on(BT_EVENTS.PLAYER_SNAPSHOT, (p) => {
    state.playerId = p.playerId;
    state.code = p.code;
    state.mode = p.mode || 'solo';
    state.teamId = p.teamId || null;
    state.teamName = p.teamName || null;
    state.playerAudio = !!p.playerAudio;
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
  // Mode auto : temps restant avant la manche suivante (affiché sur le résultat).
  socket.on(BT_EVENTS.ROUND_AUTO_NEXT, (p) => startAutoNextCountdown(p.seconds, p.isLast));

  socket.on(BT_EVENTS.PLAYER_ROUND_LOADING, (p) => {
    clearAutoNext();
    stopAudio();
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
  socket.on(BT_EVENTS.PLAYER_COUNTDOWN, () => {
    clearAutoNext();
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

  socket.on(BT_EVENTS.PLAYER_ROUND_STARTED, (p) => enterQuestion(p.publicRound));

  // --- Contrôles hôte côté joueur -----------------------------------------
  socket.on(BT_EVENTS.ROUND_PAUSED, () => {
    state.paused = true;
    stopTimer();
    $$('#q-options .option').forEach((b) => { b.disabled = true; });
    $('#q-status').textContent = '⏸️ En pause…';
  });

  socket.on(BT_EVENTS.ROUND_RESUMED, (p) => {
    state.paused = false;
    startTimer(Math.max(1, p.remainingSeconds || 1));
    const canAnswer = state.mode === 'teams' ? !state.teamLocked : !state.answered;
    if (canAnswer) {
      $$('#q-options .option').forEach((b) => { b.disabled = false; });
      $('#q-status').textContent = state.mode === 'teams' ? '🗳️ Votez, puis verrouillez' : 'À toi de jouer !';
    }
  });

  socket.on(BT_EVENTS.ROUND_SKIPPED, (p) => {
    stopTimer();
    stopAudio();
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

  // Partie annulée par l'hôte : on revient à l'écran d'attente.
  socket.on(BT_EVENTS.GAME_CANCELLED, () => {
    clearAutoNext();
    stopAudio();
    stopTimer();
    state.answered = false;
    state.paused = false;
    state.teamLocked = false;
    show('screen-wait');
    $('#wait-pseudo').textContent = state.pseudo || '';
    $('#wait-quiz').textContent = 'Partie annulée par l\'hôte' + (state.teamName ? ` · 👥 ${state.teamName}` : '');
  });

  socket.on(BT_EVENTS.PLAYER_KICKED, () => {
    localStorage.removeItem('bt_player');
    stopTimer();
    stopAudio();
    show('screen-join');
    $('#code-error').textContent = "Tu as été exclu de la partie par l'hôte.";
  });

  socket.on(BT_EVENTS.PLAYER_ANSWER_REJECTED, (p) => toast(p.reason || 'Réponse refusée.'));

  // Mode équipes : tally de vote en direct ; un membre verrouille quand il veut.
  socket.on(BT_EVENTS.PLAYER_TEAM_VOTES, (p) => {
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

  socket.on(BT_EVENTS.ROUND_RESULT, (p) => {
    stopTimer();
    stopAudio();
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
    // Combo en feu : la flamme grossit avec la série (plafonnée) sur une bonne réponse.
    const flame = $('#feedback-flame');
    if (mine && mine.correct && mine.streak >= 2) {
      const n = Math.min(mine.streak, 6);
      flame.textContent = '🔥'.repeat(Math.min(3, n - 1));
      flame.style.fontSize = `${28 + n * 8}px`;
      flame.hidden = false;
    } else {
      flame.hidden = true;
    }
    // Halo de couleur selon la place au classement (1er/2e/3e).
    banner.classList.remove('rank-halo-1', 'rank-halo-2', 'rank-halo-3');
    const myRank = (p.leaderboard || []).find((e) => e.playerId === lbId())?.rank;
    if (myRank >= 1 && myRank <= 3) banner.classList.add(`rank-halo-${myRank}`);
    $('#feedback-answer').textContent = `La réponse : ${p.answerLabel}`;
    // Payoff : miniature du morceau (dévoilée seulement maintenant).
    const thumb = $('#feedback-thumb');
    if (p.youtubeId) {
      thumb.src = `https://img.youtube.com/vi/${p.youtubeId}/hqdefault.jpg`;
      thumb.hidden = false;
    } else {
      thumb.hidden = true;
      thumb.removeAttribute('src');
    }
    window.App.renderDistribution($('#feedback-distribution'), {
      options: p.options,
      distribution: p.distribution,
      correctIndex: p.correctIndex,
      chosenIndex: state.mode === 'teams' ? state.teamAnswerIndex : state.lastChoice,
    });
    renderLeaderboard($('#feedback-leaderboard'), p.leaderboard, lbId());
  });

  // Révélation manuelle : le serveur a clos les réponses (fin du minuteur).
  socket.on(BT_EVENTS.ROUND_TIME_UP, () => {
    stopTimer();
    $$('#q-options .option').forEach((b) => { b.disabled = true; });
    $('#q-status').textContent = '⏱️ Temps écoulé — en attente de la révélation…';
  });

  socket.on(BT_EVENTS.GAME_ENDED, (p) => showFinal(p.leaderboard, p.awards));

  socket.on(BT_EVENTS.PLAYER_ERROR, (p) => {
    if (p.fatal) {
      localStorage.removeItem('bt_player');
      show('screen-join');
      $('#code-error').textContent = p.message || 'Erreur.';
    } else {
      toast(p.message || 'Erreur.');
    }
  });

  // Équipes créées en parallèle sur d'autres téléphones : MAJ du sélecteur tant
  // qu'on est encore sur l'écran de choix d'équipe (avant d'avoir rejoint).
  socket.on(BT_EVENTS.ROOM_TEAMS, (p) => {
    if (state.playerId) return;
    const section = $('#team-section');
    if (section && section.style.display === 'block') renderTeamPicker(p.teams || []);
  });

  function showFinal(leaderboard, awards) {
    clearAutoNext();
    stopAudio();
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
    window.App.renderAwards($('#player-awards'), awards);
    window.App.confetti();
    window.App.Sound.fanfare();
    localStorage.removeItem('bt_player');
  }

  // --- Connexion ----------------------------------------------------------
  let joinInfo = null; // infos de la salle (mode, équipes) une fois récupérées

  function renderTeamPicker(teams) {
    const box = $('#team-chips');
    // Conserve la sélection courante lors d'une MAJ en direct (nouvelles équipes).
    const prevSelected = selectedChipName();
    box.innerHTML = '';
    (teams || []).forEach((t) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'team-chip' + (t.name === prevSelected ? ' selected' : '');
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
        // Observe la salle : les équipes créées sur d'autres téléphones
        // apparaissent en direct sans avoir à recharger.
        socket.emit(BT_EVENTS.PLAYER_WATCH_ROOM, { code });
        section.style.display = 'block';
        $('#join-btn').textContent = "C'est parti !";
        $('#new-team').focus();
        return;
      }
      const team = $('#new-team').value.trim() || selectedChipName();
      if (!team) { $('#team-error').textContent = 'Choisis une équipe existante ou crée la tienne.'; return; }
      socket.emit(BT_EVENTS.PLAYER_JOIN, { code, pseudo, team });
    } else {
      socket.emit(BT_EVENTS.PLAYER_JOIN, { code, pseudo });
    }
  }

  $('#team-lock-btn').onclick = () => {
    if (state.teamLocked) return;
    socket.emit(BT_EVENTS.PLAYER_TEAM_LOCK);
  };
  // Le tap sur ce bouton fournit le « geste » requis pour l'autoplay mobile.
  $('#player-audio-btn').onclick = () => playAudio(state.audioVideoId, state.audioStart);
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
      if (code && playerId) socket.emit(BT_EVENTS.PLAYER_RECONNECT, { code, playerId });
    } catch (_) { localStorage.removeItem('bt_player'); }
  }
  socket.on('connect', tryReconnect);
})();
