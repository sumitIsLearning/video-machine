import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderBoard } from '../adapters/render/hyperframes/compose';
import { checkDirectionsDiffer } from '../checks/directions-differ';
import {
  type BoardId,
  BoardIdSchema,
  type Brief,
  BriefSchema,
  type CheckResult,
  type DirectionId,
  type Look,
  LookSchema,
} from '../contracts/types';
import { presetBox } from '../core/avatar';
import type { Deps } from '../core/deps';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { assertRunDir } from '../core/paths';
import { writeLooksPage } from './page';

const DIRECTIONS: DirectionId[] = ['A', 'B'];

const brandFixed = (brand: Brief['brand']): boolean =>
  (brand?.colors?.length ?? 0) > 0 || (brand?.fonts?.length ?? 0) > 0;

/**
 * Store a direction's look.json (validated) and LOOK.md under directions/<dir>/. Returns the run-relative paths.
 * Throws InputError when the LOOK.md text is empty and ContractError when the look is invalid; nothing is written then
 * for a bad look (writeJson validates first).
 */
export function writeLook(runDir: string, dir: DirectionId, input: unknown): { look: string; md: string } {
  assertRunDir(runDir);
  const { look, md } = (input ?? {}) as Partial<{ look: Look; md: string }>;
  if (typeof md !== 'string' || md.trim() === '') throw new InputError('LOOK.md text is empty');
  const base = `directions/${dir}`;
  writeJson(path.join(runDir, base, 'look.json'), LookSchema, look as Look);
  writeFileSync(path.join(runDir, base, 'LOOK.md'), md);
  return { look: `${base}/look.json`, md: `${base}/LOOK.md` };
}

/**
 * Render one board of a direction to directions/<dir>/boards/<board>.png. The composition folder stays on disk for
 * Claude to fix. Returns the run-relative png and the lint warnings. Throws InputError when the direction has no look
 * yet, when lint reports errors, or when an asset cannot render; ToolError when HyperFrames fails.
 */
export async function writeBoard(
  deps: Deps,
  runDir: string,
  dir: DirectionId,
  board: BoardId,
  html: string,
  assetIds: string[],
  at: number,
): Promise<{ png: string; warnings: string[] }> {
  const base = `directions/${dir}`;
  if (!existsSync(path.join(runDir, base, 'look.json'))) throw new InputError(`write look ${dir} first`);
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const box = brief.layout?.kind === 'stack' ? presetBox('stack', 'reel', brief.layout.split) : undefined;
  const band = box && { x: box.x, y: box.y, w: box.w, h: box.h };
  return renderBoard(
    deps,
    runDir,
    `${base}/boards/${board}`,
    html,
    assetIds,
    at,
    `board ${dir}/${board}`,
    `${base}/boards/${board}.png`,
    band,
  );
}

/**
 * Compare the two directions, write out/looks.html, and return the check, the boards not rendered yet (as
 * 'A/hook' style names) and the page path. Throws InputError when a look is missing or the directions are too alike;
 * the page is written first either way.
 */
export function compareLooks(runDir: string): { check: CheckResult; missing_boards: string[]; page: string } {
  assertRunDir(runDir);
  const aFile = path.join(runDir, 'directions/A/look.json');
  const bFile = path.join(runDir, 'directions/B/look.json');
  if (!existsSync(aFile) || !existsSync(bFile)) throw new InputError('write look A and look B first');
  const a = readJson(aFile, LookSchema);
  const b = readJson(bFile, LookSchema);
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const check = checkDirectionsDiffer(a, b, brandFixed(brief.brand));
  const missing_boards = DIRECTIONS.flatMap((dir) =>
    BoardIdSchema.options
      .filter((board) => !existsSync(boardPng(runDir, dir, board)))
      .map((board) => `${dir}/${board}`),
  );
  const page = writeLooksPage(runDir, a, b, check);
  if (check.status === 'fail') throw new InputError(check.detail);
  return { check, missing_boards, page };
}

/**
 * Copy the picked direction's look.json and LOOK.md into look/. Throws InputError when the comparison fails or the
 * direction's three boards are not all rendered. Returns the run-relative look path and the look id.
 */
export function pickLook(runDir: string, dir: DirectionId): { look: string; id: string } {
  assertRunDir(runDir);
  compareLooks(runDir);
  const missing = BoardIdSchema.options.filter((board) => !existsSync(boardPng(runDir, dir, board)));
  if (missing.length) throw new InputError(`direction ${dir} is missing boards: ${missing.join(', ')}`);
  const base = `directions/${dir}`;
  const look = readJson(path.join(runDir, base, 'look.json'), LookSchema);
  if (!existsSync(path.join(runDir, base, 'LOOK.md'))) throw new InputError(`direction ${dir} has no LOOK.md`);
  writeJson(path.join(runDir, 'look', 'look.json'), LookSchema, look);
  copyFileSync(path.join(runDir, base, 'LOOK.md'), path.join(runDir, 'look', 'LOOK.md'));
  return { look: 'look/look.json', id: look.id };
}

const boardPng = (runDir: string, dir: DirectionId, board: BoardId): string =>
  path.join(runDir, `directions/${dir}/boards/${board}.png`);
