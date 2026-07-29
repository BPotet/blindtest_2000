// Logique PURE du constructeur de quiz (sans DOM), exposée en `window.BT_quizForm`.
//
// Extraite de host.js pour être testable hors navigateur : c'est ici que vivait
// le bug « quiz invalide » (propositions vides décalant l'index de la bonne
// réponse). Couverte par src/quiz-form.test.ts (évalué dans un bac à sable).
//
// À charger AVANT host.js dans index.html.
(function (root) {
  var YT_ID = /^[A-Za-z0-9_-]{11}$/;

  // Ne garde que les propositions non vides (après trim) et recale l'index de la
  // bonne réponse sur cette liste filtrée — un slot vide ne doit jamais décaler
  // l'index ni sortir des bornes. rows: [{ value, checked }].
  function mapOptions(rows) {
    var options = [];
    var correctIndex = 0;
    (rows || []).forEach(function (row) {
      var val = String(row && row.value != null ? row.value : '').trim();
      if (!val) return;
      if (row && row.checked) correctIndex = options.length;
      options.push(val);
    });
    return { options: options, correctIndex: correctIndex };
  }

  // Extrait l'ID vidéo YouTube (11 caractères) d'une URL ou d'un ID brut ; null
  // si non analysable. Doit rester cohérent avec src/game/youtube.ts (serveur).
  function parseYtId(input) {
    var v = String(input == null ? '' : input).trim();
    if (!v) return null;
    if (YT_ID.test(v)) return v;
    try {
      var url = new URL(v.indexOf('://') >= 0 ? v : 'https://' + v);
      var host = url.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') {
        var id = url.pathname.split('/').filter(Boolean)[0];
        return YT_ID.test(id || '') ? id : null;
      }
      var vp = url.searchParams.get('v');
      if (vp && YT_ID.test(vp)) return vp;
      var seg = url.pathname.split('/').filter(Boolean);
      var m = seg.findIndex(function (s) { return s === 'embed' || s === 'shorts' || s === 'v'; });
      if (m >= 0 && YT_ID.test(seg[m + 1] || '')) return seg[m + 1];
    } catch (e) {
      /* pas une URL analysable */
    }
    return null;
  }

  root.BT_quizForm = { mapOptions: mapOptions, parseYtId: parseYtId };
})(typeof window !== 'undefined' ? window : this);
