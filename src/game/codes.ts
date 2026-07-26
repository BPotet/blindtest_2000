import { customAlphabet } from 'nanoid';

// Alphabet sans caractères ambigus (pas de 0/O, 1/I/L) pour un code lisible et
// saisissable à la main sur un téléphone — convention type Kahoot.
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

const generate = customAlphabet(ROOM_ALPHABET, CODE_LENGTH);

/** Génère un code de salle court, non ambigu, en majuscules. */
export function generateRoomCode(): string {
  return generate();
}

/** Génère un identifiant opaque (joueur, manche, quiz…). */
export function generateId(prefix = ''): string {
  const body = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)();
  return prefix ? `${prefix}_${body}` : body;
}

export const __testing = { ROOM_ALPHABET, CODE_LENGTH };
