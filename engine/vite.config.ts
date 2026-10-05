import { defineConfig, normalizePath, type Plugin } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';

// The run folder (VM_RUN) holds what one video needs: timeline.ts, its plates, audio/ and data/.
// The engine is shared; plates live outside it and import '../engine/*' as if they sat in src/.
if (!process.env.VM_RUN) throw new Error('VM_RUN is not set: point it at a run folder (timeline.ts, plates, audio/, data/)');
const runDir = path.resolve(process.env.VM_RUN);
if (!existsSync(path.join(runDir, 'timeline.ts'))) throw new Error(`VM_RUN has no timeline.ts: ${runDir}`);
const engineSrc = path.resolve(import.meta.dirname, 'src/engine');
const assetDirs = ['audio', 'data'];

// Serve the run's assets through Vite and copy them into builds (no symlinks, they break on Windows).
function runAssets(): Plugin {
  return {
    name: 'run-assets',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (assetDirs.some((dir) => req.url?.startsWith(`/${dir}/`))) {
          req.url = `/@fs/${encodeURI(normalizePath(runDir))}${req.url}`;
        }
        next();
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      for (const dir of assetDirs) {
        if (existsSync(path.join(runDir, dir))) cpSync(path.join(runDir, dir), path.join(options.dir, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [runAssets()],
  // PDOOM_NO_HMR=1: no live reload (export renders must not reload mid-run when a file changes)
  server: { port: 5173, strictPort: false, hmr: process.env.PDOOM_NO_HMR ? false : undefined, fs: { allow: [import.meta.dirname, runDir] } },
  resolve: {
    alias: [
      { find: '@run', replacement: normalizePath(runDir) },
      // plates import '../engine/x'; engine files themselves only use './x' and '../x', so this never matches them
      { find: /^\.\.\/engine\//, replacement: `${normalizePath(engineSrc)}/` },
    ],
    // plates outside the engine folder must resolve the engine's copy of three
    dedupe: ['three'],
  },
  build: { target: 'esnext', assetsInlineLimit: 0 },
});
