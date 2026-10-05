// CODE — "It writes the animation itself as code. The text, shapes, positions, easing,
// transitions, particles — basically every visual element is defined mathematically over time."
// A construction sheet. Left: the listing Claude writes, one line typed per element as it is
// named. Right: an artboard where each named element is built — the said word is its label:
//   text      MOTION slides in on its construction lines
//   shapes    the pen sweeps a circle and a square
//   positions crosshairs and dimension lines with coordinates
//   easing    the pen plots e(u) = 1 − 2^(−10u) in an inset while a puck rides the curve
//   transitions  a wipe turns the artboard over to paper and back
//   particles the spark on the circle's rim throws sparks
// Everything on the artboard is a function of one clock τ. On "defined mathematically" τ rewinds
// to 0 (every element un-builds in reverse) and on "over time" it replays under a scrubbing
// playhead, with the formula x(t) = x₀ + (x₁ − x₀) · e(t) set beneath in Cormorant italic.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import { type Line, type Word } from '../engine/lyrics';
import { clamp, ease, lerp, noise1, prog, pulse, smoothstep, TAU } from '../engine/util';
import { sparkHead, sparkParticles } from './_motifs';
import {
  Plot, Cam2D, gridPass, setGrid, drawKaraoke, placeRow, drawPen, w2s, setWorld, label, mixCss,
  pt, rectPts, lineOf, wordOf, type P, type KWord, type Cam,
} from './_vo';

const ARCH = (wd: number, wt: number) => F.archivo(wd, wt);
const expo = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));

/** The artboard (world px): a 16:9 frame. */
const A = { x: 40, y: -300, w: 880, h: 495 };
/** Element geometry in artboard-local px. */
const G = { textX: 64, textY: 168, textS: 128, circ: pt(640, 300), r: 112, sq: pt(330, 342), sqS: 124, trackY: 452, track0: 70, track1: 810 };
/** The easing inset (world px), under the artboard on the right. */
const INSET = { x: A.x + A.w - 330, y: A.y + A.h + 36, w: 330, h: 190 };

interface Code { text: string; t: number; key?: string }

export default class CodeScene extends Scene {
  plot = new Plot();
  cam = new Cam2D();
  grid = gridPass(24, 96);
  lines = new LineBatch(60000);
  fx = new LineBatch(30000);
  ui = new Layer2D();
  kw: KWord[] = [];
  L8!: Line; L9!: Line;
  w: Record<string, Word> = {};
  code: Code[] = [];
  /** τ keys: when (in τ) each element starts. */
  k = { text: 0, shapes: 0, pos: 0, ease: 0, trans: 0, part: 0 };
  tL9 = 0; tDef = 0; tRe = 0; tPlay = 0; tauMax = 0;
  listX = -1000; listY = -240;

  override init() {
    const ly = this.ctx.lyrics;
    this.L8 = lineOf(ly, 'It writes the animation');
    this.L9 = lineOf(ly, 'The text, shapes');
    const w = this.w;
    for (const [k, q] of [['it', 'It'], ['writes', 'writes'], ['the', 'the'], ['animation', 'animation'], ['itself', 'itself'], ['as', 'as'], ['code', 'code']] as const) w[k] = wordOf(this.L8, q);
    for (const [k, q] of [['The', 'The'], ['text', 'text'], ['shapes', 'shapes'], ['positions', 'positions'], ['easing', 'easing'], ['transitions', 'transitions'], ['particles', 'particles'],
      ['dash', '—'], ['basically', 'basically'], ['every', 'every'], ['visual', 'visual'], ['element', 'element'], ['is', 'is'], ['defined', 'defined'], ['mathematically', 'mathematically'], ['over', 'over'], ['time', 'time']] as const) w[k] = wordOf(this.L9, q);
    this.tL9 = w.The!.start;
    const kt = (x: Word) => x.start - this.tL9;
    this.k = { text: kt(w.text!), shapes: kt(w.shapes!), pos: kt(w.positions!), ease: kt(w.easing!), trans: kt(w.transitions!), part: kt(w.particles!) };
    this.tDef = w.defined!.start;
    this.tRe = w.mathematically!.start + 0.25; // rewind done
    this.tPlay = w.over!.start - 0.05;
    this.tauMax = this.tDef - this.tL9;
    this.buildCode();
    this.buildWords();
    this.buildPlot();
    this.buildCamera();
  }

