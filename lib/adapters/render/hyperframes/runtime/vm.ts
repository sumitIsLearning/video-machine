// Browser helper for scenes: looks up words and beats by content and fits text to its box.
// Bundled into the page by bundle.ts; it imports only fitPx and a type, so it runs without Node.

import { fitPx } from '../../../../core/fit-px';
import type { SceneTime } from '../../../../core/scene-times';

type VmData = {
  format: { w: number; h: number; min_text_px: number; max_text_px: number };
  scenes: Record<string, SceneTime>;
};

declare const window: { VM_DATA: VmData; VM?: unknown };

type Box = {
  style: { fontSize: string };
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
};

// Lower-case and drop punctuation so "Site," matches "site".
const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const scene = (id: string) => {
  const s = window.VM_DATA.scenes[id];
  if (!s) throw new Error(`VM: scene ${id}: not found`);
  const { words, beats } = s;

  // Start of the nth place where the phrase's words follow each other in the scene's word list.
  const at = (phrase: string, nth = 0): number => {
    const want = phrase.split(/\s+/).map(norm).filter(Boolean);
    // An empty phrase would match the first word silently; fail instead.
    if (want.length === 0) throw new Error(`VM: scene ${id}: no word "${phrase}"`);
    let seen = 0;
    for (let i = 0; i + want.length <= words.length; i++) {
      const hit = want.every((w, k) => norm(words[i + k]?.w ?? '') === w);
      if (!hit) continue;
      if (seen === nth) return words[i]?.start ?? 0;
      seen++;
    }
    throw new Error(`VM: scene ${id}: no word "${phrase}"`);
  };

  const beat = (i: number): number => {
    const b = beats[i];
    if (!b) throw new Error(`VM: scene ${id}: no beat ${i}`);
    return b.t;
  };

  // Sets the largest font size whose text stays inside the box, leaves it set and returns it.
  const fit = (el: Box, maxPx?: number): number => {
    const fits = (px: number): boolean => {
      el.style.fontSize = `${px}px`;
      return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
    };
    const size = fitPx(fits, window.VM_DATA.format.min_text_px, maxPx ?? window.VM_DATA.format.max_text_px);
    el.style.fontSize = `${size}px`;
    return size;
  };

  return { duration: s.duration, beats, words, at, beat, fit };
};

window.VM = { data: window.VM_DATA, scene };
