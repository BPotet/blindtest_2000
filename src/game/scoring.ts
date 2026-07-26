// Scoring strictement serveur-autoritaire.
// Aucun horodatage client n'est jamais utilisé : `elapsedMs` est toujours calculé
// à partir d'horodatages serveur (instant de démarrage de la manche -> instant de
// réception de la réponse). Voir SCORE-01 dans les exigences du projet.

export const BASE_POINTS = 1000;
export const MAX_SPEED_BONUS = 1000;

export interface ScoreInput {
  correct: boolean;
  /** Temps écoulé, en millisecondes, entre le début de la fenêtre de réponse
   *  et la réception de la réponse — mesuré côté serveur uniquement. */
  elapsedMs: number;
  /** Durée totale de la fenêtre de réponse, en millisecondes. */
  answerWindowMs: number;
}

/**
 * Calcule les points d'une réponse.
 * - Réponse fausse ou absente => 0 point.
 * - Réponse juste => points de base + bonus de vitesse dégressif linéairement
 *   sur toute la fenêtre de réponse (plus on répond tôt, plus le bonus est élevé).
 */
export function computeScore({ correct, elapsedMs, answerWindowMs }: ScoreInput): number {
  if (!correct) return 0;
  if (answerWindowMs <= 0) return BASE_POINTS + MAX_SPEED_BONUS;

  const clampedElapsed = Math.max(0, Math.min(elapsedMs, answerWindowMs));
  const speedFactor = 1 - clampedElapsed / answerWindowMs;
  const speedBonus = Math.round(MAX_SPEED_BONUS * speedFactor);

  return BASE_POINTS + speedBonus;
}

export interface RankablePlayer {
  id: string;
  pseudo: string;
  score: number;
}

export interface RankedPlayer extends RankablePlayer {
  rank: number;
}

/**
 * Classe les joueurs par score décroissant. Les ex æquo partagent le même rang
 * (classement "standard competition" : 1, 2, 2, 4). Départage stable par pseudo
 * pour un ordre déterministe.
 */
export function rankPlayers(players: RankablePlayer[]): RankedPlayer[] {
  const sorted = [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.pseudo.localeCompare(b.pseudo, 'fr');
  });

  let lastScore: number | null = null;
  let lastRank = 0;
  return sorted.map((player, index) => {
    const rank = lastScore === player.score ? lastRank : index + 1;
    lastScore = player.score;
    lastRank = rank;
    return { ...player, rank };
  });
}
