// Render adapter for the pdoom engine (engine/ at the workspace root): headless Chrome + WebGL → PNG / MP4.
// The run folder is handed to the engine as VM_RUN; the format's size as --w/--h. See engine/scripts/render.ts.
import path from 'node:path';
import { FORMATS, type FormatId, type LayerPass, type RenderAdapter } from '../../../contracts/types';

const WORKSPACE = path.resolve(import.meta.dir, '../../../../../..');
const ENGINE = path.join(WORKSPACE, 'engine');
// pinned bun: bun 1.3.x on Windows cannot launch Chrome through Playwright's pipe
const BUN = path.join(WORKSPACE, 'node_modules/.bin', process.platform === 'win32' ? 'bun.exe' : 'bun');

/** Run engine/scripts/render.ts for a run folder and format; throws with the tool's output on failure. */
function run(runDir: string, format: FormatId, args: string[]) {
  const { w, h } = FORMATS[format];
  const p = Bun.spawnSync([BUN, 'scripts/render.ts', ...args, '--w', String(w), '--h', String(h), '--strict'], {
    cwd: ENGINE, env: { ...process.env, VM_RUN: path.resolve(runDir) }, stdout: 'pipe', stderr: 'pipe',
  });
  const out = p.stdout.toString(), err = p.stderr.toString();
  if (p.exitCode !== 0) throw new Error(`pdoom render ${args[0]} (${format}) failed:\n${err || out}`);
  return out;
}

const notYet = (what: string, phase: number) => () => { throw new Error(`pdoom.${what}: not built yet (Phase ${phase})`); };

export const pdoom: RenderAdapter = {
  name: 'pdoom',
  // the engine draws at any size; whether a plate's layout suits the format is a check, not a capability
  supports: (format) => (format in FORMATS ? { ok: true } : { ok: false, reason: `unknown format ${format}` }),
  scaffold: notYet('scaffold', 1),
  plateApi: notYet('plateApi', 1),
  lint: notYet('lint', 2),

  still(runDir, format, t, only) {
    const out = path.join(runDir, 'out/stills', format);
    run(runDir, format, ['stills', '--t', t.join(','), '--out', out, ...(only?.length ? ['--only', only.join(',')] : [])]);
    // render.ts names stills f_<t padded>.png
    return t.map((x) => path.join(out, `f_${x.toFixed(2).padStart(7, '0')}.png`));
  },

  contactSheet(runDir, format, perPlate) {
    const out = path.join(runDir, 'out/sheets', `${format}.png`);
    run(runDir, format, ['sheet', '--per-plate', String(perPlate), '--cols', String(perPlate), '--out', out]);
    return out;
  },

  render(runDir, format, quality, passes?: LayerPass[]) {
    if (passes?.length) throw new Error('pdoom.render: layer passes are not supported yet (Phase 5)');
    const fps = String(FORMATS[format].fps);
    const out = path.join(runDir, 'out', quality === 'draft' ? 'drafts' : 'final', format, 'video.mp4');
    const q = quality === 'draft'
      ? ['--samples', '1', '--crf', '23', '--preset', 'veryfast']
      : ['--samples', 'auto', '--min-samples', '4', '--max-samples', '12', '--shutter', '0.5', '--crf', '17'];
    run(runDir, format, ['video', '--fps', fps, ...q, '--out', out]);
    return out;
  },
};

export default pdoom;