// PIPELINE — "So instead of: After Effects → layers → keyframes → graph editor → render, you’re
// essentially doing: Prompt → code → render → video."
// The paper plate (bone paper, ink, orange accents). FORM 2-B, a process chart:
//   1. CURRENT PROCESS — five boxes; each name is typewritten into its box as it is said, and the
//      pen draws each arrow on its "to". Fine print counts the keyframes (by hand). After "render"
//      an orange marker strikes the whole row.
//   2. PROPOSED PROCESS — four boxes, typed the same way; on "video." the NO KEYFRAMES stamp slams.
// A restless document camera reads along the rows.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { rgba } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import { type Line, type Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, pulse, mulberry32 } from '../engine/util';
import { Plot, Cam2D, w2s, setWorld, label, mixCss, lineOf, wordOf, pt, type P, type Cam } from './_vo';

const PAPER = /* glsl */ `
uniform vec4 uCam; uniform vec2 uRes;
void main() {
  vec2 sp = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 d = sp - 0.5 * uRes;
  float c = cos(-uCam.w), s = sin(-uCam.w);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / uCam.z;
  vec2 p = uCam.xy + d;                       // world px on the page
  vec3 col = C_BONE * 0.965;
  // fibres: long thin streaks of slightly darker pulp, and a soft cloudy formation
  float f = fbm(vec2(p.x * 0.004, p.y * 0.05), 4);
  float cloud = fbm(p * 0.0025 + 3.0, 4);
  col *= 1.0 - 0.035 * f - 0.03 * cloud;
  col *= 1.0 - 0.05 * smoothstep(0.6, 1.0, snoise(p * 0.08)) * 0.5;
  // a faint grid printed on the form (light blue would be off-palette: graphite at 6%)
  vec2 g = abs(fract(p / 24.0 + 0.5) - 0.5) * 24.0 * uCam.z;
  float gl = max(1.0 - smoothstep(0.0, 1.0, g.x), 1.0 - smoothstep(0.0, 1.0, g.y));
  col = mix(col, C_GRAPHITE, 0.035 * gl);
  fragColor = vec4(col, 1.0);
}`;

interface Box { x: number; y: number; w: number; h: number; word: Word; text: string; note?: string }

export default class Pipeline extends Scene {
  paper = new FSPass(PAPER, { uCam: { value: [0, 0, 1, 0] }, uRes: { value: [W, H] } });
  plot = new Plot();
  cam = new Cam2D();
  lines = new LineBatch(30000, { blend: 'normal' });
  ui = new Layer2D();
  L11!: Line; L12!: Line;
  w: Record<string, Word> = {};
  row1: Box[] = []; row2: Box[] = [];
  arrows1: Word[] = []; arrows2: Word[] = [];
  stamp!: HTMLCanvasElement;
  tStrike = 0; tStamp = 0;

