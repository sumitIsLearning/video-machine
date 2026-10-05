// PROMPT — "For example: “Create a 15-second cinematic motion graphics sequence with kinetic
// typography, smooth shape transitions, 3D elements and seamless camera movement.”"
// The original's prompt idiom, for a long prompt: a thin field in a dark stage; the prompt is typed
// as tokens exactly on the said words, each with a tiny next-token distribution flickering above
// it (deadpan candidates); the camera follows the caret. Behind the field a faint engraved 3D stage
// previews what is being described: a floor grid that starts to dolly on "cinematic", stroke
// letters that jump on "kinetic typography", a shape that morphs on "smooth shape transitions",
// wireframe solids on "3D elements", and an orbit on "seamless camera movement". ⏎ sends it, and the
// field rushes at the camera into the next plate.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font, measure, plain } from '../engine/type';
import { strokeText, type StrokeText } from '../engine/stroke';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, pulse, TAU, frameIdx } from '../engine/util';
import { sparkHead, sparkParticles } from './_motifs';
import { drawKaraoke, placeRow, lineOf, wordOf, label, triangle, returnArrow, mixCss, type KWord, type Cam } from './_vo';
import { SPECS, type Cand } from './prompt-data';

interface Tok {
  text: string; row: number; col: number; n: number; space: boolean; t0: number; word: Word; first: boolean;
  dist: Cand[] | null; pick: number; id: number; tPopEnd: number;
}
interface Shot { t: number; zoom: number; focus: 'caret' | 'field' | 'top'; rot: number; push: number; blend?: number }

const FS = 50; // token font size (UI px)
const LH = 76; // line height
const POP_PRE = 0.16;

export default class Prompt extends Scene {
  ui = new Layer2D();
  glow = new LineBatch(4000);
  stage = new LineBatch(40000, { screen2D: false, blend: 'add' });
  cam3 = new THREE.PerspectiveCamera(34, W / H, 0.1, 500);
  line!: Line; lead!: Line;
  toks: Tok[] = [];
  kw: KWord[] = [];
  adv = 30;
  fam = F.mono(400);
  cols = 44;
  rows = 1;
  fx0 = 0; fx1 = 0; fy0 = 0; fy1 = 0; tx0 = 0; keyX = 0;
  tFirst = 0; tLast = 0; tEnter = 0; tEnd = 0;
  shots: Shot[] = [];
  w: Record<string, Word> = {};
  kin!: StrokeText;

