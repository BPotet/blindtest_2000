// Import « semi-automatique » d'un blindtest à partir d'une playlist YouTube.
//
// Le serveur récupère les titres de la playlist via l'API officielle YouTube
// Data API v3 (métadonnées uniquement — aucune extraction/téléchargement audio,
// donc pas de risque « stream-ripping »), puis fabrique une manche par morceau :
// la bonne réponse est le titre du morceau, les mauvaises réponses sont d'autres
// titres de la MÊME playlist (donc plausibles et dans le thème). Le tout est
// renvoyé à l'hôte qui relit/ajuste dans le constructeur avant d'enregistrer.

export interface PlaylistVideo {
  title: string;
  videoId: string;
}

// Une manche dans la forme attendue par le constructeur et par createQuizSchema.
export interface DraftRound {
  youtube: string;
  startSeconds: number;
  durationSeconds: number;
  question: string;
  options: string[];
  correctIndex: number;
  answerLabel: string;
}

export interface BuildOptions {
  startSeconds?: number;
  durationSeconds?: number;
  maxRounds?: number;
  question?: string;
}

export class YouTubeImportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'YouTubeImportError';
  }
}

// Les identifiants de playlist font au moins 13 caractères (les vidéos en font
// 11) : on exclut ainsi un ID de vidéo collé par erreur.
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{13,64}$/;

/**
 * Extrait l'ID de playlist d'une URL YouTube (paramètre `list=`) ou accepte un
 * ID brut. Renvoie null si rien de valable.
 */
export function parseYouTubePlaylistId(input: string): string | null {
  const value = String(input || '').trim();
  if (!value) return null;
  if (!value.includes('/') && !value.includes('.') && PLAYLIST_ID_RE.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    return null;
  }
  const list = url.searchParams.get('list');
  return list && PLAYLIST_ID_RE.test(list) ? list : null;
}

// Mots-clés « bruit » : un groupe (...) ou [...] qui en contient est retiré du
// titre. Les parenthèses légitimes (ex. « (Sittin' On) The Dock of the Bay »)
// sont conservées.
const NOISE = /(official|officiel|lyrics?|paroles|audio|video|vidéo|visuali[sz]er|clip|m\/?v|hd|hq|4k|8k|remaster(ed)?|explicit|karaoke|full album|radio edit|extended|slowed|sped up)/i;

/** Nettoie un titre YouTube de ses mentions parasites. */
export function cleanTitle(raw: string): string {
  let t = String(raw || '');
  // Groupes entre parenthèses/crochets qui ne sont que du bruit.
  t = t.replace(/[([][^()[\]]*[)\]]/g, (m) => (NOISE.test(m) ? ' ' : m));
  // Chaînes auto « - Topic ».
  t = t.replace(/\s*-\s*topic\s*$/i, '');
  // Segment final après « | » s'il est parasite (label, mention…).
  t = t.replace(/\s*\|\s*[^|]*$/, (m) => (NOISE.test(m) ? '' : m));
  // Espaces multiples, tirets/espaces orphelins en bordure.
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
  return t;
}

function clampInt(v: number | undefined, min: number, max: number, fallback: number): number {
  const n = v === undefined ? fallback : Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function pickRandom<T>(arr: T[], n: number, rng: () => number): T[] {
  const copy = arr.slice();
  const out: T[] = [];
  while (copy.length > 0 && out.length < n) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  }
  return out;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Construit les manches d'un blindtest à partir des vidéos d'une playlist.
 * `rng` est injectable pour des tests déterministes.
 */
export function buildRoundsFromVideos(
  videos: PlaylistVideo[],
  opts: BuildOptions = {},
  rng: () => number = Math.random,
): DraftRound[] {
  const startSeconds = clampInt(opts.startSeconds, 0, 36000, 30);
  const durationSeconds = clampInt(opts.durationSeconds, 5, 60, 30);
  const maxRounds = clampInt(opts.maxRounds, 1, 30, 20);
  const question = opts.question?.trim() || 'Quel est ce morceau ?';

  // Nettoyage, repli sur le titre brut si le nettoyage vide tout, filtrage.
  const cleaned = videos
    .map((v) => ({ videoId: String(v.videoId || '').trim(), title: cleanTitle(v.title) || String(v.title || '').trim() }))
    .filter((v) => v.videoId && v.title);

  const distinctTitles = [...new Set(cleaned.map((v) => v.title))];

  return cleaned.slice(0, maxRounds).map((v) => {
    const pool = distinctTitles.filter((t) => t !== v.title);
    const options = shuffle([v.title, ...pickRandom(pool, 3, rng)], rng);
    return {
      youtube: v.videoId,
      startSeconds,
      durationSeconds,
      question,
      options,
      correctIndex: options.indexOf(v.title),
      answerLabel: v.title,
    };
  });
}

interface FetchLike {
  (url: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

function mapApiError(status: number, reason?: string): string {
  if (status === 404) return "Playlist introuvable (vérifie le lien, elle doit être publique ou non répertoriée).";
  if (status === 403) {
    if (reason === 'quotaExceeded') return 'Quota YouTube épuisé pour aujourd\'hui, réessaie demain.';
    return "Clé YouTube refusée ou playlist privée (vérifie YOUTUBE_API_KEY et que la playlist est accessible).";
  }
  if (status === 400) return 'Requête YouTube invalide (lien de playlist incorrect ?).';
  return `Erreur YouTube (HTTP ${status}).`;
}

/**
 * Récupère les vidéos d'une playlist via l'API YouTube Data v3. `fetchImpl` est
 * injectable pour les tests. Filtre les vidéos privées/supprimées.
 */
export async function fetchPlaylistVideos(
  playlistId: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  maxVideos = 50,
): Promise<PlaylistVideo[]> {
  const out: PlaylistVideo[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetchImpl(url.toString());
    if (!res.ok) {
      let reason: string | undefined;
      try {
        const body = (await res.json()) as { error?: { errors?: Array<{ reason?: string }> } };
        reason = body?.error?.errors?.[0]?.reason;
      } catch {
        /* corps illisible : on garde le mapping par statut */
      }
      throw new YouTubeImportError(mapApiError(res.status, reason), res.status);
    }
    const data = (await res.json()) as {
      items?: Array<{ snippet?: { title?: string; resourceId?: { videoId?: string } } }>;
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      const title = item?.snippet?.title;
      const videoId = item?.snippet?.resourceId?.videoId;
      if (!title || !videoId) continue;
      if (title === 'Private video' || title === 'Deleted video') continue;
      out.push({ title, videoId });
    }
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < maxVideos);

  return out.slice(0, maxVideos);
}
