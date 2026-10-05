// MODEL — "This is Claude Opus 5.5. Instead of controlling After Effects, you basically tell Claude
// what you want the animation to look like."
// A. The title card. The spark (still centred from the hook's dive) streaks out to rule the sheet;
//    CLAUDE and OPUS slam in on their words; 5.5 rolls in like an odometer, one digit per spoken
//    part (five / point / five); a spec table types itself underneath (MEDIUM words in, code out).
// B. Two columns. Left, "controlling": a graph editor whose handle a cursor drags, jerk by jerk
//    (manual adjustments: 1, 2, 3, 4…). Right, "telling": the pen rules a prompt field and the
//    sentence "what you want the animation to look like." is typed into it as it is said. The left
//    column dims as the right one takes over.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font, layout, measure, plain } from '../engine/type';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, pulse, TAU } from '../engine/util';
import { sparkHead } from './_motifs';
import {
  Plot, Cam2D, gridPass, setGrid, drawKaraoke, placeRow, fitRow, drawPen, w2s, setWorld, label, mixCss,
  pt, rectPts, lineOf, wordOf, parts, triangle, type P, type KWord, type Cam,
} from './_vo';

const ARCH = (wd: number, wt: number) => F.archivo(wd, wt);

export default class Model extends Scene {
  plot = new Plot();
  cam = new Cam2D();
  grid = gridPass(24, 96);
  lines = new LineBatch(40000);
  fx = new LineBatch(20000);
  ui = new Layer2D();
  kw: KWord[] = [];
  L2!: Line; L3!: Line;
  w: Record<string, Word> = {};
  // A
  X0 = -720; CW = 1440;
  sC = 0; yC = 0; sO = 0; yO = 0; opusW = 0; digitsX = 0;
  // B
  ge = { x: -940, y: 1240, w: 820, h: 430 };
  pf = { x: 120, y: 1240, w: 820, h: 236 };
  typed: { w: Word; text: string; x: number; y: number }[] = [];
  T0 = 0; T1 = 0;

  override init() {
    const ly = this.ctx.lyrics;
    this.T0 = this.ctx.start; this.T1 = this.ctx.end;
    this.L2 = lineOf(ly, 'This is Claude');
    this.L3 = lineOf(ly, 'Instead of controlling');
    const w = this.w, L2 = this.L2, L3 = this.L3;
    for (const [k, q] of [['this', 'This'], ['is', 'is'], ['claude', 'Claude'], ['opus', 'Opus'], ['v', '5.5.']] as const) w[k] = wordOf(L2, q);
    for (const [k, q, n] of [['instead', 'Instead', 0], ['of', 'of', 0], ['controlling', 'controlling', 0], ['after', 'After', 0], ['effects', 'Effects', 0],
      ['you', 'you', 0], ['basically', 'basically', 0], ['tell', 'tell', 0], ['claude2', 'Claude', 0], ['what', 'what', 0], ['you2', 'you', 1], ['want', 'want', 0],
      ['the', 'the', 0], ['animation', 'animation', 0], ['to', 'to', 0], ['look', 'look', 0], ['like', 'like', 0]] as const) w[k] = wordOf(L3, q, n);
    this.buildA();
    this.buildB();
    this.buildCamera();
    this.plot.alpha = (g, t) => this.groupAlpha(g, t);
  }