  override init() {
    const { lyrics, end } = this.ctx;
    this.tEnd = end;
    this.lead = lineOf(lyrics, 'For example');
    this.line = lineOf(lyrics, 'Create a 15-second');
    const words = this.line.words;
    for (const [k, q] of [['cinematic', 'cinematic'], ['kinetic', 'kinetic'], ['typography', 'typography'], ['smooth', 'smooth'], ['shape', 'shape'], ['transitions', 'transitions'],
      ['3d', '3D'], ['elements', 'elements'], ['seamless', 'seamless'], ['camera', 'camera'], ['movement', 'movement']] as const) this.w[k] = wordOf(this.line, q);
    this.adv = measure('0', this.fam, FS);
    // tokens, wrapped by word into rows
    let row = 0, col = 0;
    words.forEach((w, wi) => {
      const typed = plain(w.w);
      let pieces = SPECS[typed];
      if (!pieces || pieces.map((p) => p.s).join('') !== typed) pieces = [{ s: typed, dist: [[typed, 0.5], ['…', 0.12]] }];
      if (col > 0 && col + 1 + typed.length > this.cols) { row++; col = 0; }
      const space = col > 0;
      if (space) col++;
      const syl = w.syl && w.syl.length === pieces.length ? w.syl : null;
      let off = 0;
      pieces.forEach((p, pi) => {
        const t0 = pi === 0 ? w.start : syl ? syl[pi]![0] : w.start + pi * Math.min(0.1, (w.end - w.start) / pieces!.length);
        this.toks.push({ text: p.s, row, col: col + off, n: p.s.length, space: space && pi === 0, t0, word: w, first: pi === 0, dist: p.dist ?? null, pick: p.pick ?? 0, id: 1000 + Math.floor(hash(wi, pi, 9) * 98000), tPopEnd: 0 });
        off += p.s.length;
      });
      col += typed.length;
    });
    this.rows = row + 1;
    this.toks.forEach((k, i) => {
      const next = this.toks[i + 1];
      k.tPopEnd = Math.max(k.t0 + 0.2, Math.min(k.t0 + 0.6, next ? next.t0 - POP_PRE - 0.08 : k.t0 + 0.6));
    });
    this.tFirst = words[0]!.start;
    this.tLast = words[words.length - 1]!.start;
    this.tEnter = Math.min(end - 0.3, words[words.length - 1]!.end + 0.06);
    for (const k of this.toks) k.tPopEnd = Math.min(k.tPopEnd, Math.max(k.t0 + 0.12, this.tEnter - 0.16));
    // layout: the field centred
    const textW = this.adv * this.cols;
    const padL = 100, padR = 150;
    const fw = textW + padL + padR;
    this.fx0 = (W - fw) / 2; this.fx1 = this.fx0 + fw;
    const fh = this.rows * LH + 46;
    this.fy0 = 560 - fh / 2; this.fy1 = this.fy0 + fh;
    this.tx0 = this.fx0 + padL;
    this.keyX = this.fx1 - 76;
    // "For example:" above the field
    this.kw.push(...placeRow(this.lead.words, this.fx0, this.fy0 - 58, 62, F.archivo(100, 700), 'lead', { ant: 0.2 }).words);
    this.shots = this.makeShots();
    this.kin = strokeText('kinetic', 'tech', 100);
  }

  baseY(row: number) { return this.fy0 + 64 + row * LH; }

  // ------------------------------------------------------------------ camera (UI space)
  makeShots(): Shot[] {
    const s = this.ctx.start, w = this.w;
    return [
      { t: s, zoom: 1.12, focus: 'top', rot: 0, push: 0.02 },
      { t: this.tFirst - 0.05, zoom: 1.55, focus: 'caret', rot: 0, push: 0.02, blend: 0.3 },
      { t: w.cinematic!.start, zoom: 1.75, focus: 'caret', rot: -0.012, push: 0.03 },
      { t: w.kinetic!.start, zoom: 1.45, focus: 'caret', rot: 0.01, push: 0.03 },
      { t: w.smooth!.start, zoom: 1.7, focus: 'caret', rot: -0.008, push: 0.02 },
      { t: w['3d']!.start, zoom: 1.4, focus: 'caret', rot: 0.012, push: 0.03 },
      { t: w.seamless!.start, zoom: 0.94, focus: 'field', rot: 0, push: 0.04, blend: 0.9 },
      { t: this.tEnter, zoom: 1.0, focus: 'field', rot: 0, push: 0 },
    ];
  }
  caretPos(t: number, smooth: number): { x: number; y: number } {
    let x = this.tx0, y = this.baseY(0);
    for (const k of this.toks) {
      if (k.t0 > t) break;
      const target = this.tx0 + (k.col + k.n) * this.adv;
      const before = this.tx0 + (k.col - (k.space ? 1 : 0)) * this.adv;
      y = this.baseY(k.row);
      x = smooth > 0 ? lerp(before, target, ease.outExpo(clamp((t - k.t0) / smooth))) : target;
    }
    return { x, y };
  }
  focusOf(sh: Shot, t: number, z: number) {
    const fcy = (this.fy0 + this.fy1) / 2;
    if (sh.focus === 'caret') {
      // a trailing average of the caret (a pure function of t): line breaks become a glide, not a jump
      let x = 0, y = 0;
      for (let i = 0; i < 10; i++) { const q = this.caretPos(t - i * 0.04, 0.3); x += q.x; y += q.y; }
      return { x: x / 10 - 160 / z, y: y / 10 + 40 / z };
    }
    if (sh.focus === 'top') return { x: W / 2, y: fcy - 60 };
    return { x: W / 2, y: fcy + 10 };
  }
  camAt(t: number): Cam {
    const sh = this.shots;
    let i = 0;
    while (i + 1 < sh.length && sh[i + 1]!.t <= t) i++;
    const ev = (s: Shot) => { const z = s.zoom * (1 + s.push * Math.max(0, t - s.t)); const f = this.focusOf(s, t, z); return { cx: f.x, cy: f.y, z, roll: s.rot }; };
    const cur = ev(sh[i]!), s = sh[i]!;
    if (s.blend && i > 0) {
      const k = ease.inOutCubic(clamp((t - s.t) / s.blend));
      const p = ev(sh[i - 1]!);
      return { cx: lerp(p.cx, cur.cx, k), cy: lerp(p.cy, cur.cy, k), z: Math.exp(lerp(Math.log(p.z), Math.log(cur.z), k)), roll: lerp(p.roll, cur.roll, k) };
    }
    return cur;
  }

