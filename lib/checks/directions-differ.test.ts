import { expect, test } from 'bun:test';
import { type Look, LookSchema } from '../contracts/types';
import { checkDirectionsDiffer } from './directions-differ';

const base: Look = LookSchema.parse({
  id: 'a',
  based_on: [],
  idea: 'i',
  palette: [{ name: 'ink', hex: '#111111', role: 'bg' }],
  type: [{ role: 'display', family: 'Inter', weights: [700], license: 'OFL' }],
  motion: { character: 'snappy', easings: ['power3.out'], typical_beat_s: [0.4, 0.8], camera: 'static' },
  motifs: [{ id: 'cursor', meaning: 'action' }],
  post: {},
  layout_rules: { landscape: '', vertical: '', square: '' },
});
const withPalette = (l: Look, hex: string): Look => ({ ...l, palette: [{ name: 'p', hex, role: 'bg' }] });
const withType = (l: Look, family: string): Look => ({ ...l, type: l.type.map((t) => ({ ...t, family })) });
const withMotion = (l: Look, character: string): Look => ({ ...l, motion: { ...l.motion, character } });
const withMotifs = (l: Look, id: string): Look => ({ ...l, motifs: [{ id, meaning: 'm' }] });

test('two differences pass, one fails', () => {
  expect(checkDirectionsDiffer(base, withType(withPalette(base, '#FF4D00'), 'Space Mono'), false).status).toBe('pass');
  const r = checkDirectionsDiffer(base, withPalette(base, '#ff4d00'), false);
  expect(r).toMatchObject({ id: 'look.directions_differ', blocking: true, status: 'fail' });
  expect(r.detail).toBe('A and B differ in 1 of palette, type, motion, motifs (palette); need 2');
});

test('hex and family compare case-insensitively', () => {
  const b = withType(withPalette(base, '#111111'.toUpperCase()), 'inter');
  expect(checkDirectionsDiffer(base, b, false).detail).toBe(
    'A and B differ in 0 of palette, type, motion, motifs (none); need 2',
  );
});

test('when the brand fixes palette or type, motion and motifs must both differ', () => {
  const paletteAndType = withType(withPalette(base, '#FF4D00'), 'Space Mono');
  expect(checkDirectionsDiffer(base, paletteAndType, true).status).toBe('fail');
  expect(checkDirectionsDiffer(base, withMotifs(withMotion(base, 'floaty'), 'grid'), true).status).toBe('pass');
});