  // ================================================================== A: the title card
  buildA() {
    const w = this.w, P = this.plot;
    const fam = ARCH(100, 900);
    this.sC = fitRow(['CLAUDE'], this.CW, fam, 400);
    this.sO = this.sC * 0.78;
    this.yC = -40;
    this.yO = this.yC + 0.2 * this.sC + 0.7 * this.sO;
    this.opusW = (layout('OPUS', fam, 100).width / 100) * this.sO;
    this.digitsX = this.X0 + this.opusW + 0.3 * this.sO;
    const r = placeRow([w.this!, w.is!], this.X0, this.yC - 0.7 * this.sC - 46, 62, ARCH(100, 700), 'A', { ant: 0.12 });
    this.kw.push(...r.words);
    // the pen leaves the centre on "This" and rules the sheet: a top rule and a bottom rule
    const yTop = this.yC - 0.7 * this.sC - 130, yBot = this.yO + 70;
    P.wp(pt(0, 10), this.T0, Math.max(0.01, w.this!.start - this.T0 - 0.02));
    P.add([pt(this.X0, yTop), pt(this.X0 + this.CW, yTop)], w.this!.start + 0.02, w.is!.start + 0.05, 'plot', { pen: true, ez: ease.inOutQuad, width: 1.4, group: 'Arule' });
    P.add([pt(this.X0 + this.CW, yBot), pt(this.X0, yBot)], w.is!.end - 0.05, w.claude!.start + 0.18, 'plot', { pen: true, ez: ease.inOutQuad, width: 1.4, group: 'Arule' });
    // ticks along the bottom rule (a scale bar)
    for (let i = 0; i <= 24; i++) {
      const x = this.X0 + (i / 24) * this.CW, ti = lerp(w.claude!.start + 0.18, w.is!.end - 0.05, i / 24);
      P.add([pt(x, yBot), pt(x, yBot + (i % 6 === 0 ? 12 : 6))], ti, ti + 0.03, 'axis', { group: 'Arule' });
    }
    // the spec table, typed on the words
    const ty = yBot + 52;
    const row = (k: string, v: string, i: number, t0: number, hot = 0) => {
      P.note(k, this.X0, ty + i * 30, t0, { size: 17, col: 'ash', group: 'Aspec', dur: 0.1, spacing: 0.02 });
      P.note(v, this.X0 + 230, ty + i * 30, t0 + 0.06, { size: 17, col: 'bone', a: 0.92, group: 'Aspec', dur: 0.22, hot });
    };
    row('MODEL', 'claude-opus-5-5', 0, w.claude!.start + 0.12, 0.4);
    row('MEDIUM', 'words in, code out', 1, w.opus!.start + 0.1);
    row('KEYFRAMES', '0', 2, parts(w.v!)[2]![0], 0.4);
    P.note('fig. 1 — the model', this.X0 + this.CW, ty, w.claude!.start + 0.2, { size: 13, col: 'ash', align: 'right', group: 'Aspec' });
    P.note('not a plugin', this.X0 + this.CW, ty + 30, w.opus!.start + 0.25, { size: 13, col: 'ash', align: 'right', group: 'Aspec' });
    // the pen underlines the version, then rests by the table
    const v0 = parts(w.v!)[0]![0];
    P.add([pt(this.digitsX, this.yO + 24), pt(this.X0 + this.CW, this.yO + 24)], v0, parts(w.v!)[2]![1], 'signal', { pen: true, ez: ease.inOutCubic, width: 3, group: 'Aver' });
  }

  // ================================================================== B: controlling vs telling
  buildB() {
    const w = this.w, P = this.plot, g = this.ge, f = this.pf;
    const fam = ARCH(100, 700), s = 66;
    const y1 = g.y - 120, y2 = g.y - 36;
    this.kw.push(...placeRow([w.instead!, w.of!, w.controlling!], g.x, y1, s, fam, 'Bl', { ant: 0.2 }).words);
    this.kw.push(...placeRow([w.after!, w.effects!], g.x, y2, s, fam, 'Bl', { ant: 0.2 }).words);
    this.kw.push(...placeRow([w.you!, w.basically!], f.x, y1, s, fam, 'Br', { ant: 0.2 }).words);
    this.kw.push(...placeRow([w.tell!, w.claude2!], f.x, y2, s, fam, 'Br', { ant: 0.2, hot: 'signal' }).words);
    // the pen plots the graph editor's curve on "Instead" (the old way, drawn once)
    const tI = w.instead!.start;
    P.add(rectPts(g.x, g.y, g.w, g.h), tI - 0.1, tI + 0.2, 'cons', { alpha: 0.6, group: 'Bge' });
    // the prompt field ruled by the pen on "basically"
    const tb = w.basically!.start;
    P.add(rectPts(f.x, f.y, f.w, f.h), tb, tb + 0.4, 'plot', { pen: true, ez: ease.inOutQuad, width: 1.3, group: 'Bpf' });
    P.wp(pt(f.x + 52, f.y + 98), w.tell!.start + 0.02, 0.02);
    // typed words: "what you want the animation to look like."
    const ws = [w.what!, w.you2!, w.want!, w.the!, w.animation!, w.to!, w.look!, w.like!];
    const fs = 42, adv = measure('0', F.mono(400), fs);
    let col = 0, rowI = 0;
    const maxCols = Math.floor((f.w - 130) / adv);
    for (const wd of ws) {
      const tx = plain(wd.w);
      if (col > 0 && col + 1 + tx.length > maxCols) { rowI++; col = 0; }
      if (col > 0) col++;
      this.typed.push({ w: wd, text: tx, x: f.x + 90 + col * adv, y: f.y + 112 + rowI * 66 });
      col += tx.length;
    }
  }