  // ------------------------------------------------------------------ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    const cam = this.camAt(t);
    let kick = 0;
    for (const k of this.toks) if (k.first) kick = Math.max(kick, k.t0 <= t ? Math.pow(0.5, (t - k.t0) / 0.07) : 0);
    let zoom = cam.z * (1 + 0.01 * kick), rot = cam.roll, cx = cam.cx, cy = cam.cy;
    // ⏎: the field rushes at the camera
    const rk = prog(t, this.tEnter + 0.04, this.tEnd - 0.02);
    const rush = ease.inQuart(rk);
    const toKey = ease.outCubic(prog(t, this.tEnter, this.tEnter + 0.22));
    zoom = Math.exp(lerp(Math.log(zoom), Math.log(48), rush));
    cx = lerp(cx, this.keyX, toKey); cy = lerp(cy, (this.fy0 + this.fy1) / 2, toKey);
    rot *= 1 - toKey;

    // ---- the stage (3D, behind)
    renderer.setRenderTarget(out);
    renderer.setClearColor(new THREE.Color().setRGB(LIN.ink[0], LIN.ink[1], LIN.ink[2], THREE.LinearSRGBColorSpace), 1);
    renderer.clear(true, true, true);
    this.drawStage(t);
    this.stage.render(renderer, out, this.cam3);

    // ---- UI
    const L = this.ui; L.clear();
    const c = L.ctx;
    const cs = Math.cos(rot) * zoom, sn = Math.sin(rot) * zoom;
    c.setTransform(cs, sn, -sn, cs, W / 2 - (cs * cx - sn * cy), H / 2 - (sn * cx + cs * cy));
    const toScreen = (x: number, y: number) => ({ x: cs * (x - cx) - sn * (y - cy) + W / 2, y: sn * (x - cx) + cs * (y - cy) + H / 2 });
    const hair = 1 / zoom;
    this.drawField(c, t, hair);
    this.drawTokens(c, t, hair);
    this.drawPopups(c, t, hair);
    const caret = this.drawCaret(c, t);
    // "For example:" in UI space
    const uiCam: Cam = { cx: W / 2 - (cs * cx - sn * cy - W / 2) / zoom, cy: 0, z: 1, roll: 0 };
    void uiCam;
    c.save();
    drawKaraoke(c, { cx, cy, z: zoom, roll: rot }, t, this.kw, { alpha: (_g, tt) => 1 - prog(tt, this.tFirst - 0.1, this.tFirst + 0.3) });
    c.restore();
    this.ctx.comp.draw(renderer, L.upload(), out);