  // ---------------------------------------------------------------- the clock of the artboard
  tau(t: number): number {
    if (t < this.tL9) return -1;
    if (t < this.tDef) return t - this.tL9;
    if (t < this.tRe) return this.tauMax * (1 - ease.inOutCubic(prog(t, this.tDef, this.tRe)));
    if (t < this.tPlay) return 0;
    return Math.min(this.tauMax, (t - this.tPlay) * 6.0);
  }

  // ---------------------------------------------------------------- the listing
  buildCode() {
    const w = this.w;
    const C = (text: string, t: number, key?: string) => this.code.push({ text, t, key });
    C('// scene.ts — written by Claude', w.writes!.start);
    C('export function render(t: number) {', w.animation!.start);
    C('  const e = (u) => 1 - 2 ** (-10 * u);', w.itself!.start, 'ease0');
    C("  text('MOTION', { x: 64 - 160 * (1 - e(t)) });", w.text!.start, 'text');
    C('  circle(640, 300, 112);', w.shapes!.start, 'shapes');
    C('  square(330, 342, 124, { rotate: 0.4 * t });', w.shapes!.start + 0.25, 'shapes');
    C('  const p = { x: 640, y: 300 };', w.positions!.start, 'pos');
    C('  puck(lerp(70, 810, e(t % 1.6)), 452);', w.easing!.start, 'ease');
    C('  wipe(ink, paper, smooth(t - 2.9));', w.transitions!.start, 'trans');
    C('  sparks({ at: rim(p, 112), rate: 90 });', w.particles!.start, 'part');
    C('}', w.particles!.end, 'end');
    C('// keyframes: 0', w.code!.start);
  }

  // ---------------------------------------------------------------- the said words
  buildWords() {
    const w = this.w;
    const fam7 = ARCH(100, 700);
    // L8: a row across the top of the sheet
    this.kw.push(...placeRow([w.it!, w.writes!, w.the!, w.animation!, w.itself!, w.as!, w.code!], this.listX, this.listY - 92, 72, fam7, 'L8', { ant: 0.2 }).words);
    // L9: each element's word labels the element on the artboard
    const lab = (wd: Word, g: string, x: number, y: number, size = 40, words: Word[] = [wd]) => this.kw.push(...placeRow(words, A.x + x, A.y + y, size, fam7, g, { ant: 0.15 }).words);
    lab(w.text!, 'k:text', G.textX, G.textY - G.textS * 0.72 - 26, 40, [w.The!, w.text!]);
    lab(w.shapes!, 'k:shapes', G.sq.x - 70, G.sq.y + 104);
    lab(w.positions!, 'k:pos', G.circ.x + 132, G.circ.y - 52, 36);
    lab(w.easing!, 'k:ease', INSET.x - A.x + 14, INSET.y - A.y + 44, 34);
    lab(w.transitions!, 'k:trans', 300, 40, 36);
    lab(w.particles!, 'k:part', 690, 64, 36);
    // the tail: two rows under the listing
    const yb = A.y + A.h + 120;
    this.kw.push(...placeRow([w.dash!, w.basically!, w.every!, w.visual!, w.element!], this.listX, yb, 60, fam7, 'tail', { ant: 0.2 }).words);
    this.kw.push(...placeRow([w.is!, w.defined!, w.mathematically!, w.over!, w.time!], this.listX, yb + 80, 60, fam7, 'tail', { ant: 0.2, hot: 'signal' }).words);
  }