  override init() {
    const ly = this.ctx.lyrics;
    this.L11 = lineOf(ly, 'So instead of');
    this.L12 = lineOf(ly, 'essentially doing');
    const w = this.w, L11 = this.L11, L12 = this.L12;
    for (const [k, q] of [['so', 'So'], ['instead', 'instead'], ['of', 'of:'], ['after', 'After'], ['effects', 'Effects'], ['layers', 'layers'], ['keyframes', 'keyframes'], ['graph', 'graph'], ['editor', 'editor'], ['render', 'render']] as const) w[k] = wordOf(L11, q);
    for (const [k, q] of [['youre', 'you’re'], ['essentially', 'essentially'], ['doing', 'doing:'], ['prompt', 'Prompt'], ['code', 'code'], ['render2', 'render'], ['video', 'video']] as const) w[k] = wordOf(L12, q);
    this.arrows1 = L11.words.filter((x) => x.w === '→');
    this.arrows2 = L12.words.filter((x) => x.w === '→');
    this.plot.paper = true;
    // row 1
    const y1 = -150, bh = 116;
    const r1: [Word, string, string?][] = [[w.after!, 'After Effects'], [w.layers!, 'layers', '× 14'], [w.keyframes!, 'keyframes', '× 412, by hand'], [w.graph!, 'graph editor', 'drag, nudge, repeat'], [w.render!, 'render']];
    const bw1 = 262, ag1 = 64, x01 = -(5 * bw1 + 4 * ag1) / 2;
    r1.forEach(([wd, txt, note], i) => this.row1.push({ x: x01 + i * (bw1 + ag1), y: y1, w: bw1, h: bh, word: wd, text: txt, note }));
    // the graph editor box is said in two words: it types across both
    // row 2
    const y2 = 170;
    const r2: [Word, string, string?][] = [[w.prompt!, 'Prompt', 'words'], [w.code!, 'code', 'written by Claude'], [w.render2!, 'render', 'same render'], [w.video!, 'video', '.mp4']];
    const bw2 = 300, ag2 = 92, x02 = -(4 * bw2 + 3 * ag2) / 2;
    r2.forEach(([wd, txt, note], i) => this.row2.push({ x: x02 + i * (bw2 + ag2), y: y2, w: bw2, h: bh, word: wd, text: txt, note }));
    // arrows: drawn by the pen on each "to"
    const arrow = (a: Box, b: Box, wd: Word, g: string) => {
      const y = a.y + a.h / 2;
      const x0 = a.x + a.w + 10, x1 = b.x - 10;
      this.plot.add([pt(x0, y), pt(x1, y)], wd.start, wd.start + 0.16, 'ink', { pen: true, ez: ease.inOutQuad, width: 2.2, group: g });
      this.plot.add([pt(x1 - 14, y - 8), pt(x1, y), pt(x1 - 14, y + 8)], wd.start + 0.15, wd.start + 0.22, 'ink', { pen: true, width: 2.2, group: g });
    };
    this.arrows1.forEach((wd, i) => arrow(this.row1[i]!, this.row1[i + 1]!, wd, 'r1'));
    this.arrows2.forEach((wd, i) => arrow(this.row2[i]!, this.row2[i + 1]!, wd, 'r2'));
    // the orange marker strike through row 1, wobbling like a hand
    this.tStrike = w.render!.end + 0.04;
    const pts: P[] = [];
    const xa = x01 - 40, xb = x01 + 5 * bw1 + 4 * ag1 + 40;
    for (let i = 0; i <= 80; i++) { const u = i / 80; pts.push(pt(lerp(xa, xb, u), y1 + bh / 2 + 6 * Math.sin(u * 9.3) + 5 * noise1(u * 13, 4) - 10 * u)); }
    this.plot.add(pts, this.tStrike, this.tStrike + 0.3, 'signal', { pen: true, ez: ease.inOutQuad, width: 12, group: 'strike' });
    this.tStamp = w.video!.start + 0.05;
    this.stamp = this.makeStamp();
    // camera: reads along the rows
    const K = this.cam;
    const b = (r: Box[], i: number) => r[Math.min(i, r.length - 1)]!;
    K.key(this.ctx.start, -380, -260, 1.12, -0.02);
    K.key(w.instead!.start, -340, -230, 1.14, -0.018, ease.linear);
    K.key(w.after!.start + 0.15, b(this.row1, 0).x + 300, y1 + 20, 1.3, -0.012, ease.outExpo);
    K.key(w.keyframes!.start + 0.1, b(this.row1, 2).x + 120, y1 + 30, 1.32, 0.006, ease.inOutCubic);
    K.key(w.editor!.start + 0.1, b(this.row1, 3).x + 160, y1 + 30, 1.3, 0.012, ease.inOutCubic);
    K.key(this.tStrike, 0, -80, 0.95, 0.01, ease.inOutCubic);
    K.key(this.tStrike + 0.35, 0, -70, 0.96, 0.008, ease.linear);
    K.key(w.prompt!.start + 0.1, b(this.row2, 0).x + 340, y2 + 10, 1.25, -0.01, ease.inOutCubic);
    K.key(w.render2!.start, b(this.row2, 2).x - 40, y2 + 20, 1.25, 0.004, ease.inOutCubic);
    K.key(this.tStamp + 0.05, 20, 60, 0.93, -0.006, ease.outExpo);
    K.key(this.ctx.end, 20, 60, 0.95, -0.008, ease.linear);
  }