    // ---- glow: the caret spark
    this.glow.clear();
    if (caret && caret.hot > 0.01) { const p = toScreen(caret.x, caret.y); sparkHead(this.glow, p.x, p.y, t, 0.5 * Math.sqrt(zoom), caret.hot); }
    if (t > this.tEnter) {
      const p = toScreen(this.keyX, (this.fy0 + this.fy1) / 2);
      sparkParticles(this.glow, t, (tb) => (tb >= this.tEnter ? { x: p.x, y: p.y } : null), { rate: 160, intensity: 1.2, speed: 420, seed: 3, life: 0.4 });
    }
    if (this.glow.count) this.glow.render(renderer, out);

    return {
      bloomThreshold: 0.92, bloomKnee: 0.25, bloom: 0.7 + 0.8 * rush, vignette: 0.45,
      flash: 0,
      ca: 1.2 + 4 * rush, shake: [noise1(t * 40, 1) * 6 * rush * (1 - rk), noise1(t * 40, 2) * 6 * rush * (1 - rk)],
    };
  }

  // ------------------------------------------------------------------ the stage
  drawStage(t: number) {
    const S = this.stage; S.clear();
    const w = this.w;
    // camera: a slow dolly from "cinematic", an orbit on "seamless camera movement"
    const dolly = Math.max(0, t - w.cinematic!.start) * 1.1;
    const orb = ease.inOutCubic(prog(t, w.seamless!.start, this.tEnter + 0.2));
    const a = -0.05 + 0.62 * orb;
    const R = 34 - dolly * 0.5 - 6 * orb;
    const tgt = new THREE.Vector3(0, 1.5, -26);
    this.cam3.position.set(tgt.x + Math.sin(a) * R, 4.2 + 2.5 * orb, tgt.z + Math.cos(a) * R);
    this.cam3.lookAt(tgt);
    this.cam3.updateMatrixWorld(true);
    const appear = prog(t, this.ctx.start, this.ctx.start + 0.8);
    const b = LIN.bone, sg = LIN.signal;
    const col = (k: number, rgb = b): [number, number, number] => [rgb[0] * k, rgb[1] * k, rgb[2] * k];
    // the floor grid, fading with distance
    const y0 = -3;
    for (let x = -64; x <= 64; x += 4) {
      for (let z = 20; z > -110; z -= 6) {
        const f = clamp(1 - (20 - z) / 130) * appear;
        S.seg(x, y0, z, x, y0, z - 6, 1.0, ...col(0.11 * f), 1);
      }
    }
    for (let z = 20; z >= -110; z -= 4) {
      const f = clamp(1 - (20 - z) / 130) * appear;
      S.seg(-64, y0, z, 64, y0, z, 1.0, ...col(0.11 * f), 1);
    }
    // kinetic typography: stroke letters standing on the floor, jumping one by one
    const tk = w.kinetic!.start;
    if (t > tk - 0.1) {
      const ka = prog(t, tk - 0.1, tk + 0.2);
      const st = this.kin, k = 0.05, x0 = -44 - (st.width * k) / 2, z0 = -64;
      st.strokes.forEach((s, i) => {
        const ci = st.charOf[i]!;
        const jt = t - (w.typography!.start + ci * 0.07);
        const hop = jt > 0 && jt < 0.45 ? Math.sin((jt / 0.45) * Math.PI) * 2.2 : 0;
        for (let j = 1; j < s.length; j++) {
          const p = s[j - 1]!, q = s[j]!;
          S.seg(x0 + p.x * k, y0 + 7 - p.y * k + hop, z0, x0 + q.x * k, y0 + 7 - q.y * k + hop, z0, 1.4, ...col(0.3 * ka), 1);
        }
      });
    }
    // smooth shape transitions: circle → square → triangle, morphing
    const ts = w.smooth!.start;
    if (t > ts - 0.1) {
      const sa = prog(t, ts - 0.1, ts + 0.25);
      const N = 96, cx = 15, cy = 3.2, cz = -42, r = 4.2;
      const ph = Math.max(0, t - w.transitions!.start) / 1.1;
      const seg = Math.floor(ph), u = ease.inOutCubic(clamp((ph - seg) * 1.6));
      const shapes = [circlePt, squarePt, triPt];
      const A = shapes[seg % 3]!, B = shapes[(seg + 1) % 3]!;
      const hot = pulse(t, w.transitions!.start, 0.3);
      let prev: [number, number] | null = null;
      for (let i = 0; i <= N; i++) {
        const u0 = i / N;
        const pa = A(u0), pb = B(u0);
        const px = lerp(pa[0], pb[0], ph > 0 ? u : 0), py = lerp(pa[1], pb[1], ph > 0 ? u : 0);
        const p: [number, number] = [cx + px * r, cy - py * r];
        if (prev) S.seg(prev[0], prev[1], cz, p[0], p[1], cz, 2.0, ...(hot > 0.02 ? col(0.55 + 1.6 * hot, sg) : col(0.55)), 1);
        prev = p;
      }
      void sa;
    }
    // 3D elements: wireframe solids
    const t3 = w['3d']!.start;
    if (t > t3 - 0.05) {
      const ea = prog(t, t3 - 0.05, t3 + 0.3);
      const hot = pulse(t, t3, 0.25);
      const C = (k: number) => (hot > 0.02 ? col(0.4 + 1.8 * hot, sg) : col(0.6 * k));
      wire(S, cube(), [-3, 3.2, -24], 2.6 * ea, t * 0.7, t * 0.45, 1.6, C(ea));
      wire(S, octa(), [6, 5.4, -32], 2.4 * prog(t, w.elements!.start, w.elements!.start + 0.3), -t * 0.5, t * 0.8, 1.4, C(ea));
    }
  }

  // ------------------------------------------------------------------ the field
  drawField(c: CanvasRenderingContext2D, t: number, hair: number) {
    const { fx0, fx1, fy0, fy1 } = this;
    const rv = ease.outExpo(prog(t, this.ctx.start + 0.02, this.ctx.start + 0.55));
    c.save();
    c.beginPath(); c.rect(fx0 - 40, fy0 - 400, (fx1 - fx0 + 80) * rv, fy1 - fy0 + 800); c.clip();
    c.fillStyle = rgba('ink', 0.74);
    c.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
    c.lineWidth = hair;
    c.strokeStyle = rgba('bone', 0.42);
    c.strokeRect(fx0 + 0.5 * hair, fy0 + 0.5 * hair, fx1 - fx0, fy1 - fy0);
    c.strokeStyle = rgba('bone', 0.6);
    c.beginPath();
    for (const [x, y, sx, sy] of [[fx0, fy0, -1, -1], [fx1, fy0, 1, -1], [fx0, fy1, -1, 1], [fx1, fy1, 1, 1]] as const) {
      c.moveTo(x + sx * 6, y); c.lineTo(x + sx * 20, y);
      c.moveTo(x, y + sy * 6); c.lineTo(x, y + sy * 20);
    }
    c.stroke();
    c.font = font(F.mono(400), 46);
    c.fillStyle = rgba('ash', 0.7);
    c.textBaseline = 'alphabetic';
    c.fillText('›', fx0 + 36, this.baseY(0) - 4);
    // labels under the field
    const nTok = this.toks.filter((k) => k.t0 <= t).length;
    const pw = label(c, 'PROMPT', fx0, fy1 + 30, { size: 13 });
    label(c, '02', fx0 + pw + 14, fy1 + 30, { size: 13, col: rgba('signal', 0.9) });
    c.font = font(F.mono(400), 13);
    c.fillStyle = rgba('ash', 0.75);
    c.fillText('T 0.7 · top-p 0.95 · output: code, not pixels', fx0, fy1 + 52);
    c.fillText('keyframes requested: 0', fx0, fy1 + 74);
    label(c, `CONTEXT ${String(nTok).padStart(3, '0')} / 200000`, fx1, fy1 + 30, { size: 13, align: 'right' });
    c.font = font(F.mono(400), 13);
    c.fillStyle = rgba('ash', 0.75);
    c.textAlign = 'right';
    const sendTxt = ' send';
    c.fillText(sendTxt, fx1, fy1 + 52);
    c.textAlign = 'left';
    c.save();
    c.strokeStyle = rgba('ash', 0.75); c.lineWidth = 1.1; c.lineCap = 'square';
    returnArrow(c, fx1 - measure(sendTxt, F.mono(400), 13) - 6, fy1 + 47.8, 3.4);
    c.restore();
    // keycap
    const press = t >= this.tEnter ? Math.pow(0.5, (t - this.tEnter) / 0.12) : 0;
    const armed = t >= this.tLast + 0.15 ? 1 : 0;
    const kx = this.keyX, ky = (fy0 + fy1) / 2, ks = 32 * (1 - 0.1 * press);
    const lit = t >= this.tEnter ? 1 : 0;
    c.lineWidth = hair * (1 + armed);
    if (lit) { c.fillStyle = rgba('signal', 1); c.fillRect(kx - ks, ky - ks, ks * 2, ks * 2); }
    c.strokeStyle = lit ? rgba('signal', 1) : rgba('bone', 0.35 + 0.35 * armed * (0.5 + 0.5 * Math.cos(t * TAU * 2.5)));
    c.strokeRect(kx - ks, ky - ks, ks * 2, ks * 2);
    c.strokeStyle = lit ? rgba('ink', 1) : rgba('bone', 0.8);
    c.lineWidth = 2.2; c.lineCap = 'square'; c.lineJoin = 'miter';
    returnArrow(c, kx, ky, ks * 0.42);
    c.restore();
  }

  drawTokens(c: CanvasRenderingContext2D, t: number, hair: number) {
    const adv = this.adv;
    c.save();
    c.textBaseline = 'alphabetic';
    for (const k of this.toks) {
      if (k.t0 > t) break;
      const base = this.baseY(k.row);
      const x0 = this.tx0 + (k.col - (k.space ? 1 : 0)) * adv;
      const xv = this.tx0 + k.col * adv;
      const x1 = this.tx0 + (k.col + k.n) * adv;
      const age = t - k.t0;
      const w = k.word;
      const sung = t < w.end;
      const cool = prog(t, w.end, w.end + 0.35);
      const flash = Math.pow(0.5, age / 0.06);
      const drop = (1 - ease.outExpo(clamp(age / 0.18))) * -10;
      // token bracket + id
      const by = base + 18, bw = x1 - x0 - 6;
      c.fillStyle = rgba('bone', 0.4 * (1 - prog(t, k.t0 + 0.8, k.t0 + 3) * 0.4));
      c.fillRect(x0 + 3, by, bw, hair);
      c.fillRect(x0 + 3, by - 5, hair, 5);
      c.fillRect(x0 + 3 + bw - hair, by - 5, hair, 5);
      c.font = font(F.mono(400), 10);
      c.fillStyle = rgba('ash', 0.55);
      c.fillText(String(k.id), x0 + 5, by + 14);
      c.font = font(this.fam, FS);
      if (k.space) { c.fillStyle = rgba('graphite', 0.9); c.fillRect(x0 + adv * 0.5 - 2, base - FS * 0.2, 3, 3); }
      c.fillStyle = sung || cool < 1 ? (flash > 0.05 ? rgba('ember', 1) : cool > 0 ? mixCss('signal', 'bone', cool) : rgba('signal', 1)) : rgba('bone', 0.95);
      c.fillText(k.text, xv, base + drop);
    }
    // karaoke: said progress along each word's brackets
    for (const w of this.line.words) {
      if (w.start > t) break;
      const p = Lyrics.wordProgress(w, t);
      const ks = this.toks.filter((k) => k.word === w && k.t0 <= t);
      if (!ks.length) continue;
      const first = ks[0]!, lastK = ks[ks.length - 1]!;
      const x0 = this.tx0 + (first.col - (first.space ? 1 : 0)) * this.adv + 3;
      const x1 = this.tx0 + (lastK.col + lastK.n) * this.adv - 3;
      const done = prog(t, w.end, w.end + 0.4);
      c.fillStyle = rgba('signal', 1 - 0.75 * done);
      c.fillRect(x0, this.baseY(first.row) + 17, (x1 - x0) * p, 3);
    }
    c.restore();
  }

  drawPopups(c: CanvasRenderingContext2D, t: number, hair: number) {
    for (const k of this.toks) {
      if (!k.dist) continue;
      const a0 = k.t0 - POP_PRE, a1 = k.tPopEnd + 0.12;
      if (t < a0 || t > a1) continue;
      const built = clamp((t - a0) / POP_PRE);
      const picked = t >= k.t0;
      const collapse = ease.inCubic(prog(t, k.tPopEnd, k.tPopEnd + 0.12));
      const ax = this.tx0 + k.col * this.adv;
      const base = this.baseY(k.row);
      const rows = k.dist, rh = 21, headH = 20;
      const hgt = headH + rows.length * rh + 6, pw = 300;
      // below the line: the rows under the caret are still empty
      const ay = base + 34 + hgt;
      c.save();
      c.translate(ax, ay);
      c.scale(1, 1 - collapse);
      c.globalAlpha = 1 - collapse * 0.6;
      c.fillStyle = rgba('bone', 0.5);
      c.fillRect(0, -hgt - (ay - base - 22), hair, ay - base - 22 - hgt);
      c.fillRect(-3, -hgt - (ay - base - 22), 7, hair);
      c.fillStyle = rgba('ink', 0.9);
      c.fillRect(0, -hgt, pw, hgt);
      c.fillStyle = rgba('bone', 0.35);
      c.fillRect(0, -hgt, pw, hair);
      c.fillRect(0, -hgt, hair, hgt);
      c.textBaseline = 'alphabetic';
      c.font = font(F.mono(400), 11);
      c.fillStyle = rgba('ash', 0.85);
      c.fillText('p( next | context )', 10, -hgt + 14);
      c.textAlign = 'right';
      c.fillText(picked ? 'sampled' : 'computing…', pw - 8, -hgt + 14);
      c.textAlign = 'left';
      const pmax = rows[0]![1];
      rows.forEach(([txt, p], i) => {
        const y = -hgt + headH + (i + 1) * rh - 5;
        const isPick = i === k.pick;
        const fl = hash(i, frameIdx(t), k.id) < 0.25 + 0.75 * built;
        if (!picked && !fl) return;
        const jitter = picked ? 1 : 0.3 + 0.7 * built + (hash(i, Math.floor(t * 30), 3) - 0.5) * 0.5 * (1 - built);
        const on = picked && isPick;
        const flashRow = on ? Math.pow(0.5, (t - k.t0) / 0.08) : 0;
        if (on) { c.fillStyle = rgba('signal', 0.14 + 0.5 * flashRow); c.fillRect(1, y - 15, pw - 1, rh - 1); }
        c.font = font(F.mono(on ? 500 : 400), 14);
        c.fillStyle = on ? rgba('signal', 1) : rgba(picked ? 'ash' : 'bone', picked ? 0.8 : 0.55);
        const cell = measure(' ', F.mono(500), 14);
        if (on) triangle(c, 8 + cell * 0.5, y - 4.4, 3.6);
        c.fillText('  ' + txt, 8, y);
        const bx = 170, bwm = 80;
        const bw = clamp((bwm * p) / pmax * clamp(jitter, 0, 1.2), 1.5, bwm);
        c.fillStyle = on ? rgba('signal', 1) : rgba('bone', picked ? 0.3 : 0.45);
        c.fillRect(bx, y - 9, bw, 7);
        c.font = font(F.mono(400), 12);
        c.fillStyle = on ? rgba('signal', 1) : rgba('ash', 0.8);
        c.textAlign = 'right';
        c.fillText(p >= 0.01 ? p.toFixed(2) : p.toFixed(3), pw - 8, y);
        c.textAlign = 'left';
      });
      c.restore();
    }
  }

  drawCaret(c: CanvasRenderingContext2D, t: number) {
    const last = this.toks.filter((k) => k.t0 <= t).pop();
    const cp = this.caretPos(t, 0);
    const sinceTok = last ? t - last.t0 : 99;
    let on = sinceTok < 0.45 || Math.floor(t * 2.2) % 2 === 0;
    if (t > this.tEnter + 0.05) on = false;
    if (!on) return null;
    const x = cp.x + 4, y0 = cp.y - FS * 0.78, y1 = cp.y + FS * 0.12;
    c.fillStyle = rgba('signal', 1);
    c.fillRect(x, y0, 3.5, y1 - y0);
    return { x: x + 1.75, y: y0 + 4, hot: sinceTok < 0.3 ? 0.35 * Math.pow(0.5, sinceTok / 0.1) : 0 };
  }
}

