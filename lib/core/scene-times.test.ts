import { describe, expect, test } from 'bun:test';
import type { Plan, Timing } from '../contracts/types';
import { InputError, UnsupportedError } from './errors';
import { sceneTimes, TAIL_S } from './scene-times';

const w = (w: string, start: number, end: number) => ({ w, start, end });
const timing: Timing = {
  lines: [
    {
      id: 'l1',
      text: 'Meet Firecrawl today',
      start: 0.2,
      end: 1.4,
      words: [w('Meet', 0.2, 0.5), w('Firecrawl', 0.55, 1.1), w('today', 1.15, 1.4)],
    },
    {
      id: 'l2',
      text: 'Crawl any site',
      start: 1.8,
      end: 2.9,
      words: [w('Crawl', 1.8, 2.2), w('any', 2.25, 2.5), w('site', 2.55, 2.9)],
    },
    {
      id: 'l3',
      text: 'any site at all',
      start: 3.3,
      end: 4.5,
      words: [w('any', 3.3, 3.5), w('site', 3.55, 3.9), w('at', 3.95, 4.1), w('all', 4.15, 4.5)],
    },
  ],
};
const scene = (
  id: string,
  lines: string[],
  cut: Plan['visuals_plan']['scenes'][number]['cut_in'],
  beats: Plan['visuals_plan']['scenes'][number]['beats'] = [],
) => ({
  scene_id: id,
  lines,
  cut_in: cut,
  intent: 'x',
  beats,
  layout: { reel: 'x' },
  transition_out: 'cut',
  asset_ids: [],
  input_hash: 'h',
});
const plan = (scenes: ReturnType<typeof scene>[]): Plan => ({
  run_id: 'r',
  version: 1,
  look_id: 'a',
  visuals_plan: { scenes },
  asset_ids: [],
  formats: ['reel'],
});

describe('sceneTimes', () => {
  test('first scene starts at 0; pause_before cuts mid-gap; last ends TAIL_S after the last word', () => {
    const t = sceneTimes(
      plan([
        scene('hook', ['l1'], { anchor: 'Meet', rule: 'pause_before' }),
        scene('demo', ['l2', 'l3'], { anchor: 'Crawl', rule: 'pause_before' }),
      ]),
      timing,
    );
    expect(t.map((s) => [s.scene_id, s.start, s.duration])).toEqual([
      ['hook', 0, 1.6],
      ['demo', 1.6, 3.9],
    ]);
    expect(TAIL_S).toBe(1);
  });
  test('on_word cuts at the anchor word in the first line', () => {
    const t = sceneTimes(
      plan([
        scene('hook', ['l1'], { anchor: 'Meet', rule: 'pause_before' }),
        scene('demo', ['l2', 'l3'], { anchor: 'Crawl', rule: 'on_word' }),
      ]),
      timing,
    );
    expect(t[1]?.start).toBe(1.8);
  });
  test('beats are relative to the scene; nth counts across the scene lines', () => {
    const t = sceneTimes(
      plan([
        scene('hook', ['l1'], { anchor: 'Meet', rule: 'pause_before' }),
        scene('demo', ['l2', 'l3'], { anchor: 'Crawl', rule: 'pause_before' }, [
          { on: 'site', does: 'a' },
          { on: 'site', nth: 1, does: 'b', hold: true },
          { on: 'any site', does: 'c' },
        ]),
      ]),
      timing,
    );
    expect(t[1]?.beats).toEqual([
      { on: 'site', nth: 0, t: 0.95, hold: false },
      { on: 'site', nth: 1, t: 1.95, hold: true },
      { on: 'any site', nth: 0, t: 0.65, hold: false },
    ]);
    expect(t[1]?.words[0]).toEqual({ line: 'l2', w: 'Crawl', start: 0.2, end: 0.6 });
  });
  test('a beat word missing from the scene lines fails naming the scene', () => {
    expect(() =>
      sceneTimes(
        plan([
          scene('hook', ['l1', 'l2', 'l3'], { anchor: 'Meet', rule: 'pause_before' }, [{ on: 'zebra', does: 'x' }]),
        ]),
        timing,
      ),
    ).toThrow(/hook.*zebra/);
  });
  test('on_beat and beat:N are not supported yet', () => {
    expect(() =>
      sceneTimes(plan([scene('hook', ['l1', 'l2', 'l3'], { anchor: 'x', rule: 'on_beat' })]), timing),
    ).toThrow(UnsupportedError);
    expect(() =>
      sceneTimes(
        plan([
          scene('hook', ['l1', 'l2', 'l3'], { anchor: 'Meet', rule: 'pause_before' }, [{ on: 'beat:3', does: 'x' }]),
        ]),
        timing,
      ),
    ).toThrow(UnsupportedError);
  });
  test('a scene that would not start after the previous one fails', () => {
    const run = () =>
      sceneTimes(
        plan([
          scene('hook', ['l1'], { anchor: 'Meet', rule: 'pause_before' }),
          scene('demo', ['l2'], { anchor: 'Crawl', rule: 'on_word' }),
          scene('back', ['l1'], { anchor: 'Meet', rule: 'on_word' }),
        ]),
        timing,
      );
    expect(run).toThrow(InputError);
    expect(run).toThrow(/scene back: starts at 0.2s, not after/);
  });
});
