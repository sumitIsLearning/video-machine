// Token specs for the example prompt: how each said word is split into tokens, and the (deadpan)
// next-token distributions shown above each token. Keyed by the word as typed (straight quotes).

export type Cand = [text: string, p: number];
export interface PieceSpec {
  /** Display text of this token (the pieces of a word concatenate to the word as typed). */
  s: string;
  dist?: Cand[];
  /** Index of the sampled candidate (default 0). */
  pick?: number;
}

export const SPECS: Record<string, PieceSpec[]> = {
  '"Create': [{ s: '"', dist: [['"', 0.62], ['/', 0.11], ['Please', 0.08], ['Hi!', 0.03]] }, { s: 'Create', dist: [['Create', 0.58], ['Make', 0.21], ['Render', 0.09], ['Imagine', 0.04]] }],
  a: [{ s: 'a', dist: [['a', 0.81], ['an', 0.07], ['the', 0.05], ['400', 0.01]] }],
  '15-second': [{ s: '15', dist: [['15', 0.38], ['30', 0.24], ['10', 0.12], ['90', 0.03]] }, { s: '-second', dist: [['-second', 0.71], ['-minute', 0.12], ['-frame', 0.06], ['-hour', 0.01]] }],
  cinematic: [{ s: 'cinematic', dist: [['cinematic', 0.61], ['epic', 0.14], ['tasteful', 0.08], ['vertical', 0.03]] }],
  motion: [{ s: 'motion', dist: [['motion', 0.83], ['emotion', 0.04], ['slow-motion', 0.03]] }],
  graphics: [{ s: 'graphics', dist: [['graphics', 0.91], ['design', 0.05], ['sickness', 0.01]] }],
  sequence: [{ s: 'sequence', dist: [['sequence', 0.64], ['montage', 0.17], ['banger', 0.03]] }],
  with: [{ s: 'with', dist: [['with', 0.72], ['featuring', 0.14], ['without', 0.02]] }],
  kinetic: [{ s: 'kinetic', dist: [['kinetic', 0.55], ['animated', 0.21], ['bouncy', 0.06], ['Comic Sans', 0.01]] }],
  'typography,': [{ s: 'typo', dist: [['typo', 0.68], ['type', 0.14], ['fonts', 0.07]] }, { s: 'graphy,', dist: [['graphy,', 0.97], ['s,', 0.02]] }],
  smooth: [{ s: 'smooth', dist: [['smooth', 0.52], ['buttery', 0.19], ['snappy', 0.11], ['janky', 0.02]] }],
  shape: [{ s: 'shape', dist: [['shape', 0.77], ['morph', 0.09], ['blob', 0.05]] }],
  'transitions,': [{ s: 'transitions,', dist: [['transitions,', 0.82], ['wipes,', 0.07], ['star wipes,', 0.01]] }],
  '3D': [{ s: '3', dist: [['3', 0.71], ['2.5', 0.12], ['4', 0.02]] }, { s: 'D', dist: [['D', 0.98], ['-ish', 0.01]] }],
  elements: [{ s: 'elements', dist: [['elements', 0.66], ['objects', 0.18], ['teapots', 0.02]] }],
  and: [{ s: 'and', dist: [['and', 0.86], ['plus', 0.06], ['but', 0.02]] }],
  seamless: [{ s: 'seamless', dist: [['seamless', 0.49], ['smooth', 0.22], ['sweeping', 0.12], ['nauseating', 0.02]] }],
  camera: [{ s: 'camera', dist: [['camera', 0.83], ['drone', 0.06], ['Steadicam', 0.04], ['crane', 0.03]] }],
  'movement."': [{ s: 'movement', dist: [['movement', 0.77], ['moves', 0.11], ['shake', 0.03], ['sickness', 0.01]] }, { s: '."', dist: [['."', 0.88], [', please."', 0.06], ['!!!"', 0.01]] }],
};