// ---- shapes for the morph (unit size, parameter u in 0..1 around the outline)
function circlePt(u: number): [number, number] { const a = u * TAU - Math.PI / 2; return [Math.cos(a), Math.sin(a)]; }
function squarePt(u: number): [number, number] {
  const s = ((u + 0.125) % 1) * 4, i = Math.floor(s), f = s - i;
  const P: [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  const a = P[(i + 3) % 4]!, b = P[i % 4]!;
  return [lerp(a[0], b[0], f) * 0.85, lerp(a[1], b[1], f) * 0.85];
}
function triPt(u: number): [number, number] {
  const P: [number, number][] = [[0, 1.05], [0.95, -0.6], [-0.95, -0.6]];
  const s = u * 3, i = Math.floor(s) % 3, f = s - Math.floor(s);
  const a = P[i]!, b = P[(i + 1) % 3]!;
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
}
type V3 = [number, number, number];
function cube(): [V3, V3][] {
  const v: V3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  const e: [V3, V3][] = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const d = Math.abs(v[i]![0] - v[j]![0]) + Math.abs(v[i]![1] - v[j]![1]) + Math.abs(v[i]![2] - v[j]![2]);
    if (d === 2) e.push([v[i]!, v[j]!]);
  }
  return e;
}
function octa(): [V3, V3][] {
  const v: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const e: [V3, V3][] = [];
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (Math.abs(v[i]![0] + v[j]![0]) + Math.abs(v[i]![1] + v[j]![1]) + Math.abs(v[i]![2] + v[j]![2]) > 0.5) e.push([v[i]!, v[j]!]);
  return e;
}
function wire(S: LineBatch, edges: [V3, V3][], c: V3, s: number, ay: number, ax: number, wd: number, col: [number, number, number]) {
  if (s <= 0.001) return;
  const r = (p: V3): V3 => {
    let [x, y, z] = p;
    const c1 = Math.cos(ay), s1 = Math.sin(ay);
    [x, z] = [x * c1 + z * s1, -x * s1 + z * c1];
    const c2 = Math.cos(ax), s2 = Math.sin(ax);
    [y, z] = [y * c2 - z * s2, y * s2 + z * c2];
    return [c[0] + x * s, c[1] + y * s, c[2] + z * s];
  };
  for (const [a, b] of edges) { const p = r(a), q = r(b); S.seg(p[0], p[1], p[2], q[0], q[1], q[2], wd, col[0], col[1], col[2], 1); }
}
