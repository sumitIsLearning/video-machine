import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ContractError } from './errors';
import { readJson, writeJson } from './json';

const Schema = z.object({ n: z.number(), tag: z.string().default('x') });
const tmp = () => mkdtempSync(path.join(tmpdir(), 'vm-'));

test('writeJson creates folders and writes 1-space JSON with LF and a trailing newline', () => {
  const f = path.join(tmp(), 'a', 'b.json');
  writeJson(f, Schema, { n: 1 });
  expect(readFileSync(f, 'utf8')).toBe('{\n "n": 1,\n "tag": "x"\n}\n');
});

test('writeJson refuses invalid data and writes nothing', () => {
  const f = path.join(tmp(), 'bad.json');
  expect(() => writeJson(f, Schema, { n: 'one' } as never)).toThrow(ContractError);
  expect(existsSync(f)).toBe(false);
});

test('readJson returns the parsed data with defaults applied', () => {
  const f = path.join(tmp(), 'ok.json');
  writeFileSync(f, '{"n": 2}');
  expect(readJson(f, Schema)).toEqual({ n: 2, tag: 'x' });
});

test('readJson parses a file that starts with a BOM', () => {
  const f = path.join(tmp(), 'bom.json');
  writeFileSync(f, '\u{FEFF}{"n": 3}');
  expect(readJson(f, Schema)).toEqual({ n: 3, tag: 'x' });
});

test('writeJson replaces an existing file and leaves no .tmp behind', () => {
  const dir = tmp();
  const f = path.join(dir, 'a.json');
  writeJson(f, Schema, { n: 1 });
  writeJson(f, Schema, { n: 2 });
  expect(readJson(f, Schema).n).toBe(2);
  expect(readdirSync(dir)).toEqual(['a.json']);
});

test('writeJson removes its .tmp file when the rename fails', () => {
  const dir = tmp();
  const f = path.join(dir, 'a.json');
  mkdirSync(f); // a folder at the target makes the rename fail
  expect(() => writeJson(f, Schema, { n: 1 })).toThrow();
  expect(readdirSync(dir)).toEqual(['a.json']);
});

test('readJson names the file when it does not match the schema', () => {
  const f = path.join(tmp(), 'wrong.json');
  writeFileSync(f, '{"n": "two"}');
  expect(() => readJson(f, Schema)).toThrow(ContractError);
  expect(() => readJson(f, Schema)).toThrow(f);
});

test('readJson turns malformed JSON into a ContractError that names the file and keeps the cause', () => {
  const f = path.join(tmp(), 'broken.json');
  writeFileSync(f, '{"n": ');
  let caught: unknown;
  try {
    readJson(f, Schema);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ContractError);
  expect((caught as Error).message).toContain(f);
  expect((caught as Error).message).toContain(((caught as Error).cause as Error).message);
  expect((caught as Error).cause).toBeInstanceOf(SyntaxError);
});