  // ---------------------------------------------------------------- plotted (real time) construction
  buildPlot() {
    const P = this.plot, w = this.w;
    // the artboard frame, ruled by the pen on "animation"
    const ta = w.animation!.start;
    P.add(rectPts(A.x, A.y, A.w, A.h), ta, ta + 0.45, 'plot', { pen: true, ez: ease.inOutQuad, width: 1.3, group: 'board' });
    P.note('artboard 1920×1080 @ 0.46', A.x, A.y - 14, ta + 0.3, { size: 13, col: 'ash', group: 'board' });
    // the time ruler under the artboard (drawn on "itself")
    const ti = w.itself!.start;
    const ry = A.y + A.h + 18;
    P.add([pt(A.x, ry), pt(A.x + A.w - 360, ry)], ti, ti + 0.3, 'axis', { ez: ease.outCubic, group: 'ruler' });
    for (let i = 0; i <= 14; i++) {
      const x = A.x + (i / 14) * (A.w - 360), tt = ti + 0.02 * i;
      P.add([pt(x, ry), pt(x, ry + (i % 2 === 0 ? 10 : 5))], tt, tt + 0.03, 'axis', { group: 'ruler' });
      if (i % 2 === 0) P.note((i / 14 * this.tauMax).toFixed(1), x, ry + 28, tt, { size: 11, align: 'center', col: 'ash', group: 'ruler', dur: 0.03 });
    }
    P.note('τ (s)', A.x + A.w - 350, ry + 5, ti + 0.3, { size: 12, col: 'ash', group: 'ruler' });
    // the listing's left rule
    P.add([pt(this.listX - 18, this.listY - 30), pt(this.listX - 18, this.listY + 12 * 38)], w.writes!.start, w.animation!.start + 0.2, 'cons', { alpha: 0.5, group: 'list' });
    // the pen: after the frame it parks on the listing's caret; the artboard elements take it over in τ-space
    P.wp(pt(this.listX + 10, this.listY - 6), this.ctx.start, Math.max(0.01, w.writes!.start - this.ctx.start));
  }

  buildCamera() {
    const w = this.w, K = this.cam;
    const lx = this.listX, ly = this.listY;
    const bx = A.x + A.w / 2, by = A.y + A.h / 2;
    K.key(this.ctx.start, lx + 260, ly + 20, 2.3, 0);
    K.key(w.writes!.start + 0.1, lx + 320, ly + 20, 2.0, 0, ease.outCubic);
    K.key(w.animation!.start + 0.35, -40, -60, 0.92, -0.008, ease.outExpo);
    K.key(w.code!.end, -30, -50, 0.95, -0.004, ease.linear);
    K.key(w.text!.start + 0.2, bx - 120, by - 30, 1.18, 0.008, ease.outExpo);
    K.key(w.positions!.start, bx - 60, by - 10, 1.22, 0.01, ease.linear);
    K.key(w.positions!.start + 0.25, A.x + G.circ.x - 80, A.y + G.circ.y - 30, 1.5, 0.014, ease.outExpo);
    K.key(w.easing!.start, A.x + G.circ.x - 60, A.y + G.circ.y - 10, 1.5, 0.014, ease.linear);
    K.key(w.easing!.start + 0.3, INSET.x + 60, INSET.y - 40, 1.35, 0.004, ease.outExpo);
    K.key(w.transitions!.start, INSET.x + 50, INSET.y - 60, 1.35, 0.004, ease.linear);
    K.key(w.transitions!.start + 0.3, bx, by + 20, 1.12, -0.006, ease.outExpo);
    K.key(w.particles!.start, bx + 20, by + 10, 1.14, -0.006, ease.linear);
    K.key(w.particles!.start + 0.25, A.x + G.circ.x - 30, A.y + G.circ.y - 40, 1.45, 0.01, ease.outExpo);
    K.key(w.basically!.start - 0.1, A.x + G.circ.x - 20, A.y + G.circ.y - 30, 1.48, 0.01, ease.linear);
    K.key(w.basically!.start + 0.4, -40, 20, 0.86, 0, ease.inOutCubic);
    K.key(this.tDef, -30, 40, 0.88, 0, ease.linear);
    K.key(this.tPlay, -20, 70, 0.9, 0, ease.inOutQuad);
    K.key(this.ctx.end, -10, 80, 0.93, 0, ease.linear);
  }

