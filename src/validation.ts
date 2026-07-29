import { z } from 'zod';
import { parseYouTubeId } from './game/youtube';

// Schémas de validation pour toute entrée non fiable (payloads Socket.IO envoyés
// par des téléphones arbitraires, corps de requêtes HTTP). Rien ne franchit la
// frontière navigateur -> serveur sans passer par ici.

export const createRoomSchema = z.object({
  quizId: z.string().min(1).max(100),
  mode: z.enum(['solo', 'teams']).optional(),
  combo: z.boolean().optional(),
  playerAudio: z.boolean().optional(),
  // Révélation manuelle : à la fin du minuteur, la manche attend que l'hôte
  // révèle (il peut rejouer l'extrait). Par défaut, révélation automatique.
  manualReveal: z.boolean().optional(),
});

// Import d'un blindtest depuis une playlist YouTube.
// `save: true` = mode « surprise » : le serveur crée directement le quiz sans
// jamais renvoyer les morceaux à l'hôte (il ne connaît pas les réponses).
// `save` absent/false = mode relecture : renvoie un brouillon pour le constructeur.
export const importYoutubeSchema = z.object({
  url: z.string().min(1).max(500),
  title: z.string().max(120).optional(),
  startSeconds: z.number().int().min(0).max(36000).optional(),
  durationSeconds: z.number().int().min(5).max(60).optional(),
  maxRounds: z.number().int().min(1).max(100).optional(),
  save: z.boolean().optional(),
});

// Inscription / connexion d'un compte hôte. Nom sobre (lettres/chiffres/._-),
// mot de passe d'au moins 6 caractères.
export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Le nom doit faire au moins 3 caractères.')
    .max(40)
    .regex(/^[\p{L}\p{N}._-]+$/u, 'Lettres, chiffres, point, tiret et underscore uniquement.'),
  password: z.string().min(6, 'Le mot de passe doit faire au moins 6 caractères.').max(200),
});

export const joinRoomSchema = z.object({
  code: z.string().min(3).max(10),
  pseudo: z.string().min(1).max(40),
  team: z.string().max(40).optional(),
});

export const reconnectSchema = z.object({
  code: z.string().min(3).max(10),
  playerId: z.string().min(1).max(100),
});

// Un joueur encore sur l'écran de choix d'équipe « observe » la salle pour
// recevoir en direct les équipes créées par d'autres téléphones.
export const watchRoomSchema = z.object({
  code: z.string().min(3).max(10),
});

export const hostReconnectSchema = z.object({
  code: z.string().min(3).max(10),
  hostToken: z.string().min(1).max(100),
});

export const answerSchema = z.object({
  optionIndex: z.number().int().min(0).max(5),
});

export const kickSchema = z.object({
  playerId: z.string().min(1).max(100),
});

export const resumeSchema = z.object({
  remainingSeconds: z.number().min(0).max(600),
});

// Mode auto : l'hôte relaie aux joueurs le temps restant avant la manche suivante.
export const autoNextSchema = z.object({
  seconds: z.number().int().min(1).max(60),
  isLast: z.boolean().optional(),
});

const roundInputSchema = z.object({
  youtube: z
    .string()
    .min(1)
    .transform((value, ctx) => {
      const id = parseYouTubeId(value);
      if (!id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Lien YouTube invalide.' });
        return z.NEVER;
      }
      return id;
    }),
  startSeconds: z.number().int().min(0).max(36000),
  durationSeconds: z.number().int().min(5).max(60),
  question: z.string().min(1).max(200),
  options: z.array(z.string().min(1).max(120)).min(2).max(6),
  correctIndex: z.number().int().min(0).max(5),
  // Facultatif : si vide, on retombe sur la bonne proposition (voir mapValidatedRounds).
  answerLabel: z.string().max(200).optional(),
});

export const createQuizSchema = z
  .object({
    title: z.string().min(1).max(120),
    rounds: z.array(roundInputSchema).min(1).max(100),
  })
  .superRefine((data, ctx) => {
    data.rounds.forEach((round, index) => {
      if (round.correctIndex >= round.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rounds', index, 'correctIndex'],
          message: 'La bonne réponse doit désigner une proposition existante.',
        });
      }
    });
  });

export type CreateQuizInput = z.infer<typeof createQuizSchema>;
