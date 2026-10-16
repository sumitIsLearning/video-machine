// Builds the browser helper (vm.ts) once and prefixes it with the data the page needs.

import path from 'node:path';
import { ToolError } from '../../../../core/errors';
import type { SceneTime } from '../../../../core/scene-times';

/** What the page's VM helper reads from window.VM_DATA. */
export type VmData = {
  format: { w: number; h: number; min_text_px: number; max_text_px: number };
  scenes: Record<string, SceneTime>;
};

const VM_ENTRY = path.join(import.meta.dir, 'vm.ts');
let bundleText: string | undefined;

// "<" and the two JS line separators can end a <script> element or break the page script, so the JSON
// text escapes them as \uXXXX (valid JSON, same value once parsed).
const SCRIPT_BREAKS = /[<\u2028\u2029]/g;
const escapeBreak = (c: string): string => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;

// Bundles vm.ts as an IIFE, once per process; throws ToolError when the build fails.
const buildVm = async (): Promise<string> => {
  const out = await Bun.build({ entrypoints: [VM_ENTRY], target: 'browser', format: 'iife' });
  const [artifact] = out.outputs;
  if (!out.success || !artifact) {
    throw new ToolError({
      cmd: ['bun', 'build', VM_ENTRY],
      code: null,
      stderr: out.logs.map(String).join('\n'),
    });
  }
  return artifact.text();
};

/** Returns the page script that sets window.VM_DATA and then the VM helper. Throws ToolError if the bundle fails. */
export async function vmScript(data: VmData): Promise<string> {
  bundleText ??= await buildVm();
  const json = JSON.stringify(data).replace(SCRIPT_BREAKS, escapeBreak);
  return `window.VM_DATA = ${json};\n${bundleText}`;
}
