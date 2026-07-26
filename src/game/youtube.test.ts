import { describe, it, expect } from 'vitest';
import { parseYouTubeId } from './youtube';

describe('parseYouTubeId', () => {
  it('accepte un ID brut de 11 caractères', () => {
    expect(parseYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extrait l\'ID d\'une URL watch', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extrait l\'ID d\'un lien court youtu.be', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
  });

  it('extrait l\'ID d\'une URL embed', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extrait l\'ID d\'un short', () => {
    expect(parseYouTubeId('youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejette une URL non YouTube', () => {
    expect(parseYouTubeId('https://vimeo.com/12345')).toBeNull();
  });

  it('rejette une chaîne vide ou absurde', () => {
    expect(parseYouTubeId('')).toBeNull();
    expect(parseYouTubeId('pas une url')).toBeNull();
  });
});