  makeStamp() {
    const cv = document.createElement('canvas');
    const SW = 1400, SH = 340;
    cv.width = SW; cv.height = SH;
    const c = cv.getContext('2d')!;
    const col = '#FF4D12';
    c.strokeStyle = col; c.fillStyle = col;
    c.lineWidth = 12; c.strokeRect(16, 16, SW - 32, SH - 32);
    c.lineWidth = 4; c.strokeRect(40, 40, SW - 80, SH - 80);
    const fam = F.archivo(100, 900);
    const fs = Math.min(170, (150 * (SW - 180)) / measure('NO KEYFRAMES', fam, 150));
    c.font = font(fam, fs);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText('NO KEYFRAMES', SW / 2, 236);
    c.font = font(F.mono(500), 28);
    (c as any).letterSpacing = '9px';
    c.fillText('APPROVED · DEPT. OF PROCEDURES', SW / 2, 290);
    c.fillText('PROCESS 2-B', SW / 2, 88);
    // knock out ink: speckles and dry streaks
    c.globalCompositeOperation = 'destination-out';
    const r = mulberry32(7);
    for (let i = 0; i < 3600; i++) { c.globalAlpha = 0.25 + 0.75 * r(); c.beginPath(); c.arc(r() * SW, r() * SH, 0.6 + r() * 2.4, 0, 6.3); c.fill(); }
    for (let i = 0; i < 34; i++) { c.globalAlpha = 0.18 * r(); c.fillRect(r() * SW, r() * SH, 60 + r() * 300, 2 + r() * 5); }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    return cv;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, w = this.w;
    const c = this.cam.at(t);
    // a restless hand-held page
    const cc: Cam = { cx: c.cx + 6 * noise1(t * 0.7, 1), cy: c.cy + 5 * noise1(t * 0.6, 2), z: c.z, roll: c.roll + 0.004 * noise1(t * 0.5, 3) };
    (this.paper.u.uCam!.value as number[]).splice(0, 4, cc.cx, cc.cy, cc.z, cc.roll);
    this.paper.render(renderer, out);
    const U = this.ui; U.clear();
    const ctx = U.ctx;
    this.drawForm(ctx, t, cc);
    comp.draw(renderer, U.upload(), out);
    const L = this.lines; L.clear();
    this.plot.draw(t, cc, L);
    L.render(renderer, out);
    // the stamp, over everything
    const U2 = this.ui; U2.clear();
    this.drawStamp(U2.ctx, t, cc);
    comp.draw(renderer, U2.upload(), out);
    const slam = pulse(t, this.tStamp, 0.07);
    return {
      bloom: 0.15, bloomThreshold: 1.4, vignette: 0.28, grain: 0.04, halation: 0.05, ca: 0.6, paper: 1,
      zoom: 1 + 0.025 * slam + 0.01 * pulse(t, this.tStrike, 0.1), shake: [7 * slam * noise1(t * 60, 1), 7 * slam * noise1(t * 60, 2)],
    };
  }

