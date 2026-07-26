// Extraction de l'identifiant d'une vidéo YouTube à partir d'une URL ou d'un ID
// brut. Aucune requête réseau : on ne fait qu'analyser la chaîne. La lecture de
// l'extrait se fait ensuite côté hôte via l'IFrame Player YouTube (pas
// d'extraction de fichier audio en v1 — voir README).

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Renvoie l'ID de vidéo YouTube (11 caractères) ou null si l'entrée est invalide.
 * Accepte : ID brut, youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID.
 */
export function parseYouTubeId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (YT_ID_RE.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && YT_ID_RE.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const vParam = url.searchParams.get('v');
    if (vParam && YT_ID_RE.test(vParam)) return vParam;

    const segments = url.pathname.split('/').filter(Boolean);
    const marker = segments.findIndex((s) => s === 'embed' || s === 'shorts' || s === 'v');
    if (marker >= 0 && segments[marker + 1] && YT_ID_RE.test(segments[marker + 1])) {
      return segments[marker + 1];
    }
  }

  return null;
}
