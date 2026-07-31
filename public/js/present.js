/* Écran public (projeté / partagé). Ne reçoit AUCUNE donnée du serveur :
   il est piloté par la fenêtre de contrôle de l'hôte via BroadcastChannel
   (même origine, même navigateur). Il n'affiche jamais la vidéo. */
(function () {
  const { $, show, escapeHtml, OPTION_SHAPES, renderLeaderboard, renderDistribution, renderPodium, renderAwards } = window.App;

  if (!('BroadcastChannel' in window)) {
    $('#present-idle').innerHTML =
      '<div class="card center"><h1>Navigateur non compatible</h1>' +
      "<p class=\"muted\">Cet écran public nécessite un navigateur récent (BroadcastChannel).</p></div>";
    return;
  }

  const channel = new BroadcastChannel('bt-present');
  let mode = 'solo';
  let lastRoundOptions = []; // propositions de la manche, dévoilées seulement au vrai départ
  let roundHasClip = true; // manche avec extrait audio, ou question « quiz pur »

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
    window.App.applyClueBlur($('#p-round-image'), remaining, total);
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
      roundHasClip = m.hasClip !== false;
      // Indice visuel : on affiche l'image et on masque le visualiseur audio.
      // Une image cassée (URL morte) ne doit jamais montrer le placeholder alt :
      // on la masque et on rebascule sur la scène « à vous de jouer ».
      const pImg = $('#p-round-image');
      if (m.imageUrl) {
        pImg.onerror = () => {
          pImg.hidden = true; pImg.removeAttribute('src');
          $('#p-audio-stage').style.display = '';
        };
        pImg.hidden = false; pImg.style.filter = 'blur(20px)'; pImg.src = m.imageUrl;
        $('#p-audio-stage').style.display = 'none';
      } else {
        pImg.onerror = null;
        pImg.hidden = true; pImg.removeAttribute('src');
        $('#p-audio-stage').style.display = '';
      }
      if (m.started) {
        $('#p-audio-label').textContent = roundHasClip ? '🎵 À l\'écoute…' : '❓ À vous de jouer !';
        renderOptions(lastRoundOptions);
      } else {
        // Le morceau n'a pas encore démarré : on ne dévoile PAS les propositions.
        $('#p-audio-label').textContent = roundHasClip ? '🎧 Prépare-toi…' : '❓ Prépare-toi…';
        $('#p-round-options').innerHTML = '';
      }
    },

    // Révélation manuelle : temps écoulé, réponses closes, en attente de l'hôte.
    timeUp() {
      $('#p-round-timer').textContent = '⏱️';
      $('#p-round-bar').style.width = '0%';
      $('#p-audio-label').textContent = '⏱️ Temps écoulé — en attente de la révélation…';
    },

    // Le morceau démarre réellement : on dévoile les propositions.
    roundGo(m) {
      $('#p-audio-label').textContent = roundHasClip ? '🎵 À l\'écoute…' : '❓ À vous de jouer !';
      renderOptions(lastRoundOptions);
      // Précharge la miniature du payoff (cache chaud) pour qu'elle s'affiche
      // instantanément à la révélation. Non affichée ici : aucun spoiler.
      if (m && m.preloadThumbId) {
        const img = new Image();
        img.src = `https://img.youtube.com/vi/${m.preloadThumbId}/hqdefault.jpg`;
      }
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
      // Badges de manche : main la plus rapide + (lente/au buzzer) + seul contre tous.
      const fast = $('#p-result-fastest');
      if (m.skipped) {
        fast.hidden = true;
      } else {
        const badges = [];
        if (m.fastest && m.fastest.name) badges.push(`⚡ Main la plus rapide : ${m.fastest.name}`);
        if (m.slowest && m.slowest.name && (!m.fastest || m.slowest.name !== m.fastest.name)) {
          if (m.slowestNoAnswer) badges.push(`😴 N'a pas répondu : ${m.slowest.name}`);
          else if (m.atBuzzer) badges.push(`🍀 Au buzzer : ${m.slowest.name}`);
          else badges.push(`🐢 Main la plus lente : ${m.slowest.name}`);
        }
        if (m.soloCorrect) badges.push(`🧠 Seul contre tous : ${m.soloCorrect}`);
        if (m.allCorrect) badges.push('🎯 Carton plein — tout le monde a trouvé !');
        else if (m.noneCorrect) badges.push("🥅 Personne n'a trouvé !");
        if (m.topTrap) badges.push(`🃏 Piège du jour : ${m.topTrap}`);
        if (badges.length) {
          fast.innerHTML = badges.map((b) => `<span class="fastest-badge">${escapeHtml(b)}</span>`).join('');
          fast.hidden = false;
        } else {
          fast.hidden = true;
        }
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
      // Le palmarès se dévoile après l'animation du podium.
      const awardsBox = $('#p-final-awards');
      awardsBox.innerHTML = '';
      setTimeout(() => renderAwards(awardsBox, m.awards), 2000);
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
