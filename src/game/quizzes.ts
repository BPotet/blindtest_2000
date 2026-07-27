import type { Quiz } from '../types';

// Quiz de démonstration livrés avec l'application pour pouvoir tester tout de
// suite. Les identifiants YouTube sont ceux de clips officiels très connus ;
// les timestamps de départ visent approximativement un passage reconnaissable.
// Un hôte peut créer ses propres quiz depuis l'interface (stockés en mémoire
// pour cette v1 — voir README).

export const DEMO_QUIZZES: Quiz[] = [
  {
    id: 'demo-tubes',
    title: 'Tubes intemporels',
    ownerId: null,
    rounds: [
      {
        id: 'r1',
        youtubeId: 'dQw4w9WgXcQ',
        startSeconds: 43,
        durationSeconds: 20,
        question: 'Quel est ce morceau ?',
        options: [
          'Never Gonna Give You Up — Rick Astley',
          'Together Forever — Rick Astley',
          'Faith — George Michael',
          'Wake Me Up Before You Go-Go — Wham!',
        ],
        correctIndex: 0,
        answerLabel: 'Rick Astley — Never Gonna Give You Up (1987)',
      },
      {
        id: 'r2',
        youtubeId: 'fJ9rUzIMcZQ',
        startSeconds: 55,
        durationSeconds: 20,
        question: 'Quel groupe interprète ce titre ?',
        options: ['Queen', 'The Beatles', 'Led Zeppelin', 'Pink Floyd'],
        correctIndex: 0,
        answerLabel: 'Queen — Bohemian Rhapsody (1975)',
      },
      {
        id: 'r3',
        youtubeId: 'hTWKbfoikeg',
        startSeconds: 15,
        durationSeconds: 20,
        question: 'Quel est ce morceau grunge culte ?',
        options: [
          'Smells Like Teen Spirit — Nirvana',
          'Black Hole Sun — Soundgarden',
          'Alive — Pearl Jam',
          'Creep — Radiohead',
        ],
        correctIndex: 0,
        answerLabel: 'Nirvana — Smells Like Teen Spirit (1991)',
      },
      {
        id: 'r4',
        youtubeId: 'Zi_XLOBDo_Y',
        startSeconds: 30,
        durationSeconds: 20,
        question: 'Qui chante ce classique de la pop ?',
        options: ['Michael Jackson', 'Prince', 'Lionel Richie', 'Stevie Wonder'],
        correctIndex: 0,
        answerLabel: 'Michael Jackson — Billie Jean (1982)',
      },
      {
        id: 'r5',
        youtubeId: '8UVNT4wvIGY',
        startSeconds: 60,
        durationSeconds: 20,
        question: 'Quel est ce tube de 2011 ?',
        options: [
          'Somebody That I Used to Know — Gotye',
          'Rolling in the Deep — Adele',
          'Pumped Up Kicks — Foster the People',
          'We Found Love — Rihanna',
        ],
        correctIndex: 0,
        answerLabel: 'Gotye — Somebody That I Used to Know (2011)',
      },
    ],
  },
  {
    id: 'demo-80s',
    title: 'Spécial années 80',
    ownerId: null,
    rounds: [
      {
        id: 'r1',
        youtubeId: 'djV11Xbc914',
        startSeconds: 50,
        durationSeconds: 20,
        question: 'Quel est ce hit de 1985 ?',
        options: ['Take On Me — a-ha', 'Africa — Toto', 'Sweet Dreams — Eurythmics', 'Blue Monday — New Order'],
        correctIndex: 0,
        answerLabel: 'a-ha — Take On Me (1985)',
      },
      {
        id: 'r2',
        youtubeId: 'FTQbiNvZqaY',
        startSeconds: 60,
        durationSeconds: 20,
        question: 'Quel groupe interprète ce titre ?',
        options: ['Toto', 'Journey', 'Foreigner', 'Chicago'],
        correctIndex: 0,
        answerLabel: 'Toto — Africa (1982)',
      },
      {
        id: 'r3',
        youtubeId: '9jK-NcRmVcw',
        startSeconds: 43,
        durationSeconds: 20,
        question: 'Quel est ce morceau ?',
        options: [
          'The Final Countdown — Europe',
          'Eye of the Tiger — Survivor',
          'Jump — Van Halen',
          'Livin\' on a Prayer — Bon Jovi',
        ],
        correctIndex: 0,
        answerLabel: 'Europe — The Final Countdown (1986)',
      },
    ],
  },
];

/** Renvoie une copie profonde des quiz de démonstration (pour le seed du store). */
export function cloneDemoQuizzes(): Quiz[] {
  return DEMO_QUIZZES.map((quiz) => ({
    ...quiz,
    rounds: quiz.rounds.map((round) => ({ ...round, options: [...round.options] })),
  }));
}
