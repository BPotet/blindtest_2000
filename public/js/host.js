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
    clipStopTimer: null, // borne dure : met l'extrait en pause à la fin de sa durée
    total: 0,
    remaining: 0,
    paused: false,
    mode: 'solo', // mode choisi pour la prochaine salle
    roomMode: 'solo', // mode de la salle en cours
    combo: true, // bonus de série activé pour la prochaine salle
    autoplay: false, // partie automatique : l'hôte joue aussi, la partie s'enchaîne seule
    autoDelay: 6, // secondes d'attente entre les manches en mode auto (réglable)
    autoTimer: null, // timer d'enchaînement automatique des manches
    autoSkipTimer: null, // timer de révélation anticipée quand tout le monde a répondu
    playerAudio: false, // son joué sur le téléphone des joueurs
    manualReveal: false, // révélation manuelle : la manche attend l'hôte en fin de minuteur
    youtubeImport: false, // import de playlist YouTube disponible (clé API côté serveur)
  };

  const clampAutoDelay = (v) => Math.max(2, Math.min(30, Math.round(Number(v)) || 6));
  const AUTO_SKIP_MS = 3000; // mode auto : délai avant révélation quand tous ont répondu

  // --- Écran public (fenêtre projetée/partagée) ---------------------------
  // Piloté par BroadcastChannel (même origine, même navigateur) : la vidéo
  // reste sur CETTE fenêtre de contrôle, l'écran public ne montre jamais la
  // vidéo (pour ne pas dévoiler le morceau quand l'hôte partage son écran).
  const present = ('BroadcastChannel' in window) ? new BroadcastChannel('bt-present') : null;
  const pres = { scene: 'idle', data: {}, timer: null, answers: null, paused: false };

  function sendPresent(msg) { if (present) present.postMessage(msg); }

  function presentScene(scene, data) {
    pres.scene = scene;
    pres.data = data || {};
    if (scene !== 'round') { pres.timer = null; pres.answers = null; pres.paused = false; }
    sendPresent(Object.assign({ type: scene }, pres.data));
  }

  function presentTimer(remaining, total) {
    pres.timer = { remaining, total };
    sendPresent({ type: 'timer', remaining, total });
  }

  function presentAnswers(answered, playerCount) {
    pres.answers = { answered, playerCount };
    sendPresent({ type: 'answers', answered, playerCount });
  }

  function presentPaused(paused) {
    pres.paused = paused;
    sendPresent({ type: 'paused', paused });
  }

  // À l'ouverture d'un écran public, il réclame l'état courant : on le repousse.
  if (present) {
    present.onmessage = (ev) => {
      if (!ev.data || ev.data.type !== 'ready') return;
      sendPresent(Object.assign({ type: pres.scene }, pres.data));
      if (pres.scene === 'round') {
        if (pres.timer) sendPresent(Object.assign({ type: 'timer' }, pres.timer));
        if (pres.answers) sendPresent(Object.assign({ type: 'answers' }, pres.answers));
        if (pres.paused) sendPresent({ type: 'paused', paused: true });
      }
    };
  }

  function openPresent() {
    window.open('/present', 'bt-present-win', 'width=1280,height=800');
  }

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
    socket.emit(BT_EVENTS.HOST_CLIP_STARTED);
    presentRoundGo(); // dévoile les propositions sur l'écran public (pas avant !)
    startCountdown(state.round.durationSeconds);
    scheduleExtractStop(); // l'extrait s'arrête à sa fin, même en révélation manuelle
  }

  // Dévoile les propositions sur l'écran public au vrai départ du morceau.
  // On joint l'ID vidéo pour que l'écran public PRÉCHARGE la miniature du payoff
  // (cache chaud) — elle apparaîtra instantanément à la révélation, sans décalage.
  // L'écran public est piloté par l'hôte (pas un téléphone joueur) : aucun spoiler.
  function presentRoundGo() {
    if (pres.scene === 'round') {
      pres.data.started = true;
      sendPresent({ type: 'roundGo', preloadThumbId: state.round && state.round.youtubeId });
    }
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
        if (state.manualReveal) {
          // Révélation manuelle : on ferme les réponses, on ne révèle pas encore.
          // L'hôte peut rejouer l'extrait puis cliquer « Révéler la réponse ».
          socket.emit(BT_EVENTS.HOST_TIME_UP);
          enterTimeUp();
        } else {
          stopClip();
          socket.emit(BT_EVENTS.HOST_END_ROUND);
        }
      }
    }, 1000);
  }

  // Fin du minuteur en révélation manuelle : réponses closes, en attente de l'hôte.
  function enterTimeUp() {
    // On met l'extrait en pause à sa fin (il ne doit pas déborder sur le morceau) ;
    // l'hôte pourra le rejouer via « Rejouer » avant de révéler.
    clearTimeout(state.clipStopTimer);
    try { if (state.yt) state.yt.pauseVideo(); } catch (_) {}
    $('#round-timer').textContent = '⏱️';
    $('#round-bar').style.width = '0%';
    const status = $('#round-status');
    if (status) status.textContent = '⏱️ Temps écoulé — rejoue l\'extrait ou révèle la réponse.';
    const pause = $('#pause-round');
    if (pause) pause.disabled = true; // plus de pause une fois le temps écoulé
    sendPresent({ type: 'timeUp' });
  }

  // Borne l'extrait : met la vidéo en pause à la fin de sa durée pour ne pas
  // déborder sur le reste du morceau (le lecteur YouTube joue sinon toute la vidéo).
  function scheduleExtractStop() {
    clearTimeout(state.clipStopTimer);
    const secs = Math.max(1, Number(state.round && state.round.durationSeconds) || 0);
    state.clipStopTimer = setTimeout(() => {
      try { if (state.yt) state.yt.pauseVideo(); } catch (_) {}
    }, secs * 1000);
  }

  function togglePause() {
    if (state.paused) {
      state.paused = false;
      try { if (state.yt) state.yt.playVideo(); } catch (_) {}
      runCountdown();
      socket.emit(BT_EVENTS.HOST_RESUME_ROUND, { remainingSeconds: state.remaining });
      $('#pause-round').textContent = '⏸️ Pause';
      presentPaused(false);
    } else {
      state.paused = true;
      clearInterval(state.timer);
      try { if (state.yt) state.yt.pauseVideo(); } catch (_) {}
      socket.emit(BT_EVENTS.HOST_PAUSE_ROUND);
      $('#pause-round').textContent = '▶️ Reprendre';
      presentPaused(true);
    }
  }

  function stopClip() {
    clearInterval(state.timer);
    clearTimeout(state.clipFallback);
    clearTimeout(state.clipStopTimer);
    state.clipStarted = true; // empêche un démarrage tardif après clôture
    try { if (state.yt) state.yt.pauseVideo(); } catch (_) {}
  }

  function updateTimer(remaining, total) {
    $('#round-timer').textContent = Math.max(0, remaining);
    $('#round-bar').style.width = `${Math.max(0, (remaining / total) * 100)}%`;
    presentTimer(remaining, total);
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
        open.onclick = () => openRoomConfig(q.id, q.title);
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
  let authMode = 'login'; // 'login' | 'register'

  function setAuthMode(mode) {
    authMode = mode;
    const register = mode === 'register';
    $('#tab-login').classList.toggle('active', !register);
    $('#tab-register').classList.toggle('active', register);
    $('#login-heading').textContent = register ? 'Créer un compte hôte' : 'Connexion hôte';
    $('#login-sub').textContent = register
      ? 'Choisis un identifiant et un mot de passe pour héberger tes blindtests.'
      : 'Connecte-toi pour retrouver tes playlists.';
    $('#confirm-row').style.display = register ? '' : 'none';
    $('#register-hint').style.display = register ? '' : 'none';
    $('#login-btn').textContent = register ? '✨ Créer mon compte' : 'Se connecter';
    $('#login-password').setAttribute('autocomplete', register ? 'new-password' : 'current-password');
    $('#login-error').textContent = '';
  }

  async function checkAuth() {
    try {
      const res = await fetch('/api/me');
      if (res.ok) { const me = await res.json().catch(() => ({})); onAuthed(me.username, me.youtubeImport); return; }
    } catch (_) { /* réseau : on montre le login */ }
    show('screen-login');
  }

  function onAuthed(username, youtubeImport) {
    state.authed = true;
    state.youtubeImport = !!youtubeImport;
    $('#logout-btn').style.display = '';
    $('#open-present').style.display = '';
    $('#toggle-import').style.display = state.youtubeImport ? '' : 'none';
    const label = $('#host-user');
    if (username) { label.textContent = `👤 ${username}`; label.style.display = ''; }
    show('screen-home');
    presentScene('idle');
    loadQuizzes();
    socket.connect(); // le handshake porte désormais le cookie de session
  }

  // Connexion ou inscription selon l'onglet actif.
  async function doAuth() {
    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;
    $('#login-error').textContent = '';
    if (!username || !password) { $('#login-error').textContent = 'Identifiant et mot de passe requis.'; return; }
    if (authMode === 'register') {
      if (password.length < 6) { $('#login-error').textContent = 'Mot de passe : 6 caractères minimum.'; return; }
      if (password !== $('#login-confirm').value) { $('#login-error').textContent = 'Les mots de passe ne correspondent pas.'; return; }
    }
    const btn = $('#login-btn');
    btn.disabled = true;
    try {
      const res = await fetch(authMode === 'register' ? '/api/register' : '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        $('#login-error').textContent = authMode === 'register'
          ? (body.message || 'Inscription impossible.')
          : 'Identifiant ou mot de passe incorrect.';
        return;
      }
      const body = await res.json().catch(() => ({}));
      $('#login-password').value = '';
      $('#login-confirm').value = '';
      onAuthed(body.username || username, body.youtubeImport);
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
      `<label>Lien YouTube (ou ID)</label>` +
      `<div style="display:flex; gap:8px; align-items:center;">` +
      `<input class="r-yt" style="flex:1" placeholder="https://youtu.be/..." value="${escapeHtml(d?.youtube ?? '')}" />` +
      `<button type="button" class="btn btn--ghost btn--sm r-preview" title="Écouter l'extrait pour te rappeler le morceau">▶️ Aperçu</button>` +
      `</div>` +
      `<div class="field-row">` +
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
    else if (btn.classList.contains('r-preview')) previewRound(block);
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

  // Import depuis une playlist YouTube.
  //  - save=true  : mode « surprise » — le serveur crée le quiz directement, sans
  //    jamais renvoyer les morceaux (l'hôte ne connaît ni questions ni réponses).
  //  - save=false : mode relecture — charge un brouillon dans le constructeur.
  async function doImport(save) {
    const url = $('#import-url').value.trim();
    $('#import-error').textContent = '';
    if (!url) { $('#import-error').textContent = 'Colle le lien de la playlist YouTube.'; return; }
    const payload = {
      url,
      title: $('#import-title').value.trim(),
      maxRounds: Number($('#import-max').value) || 15,
      startSeconds: Number($('#import-start').value) || 0,
      durationSeconds: Number($('#import-dur').value) || 30,
      save: !!save,
    };
    const btns = [$('#run-import-blind'), $('#run-import-review')];
    btns.forEach((b) => { b.disabled = true; });
    const active = save ? $('#run-import-blind') : $('#run-import-review');
    const prev = active.textContent;
    active.textContent = '⏳ Génération…';
    try {
      const res = await fetch('/api/import/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { $('#import-error').textContent = body.message || "Échec de l'import."; return; }
      $('#import-panel').style.display = 'none';
      $('#import-url').value = '';
      if (save) {
        // Surprise : on ne montre RIEN — juste la confirmation, et on rafraîchit la liste.
        await loadQuizzes();
        toast(`🎲 « ${body.title} » créé (${body.count} morceaux) — tu le découvriras en jouant !`);
      } else {
        fillBuilderFromDraft(body.title, body.rounds);
        toast(`✅ ${body.count} morceau(x) importé(s) — relis et enregistre.`);
      }
    } catch (_) {
      $('#import-error').textContent = 'Erreur réseau.';
    } finally {
      btns.forEach((b) => { b.disabled = false; });
      active.textContent = prev;
    }
  }

  // Charge un brouillon importé dans le constructeur (nouveau quiz, non enregistré).
  function fillBuilderFromDraft(title, rounds) {
    state.editingQuizId = null;
    $('#builder').style.display = 'block';
    $('#builder-heading').textContent = 'Nouveau quiz (importé) — à relire';
    $('#quiz-title').value = title || '';
    $('#builder-rounds').innerHTML = '';
    roundCount = 0;
    (rounds || []).forEach((r) => addRoundBlock({
      youtube: r.youtube,
      startSeconds: r.startSeconds,
      durationSeconds: r.durationSeconds,
      question: r.question,
      options: r.options,
      correctIndex: r.correctIndex,
      answerLabel: r.answerLabel,
    }));
    $('#save-quiz').textContent = '💾 Enregistrer le quiz';
    $('#builder').scrollIntoView({ behavior: 'smooth' });
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
      // Mapping pur (testé dans src/quiz-form.test.ts) : ne garde que les
      // propositions non vides et recale l'index de la bonne réponse dessus.
      const rows = $$('.option-input-row', block).map((row) => {
        const radio = $('input[type="radio"]', row);
        return { value: $('.r-opt', row).value, checked: !!(radio && radio.checked) };
      });
      const { options, correctIndex } = BT_quizForm.mapOptions(rows);
      rounds.push({
        youtube: $('.r-yt', block).value.trim(),
        startSeconds: Number($('.r-start', block).value) || 0,
        durationSeconds: Number($('.r-dur', block).value) || 20,
        question: $('.r-q', block).value.trim(),
        options,
        correctIndex,
        answerLabel: $('.r-answer', block).value.trim(),
      });
    }
    if (rounds.length === 0) { toast('Ajoute au moins une manche.'); return; }

    // Validation claire, manche par manche (message précis plutôt que « quiz invalide »).
    for (let i = 0; i < rounds.length; i += 1) {
      const r = rounds[i];
      const num = i + 1;
      if (!r.youtube) { toast(`Manche ${num} : colle un lien YouTube (ou un ID).`); return; }
      if (!BT_quizForm.parseYtId(r.youtube)) { toast(`Manche ${num} : lien YouTube invalide.`); return; }
      if (r.options.length < 2) { toast(`Manche ${num} : ajoute au moins 2 propositions.`); return; }
      if (!r.question) { toast(`Manche ${num} : écris la question posée.`); return; }
    }
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
  socket.on(BT_EVENTS.HOST_ROOM_CREATED, (p) => {
    state.code = p.code;
    state.hostToken = p.hostToken;
    state.roomMode = p.mode || 'solo';
    state.autoDelay = clampAutoDelay($('#auto-delay') ? $('#auto-delay').value : state.autoDelay);
    // On mémorise aussi le mode auto + le délai (purement côté hôte) pour les restaurer au rechargement.
    localStorage.setItem('bt_host', JSON.stringify({ code: p.code, hostToken: p.hostToken, autoplay: state.autoplay, autoDelay: state.autoDelay }));
    enterLobby(p.quizTitle, p.players, p.teams);
  });

  socket.on(BT_EVENTS.HOST_SNAPSHOT, (p) => {
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
      presentScene('ended', { leaderboard: p.leaderboard });
    } else {
      // En pleine partie : on montre le classement, l'hôte relance la manche suivante.
      show('screen-result');
      $('#result-answer').textContent = 'Reprise de la partie…';
      renderLeaderboard($('#result-leaderboard'), p.leaderboard, null);
      $('#next-round').style.display = '';
      $('#end-game').style.display = '';
      presentScene('result', {
        skipped: true, title: 'Reprise de la partie…', leaderboard: p.leaderboard, mode: state.roomMode,
      });
    }
  });

  socket.on(BT_EVENTS.ROOM_PLAYERS, (p) => updatePlayers(p.players, p.teams));

  socket.on(BT_EVENTS.HOST_ROUND_STARTED, (p) => {
    cancelAutoNext();
    cancelAutoSkip();
    state.round = p.hostRound;
    state.clipStarted = false;
    state.paused = false;
    $('#pause-round').textContent = '⏸️ Pause';
    $('#pause-round').disabled = false;
    $('#round-status').textContent = '';
    $('#round-live-dist').innerHTML = '';
    show('screen-round');
    // Mode auto : la vidéo est masquée (l'écran de l'hôte est projeté et l'hôte
    // joue), les contrôles manuels disparaissent (tout s'enchaîne tout seul).
    $('#yt-cover').style.display = state.autoplay ? 'flex' : 'none';
    $('#manual-controls').style.display = state.autoplay ? 'none' : '';
    $('#reveal-answer').style.display = state.autoplay ? 'none' : '';
    $('#round-progress').textContent = `Manche ${p.hostRound.roundIndex + 1} / ${p.hostRound.totalRounds}`;
    $('#round-question').textContent = p.hostRound.question;
    $('#answer-count').textContent = `0 / ${p.playerCount}`;
    $('#reveal-answer').disabled = false;
    renderHostOptions(p.hostRound.options);
    presentScene('round', {
      roundIndex: p.hostRound.roundIndex,
      totalRounds: p.hostRound.totalRounds,
      question: p.hostRound.question,
      options: p.hostRound.options,
      playerCount: p.playerCount,
      mode: state.roomMode,
      started: false, // propositions dévoilées seulement à onClipStarted
    });
    if (p.hostRound.roundIndex === 0) {
      // 1re manche : décompte « 3·2·1 » PUIS lecture.
      socket.emit(BT_EVENTS.HOST_BEGIN_COUNTDOWN);
      window.App.playCountdown(3, loadClip);
    } else {
      // Manches suivantes : lecture immédiate, sans décompte.
      loadClip();
    }
  });

  socket.on(BT_EVENTS.HOST_ANSWER_UPDATE, (p) => {
    $('#answer-count').textContent = `${p.answered} / ${p.playerCount}`;
    presentAnswers(p.answered, p.playerCount);
    maybeAutoSkip(p.answered, p.playerCount);
    // Votes en direct sur l'écran de l'hôte (pour voir si les joueurs galèrent).
    if (p.distribution && state.round) {
      window.App.renderDistribution($('#round-live-dist'), {
        options: state.round.options,
        distribution: p.distribution,
        correctIndex: state.round.correctIndex,
      });
    }
  });

  // Mode auto : dès que tout le monde a répondu, on révèle après 3 s sans
  // attendre la fin du minuteur.
  function maybeAutoSkip(answered, playerCount) {
    if (!state.autoplay || state.paused || state.autoSkipTimer) return;
    if (playerCount <= 0 || answered < playerCount) return;
    state.autoSkipTimer = setTimeout(() => {
      state.autoSkipTimer = null;
      clearInterval(state.timer); // stoppe le décompte de manche (on clôt en avance)
      stopClip();
      socket.emit(BT_EVENTS.HOST_END_ROUND);
    }, AUTO_SKIP_MS);
  }

  function cancelAutoSkip() {
    if (state.autoSkipTimer) { clearTimeout(state.autoSkipTimer); state.autoSkipTimer = null; }
  }

  socket.on(BT_EVENTS.ROUND_RESULT, (p) => {
    cancelAutoSkip();
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
      $('#next-round').style.display = state.autoplay || p.isLastRound ? 'none' : '';
      if (state.autoplay) startAutoNext(p.isLastRound);
      presentScene('result', {
        skipped: false,
        answerLabel: p.answerLabel,
        options: p.options,
        distribution: p.distribution,
        correctIndex: p.correctIndex,
        correctCount: p.correctCount,
        totalPlayers: p.totalPlayers,
        leaderboard: p.leaderboard,
        youtubeId: p.youtubeId,
        fastest: p.fastest,
        slowest: p.slowest,
        atBuzzer: p.atBuzzer,
        soloCorrect: p.soloCorrect,
        mode: state.roomMode,
      });
    }, 1200);
  });

  socket.on(BT_EVENTS.ROUND_SKIPPED, (p) => {
    cancelAutoSkip();
    stopClip();
    show('screen-result');
    $('#result-answer').textContent = '⏭️ Manche passée';
    $('#result-distribution').innerHTML = '';
    $('#result-correct-count').textContent = '';
    renderLeaderboard($('#result-leaderboard'), p.leaderboard, null);
    $('#next-round').style.display = state.autoplay || p.isLastRound ? 'none' : '';
    if (state.autoplay) startAutoNext(p.isLastRound);
    presentScene('result', { skipped: true, leaderboard: p.leaderboard, mode: state.roomMode });
  });

  // Mode auto : enchaîne seul la manche suivante (ou termine) après un court délai.
  function startAutoNext(isLastRound) {
    cancelAutoNext();
    const hint = $('#auto-next-hint');
    let remaining = clampAutoDelay(state.autoDelay);
    // Les joueurs voient le même décompte sur leur écran de résultat.
    socket.emit(BT_EVENTS.HOST_AUTO_NEXT, { seconds: remaining, isLast: isLastRound });
    const label = () => {
      hint.textContent = isLastRound
        ? `🏁 Classement final dans ${remaining}…`
        : `⏭️ Manche suivante dans ${remaining}…`;
    };
    hint.style.display = '';
    label();
    state.autoTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        cancelAutoNext();
        socket.emit(isLastRound ? BT_EVENTS.HOST_END_GAME : BT_EVENTS.HOST_START_ROUND);
      } else {
        label();
      }
    }, 1000);
  }

  function cancelAutoNext() {
    if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
    const hint = $('#auto-next-hint');
    if (hint) hint.style.display = 'none';
  }

  socket.on(BT_EVENTS.GAME_ENDED, (p) => {
    cancelAutoNext();
    show('screen-ended');
    window.App.renderPodium($('#final-podium'), p.leaderboard, null);
    const rest = p.leaderboard.slice(3);
    if (rest.length) renderLeaderboard($('#final-leaderboard'), rest, null);
    else $('#final-leaderboard').innerHTML = '';
    window.App.renderAwards($('#final-awards'), p.awards);
    window.App.confetti();
    window.App.Sound.fanfare();
    presentScene('ended', { leaderboard: p.leaderboard, awards: p.awards });
    localStorage.removeItem('bt_host');
  });

  // Partie annulée : retour au lobby (tout le monde y revient, scores à zéro).
  socket.on(BT_EVENTS.GAME_CANCELLED, (p) => {
    cancelAutoNext();
    cancelAutoSkip();
    stopClip();
    state.paused = false;
    enterLobby(p.quizTitle, p.players, p.teams);
    toast('Partie annulée — retour au lobby.');
  });

  function cancelGame() {
    if (!window.confirm('Annuler la partie et revenir au lobby ? Les scores seront remis à zéro.')) return;
    cancelAutoNext();
    cancelAutoSkip();
    stopClip();
    socket.emit(BT_EVENTS.HOST_CANCEL_GAME);
  }

  socket.on(BT_EVENTS.HOST_ERROR, (p) => {
    toast(p.message || 'Erreur.');
    if (p.fatal) localStorage.removeItem('bt_host');
  });

  // --- Écrans -------------------------------------------------------------
  function enterLobby(quizTitle, players, teams) {
    show('screen-lobby');
    const suffix = (state.roomMode === 'teams' ? ' · mode équipes' : '') + (state.autoplay ? ' · auto 🎮' : '');
    $('#lobby-quiz-title').textContent = (quizTitle || '') + suffix;
    // Mode auto : rappelle à l'hôte de rejoindre sur son téléphone (il joue aussi).
    $('#lobby-auto-hint').style.display = state.autoplay ? '' : 'none';
    $('#lobby-code').textContent = state.code;
    $('#lobby-code-inline').textContent = state.code;
    $('#lobby-qr').src = `/api/room/${state.code}/qr`;
    const joinUrl = `${location.origin}/join?code=${state.code}`;
    $('#lobby-url').textContent = joinUrl;
    presentScene('lobby', {
      code: state.code,
      joinUrl,
      quizTitle: quizTitle || '',
      mode: state.roomMode,
      players: players || [],
      teams: teams || [],
    });
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
        socket.emit(BT_EVENTS.HOST_KICK_PLAYER, { playerId: pl.id });
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

    // Reflète les arrivées/départs sur l'écran public tant qu'on est au lobby.
    if (pres.scene === 'lobby') {
      pres.data.players = players;
      pres.data.teams = teams || [];
      sendPresent(Object.assign({ type: 'lobby' }, pres.data));
    }
  }

  function setMode(m) {
    state.mode = m;
    $('#mode-solo').classList.toggle('active', m === 'solo');
    $('#mode-teams').classList.toggle('active', m === 'teams');
    updateRoomSummary();
  }

  function setCombo(on) {
    state.combo = on;
    $('#combo-on').classList.toggle('active', on);
    $('#combo-off').classList.toggle('active', !on);
    updateRoomSummary();
  }

  function setAuto(on) {
    state.autoplay = on;
    $('#auto-on').classList.toggle('active', on);
    $('#auto-off').classList.toggle('active', !on);
    $('#auto-delay-row').style.display = on ? '' : 'none';
    updateRoomSummary();
  }

  function setPlayerAudio(on) {
    state.playerAudio = on;
    $('#audio-on').classList.toggle('active', on);
    $('#audio-off').classList.toggle('active', !on);
    $('#audio-hint').style.display = on ? '' : 'none';
    updateRoomSummary();
  }

  function setManualReveal(on) {
    state.manualReveal = on;
    $('#reveal-manual').classList.toggle('active', on);
    $('#reveal-auto').classList.toggle('active', !on);
    $('#reveal-hint').style.display = on ? '' : 'none';
    updateRoomSummary();
  }

  // --- Modale de configuration de la salle -------------------------------
  function updateRoomSummary() {
    const el = $('#room-config-summary');
    if (!el) return;
    const parts = [
      state.mode === 'teams' ? '👥 Équipes' : '👤 Individuel',
      state.combo ? '🔥 Combo' : 'Sans combo',
      state.autoplay ? `🎮 Auto (${clampAutoDelay($('#auto-delay').value)}s d'attente)` : '🎬 Partie manuelle',
    ];
    if (state.playerAudio) parts.push('🔊 Son sur les tél.');
    if (state.manualReveal && !state.autoplay) parts.push('🎬 Révélation manuelle');
    el.textContent = parts.join('  ·  ');
  }

  function openRoomConfig(quizId, quizTitle) {
    state.pendingQuizId = quizId;
    $('#room-config-title').textContent = `Configurer « ${quizTitle} »`;
    $('#auto-delay-row').style.display = state.autoplay ? '' : 'none';
    updateRoomSummary();
    $('#room-config-modal').style.display = 'flex';
  }

  function closeRoomConfig() {
    $('#room-config-modal').style.display = 'none';
  }

  function confirmRoomConfig() {
    if (!state.pendingQuizId) return;
    state.autoDelay = clampAutoDelay($('#auto-delay').value);
    socket.emit(BT_EVENTS.HOST_CREATE_ROOM, {
      quizId: state.pendingQuizId, mode: state.mode, combo: state.combo, playerAudio: state.playerAudio,
      // Le mode auto révèle toujours automatiquement (l'hôte ne pilote pas).
      manualReveal: state.manualReveal && !state.autoplay,
    });
    closeRoomConfig();
  }

  // --- Aperçu d'un extrait (pour se rappeler le morceau) -----------------
  function openPreview(id, startSeconds) {
    const start = Math.max(0, Math.round(Number(startSeconds) || 0));
    $('#preview-player').innerHTML =
      `<iframe src="https://www.youtube.com/embed/${id}?start=${start}&autoplay=1&rel=0" ` +
      `allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    $('#preview-modal').style.display = 'flex';
  }

  function closePreview() {
    $('#preview-player').innerHTML = ''; // vide l'iframe -> stoppe la lecture
    $('#preview-modal').style.display = 'none';
  }

  function previewRound(block) {
    const id = BT_quizForm.parseYtId($('.r-yt', block).value);
    if (!id) { toast('Lien YouTube invalide — colle une URL ou un ID valide.'); return; }
    openPreview(id, $('.r-start', block).value);
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
  $('#toggle-import').onclick = () => {
    const p = $('#import-panel');
    const hidden = p.style.display === 'none' || p.style.display === '';
    p.style.display = hidden ? 'block' : 'none';
    if (hidden) { $('#import-error').textContent = ''; $('#import-url').focus(); }
  };
  $('#run-import-blind').onclick = () => doImport(true);
  $('#run-import-review').onclick = () => doImport(false);
  $('#import-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') doImport(true); });
  $('#add-round').onclick = () => addRoundBlock();
  $('#builder-rounds').addEventListener('click', onBuilderRoundsClick);
  $('#save-quiz').onclick = saveQuiz;
  $('#start-game').onclick = () => socket.emit(BT_EVENTS.HOST_START_ROUND);
  $('#reveal-answer').onclick = () => { $('#reveal-answer').disabled = true; stopClip(); socket.emit(BT_EVENTS.HOST_END_ROUND); };
  // « Rejouer » = refaire la manche en cours : nouvelle chance pour tout le monde
  // (réponses effacées, minuteur relancé). Confirmation pour éviter un clic malheureux.
  $('#replay-clip').onclick = () => {
    if (window.confirm('Rejouer la manche ? Les réponses en cours seront effacées et tout le monde rejoue.')) {
      socket.emit(BT_EVENTS.HOST_REPLAY_ROUND);
    }
  };
  $('#pause-round').onclick = togglePause;
  $('#skip-round').onclick = () => { if (window.confirm('Passer cette manche (aucun point) ?')) socket.emit(BT_EVENTS.HOST_SKIP_ROUND); };
  $('#next-round').onclick = () => socket.emit(BT_EVENTS.HOST_START_ROUND);
  $('#end-game').onclick = () => { cancelAutoNext(); socket.emit(BT_EVENTS.HOST_END_GAME); };
  $('#cancel-game').onclick = cancelGame;
  $('#cancel-game-2').onclick = cancelGame;
  $('#auto-delay').addEventListener('change', () => { state.autoDelay = clampAutoDelay($('#auto-delay').value); $('#auto-delay').value = state.autoDelay; updateRoomSummary(); });
  $('#room-config-confirm').onclick = confirmRoomConfig;
  $('#room-config-cancel').onclick = closeRoomConfig;
  $('#room-config-modal').addEventListener('click', (e) => { if (e.target.id === 'room-config-modal') closeRoomConfig(); });
  $('#preview-close').onclick = closePreview;
  $('#preview-modal').addEventListener('click', (e) => { if (e.target.id === 'preview-modal') closePreview(); });
  $('#mode-solo').onclick = () => setMode('solo');
  $('#mode-teams').onclick = () => setMode('teams');
  $('#combo-on').onclick = () => setCombo(true);
  $('#combo-off').onclick = () => setCombo(false);
  $('#auto-on').onclick = () => setAuto(true);
  $('#auto-off').onclick = () => setAuto(false);
  $('#audio-on').onclick = () => setPlayerAudio(true);
  $('#audio-off').onclick = () => setPlayerAudio(false);
  $('#reveal-manual').onclick = () => setManualReveal(true);
  $('#reveal-auto').onclick = () => setManualReveal(false);
  $('#tab-login').onclick = () => setAuthMode('login');
  $('#tab-register').onclick = () => setAuthMode('register');
  $('#login-btn').onclick = doAuth;
  $('#login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
  $('#login-confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
  $('#logout-btn').onclick = doLogout;
  $('#open-present').onclick = openPresent;

  // --- Reprise après rechargement ----------------------------------------
  function tryReconnect() {
    if (!state.authed) return;
    const raw = localStorage.getItem('bt_host');
    if (!raw) return;
    try {
      const { code, hostToken, autoplay, autoDelay } = JSON.parse(raw);
      if (code && hostToken) {
        state.hostToken = hostToken;
        state.autoplay = !!autoplay;
        if (autoDelay != null) state.autoDelay = clampAutoDelay(autoDelay);
        socket.emit(BT_EVENTS.HOST_RECONNECT, { code, hostToken });
      }
    } catch (_) { localStorage.removeItem('bt_host'); }
  }

  checkAuth();
  socket.on('connect', tryReconnect);
})();
