/* global io */
(function () {
  const { $, $$, show, escapeHtml, OPTION_SHAPES, toast, renderLeaderboard } = window.App;
  const socket = io();

  const state = { code: null, playerId: null, answered: false, lastChoice: null };

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
      btn.innerHTML = `<span class="option__shape">${OPTION_SHAPES[i % 6]}</span><span>${escapeHtml(opt)}</span>`;
      btn.onclick = () => submitAnswer(i, btn);
      box.appendChild(btn);
    });
  }

  function submitAnswer(i, btn) {
    if (state.answered) return;
    state.answered = true;
    state.lastChoice = i;
    socket.emit('player:answer', { optionIndex: i });
    $$('#q-options .option').forEach((b) => {
      b.disabled = true;
      if (Number(b.dataset.i) !== i) b.classList.add('dimmed');
    });
    btn.classList.add('chosen');
    $('#q-status').textContent = 'Réponse envoyée ✓ En attente des autres…';
  }

  function lockOptions(message) {
    $$('#q-options .option').forEach((b) => { b.disabled = true; });
    $('#q-status').textContent = message;
    state.answered = true;
  }

  function enterQuestion(pr) {
    state.answered = false;
    state.lastChoice = null;
    show('screen-question');
    $('#q-progress').textContent = `Manche ${pr.roundIndex + 1} / ${pr.totalRounds}`;
    $('#q-text').textContent = pr.question;
    $('#q-status').textContent = 'À toi de jouer !';
    renderOptions(pr.options);
  }

  // --- Événements Socket --------------------------------------------------
  socket.on('player:joined', (p) => {
    state.playerId = p.playerId;
    state.code = p.code;
    localStorage.setItem('bt_player', JSON.stringify({ code: p.code, playerId: p.playerId }));
    show('screen-wait');
    $('#wait-pseudo').textContent = $('#join-pseudo').value.trim();
    $('#wait-quiz').textContent = p.quizTitle ? `Quiz : ${p.quizTitle}` : '';
  });

  socket.on('player:snapshot', (p) => {
    state.playerId = p.playerId;
    state.code = p.code;
    if (p.state === 'playing' && p.publicRound) {
      enterQuestion(p.publicRound);
      if (p.alreadyAnswered) lockOptions('Réponse déjà envoyée ✓ En attente des autres…');
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

  socket.on('player:roundStarted', (p) => enterQuestion(p.publicRound));

  socket.on('player:answerRejected', (p) => toast(p.reason || 'Réponse refusée.'));

  socket.on('round:result', (p) => {
    const mine = state.playerId ? p.results[state.playerId] : null;
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
    $('#feedback-answer').textContent = `La réponse : ${p.answerLabel}`;
    window.App.renderDistribution($('#feedback-distribution'), {
      options: p.options,
      distribution: p.distribution,
      correctIndex: p.correctIndex,
      chosenIndex: state.lastChoice,
    });
    renderLeaderboard($('#feedback-leaderboard'), p.leaderboard, state.playerId);
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
    const me = leaderboard.find((e) => e.playerId === state.playerId);
    $('#final-rank').textContent = me ? `#${me.rank}` : '—';
    $('#final-score').textContent = me ? `${me.score} points` : '';
    renderLeaderboard($('#final-board'), leaderboard, state.playerId);
    localStorage.removeItem('bt_player');
  }

  // --- Connexion ----------------------------------------------------------
  $('#join-btn').onclick = () => {
    const code = $('#join-code').value.trim().toUpperCase();
    const pseudo = $('#join-pseudo').value.trim();
    $('#code-error').textContent = '';
    $('#pseudo-error').textContent = '';
    if (code.length < 3) { $('#code-error').textContent = 'Entre le code de la salle.'; $('#join-code').focus(); return; }
    if (!pseudo) { $('#pseudo-error').textContent = 'Choisis un pseudo.'; $('#join-pseudo').focus(); return; }
    socket.emit('player:join', { code, pseudo });
  };
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join-pseudo').focus(); });
  $('#join-pseudo').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join-btn').click(); });

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
