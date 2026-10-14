import { expect, test } from 'bun:test';
import { ScriptSchema } from '../contracts/types';
import { checkFactsCited } from './facts-cited';

const S = 'https://www.firecrawl.dev/';
const script = (lines: object[]) => ScriptSchema.parse({ run_id: 'r', version: 1, lines });

test('passes when every line with a digit cites a URL from research.md', () => {
  const r = checkFactsCited(
    script([
      { id: 'l1', text: 'Paste a URL.' },
      { id: 'l2', text: '93% fewer tokens.', cite: [S] },
    ]),
    [S],
  );
  expect(r).toMatchObject({ id: 'script.facts_cited', blocking: true, status: 'pass', annotations: [] });
});

test('a digit in text, spoken or on_screen with no cite fails, naming the line', () => {
  const r = checkFactsCited(
    script([
      { id: 'l1', text: 'Fast.', on_screen: '3.4 s' },
      { id: 'l2', text: 'Ninety three percent', spoken: 'ninety 3' },
    ]),
    [S],
  );
  expect(r.status).toBe('fail');
  expect(r.annotations.map((a) => a.problem)).toEqual([
    'line l1 states a number but has no cite',
    'line l2 states a number but has no cite',
  ]);
});

test('a cite that research.md does not list fails', () => {
  const r = checkFactsCited(script([{ id: 'l1', text: '1,000 credits', cite: ['https://elsewhere.example/'] }]), [S]);
  expect(r.status).toBe('fail');
  expect(r.annotations[0]?.problem).toBe('line l1 cites https://elsewhere.example/, which research.md does not list');
});
