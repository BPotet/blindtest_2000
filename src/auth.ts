import crypto from 'node:crypto';

// Authentification légère pour l'espace hôte : un utilisateur admin, mot de passe
// haché (scrypt natif — aucune dépendance, aucun crypto « maison »), et session
// par cookie signé HMAC. Suffisant pour une « petite protection » ; extensible
// vers plusieurs comptes plus tard.

export const SESSION_COOKIE = 'bt_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

export interface AuthConfig {
  adminUsername: string;
  adminPassword: string;
  sessionSecret: string;
  secureCookies: boolean;
}

/** Lit la configuration d'auth depuis l'environnement, avec défauts de dev. */
export function loadAuthConfig(): AuthConfig {
  const adminUsername = process.env.ADMIN_USERNAME?.trim() || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      "⚠️  ADMIN_PASSWORD non défini — identifiants par défaut admin/admin. Définis ADMIN_PASSWORD (et ADMIN_USERNAME) en production.",
    );
  }
  if (!process.env.SESSION_SECRET) {
    console.warn(
      '⚠️  SESSION_SECRET non défini — les sessions seront invalidées à chaque redémarrage. Définis SESSION_SECRET (chaîne aléatoire) pour des sessions stables.',
    );
  }

  return {
    adminUsername,
    adminPassword,
    sessionSecret,
    secureCookies: process.env.NODE_ENV === 'production',
  };
}

// ---- Mot de passe (scrypt) ----------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ---- Session (cookie signé HMAC) ----------------------------------------

/** Crée un jeton de session `payload.signature` (base64url). */
export function createSession(userId: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + SESSION_TTL_MS })).toString(
    'base64url',
  );
  const sig = sign(payload, secret);
  return `${payload}.${sig}`;
}

/** Vérifie un jeton de session et renvoie l'identifiant utilisateur, ou null. */
export function verifySession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): { uid: string } | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid?: unknown;
      exp?: unknown;
    };
    if (typeof data.uid !== 'string' || typeof data.exp !== 'number' || data.exp < now) return null;
    return { uid: data.uid };
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

// ---- Cookies -------------------------------------------------------------

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function buildSessionCookie(value: string, cfg: AuthConfig): string {
  const attrs = [
    `${SESSION_COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (cfg.secureCookies) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(cfg: AuthConfig): string {
  const attrs = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (cfg.secureCookies) attrs.push('Secure');
  return attrs.join('; ');
}
