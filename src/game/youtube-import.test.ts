import { describe, it, expect } from 'vitest';
import {
  parseYouTubePlaylistId,
  cleanTitle,
  buildRoundsFromVideos,
  fetchPlaylistVideos,
  YouTubeImportError,
  type PlaylistVideo,
} from './youtube-import';

// PRNG déterministe (mulberry32) pour des tests reproductibles.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('parseYouTubePlaylistId', () => {
  it('extrait le paramètre list= des URLs', () => {
    expect(parseYouTubePlaylistId('https://www.youtube.com/playlist?list=PLabcdefghij12')).toBe('PLabcdefghij12');
    expect(parseYouTubePlaylistId('https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxxxxxxxxxxx')).toBe('PLxxxxxxxxxxxx');
  });
  it('accepte un ID de playlist brut', () => {
    expect(parseYouTubePlaylistId('PL1234567890abc')).toBe('PL1234567890abc');
  });
  it('rejette ce qui n\'est pas une playlist', () => {
    expect(parseYouTubePlaylistId('https://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubePlaylistId('dQw4w9WgXcQ')).toBeNull(); // ID de vidéo (11)
    expect(parseYouTubePlaylistId('')).toBeNull();
    expect(parseYouTubePlaylistId('pas une url')).toBeNull();
  });
});

describe('cleanTitle', () => {
  it('retire les mentions parasites', () => {
    expect(cleanTitle('A-ha - Take On Me (Official Video)')).toBe('A-ha - Take On Me');
    expect(cleanTitle('Queen - Bohemian Rhapsody [Remastered 2011]')).toBe('Queen - Bohemian Rhapsody');
    expect(cleanTitle('Daft Punk - Get Lucky (Official Audio) [HD]')).toBe('Daft Punk - Get Lucky');
    expect(cleanTitle('Artiste - Titre (Lyrics)')).toBe('Artiste - Titre');
  });
  it('conserve les parenthèses légitimes', () => {
    expect(cleanTitle("Otis Redding - (Sittin' On) The Dock of the Bay")).toBe("Otis Redding - (Sittin' On) The Dock of the Bay");
  });
  it('gère les chaînes « - Topic »', () => {
    expect(cleanTitle('Michael Jackson - Topic')).toBe('Michael Jackson');
  });
});

const VIDEOS: PlaylistVideo[] = [
  { title: 'A-ha - Take On Me (Official Video)', videoId: 'djV11Xbc914' },
  { title: 'Queen - Bohemian Rhapsody [Remastered]', videoId: 'fJ9rUzIMcZQ' },
  { title: 'Michael Jackson - Billie Jean (Official)', videoId: 'Zi_XLOBDo_Y' },
  { title: 'Toto - Africa (Official HD Video)', videoId: 'FTQbiNvZqaY' },
  { title: 'Europe - The Final Countdown', videoId: '9jK-NcRmVcw' },
];

const CLEANED_TITLES = [
  'A-ha - Take On Me',
  'Queen - Bohemian Rhapsody',
  'Michael Jackson - Billie Jean',
  'Toto - Africa',
  'Europe - The Final Countdown',
];

describe('buildRoundsFromVideos', () => {
  it('crée une manche par morceau avec la bonne réponse dans les options', () => {
    const rounds = buildRoundsFromVideos(VIDEOS, {}, seeded(42));
    expect(rounds).toHaveLength(5);
    for (const r of rounds) {
      expect(r.options.length).toBeGreaterThanOrEqual(2);
      expect(r.options.length).toBeLessThanOrEqual(4);
      // La bonne réponse est bien celle désignée et correspond au label révélé.
      expect(r.options[r.correctIndex]).toBe(r.answerLabel);
      // Options distinctes, titres nettoyés, issus de la playlist.
      expect(new Set(r.options).size).toBe(r.options.length);
      expect(r.answerLabel).not.toMatch(/official|remaster/i);
      expect(CLEANED_TITLES).toContain(r.answerLabel);
      for (const opt of r.options) expect(CLEANED_TITLES).toContain(opt);
    }
    // Chaque morceau de la playlist est joué une fois (ordre indifférent).
    expect(new Set(rounds.map((r) => r.answerLabel))).toEqual(new Set(CLEANED_TITLES));
  });

  it('sélectionne les morceaux joués AU HASARD (pas dans l\'ordre de la playlist)', () => {
    // Avec des graines différentes, l'ordre/la sélection diffèrent.
    const a = buildRoundsFromVideos(VIDEOS, { maxRounds: 3 }, seeded(1)).map((r) => r.answerLabel);
    const b = buildRoundsFromVideos(VIDEOS, { maxRounds: 3 }, seeded(999)).map((r) => r.answerLabel);
    expect(a).toHaveLength(3);
    expect(a).not.toEqual(b); // tirage aléatoire, pas les 3 premiers dans l'ordre
  });

  it('tire les mauvaises réponses de TOUTE la playlist, pas que des manches jouées', () => {
    // 8 morceaux, mais seulement 3 manches : les distracteurs doivent pouvoir
    // venir des 5 morceaux non joués.
    const many = Array.from({ length: 8 }, (_, i) => ({ title: `Artiste ${i} - Titre ${i}`, videoId: `vid${i}0000000`.slice(0, 11) }));
    const rounds = buildRoundsFromVideos(many, { maxRounds: 3 }, seeded(3));
    expect(rounds).toHaveLength(3);
    const played = new Set(rounds.map((r) => r.answerLabel));
    const allOptions = new Set(rounds.flatMap((r) => r.options));
    // Au moins une proposition ne fait PAS partie des morceaux joués.
    const fromOutside = [...allOptions].some((o) => !played.has(o));
    expect(fromOutside).toBe(true);
  });

  it('respecte les options de départ/durée/nombre', () => {
    const rounds = buildRoundsFromVideos(VIDEOS, { startSeconds: 45, durationSeconds: 20, maxRounds: 2 }, seeded(1));
    expect(rounds).toHaveLength(2);
    expect(rounds[0].startSeconds).toBe(45);
    expect(rounds[0].durationSeconds).toBe(20);
  });

  it('borne les valeurs hors limites', () => {
    const rounds = buildRoundsFromVideos(VIDEOS, { durationSeconds: 999, maxRounds: 999 }, seeded(1));
    expect(rounds[0].durationSeconds).toBe(60); // plafond
    expect(rounds.length).toBeLessThanOrEqual(5);
  });
});

describe('fetchPlaylistVideos', () => {
  const page = (items: unknown[], nextPageToken?: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ items, nextPageToken }),
  });
  const item = (title: string, videoId: string) => ({ snippet: { title, resourceId: { videoId } } });

  it('mappe les items et filtre les vidéos privées/supprimées', async () => {
    const fake = async () =>
      page([
        item('Chanson A', 'aaaaaaaaaaa'),
        item('Private video', 'bbbbbbbbbbb'),
        item('Deleted video', 'ccccccccccc'),
        item('Chanson B', 'ddddddddddd'),
      ]);
    const videos = await fetchPlaylistVideos('PLxxxxxxxxxxxx', 'KEY', fake as any);
    expect(videos).toEqual([
      { title: 'Chanson A', videoId: 'aaaaaaaaaaa' },
      { title: 'Chanson B', videoId: 'ddddddddddd' },
    ]);
  });

  it('remonte une erreur claire sur réponse non-200', async () => {
    const fake = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } }),
    });
    await expect(fetchPlaylistVideos('PLxxxxxxxxxxxx', 'KEY', fake as any)).rejects.toBeInstanceOf(YouTubeImportError);
  });
});
