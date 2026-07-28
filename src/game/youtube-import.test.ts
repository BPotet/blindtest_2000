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

describe('buildRoundsFromVideos', () => {
  it('crée une manche par morceau avec la bonne réponse dans les options', () => {
    const rounds = buildRoundsFromVideos(VIDEOS, {}, seeded(42));
    expect(rounds).toHaveLength(5);
    for (const r of rounds) {
      expect(r.options.length).toBeGreaterThanOrEqual(2);
      expect(r.options.length).toBeLessThanOrEqual(4);
      // La bonne réponse est bien celle désignée et correspond au label révélé.
      expect(r.options[r.correctIndex]).toBe(r.answerLabel);
      // Options distinctes.
      expect(new Set(r.options).size).toBe(r.options.length);
      // Les titres sont nettoyés.
      expect(r.answerLabel).not.toMatch(/official|remaster/i);
    }
    // Titres nettoyés attendus.
    expect(rounds[0].answerLabel).toBe('A-ha - Take On Me');
    expect(rounds[0].youtube).toBe('djV11Xbc914');
  });

  it('les mauvaises réponses proviennent d\'autres titres de la playlist', () => {
    const rounds = buildRoundsFromVideos(VIDEOS, {}, seeded(7));
    const allTitles = new Set(rounds.map((r) => r.answerLabel));
    for (const r of rounds) {
      for (const opt of r.options) expect(allTitles.has(opt)).toBe(true);
    }
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