  // ================================================================== camera
  buildCamera() {
    const w = this.w, K = this.cam;
    K.key(this.T0, 0, 10, 4.4, 0);
    K.key(w.this!.start + 0.25, -20, 30, 1.0, -0.01, ease.outExpo);
    K.key(w.v!.end, 0, 40, 1.06, 0.006, ease.linear);
    // whip down to B
    const g = this.ge, f = this.pf;
    const lx = g.x + g.w / 2, rx = f.x + f.w / 2, cy = g.y + g.h / 2 - 70;
    K.key(w.instead!.start - 0.14, 0, 70, 1.07, 0.006, ease.linear);
    K.key(w.instead!.start + 0.16, lx + 60, cy, 1.12, -0.012, ease.outExpo);
    K.key(w.effects!.end, lx + 90, cy + 10, 1.17, -0.012, ease.linear);
    K.key(w.you!.start + 0.35, 0, cy + 20, 0.86, 0, ease.inOutCubic);
    K.key(w.tell!.start, 40, cy + 20, 0.88, 0.004, ease.linear);
    K.key(w.tell!.start + 0.3, rx - 30, cy + 10, 1.15, 0.01, ease.outExpo);
    K.key(this.T1, rx - 10, cy + 20, 1.24, 0.012, ease.linear);
  }

  groupAlpha(g: string, t: number): number {
    const w = this.w;
    switch (g) {
      case 'Bl': case 'Bge': return (1 - 0.6 * prog(t, w.you!.start, w.tell!.start)) * (1 - prog(t, w.tell!.start + 0.2, w.claude2!.end + 0.3));
      default: return 1;
    }
  }

  // ================================================================== render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, w = this.w;
    const c = this.cam.at(t);
    const pen = this.plot.penAt(t);
    const ps = pen ? w2s(c, pen.x, pen.y) : null;
    setGrid(this.grid, c, { reveal: [0, 0, 1e5], ink: 0.8, pen: ps ? [ps[0], ps[1], 1] : [0, 0, 0] });
    this.grid.render(renderer, out);

    const L = this.lines; L.clear();
    this.plot.draw(t, c, L);
    L.render(renderer, out);

    const U = this.ui; U.clear();
    const ctx = U.ctx;
    this.drawTitle(ctx, t, c);
    this.drawEditor(ctx, t, c);
    this.drawField(ctx, t, c);
    this.plot.drawNotes(t, c, ctx);
    drawKaraoke(ctx, c, t, this.kw, { alpha: (g, tt) => this.groupAlpha(g, tt) });
    comp.draw(renderer, U.upload(), out);

    const X = this.fx; X.clear();
    drawPen(X, t, (tt) => { const q = this.plot.penAt(tt); return q ? w2s(c, q.x, q.y) : null; }, {
      scale: 0.9 + 0.6 * pulse(t, w.this!.start, 0.12), intensity: 1, rate: 50,
    });
    // the caret's spark while typing
    const car = this.caret(t);
    if (car && car.hot > 0.01) { const s = w2s(c, car.x, car.y); sparkHead(X, s[0], s[1], t, 0.45 * Math.sqrt(c.z), car.hot); }
    X.render(renderer, out);

