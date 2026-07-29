import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

// La logique cliente pure (public/js/quiz-form.js) est évaluée dans un bac à
// sable muni d'un faux `window` : on teste le code réellement livré au
// navigateur, là où vivait le bug « quiz invalide ».
interface QuizForm {
  mapOptions(rows: Array<{ value: unknown; checked?: boolean }>): {
    options: string[];
    correctIndex: number;
  };
  parseYtId(input: unknown): string | null;
}

let form: QuizForm;

beforeAll(() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const code = readFileSync(resolve(here, '..', 'public', 'js', 'quiz-form.js'), 'utf8');
  const sandbox: { window: { BT_quizForm?: QuizForm }; URL: typeof URL } = { window: {}, URL };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  if (!sandbox.window.BT_quizForm) throw new Error('quiz-form.js n\'a pas défini window.BT_quizForm');
  form = sandbox.window.BT_quizForm;
});

describe('mapOptions — propositions et index de bonne réponse', () => {
  it('recale l\'index quand des propositions AVANT la bonne sont vides (le bug)', () => {
    const { options, correctIndex } = form.mapOptions([
      { value: '', checked: false },
      { value: 'Bonne', checked: true },
      { value: 'Mauvaise', checked: false },
    ]);
    expect(options).toEqual(['Bonne', 'Mauvaise']);
    expect(correctIndex).toBe(0); // 0 dans la liste filtrée, pas 1
  });

  it('ignore les slots vides intercalés sans casser l\'index', () => {
    const { options, correctIndex } = form.mapOptions([
      { value: 'A', checked: false },
      { value: '   ', checked: false },
      { value: 'B', checked: true },
      { value: '', checked: false },
      { value: 'C', checked: false },
    ]);
    expect(options).toEqual(['A', 'B', 'C']);
    expect(correctIndex).toBe(1);
  });

  it('trim les valeurs et par défaut pointe la première proposition', () => {
    const { options, correctIndex } = form.mapOptions([
      { value: '  Alpha  ', checked: false },
      { value: 'Beta', checked: false },
    ]);
    expect(options).toEqual(['Alpha', 'Beta']);
    expect(correctIndex).toBe(0);
  });

  it('tolère une entrée vide ou absente', () => {
    expect(form.mapOptions([])).toEqual({ options: [], correctIndex: 0 });
    // @ts-expect-error robustesse à un appel sans argument
    expect(form.mapOptions()).toEqual({ options: [], correctIndex: 0 });
  });
});

describe('parseYtId — extraction d\'ID YouTube', () => {
  it('accepte un ID brut de 11 caractères', () => {
    expect(form.parseYtId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('lit ?v= sur une URL watch (avec ou sans www)', () => {
    expect(form.parseYtId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(form.parseYtId('youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toBe('dQw4w9WgXcQ');
  });

  it('gère youtu.be, /embed/ et /shorts/', () => {
    expect(form.parseYtId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(form.parseYtId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(form.parseYtId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejette ce qui n\'est pas un ID valide', () => {
    expect(form.parseYtId('')).toBeNull();
    expect(form.parseYtId('   ')).toBeNull();
    expect(form.parseYtId('pas une url')).toBeNull();
    expect(form.parseYtId('https://youtu.be/trop-court')).toBeNull();
    expect(form.parseYtId(null)).toBeNull();
  });
});
