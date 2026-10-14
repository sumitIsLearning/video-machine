import path from 'node:path';
import { runCli } from '../core/cli';
import { InputError } from '../core/errors';
import { writePanel } from './panel';
import { buildPool, isUnknownLicence, markAsset } from './pool';

const USAGE = 'usage: cli.ts build <run_dir> | mark <run_dir> <asset_id> <pin|drop|pool> | panel <run_dir>';
const STATUS = { pin: 'pinned', drop: 'dropped', pool: 'pool' } as const;

/**
 * Run one assets command: `build`, `mark` or `panel`.
 * Returns the fields of the CLI's JSON result. Throws InputError for a usage mistake or an unknown asset id.
 */
export const main = async (argv: string[], io: { cwd?: string } = {}): Promise<Record<string, unknown>> => {
  const [command, first, ...rest] = argv;
  const runDir = first === undefined ? undefined : path.resolve(io.cwd ?? process.cwd(), first);
  if (command === 'build' && runDir && rest.length === 0) {
    const { assets } = buildPool(runDir);
    const by_origin: Record<string, number> = {};
    for (const a of assets) by_origin[a.origin] = (by_origin[a.origin] ?? 0) + 1;
    return {
      assets: assets.length,
      by_origin,
      unknown_licence: assets.filter((a) => isUnknownLicence(a.license)).length,
    };
  }
  const [id, mark] = rest;
  if (command === 'mark' && runDir && id && mark && rest.length === 2 && mark in STATUS) {
    const status = STATUS[mark as keyof typeof STATUS];
    markAsset(runDir, id, status);
    return { asset_id: id, status };
  }
  if (command === 'panel' && runDir && rest.length === 0) return { panel: writePanel(runDir) };
  throw new InputError(USAGE);
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
