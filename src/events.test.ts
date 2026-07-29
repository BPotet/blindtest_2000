import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { EVENTS } from './events';

// Drift-guard : le miroir navigateur `public/js/events.js` DOIT décrire
// exactement les mêmes paires clé→valeur que la source serveur `src/events.ts`.
// Sinon client et serveur parleraient de noms d'évènements différents — le bug
// réseau silencieux que ce module existe pour empêcher.
//
// On évalue le vrai fichier navigateur dans un bac à sable muni d'un faux
// `window` : on teste donc le code réellement livré au navigateur, pas une copie.
function loadClientEvents(): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const code = readFileSync(resolve(here, '..', 'public', 'js', 'events.js'), 'utf8');
  const sandbox: { window: { BT_EVENTS?: Record<string, string> } } = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  if (!sandbox.window.BT_EVENTS) throw new Error('events.js n\'a pas défini window.BT_EVENTS');
  return sandbox.window.BT_EVENTS;
}

describe('Constantes d\'évènements — miroir client/serveur', () => {
  it('public/js/events.js est identique à src/events.ts', () => {
    expect(loadClientEvents()).toEqual({ ...EVENTS });
  });

  it('les valeurs (noms réseau) sont toutes uniques', () => {
    const values = Object.values(EVENTS);
    expect(new Set(values).size).toBe(values.length);
  });
});