    const punch = 0.016 * pulse(t, w.claude!.start, 0.08) + 0.014 * pulse(t, w.opus!.start, 0.08) + 0.01 * pulse(t, parts(w.v!)[0]![0], 0.07) + 0.012 * pulse(t, w.tell!.start, 0.08);
    return { bloom: 0.7, bloomThreshold: 0.84, vignette: 0.42, grain: 0.05, zoom: 1 + punch };
  }

  // ---------------------------------------------------------------- A: title, slams and the odometer
  drawTitle(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const fam = ARCH(100, 900);
    const slam = (text: string, word: Word, x: number, y: number, size: number) => {
      if (t < word.start) return;
      const age = t - word.start;
      const sc = 1 + 0.18 * (1 - ease.outExpo(clamp(age / 0.2)));
      const hot = Math.pow(0.5, age / 0.08);
      const cool = prog(t, word.end, word.end + 0.35);
      const lay = layout(text, fam, 100);
      const cx = x + (lay.width / 200) * size, cy = y - 0.35 * size;
      setWorld(ctx, c, cx + (x - cx) * sc, cy + (y - cy) * sc, (size / 100) * sc);
      ctx.font = font(fam, 100);
      ctx.fillStyle = hot > 0.1 ? mixCss('ember', 'signal', 1 - hot) : mixCss('signal', 'bone', cool);
      ctx.fillText(text, 0, 0);
    };
    slam('CLAUDE', w.claude!, this.X0, this.yC, this.sC);
    slam('OPUS', w.opus!, this.X0, this.yO, this.sO);
    // 5.5 : odometer digits, one per spoken part
    const ps = parts(w.v!);
    const size = this.sO;
    ctx.font = font(fam, 100);
    const dW = (measure('5', fam, 100) / 100) * size, pW = (measure('.', fam, 100) / 100) * size;
    const glyphs: { ch: string; x: number; p: [number, number] }[] = [
      { ch: 'd', x: this.digitsX, p: ps[0]! },
      { ch: '.', x: this.digitsX + dW, p: ps[1]! },
      { ch: 'd', x: this.digitsX + dW + pW, p: ps[2]! },
    ];
    for (const g of glyphs) {
      if (t < g.p[0] - 0.02) continue;
      const k = ease.outCubic(clamp((t - g.p[0]) / Math.max(0.12, (g.p[1] - g.p[0]) * 0.9)));
      const cool = prog(t, g.p[1], g.p[1] + 0.4);
      const col = mixCss('signal', 'bone', cool);
      if (g.ch === '.') {
        const sc = 1 + 0.6 * (1 - ease.outExpo(clamp((t - g.p[0]) / 0.15)));
        setWorld(ctx, c, g.x, this.yO, (size / 100) * sc);
        ctx.fillStyle = col;
        ctx.fillText('.', 0, 0);
        continue;
      }
      // a roll from 0 to 5 through a clipped window
      const v = 5 * k;
      const top = this.yO - 0.74 * size, bot = this.yO + 0.06 * size;
      const [x0s, y0s] = w2s(c, g.x - 4, top), [x1s, y1s] = w2s(c, g.x + dW + 4, bot);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); ctx.rect(Math.min(x0s, x1s), Math.min(y0s, y1s), Math.abs(x1s - x0s), Math.abs(y1s - y0s)); ctx.clip();
      for (let d = Math.floor(v); d <= Math.min(9, Math.floor(v) + 1); d++) {
        const off = (d - v) * size * 0.9;
        setWorld(ctx, c, g.x, this.yO + off, size / 100);
        ctx.fillStyle = d === 5 ? col : rgba('ash', 0.7);
        ctx.fillText(String(d), 0, 0);
      }
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------------------------------------------------------------- B left: the graph editor, dragged by hand
  /** The dragged handle's position (editor-local px) at t: a few jerky manual drags. */
  handleAt(t: number): P {
    const w = this.w, g = this.ge;
    const drags = [w.controlling!.start + 0.05, w.controlling!.end - 0.08, w.after!.start + 0.1, w.effects!.start + 0.12, w.effects!.end - 0.05];
    const targets: P[] = [pt(0.8, 0.24), pt(0.42, 0.1), pt(0.9, 0.5), pt(0.55, 0.02), pt(0.78, 0.3), pt(0.6, 0.12)];
    let p = targets[0]!;
    for (let i = 0; i < drags.length; i++) {
      const k = ease.outCubic(prog(t, drags[i]!, drags[i]! + 0.18));
      if (k <= 0) break;
      const a = targets[i]!, b = targets[i + 1]!;
      p = pt(lerp(a.x, b.x, k), lerp(a.y, b.y, k));
    }
    return pt(p.x * g.w, p.y * g.h);
  }
  dragsDone(t: number) {
    const w = this.w;
    return [w.controlling!.start + 0.05, w.controlling!.end - 0.08, w.after!.start + 0.1, w.effects!.start + 0.12, w.effects!.end - 0.05].filter((d) => t >= d + 0.1).length;
  }
  drawEditor(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w, g = this.ge;
    const t0 = w.instead!.start - 0.15;
    if (t < t0) return;
    const ga = this.groupAlpha('Bge', t) * prog(t, t0, t0 + 0.25);
    const hair = 1 / c.z;
    setWorld(ctx, c, g.x, g.y);
    ctx.fillStyle = rgba('ink2', 0.85 * ga);
    ctx.fillRect(0, 0, g.w, g.h);
    // axes and grid of the graph editor
    const m = { l: 60, r: 24, t: 48, b: 44 };
    const ex0 = m.l, ex1 = g.w - m.r, ey0 = m.t, ey1 = g.h - m.b;
    ctx.fillStyle = rgba('bone', 0.08 * ga);
    for (let i = 0; i <= 10; i++) ctx.fillRect(lerp(ex0, ex1, i / 10), ey0, hair, ey1 - ey0);
    for (let i = 0; i <= 6; i++) ctx.fillRect(ex0, lerp(ey0, ey1, i / 6), ex1 - ex0, hair);
    ctx.fillStyle = rgba('ash', 0.6 * ga);
    ctx.fillRect(ex0, ey1, ex1 - ex0, hair * 1.5);
    ctx.fillRect(ex0, ey0, hair * 1.5, ey1 - ey0);
    label(ctx, 'GRAPH EDITOR', 16, 30, { size: 12, col: rgba('bone', 0.65 * ga) });
    ctx.font = font(F.mono(400), 12);
    ctx.fillStyle = rgba('ash', 0.75 * ga);
    ctx.fillText('value', 12, ey0 + 14);
    ctx.textAlign = 'right';
    ctx.fillText('time →', ex1, ey1 + 28);
    ctx.textAlign = 'left';
    // the curve: key A (bottom left) → key B (top right), B's handle dragged by the cursor
    const A = pt(ex0 + 40, ey1 - 30), B = pt(ex1 - 50, ey0 + 40);
    const hA = pt(A.x + 180, A.y);
    const hp = this.handleAt(t);
    const hB = pt(hp.x, hp.y);
    ctx.strokeStyle = rgba('bone', 0.9 * ga);
    ctx.lineWidth = 2 / c.z;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.bezierCurveTo(hA.x, hA.y, hB.x, hB.y, B.x, B.y); ctx.stroke();
    // handles
    ctx.strokeStyle = rgba('ash', 0.8 * ga);
    ctx.lineWidth = hair;
    ctx.setLineDash([5 / c.z, 4 / c.z]);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(hA.x, hA.y); ctx.moveTo(B.x, B.y); ctx.lineTo(hB.x, hB.y); ctx.stroke();
    ctx.setLineDash([]);
    for (const q of [hA, hB]) { ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, TAU); ctx.stroke(); }
    for (const q of [A, B]) {
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = rgba('bone', 0.95 * ga); ctx.fillRect(-6, -6, 12, 12); ctx.restore();
    }
    // the cursor: an arrow pointer that grabs the handle
    const tIn = w.instead!.start + 0.2;
    if (t > tIn) {
      const k = ease.inOutCubic(prog(t, tIn, w.controlling!.start + 0.04));
      const from = pt(g.w * 0.95, g.h * 0.95);
      const cx = lerp(from.x, hB.x, k) + 4, cy = lerp(from.y, hB.y, k) + 4;
      const press = this.dragsDone(t + 0.1) > this.dragsDone(t) || [w.controlling!.start + 0.05, w.controlling!.end - 0.08, w.after!.start + 0.1, w.effects!.start + 0.12, w.effects!.end - 0.05].some((d) => t > d && t < d + 0.18);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1.9, 1.9);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 24); ctx.lineTo(6, 18); ctx.lineTo(10.5, 27.5); ctx.lineTo(14, 26); ctx.lineTo(9.6, 16.8); ctx.lineTo(17, 16.8); ctx.closePath();
      ctx.fillStyle = press ? rgba('signal', ga) : rgba('bone', 0.95 * ga);
      ctx.fill();
      ctx.strokeStyle = rgba('ink', ga);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }
    // the counter of manual adjustments
    const n = this.dragsDone(t);
    ctx.font = font(F.mono(500), 17);
    ctx.textAlign = 'right';
    ctx.fillStyle = n > 0 ? rgba('bone', 0.9 * ga) : rgba('ash', 0.7 * ga);
    ctx.fillText(`manual adjustments: ${n}`, g.w - 14, 32);
    if (n > 0) { const fl = pulse(t, [0, w.controlling!.start + 0.15, w.controlling!.end + 0.02, w.after!.start + 0.2, w.effects!.start + 0.22, w.effects!.end + 0.05][n]!, 0.12); if (fl > 0.05) { ctx.fillStyle = rgba('signal', fl); ctx.fillText(`${n}`, g.w - 14, 32); } }
    ctx.textAlign = 'left';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------------------------------------------------------------- B right: the prompt field
  caret(t: number): { x: number; y: number; hot: number } | null {
    const w = this.w;
    if (t < w.tell!.start) return null;
    const fs = 42, adv = measure('0', F.mono(400), fs);
    let x = this.pf.x + 90, y = this.pf.y + 112, hot = 0;
    for (const k of this.typed) {
      if (t < k.w.start) break;
      const n = Math.min(k.text.length, Math.ceil(k.text.length * clamp((t - k.w.start) / Math.max(0.08, (k.w.end - k.w.start) * 0.7))));
      x = k.x + n * adv; y = k.y;
      const since = t - k.w.start;
      hot = since < 0.3 ? 0.35 * Math.pow(0.5, since / 0.1) : 0;
    }
    return { x: x + 4, y: y - fs * 0.62, hot };
  }
  drawField(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w, f = this.pf;
    const t0 = w.basically!.start;
    if (t < t0) return;
    const a = prog(t, t0 + 0.2, t0 + 0.5);
    setWorld(ctx, c, f.x, f.y);
    ctx.fillStyle = rgba('ink', 0.85 * a);
    ctx.fillRect(0, 0, f.w, f.h);
    // registration ticks
    ctx.strokeStyle = rgba('bone', 0.6 * a);
    ctx.lineWidth = 1 / c.z;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[0, 0, -1, -1], [f.w, 0, 1, -1], [0, f.h, -1, 1], [f.w, f.h, 1, 1]] as const) {
      ctx.moveTo(x + sx * 6, y); ctx.lineTo(x + sx * 20, y);
      ctx.moveTo(x, y + sy * 6); ctx.lineTo(x, y + sy * 20);
    }
    ctx.stroke();
    const tl = w.tell!.start;
    const lit = prog(t, tl, tl + 0.1);
    ctx.font = font(F.mono(400), 44);
    ctx.fillStyle = rgba('ash', 0.75 * lit);
    ctx.fillText('›', 36, 110);
    label(ctx, 'PROMPT', 0, -14, { size: 13, col: rgba('bone', 0.6 * a) });
    label(ctx, 'TO  CLAUDE', 120, -14, { size: 13, col: mixCss('signal', 'ash', prog(t, w.claude2!.end, w.claude2!.end + 0.5), a) });
    ctx.font = font(F.mono(400), 13);
    ctx.fillStyle = rgba('ash', 0.75 * a);
    ctx.textAlign = 'right';
    ctx.fillText('returns: code', f.w, f.h + 26);
    ctx.textAlign = 'left';
    // the words, typed as they are said
    const fs = 42;
    ctx.font = font(F.mono(400), fs);
    for (const k of this.typed) {
      if (t < k.w.start) break;
      const n = Math.min(k.text.length, Math.ceil(k.text.length * clamp((t - k.w.start) / Math.max(0.08, (k.w.end - k.w.start) * 0.7))));
      const p = Lyrics.wordProgress(k.w, t);
      const cool = prog(t, k.w.end, k.w.end + 0.35);
      ctx.fillStyle = p < 1 ? rgba('signal', 1) : mixCss('signal', 'bone', cool);
      ctx.fillText(k.text.slice(0, n), k.x - f.x, k.y - f.y);
      // the karaoke bar under the word
      const adv = measure('0', F.mono(400), fs);
      ctx.fillStyle = rgba('signal', 1 - 0.8 * prog(t, k.w.end, k.w.end + 0.4));
      ctx.fillRect(k.x - f.x, k.y - f.y + 14, k.text.length * adv * p, 3);
    }
    // caret
    const car = this.caret(t);
    if (car) {
      const on = car.hot > 0.01 || Math.floor(t * 2.2) % 2 === 0;
      if (on) { ctx.fillStyle = rgba('signal', 1); ctx.fillRect(car.x - 4 - f.x, car.y - f.y - 6, 4, fs * 0.9); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    void triangle; void hash; void noise1; void LIN;
  }
}