  groupAlpha(g: string, t: number) {
    const w = this.w;
    if (g.startsWith('k:')) {
      if (t < this.tDef) return 1;
      const key = (this.k as Record<string, number>)[g.slice(2)]!;
      return this.tau(t) >= key ? 1 : 0.12;
    }
    switch (g) {
      case 'L8': return 1 - 0.75 * prog(t, w.The!.start - 0.2, w.The!.start + 0.3);
      default: return 1;
    }
  }

  // ================================================================== render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, w = this.w;
    const c = this.cam.at(t);
    const tau = this.tau(t);
    const penW = this.penWorld(t, tau);
    const ps = penW ? w2s(c, penW.x, penW.y) : null;
    setGrid(this.grid, c, { reveal: [0, 0, 1e5], ink: 0.85, pen: ps ? [ps[0], ps[1], 1] : [0, 0, 0] });
    this.grid.render(renderer, out);

    const L = this.lines; L.clear();
    this.plot.alpha = (g, tt) => this.groupAlpha(g, tt);
    this.plot.draw(t, c, L);
    this.stageLines(L, c, tau, t);
    L.render(renderer, out);

    const U = this.ui; U.clear();
    const ctx = U.ctx;
    this.drawListing(ctx, t, c);
    this.drawStage(ctx, c, tau, t);
    this.drawInset(ctx, c, tau);
    this.drawPlayhead(ctx, c, tau, t);
    this.plot.drawNotes(t, c, ctx);
    this.drawFormula(ctx, t, c);
    drawKaraoke(ctx, c, t, this.kw, { alpha: (g, tt) => this.groupAlpha(g, tt) });
    comp.draw(renderer, U.upload(), out);

