import { existsSync } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import {
  AssetsSchema,
  BriefSchema,
  CaptureLogSchema,
  type CheckResult,
  LookSchema,
  PlanSchema,
  ScriptSchema,
  StepsSchema,
  TimingSchema,
} from '../contracts/types';
import { ContractError } from '../core/errors';
import { readJson } from '../core/json';

/** The run files checked when present, in report order, each with its schema. */
const CONTRACT_FILES: [string, z.ZodType][] = [
  ['brief.json', BriefSchema],
  ['script.json', ScriptSchema],
  ['plan.json', PlanSchema],
  ['assets.json', AssetsSchema],
  ['data/timing.json', TimingSchema],
  ['capture/steps.json', StepsSchema],
  ['capture/log.json', CaptureLogSchema],
  ['look/look.json', LookSchema],
  ['directions/A/look.json', LookSchema],
  ['directions/B/look.json', LookSchema],
];

/**
 * Parses every run file of the contract list that exists against its schema; returns a blocking CheckResult
 * with one annotation per file that is not valid JSON or breaks its schema. Never throws for a bad file.
 * When run from the scenes checks, `plan.json`, `brief.json` and `assets.json` are already parsed first, so a broken
 * copy of those throws `ContractError` before this check runs; it flags the other files.
 */
export const checkContractsValid = (runDir: string): CheckResult => {
  const annotations: CheckResult['annotations'] = [];
  let present = 0;
  for (const [rel, schema] of CONTRACT_FILES) {
    const file = path.join(runDir, rel);
    if (!existsSync(file)) continue;
    present += 1;
    try {
      readJson(file, schema);
    } catch (cause) {
      // readJson's ContractError message starts with the file path; the reason is the first line after it.
      // Any other error (EISDIR, EACCES) is a bad file too, so it gets the same annotation.
      const reason =
        cause instanceof ContractError
          ? (cause.message.slice(file.length).trim().split('\n')[0] ?? '')
          : (cause as Error).message;
      annotations.push({
        problem: `${rel}: ${reason}`,
        suggested_fix: 'write the file again through its CLI',
      });
    }
  }
  return {
    id: 'contracts.valid',
    blocking: true,
    status: annotations.length === 0 ? 'pass' : 'fail',
    detail: annotations.length === 0 ? `${present} file(s) valid` : `${annotations.length} file(s) not valid`,
    annotations,
  };
};