  drawForm(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const t0 = this.ctx.start;
    // header band
    setWorld(ctx, c, -860, -470);
    ctx.fillStyle = rgba('ink', 0.94);
    ctx.fillRect(0, 0, 1720, 104);
    ctx.font = font(F.archivo(112.5, 900), 64);
    ctx.fillStyle = rgba('bone', 0.97);
    ctx.fillText('FORM 2-B', 34, 76);
    label(ctx, 'PRODUCTION PIPELINE, MOTION GRAPHICS', 470, 44, { size: 19, col: rgba('bone', 0.95), spacing: 5 });
    label(ctx, 'REVISED EDITION   ·   FOLLOW THE ARROWS', 470, 76, { size: 14, col: rgba('bone', 0.75), spacing: 5 });
    // rule lines and section titles
    ctx.fillStyle = rgba('ink', 0.85);
    ctx.fillRect(0, 150, 1720, 1.6 / c.z);
    label(ctx, 'ISSUED BY', 0, 136, { size: 12, col: rgba('ink', 0.6), spacing: 3 });
    label(ctx, 'DEPT. OF PROCEDURES', 120, 136, { size: 14, col: rgba('ink', 0.85), spacing: 3 });
    label(ctx, 'REF.  2B-0092/∞', 1720, 136, { size: 14, col: rgba('ink', 0.85), spacing: 3, align: 'right' });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // section labels with typed answers
    const sec = (n: string, title: string, x: number, y: number, words: Word[], typed: string) => {
      setWorld(ctx, c, x, y);
      label(ctx, n, 0, 0, { size: 17, col: rgba('ink', 0.9), spacing: 3, weight: 600 });
      label(ctx, title, 40, 0, { size: 17, col: rgba('ink', 0.9), spacing: 3, weight: 600 });
      // the typed answer: chars appear as the words are said
      ctx.font = font(F.mono(400), 30);
      let x0 = 440;
      const all = typed.split(' ');
      all.forEach((wordTxt, i) => {
        const wd = words[i]!;
        const n2 = Math.ceil(wordTxt.length * clamp((t - wd.start) / Math.max(0.1, (wd.end - wd.start) * 0.8)));
        if (n2 > 0) {
          const hot = Lyrics_hot(t, wd);
          for (let k = 0; k < Math.min(n2, wordTxt.length); k++) {
            const jy = (hash(i, k, 3) - 0.5) * 1.6;
            ctx.fillStyle = hot > 0 ? mixCss('signal', 'ink', 1 - hot, 0.92) : rgba('ink', 0.88);
            ctx.fillText(wordTxt[k]!, x0 + measure(wordTxt.slice(0, k), F.mono(400), 30), jy);
          }
        }
        x0 += measure(wordTxt + ' ', F.mono(400), 30);
      });
      ctx.fillStyle = rgba('ink', 0.5);
      ctx.fillRect(430, 12, 1150, 1.2 / c.z);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    sec('1.', 'CURRENT PROCESS', -860, -230, [w.so!, w.instead!, w.of!], 'So instead of:');
    sec('2.', 'PROPOSED PROCESS', -860, 90, [w.youre!, w.essentially!, w.doing!], "you're essentially doing:");
    // the boxes
    const box = (b: Box, i: number, row: number) => {
      const shown = t >= b.word.start - 0.25;
      if (!shown) return;
      const a = prog(t, b.word.start - 0.25, b.word.start - 0.05);
      setWorld(ctx, c, b.x, b.y);
      ctx.strokeStyle = rgba('ink', 0.85 * a);
      ctx.lineWidth = (row === 2 ? 2.4 : 1.6) / c.z;
      ctx.strokeRect(0, 0, b.w, b.h);
      label(ctx, `${row}.${i + 1}`, 10, -10, { size: 12, col: rgba(row === 2 ? 'blood' : 'ink', 0.75 * a), spacing: 2 });
      // the name, typewritten as it is said (the graph editor spans "graph" and "editor")
      const end = b.text === 'graph editor' ? w.editor!.end : b.text === 'After Effects' ? w.effects!.end : b.word.end;
      const n = Math.ceil(b.text.length * clamp((t - b.word.start) / Math.max(0.12, (end - b.word.start) * 0.85)));
      ctx.font = font(F.mono(500), row === 2 ? 36 : 30);
      const tw = measure(b.text, F.mono(500), row === 2 ? 36 : 30);
      const hot = pulse(t, b.word.start, 0.25);
      ctx.fillStyle = row === 2 && b.text === 'video' && t > this.tStamp ? rgba('blood', 0.95) : hot > 0.05 ? mixCss('signal', 'ink', 1 - hot, 0.95) : rgba('ink', 0.92);
      ctx.fillText(b.text.slice(0, n), (b.w - tw) / 2, b.h / 2 + 11);
      if (b.note && n >= b.text.length) {
        ctx.font = font(F.mono(400), 15);
        ctx.fillStyle = rgba('graphite', 0.95);
        ctx.textAlign = 'center';
        ctx.fillText(b.note, b.w / 2, b.h + 28);
        ctx.textAlign = 'left';
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    this.row1.forEach((b, i) => box(b, i, 1));
    this.row2.forEach((b, i) => box(b, i, 2));
    // totals in the margin
    const tot = (x: number, y: number, s: string, t1: number, col = 'ink') => {
      if (t < t1) return;
      setWorld(ctx, c, x, y);
      ctx.font = font(F.mono(500), 18);
      ctx.fillStyle = rgba(col, 0.9 * prog(t, t1, t1 + 0.2));
      ctx.textAlign = 'right';
      ctx.fillText(s, 0, 0);
      ctx.textAlign = 'left';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    tot(860, -6, 'STEPS 5 · KEYFRAMES 412', this.tStrike + 0.2);
    tot(860, 316, 'STEPS 4 · KEYFRAMES 0', this.tStamp + 0.25, 'blood');
    // fine print
    setWorld(ctx, c, -860, 530);
    ctx.fillStyle = rgba('ink', 0.6);
    ctx.fillRect(0, -30, 1720, 1.2 / c.z);
    ctx.font = font(F.mono(400), 15);
    ctx.fillStyle = rgba('ink', 0.75);
    ctx.fillText('* “render” appears in both processes. It is the same render. Do not detach.', 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    void t0;
  }

  drawStamp(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    if (t < this.tStamp) return;
    const age = t - this.tStamp;
    const sc = 1 + 0.6 * (1 - ease.outExpo(clamp(age / 0.12)));
    const a = clamp(age / 0.05);
    const [sx, sy] = w2s(c, 160, 395);
    const k = c.z * 0.44 * sc;
    const rot = -0.07 + c.roll;
    ctx.setTransform(k * Math.cos(rot), k * Math.sin(rot), -k * Math.sin(rot), k * Math.cos(rot), sx, sy);
    ctx.globalAlpha = 0.92 * a;
    ctx.drawImage(this.stamp, -700, -170, 1400, 340);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/** Typed text is hot (signal) while its word is being said, cooling after. */
function Lyrics_hot(t: number, w: Word) {
  if (t < w.start) return 0;
  if (t < w.end) return 1;
  return 1 - clamp((t - w.end) / 0.35);
}