    const X = this.fx; X.clear();
    drawPen(X, t, (tt) => { const q = this.penWorld(tt, this.tau(tt)); return q ? w2s(c, q.x, q.y) : null; }, { scale: 0.9, rate: 50 });
    // particles from the rim, in τ (they rewind with it)
    if (tau >= this.k.part) {
      const rim = (tb: number) => { const a = -0.6 + tb * 2.2; return w2s(c, A.x + G.circ.x + Math.cos(a) * G.r, A.y + G.circ.y + Math.sin(a) * G.r); };
      sparkParticles(X, tau, (tb) => (tb >= this.k.part ? (() => { const s = rim(tb); return { x: s[0], y: s[1] }; })() : null), { rate: 110, intensity: 1.0, speed: 260 * c.z, seed: 23, life: 0.5 });
      const s = rim(tau);
      sparkHead(X, s[0], s[1], t, 0.8, 1);
    }
    X.render(renderer, out);
    const punch = 0.01 * (pulse(t, w.text!.start, 0.08) + pulse(t, w.shapes!.start, 0.08) + pulse(t, w.positions!.start, 0.08) + pulse(t, w.easing!.start, 0.08) + pulse(t, w.transitions!.start, 0.08) + pulse(t, w.particles!.start, 0.08));
    return { bloom: 0.7, bloomThreshold: 0.84, vignette: 0.42, grain: 0.05, zoom: 1 + punch };
  }

  /** The pen (world): the plotter's pen in real time, or the artboard's pen in τ while it builds the shapes and the curve. */
  penWorld(t: number, tau: number): P | null {
    const k = this.k;
    // circle sweep: τ in [shapes, shapes + 0.35]; square: [shapes + 0.35, shapes + 0.6]; curve: [ease, ease + 0.45]
    if (tau >= k.shapes && tau < k.shapes + 0.6) {
      if (tau < k.shapes + 0.35) {
        const a = -Math.PI / 2 + TAU * ease.inOutQuad(clamp((tau - k.shapes) / 0.35));
        return pt(A.x + G.circ.x + Math.cos(a) * G.r, A.y + G.circ.y + Math.sin(a) * G.r);
      }
      const q = this.squarePts(tau);
      const u = ease.inOutQuad(clamp((tau - k.shapes - 0.35) / 0.25)) * 4;
      const i = Math.min(3, Math.floor(u)), f = u - i;
      return pt(lerp(q[i]!.x, q[i + 1]!.x, f), lerp(q[i]!.y, q[i + 1]!.y, f));
    }
    if (tau >= k.ease && tau < k.ease + 0.5) {
      const u = clamp((tau - k.ease) / 0.45);
      return pt(INSET.x + 40 + u * (INSET.w - 70), INSET.y + INSET.h - 36 - expo(u) * (INSET.h - 70));
    }
    if (tau >= k.pos && tau < k.pos + 0.3) return pt(A.x + G.circ.x, A.y + G.circ.y);
    const p = this.plot.penAt(t);
    if (t > this.w.animation!.start + 0.5 && tau < 0) return pt(this.listX + 10 + this.caretCol(t) * this.adv(), this.listY + this.caretRow(t) * 38 - 7);
    return p;
  }

  // ---------------------------------------------------------------- the listing
  adv() { return measure('0', F.mono(400), 23); }
  caretRow(t: number) { let r = 0; this.code.forEach((l, i) => { if (t >= l.t) r = i; }); return r; }
  caretCol(t: number) { const l = this.code[this.caretRow(t)]!; return Math.min(l.text.length, Math.ceil(l.text.length * clamp((t - l.t) / 0.35))); }
  drawListing(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const x0 = this.listX, y0 = this.listY;
    const adv = this.adv();
    const cur = this.caretRow(t);
    this.code.forEach((l, i) => {
      if (t < l.t) return;
      const y = y0 + i * 38;
      const n = Math.min(l.text.length, Math.ceil(l.text.length * clamp((t - l.t) / 0.35)));
      const hot = Math.pow(0.5, (t - l.t) / 0.25);
      setWorld(ctx, c, x0, y, 0.23);
      // line number
      ctx.font = font(F.mono(400), 100);
      ctx.textAlign = 'right';
      ctx.fillStyle = rgba('graphite', 0.9);
      ctx.fillText(String(i + 1).padStart(2, ' '), -60, 0);
      ctx.textAlign = 'left';
      if (i === cur) { ctx.fillStyle = rgba('signal', 0.9); ctx.fillRect(-40, -78, 8, 100); }
      // simple highlighting: comments ash, numbers signal, the rest bone
      const s = l.text.slice(0, n);
      const comment = s.trimStart().startsWith('//');
      if (comment) { ctx.fillStyle = rgba('ash', 0.85); ctx.fillText(s, 0, 0); }
      else {
        let x = 0;
        for (const tok of s.split(/(\d+(?:\.\d+)?|'[^']*'?)/)) {
          if (!tok) continue;
          const num = /^\d/.test(tok), str = tok.startsWith("'");
          ctx.fillStyle = hot > 0.05 ? mixCss('bone', 'signal', hot) : num ? rgba('signal', 0.9) : str ? rgba('bone', 1) : rgba('bone', 0.78);
          ctx.fillText(tok, x, 0);
          x += ctx.measureText(tok).width;
        }
      }
      if (i === cur && n < l.text.length) { ctx.fillStyle = rgba('signal', 1); ctx.fillRect(ctx.measureText(s).width + 6, -74, 54, 88); }
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    void adv;
  }

  // ---------------------------------------------------------------- the artboard, in τ
  squarePts(tau: number): P[] {
    const rot = 0.4 * Math.max(0, tau - this.k.shapes);
    const cx = A.x + G.sq.x, cy = A.y + G.sq.y, h = G.sqS / 2;
    const pts: P[] = [];
    for (const [x, y] of [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]] as const) pts.push(pt(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)));
    return pts;
  }
  wipe(tau: number) {
    const k = this.k.trans;
    return clamp(smoothstep(k, k + 0.45, tau) - smoothstep(k + 0.75, k + 1.2, tau), 0, 1);
  }
  /** Hairline geometry of the artboard: circle, square, crosshairs, dimensions, track (into the LineBatch). */
  stageLines(L: LineBatch, c: Cam, tau: number, t: number) {
    if (tau < 0) return;
    const k = this.k, b = LIN.bone, s = LIN.signal, a = LIN.ash;
    const S = (p: P, q: P, wd: number, col: [number, number, number], al = 1) => { const u = w2s(c, p.x, p.y), v = w2s(c, q.x, q.y); L.seg2(u[0], u[1], v[0], v[1], wd, col, al); };
    // text construction: baseline and cap line
    if (tau >= k.text) {
      const u = ease.outCubic(clamp((tau - k.text) / 0.3));
      const y = A.y + G.textY, yc = y - 0.7 * G.textS;
      S(pt(A.x, y), pt(A.x + A.w * u, y), 1, a, 0.6);
      S(pt(A.x, yc), pt(A.x + A.w * u * 0.7, yc), 1, a, 0.4);
    }
    // circle (swept), square (drawn)
    if (tau >= k.shapes) {
      const u = ease.inOutQuad(clamp((tau - k.shapes) / 0.35));
      const N = 120;
      let prev: P | null = null;
      for (let i = 0; i <= N * u; i++) {
        const an = -Math.PI / 2 + (i / N) * TAU;
        const p = pt(A.x + G.circ.x + Math.cos(an) * G.r, A.y + G.circ.y + Math.sin(an) * G.r);
        if (prev) S(prev, p, 2, [b[0] * 0.95, b[1] * 0.95, b[2] * 0.95]);
        prev = p;
      }
      const v = ease.inOutQuad(clamp((tau - k.shapes - 0.35) / 0.25)) * 4;
      const q = this.squarePts(tau);
      for (let i = 0; i < 4; i++) {
        const f = clamp(v - i);
        if (f <= 0) break;
        S(q[i]!, pt(lerp(q[i]!.x, q[i + 1]!.x, f), lerp(q[i]!.y, q[i + 1]!.y, f)), 2, [b[0] * 0.95, b[1] * 0.95, b[2] * 0.95]);
      }
    }
    // positions: crosshairs and dimension lines
    if (tau >= k.pos) {
      const u = ease.outCubic(clamp((tau - k.pos) / 0.3));
      const cx = A.x + G.circ.x, cy = A.y + G.circ.y;
      S(pt(cx - 22, cy), pt(cx + 22, cy), 1.2, s, u);
      S(pt(cx, cy - 22), pt(cx, cy + 22), 1.2, s, u);
      S(pt(A.x, cy), pt(lerp(A.x, cx - 26, u), cy), 1, a, 0.8);
      S(pt(cx, A.y), pt(cx, lerp(A.y, cy - 26, u)), 1, a, 0.8);
      const sx = A.x + G.sq.x, sy = A.y + G.sq.y;
      S(pt(sx - 16, sy), pt(sx + 16, sy), 1.1, a, u);
      S(pt(sx, sy - 16), pt(sx, sy + 16), 1.1, a, u);
    }
    // the puck's track
    if (tau >= k.ease) {
      const u = ease.outCubic(clamp((tau - k.ease) / 0.3));
      const y = A.y + G.trackY;
      S(pt(A.x + G.track0, y), pt(A.x + lerp(G.track0, G.track1, u), y), 1, a, 0.6);
      for (let i = 0; i <= 10; i++) { const x = A.x + lerp(G.track0, G.track1, i / 10); if (i / 10 <= u) S(pt(x, y - 5), pt(x, y + 5), 1, a, 0.6); }
    }
    void t;
  }

  /** Filled elements of the artboard; the wipe repaints a copy on paper inside its clip. */
  drawStage(ctx: CanvasRenderingContext2D, c: Cam, tau: number, t: number) {
    if (tau < 0) return;
    const wp = this.wipe(tau);
    this.paintStage(ctx, c, tau, false);
    if (wp > 0) {
      // the wipe: a diagonal edge sweeping right; behind it, the same frame on paper
      ctx.save();
      const e = lerp(-260, A.w + 260, wp);
      const poly = [pt(A.x, A.y), pt(A.x + e + 130, A.y), pt(A.x + e - 130, A.y + A.h), pt(A.x, A.y + A.h)];
      ctx.beginPath();
      poly.forEach((p, i) => { const s = w2s(c, p.x, p.y); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
      ctx.closePath();
      ctx.clip();
      // clip to the artboard too
      const a0 = w2s(c, A.x, A.y), a1 = w2s(c, A.x + A.w, A.y + A.h);
      ctx.beginPath(); ctx.rect(a0[0], a0[1], a1[0] - a0[0], a1[1] - a0[1]); ctx.clip();
      ctx.fillStyle = rgba('bone', 1);
      ctx.fillRect(0, 0, 1920, 1080);
      this.paintStage(ctx, c, tau, true);
      ctx.restore();
      // the edge itself, hot
      const top = w2s(c, A.x + e + 130, A.y), bot = w2s(c, A.x + e - 130, A.y + A.h);
      if (wp < 1) { ctx.strokeStyle = rgba('signal', 1); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(bot[0], bot[1]); ctx.stroke(); }
    }
    void t;
  }
  paintStage(ctx: CanvasRenderingContext2D, c: Cam, tau: number, paper: boolean) {
    const k = this.k;
    const ink = paper ? 'ink' : 'bone';
    // text: slides in with e(t)
    if (tau >= k.text) {
      const u = clamp((tau - k.text) / 0.6);
      const x = A.x + G.textX - 160 * (1 - expo(u));
      setWorld(ctx, c, x, A.y + G.textY, G.textS / 100);
      ctx.font = font(ARCH(100, 900), 100);
      ctx.fillStyle = paper ? rgba('ink', 1) : mixCss('signal', 'bone', clamp((tau - k.text) / 0.5), Math.min(1, u * 3));
      ctx.fillText('MOTION', 0, 0);
    }
    // coordinates, on positions
    if (tau >= k.pos) {
      const a = clamp((tau - k.pos) / 0.2);
      ctx.font = font(F.mono(500), 100);
      setWorld(ctx, c, A.x + G.circ.x + 30, A.y + G.circ.y + 34, 0.17);
      ctx.fillStyle = paper ? rgba('blood', a) : rgba('signal', a);
      ctx.fillText('(640, 300)', 0, 0);
      setWorld(ctx, c, A.x + G.sq.x + 22, A.y + G.sq.y - 20, 0.15);
      ctx.fillStyle = rgba(paper ? 'graphite' : 'ash', a);
      ctx.fillText('(330, 342)', 0, 0);
    }
    // the puck riding e(t), looping every 1.6
    if (tau >= k.ease + 0.1) {
      const u = ((tau - k.ease - 0.1) % 1.6) / 1.6;
      const x = A.x + lerp(G.track0, G.track1, expo(clamp(u / 0.75)));
      const y = A.y + G.trackY;
      const s = w2s(c, x, y);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = paper ? rgba('ink', 1) : rgba('signal', 1);
      ctx.beginPath(); ctx.arc(s[0], s[1], 9 * c.z, 0, TAU); ctx.fill();
    }
    // on paper the shapes are inked (the hairlines live in the LineBatch, under this layer)
    if (paper && tau >= k.shapes) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = rgba('ink', 1);
      ctx.lineWidth = 2.2;
      const cc = w2s(c, A.x + G.circ.x, A.y + G.circ.y);
      ctx.beginPath(); ctx.arc(cc[0], cc[1], G.r * c.z, 0, TAU); ctx.stroke();
      const q = this.squarePts(tau).map((p) => w2s(c, p.x, p.y));
      ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    void ink;
  }

  drawInset(ctx: CanvasRenderingContext2D, c: Cam, tau: number) {
    const k = this.k;
    if (tau < k.ease - 0.05) return;
    const a = clamp((tau - k.ease + 0.05) / 0.15);
    const I = INSET;
    setWorld(ctx, c, I.x, I.y);
    ctx.fillStyle = rgba('ink2', 0.92 * a);
    ctx.fillRect(0, 0, I.w, I.h);
    const hair = 1 / c.z;
    ctx.strokeStyle = rgba('bone', 0.4 * a);
    ctx.lineWidth = hair;
    ctx.strokeRect(0, 0, I.w, I.h);
    ctx.fillStyle = rgba('ash', 0.7 * a);
    ctx.fillRect(40, I.h - 36, I.w - 70, hair);
    ctx.fillRect(40, 34, hair, I.h - 70);
    ctx.font = font(F.mono(400), 13);
    ctx.fillText('e(u) = 1 − 2^(−10u)', I.w - 190, 24);
    ctx.fillText('u', I.w - 26, I.h - 14);
    // the curve, plotted by the pen in τ
    const u1 = clamp((tau - k.ease) / 0.45);
    ctx.strokeStyle = rgba('bone', 0.95 * a);
    ctx.lineWidth = 2 / c.z;
    ctx.beginPath();
    for (let i = 0; i <= 60 * u1; i++) {
      const u = i / 60;
      const x = 40 + u * (I.w - 70), y = I.h - 36 - expo(u) * (I.h - 70);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    // the puck's phase on the curve
    if (tau >= k.ease + 0.1) {
      const u = clamp((((tau - k.ease - 0.1) % 1.6) / 1.6) / 0.75);
      ctx.fillStyle = rgba('signal', a);
      ctx.beginPath(); ctx.arc(40 + u * (I.w - 70), I.h - 36 - expo(u) * (I.h - 70), 5, 0, TAU); ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawPlayhead(ctx: CanvasRenderingContext2D, c: Cam, tau: number, t: number) {
    if (t < this.w.itself!.start + 0.3) return;
    const ry = A.y + A.h + 18;
    const span = A.w - 360;
    const x = A.x + span * clamp(Math.max(0, tau) / this.tauMax);
    const s0 = w2s(c, x, ry - 8), s1 = w2s(c, x, ry + 14);
    const hot = t > this.tDef ? 1 : 0.7;
    ctx.fillStyle = rgba('signal', hot);
    ctx.fillRect(s0[0] - 1, s0[1], 2.5, s1[1] - s0[1]);
    ctx.beginPath(); ctx.moveTo(s0[0] - 7, s0[1] - 10); ctx.lineTo(s0[0] + 7, s0[1] - 10); ctx.lineTo(s0[0], s0[1]); ctx.closePath(); ctx.fill();
    // τ readout on the artboard's corner
    setWorld(ctx, c, A.x + A.w, A.y - 16, 0.21);
    ctx.font = font(F.mono(500), 100);
    ctx.textAlign = 'right';
    ctx.fillStyle = t > this.tDef ? rgba('signal', 1) : rgba('bone', 0.8);
    ctx.fillText(`τ = ${Math.max(0, tau).toFixed(2)} s`, 0, 0);
    ctx.textAlign = 'left';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawFormula(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const t0 = w.mathematically!.start;
    if (t < t0) return;
    const a = prog(t, t0, t0 + 0.4);
    const x = A.x + 10, y = A.y + A.h + 230;
    setWorld(ctx, c, x, y, 0.62);
    ctx.font = font(F.serif(400, true), 100);
    const s = 'x(t) = x₀ + (x₁ − x₀) · e(t)';
    const n = Math.ceil(s.length * prog(t, t0, t0 + 0.55));
    ctx.fillStyle = rgba('bone', 0.95 * a);
    ctx.fillText(s.slice(0, n), 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    label(ctx, '', 0, 0);
    void noise1;
  }
}
