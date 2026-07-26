import type { Quiz, Round } from '../types';
import { cloneDemoQuizzes } from './quizzes';
import { generateId } from './codes';

export interface QuizSummary {
  id: string;
  title: string;
  roundCount: number;
  isDemo: boolean;
}

/**
 * Stockage en mémoire des quiz (v1 — pas de base de données).
 * Les quiz de démonstration sont présents au démarrage. Les quiz créés par un
 * hôte vivent le temps de l'exécution du serveur (voir README pour la limite).
 */
export class QuizStore {
  private readonly quizzes = new Map<string, Quiz>();
  private readonly demoIds = new Set<string>();

  constructor() {
    for (const quiz of cloneDemoQuizzes()) {
      this.quizzes.set(quiz.id, quiz);
      this.demoIds.add(quiz.id);
    }
  }

  list(): QuizSummary[] {
    return [...this.quizzes.values()].map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      roundCount: quiz.rounds.length,
      isDemo: this.demoIds.has(quiz.id),
    }));
  }

  get(id: string): Quiz | undefined {
    return this.quizzes.get(id);
  }

  create(title: string, rounds: Array<Omit<Round, 'id'>>): Quiz {
    const quiz: Quiz = {
      id: generateId('quiz'),
      title,
      rounds: rounds.map((round, index) => ({ ...round, id: `r${index + 1}` })),
    };
    this.quizzes.set(quiz.id, quiz);
    return quiz;
  }
}
