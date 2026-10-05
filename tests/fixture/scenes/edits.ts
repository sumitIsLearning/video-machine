// EDITS — "And because the animation is procedural, you can literally tell Claude: “Make this
// transition smoother.” “Change the colour.” “Slow this section down.” “Make the ending seamlessly
// loop into the beginning.” And it can modify the underlying animation instead of you manually
// moving hundreds of keyframes."
// 1. A dictionary entry: pro·ce·dur·al (adj.), set in Cormorant, defined deadpan.
// 2. A live PREVIEW (a looping little animation: a puck crossing, a circle that turns into a square,
//    a timeline under it) beside a CHAT: each command is typed as it is said, Claude answers with a
//    two-line diff, and the preview changes on the spot:
//      smoother → the hard cut becomes an eased morph (its curve in the corner turns from a step to an S)
//      colour   → the shapes turn acid (the video's one acid moment)
//      slow     → the transition's section stretches on the timeline and the puck slows through it
//      loop     → the timeline bends into a ring and the end morphs back into the start
// 3. "…instead of you manually moving hundreds of keyframes.": a field of 960 keyframe diamonds, a
//    cursor dragging them one at a time; on "keyframes." the whole field drops away.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font, measure, plain } from '../engine/type';
import { type Line, type Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, pulse, TAU } from '../engine/util';
import { sparkHead } from './_motifs';
import { Cam2D, gridPass, setGrid, drawKaraoke, placeRow, w2s, setWorld, label, mixCss, lineOf, wordOf, pt, drawPen, type KWord, type Cam } from './_vo';

const ARCH = (wd: number, wt: number) => F.archivo(wd, wt);
const PV = { x: -900, y: -300, w: 840, h: 472 }; // preview frame
const TL = { x: -900, y: 236, w: 840 };           // its timeline
const CH = { x: 0, y: -330, w: 920 };             // chat column
const CFS = 30, DFS = 22;                         // chat and diff font sizes
const KF = { x: -940, y: 1360, w: 1880, h: 560, rows: 24, cols: 40 }; // the keyframe field

interface Cmd { line: Line; text: string; diffs: [string, string]; y: number; tDone: number; rows: string[][] }

export default class Edits extends Scene {
  cam = new Cam2D();
  grid = gridPass(24, 96);
  fx = new LineBatch(30000);
  lines = new LineBatch(30000);
  ui = new Layer2D();
  kw: KWord[] = [];
  L13!: Line; L18!: Line;
  cmds: Cmd[] = [];
  w: Record<string, Word> = {};
  t0 = 0;

  override init() {
    const ly = this.ctx.lyrics;
    this.t0 = this.ctx.start;
    this.L13 = lineOf(ly, 'And because the animation');
    this.L18 = lineOf(ly, 'modify the underlying');
    const w = this.w;
    for (const [k, q] of [['and', 'And'], ['because', 'because'], ['the', 'the'], ['animation', 'animation'], ['is', 'is'], ['procedural', 'procedural'], ['you', 'you'], ['can', 'can'], ['literally', 'literally'], ['tell', 'tell'], ['claude', 'Claude']] as const) w[k] = wordOf(this.L13, q);
    for (const [k, q] of [['and2', 'And'], ['it', 'it'], ['can2', 'can'], ['modify', 'modify'], ['the2', 'the'], ['underlying', 'underlying'], ['animation2', 'animation'], ['instead', 'instead'], ['of', 'of'], ['you2', 'you'], ['manually', 'manually'], ['moving', 'moving'], ['hundreds', 'hundreds'], ['of2', 'of'], ['keyframes', 'keyframes']] as const) w[k] = wordOf(this.L18, q);
    const specs: [string, [string, string]][] = [
      ['transition smoother', ['- transition: cut()', '+ transition: morph(0.6, ease.inOutCubic)']],
      ['Change the colour', ['- fill: BONE · puck: SIGNAL', '+ fill: SIGNAL · puck: BONE']],
      ['Slow this section', ['- section(1.0, 1.6).speed = 1', '+ section(1.0, 1.6).speed = 0.5']],
      ['seamlessly loop', ['- end: square', '+ end: morph(circle) · loop: true']],
    ];
    let y = CH.y + 40;
    const adv = measure('0', F.mono(400), CFS), maxCh = Math.floor((CH.w - 70) / adv);
    for (const [q, diffs] of specs) {
      const line = lineOf(ly, q);
      // wrap the command by words into rows that fit the bubble
      const rows: string[][] = [[]];
      let n = 0;
      for (const wd of line.words) {
        const s0 = plain(wd.w);
        if (n > 0 && n + 1 + s0.length > maxCh) { rows.push([]); n = 0; }
        rows[rows.length - 1]!.push(s0);
        n += (n > 0 ? 1 : 0) + s0.length;
      }
      this.cmds.push({ line, text: plain(line.text), diffs, y, tDone: line.end + 0.12, rows });
      y += 58 + (rows.length - 1) * 42 + 112;
    }
    // said words
    const fam7 = ARCH(100, 700);
    this.kw.push(...placeRow([w.and!, w.because!, w.the!, w.animation!, w.is!, w.procedural!], -760, -1640, 70, fam7, 'd', { ant: 0.2 }).words);
    this.kw.push(...placeRow([w.you!, w.can!, w.literally!, w.tell!, w.claude!], PV.x, -400, 64, fam7, 'top1', { ant: 0.25 }).words);
    this.kw.push(...placeRow([w.and2!, w.it!, w.can2!, w.modify!, w.the2!, w.underlying!, w.animation2!], PV.x, -400, 64, fam7, 'top2', { ant: 0.15 }).words);
    this.kw.push(...placeRow([w.instead!, w.of!, w.you2!, w.manually!, w.moving!], KF.x, KF.y - 150, 72, fam7, 'kf', { ant: 0.2 }).words);
    this.kw.push(...placeRow([w.hundreds!, w.of2!, w.keyframes!], KF.x, KF.y - 56, 72, ARCH(100, 900), 'kf', { ant: 0.2, hot: 'signal' }).words);
    // camera
    const K = this.cam;
    K.key(this.t0, -60, -1520, 1.12, -0.012);
    K.key(w.procedural!.start, -40, -1500, 1.18, -0.006, ease.linear);
    K.key(w.procedural!.end + 0.3, -20, -1480, 1.22, 0, ease.linear);
    K.key(w.you!.start - 0.12, -20, -1470, 1.22, 0, ease.linear);
    K.key(w.you!.start + 0.2, 0, -30, 0.98, 0, ease.outExpo);
    for (let i = 0; i < this.cmds.length; i++) {
      const cm = this.cmds[i]!;
      K.key(cm.line.start + 0.2, 60, lerp(-30, cm.y + 40, 0.35), 1.05, 0.004 * (i % 2 ? 1 : -1), ease.inOutCubic);
      K.key(cm.tDone + 0.15, 0, -10, 1.0, 0, ease.inOutCubic);
    }
    K.key(w.and2!.start + 0.1, 0, 0, 0.99, 0, ease.inOutQuad);
    K.key(w.instead!.start - 0.1, 0, 10, 1.0, 0, ease.linear);
    K.key(w.instead!.start + 0.2, 0, KF.y + 120, 0.98, -0.01, ease.outExpo);
    K.key(w.hundreds!.start, 0, KF.y + 140, 1.0, -0.006, ease.linear);
    K.key(w.hundreds!.start + 0.35, 0, KF.y + 160, 0.8, 0, ease.outExpo);
    K.key(this.ctx.end, 0, KF.y + 170, 0.84, 0, ease.linear);
  }

  // ---------------------------------------------------------------- state of the preview
  k(i: number, t: number) { const c = this.cmds[i]!; return ease.inOutCubic(prog(t, c.tDone, c.tDone + 0.45)); }
  /** Preview clock: the loop with the slowed section; returns animation time a in [0, 3) and the loop phase. */
  clock(t: number) {
    const slow = this.k(2, t);
    const sec = 0.6 * (1 + slow);
    const period = 3.0 + 0.6 * slow;
    const lt = ((t - this.t0) % period + period) % period;
    let a: number;
    if (lt < 1.0) a = lt;
    else if (lt < 1.0 + sec) a = 1.0 + (lt - 1.0) / (1 + slow);
    else a = 1.6 + (lt - 1.0 - sec);
    return { a, lt, period, sec };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, w = this.w;
    const c = this.cam.at(t);
    setGrid(this.grid, c, { reveal: [0, 0, 1e5], ink: 0.75 });
    this.grid.render(renderer, out);
    const U = this.ui; U.clear();
    const ctx = U.ctx;
    this.drawDictionary(ctx, t, c);
    if (t > w.you!.start - 0.3) {
      this.drawPreview(ctx, t, c);
      this.drawTimeline(ctx, t, c);
      this.drawChat(ctx, t, c);
    }
    if (t > w.and2!.start) this.drawKeyframes(ctx, t, c);
    drawKaraoke(ctx, c, t, this.kw, { alpha: (g, tt) => this.groupAlpha(g, tt) });
    comp.draw(renderer, U.upload(), out);
    // sparks: the puck's spark in the preview, the keyframes falling into nothing
    const X = this.fx; X.clear();
    const puck = this.puckWorld(t);
    if (puck && t > w.you!.start) {
      const s = w2s(c, puck.x, puck.y);
      if (this.k(1, t) < 0.5) sparkHead(X, s[0], s[1], t, 0.6 * Math.sqrt(c.z), 0.8);
    }
    X.render(renderer, out);
    const punch = this.cmds.reduce((a, cm) => a + 0.012 * pulse(t, cm.tDone, 0.08), 0) + 0.02 * pulse(t, w.keyframes!.start, 0.1);
    return { bloom: 0.7, bloomThreshold: 0.86, vignette: 0.42, grain: 0.05, zoom: 1 + punch };
  }

  groupAlpha(g: string, t: number) {
    const w = this.w;
    switch (g) {
      case 'top1': return 1 - prog(t, w.and2!.start - 0.25, w.and2!.start);
      case 'top2': return prog(t, w.and2!.start - 0.25, w.and2!.start) * (1 - prog(t, w.instead!.start, w.instead!.start + 0.3));
      default: return 1;
    }
  }

  // ---------------------------------------------------------------- 1. the dictionary
  drawDictionary(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    if (t > w.you!.start + 0.4) return;
    const tp = w.procedural!.start;
    const x = -760, y = -1450;
    // headword with syllable dots, one syllable per quarter of the word
    const syl = ['pro', '·ce', '·dur', '·al'];
    const d = Math.max(0.3, w.procedural!.end - tp);
    setWorld(ctx, c, x, y, 1.5);
    ctx.font = font(F.serif(600), 100);
    let xx = 0;
    syl.forEach((s, i) => {
      const ti = tp + (i / 4) * d;
      if (t < ti - 0.3) { ctx.lineWidth = 1 / (c.z * 1.5); ctx.strokeStyle = rgba('ash', 0.35); ctx.strokeText(s, xx, 0); }
      else {
        const hot = t < ti ? 0 : 1 - prog(t, ti + 0.15, ti + 0.6);
        ctx.fillStyle = t < ti ? rgba('ash', 0.35) : mixCss('bone', 'signal', hot);
        ctx.fillText(s, xx, 0);
      }
      xx += ctx.measureText(s).width;
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ta = w.animation!.start + 0.1;
    const line = (s: string, yy: number, t1: number, size: number, fam: string, col = 'bone', a = 0.9) => {
      if (t < t1) return;
      const n = Math.ceil(s.length * prog(t, t1, t1 + 0.4));
      setWorld(ctx, c, x, yy, size / 100);
      ctx.font = font(fam, 100);
      ctx.fillStyle = rgba(col, a);
      ctx.fillText(s.slice(0, n), 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    line('(adj.)', y - 108, ta - 0.2, 30, F.serif(400, true), 'ash');
    line('1.  made by a procedure, not stored by hand.', y + 84, ta, 44, F.serif(400, true));
    line('2.  of an animation: a function of time, f(t).', y + 148, ta + 0.35, 44, F.serif(400, true));
    line('     Change the function and every frame follows.', y + 204, ta + 0.7, 44, F.serif(400, true), 'ash');
    line('see also: keyframe (obs.)', y + 270, ta + 1.0, 20, F.mono(400), 'ash', 0.85);
  }

  // ---------------------------------------------------------------- 2. the preview
  puckWorld(t: number) {
    const { a } = this.clock(t);
    const smooth = this.k(0, t);
    const L = PV.x + 110, R = PV.x + PV.w - 110, y = PV.y + PV.h - 110;
    let u: number;
    if (a < 1.0) u = lerp(a, ease.inOutCubic(a), smooth);
    else if (a < 1.6) u = 1;
    else u = 1 - lerp(clamp((a - 1.6) / 1.4), ease.inOutCubic(clamp((a - 1.6) / 1.4)), smooth);
    return pt(lerp(L, R, u), y);
  }
  /** Morph amount circle (0) → square (1) at animation time a. */
  morph(t: number, a: number) {
    const smooth = this.k(0, t), loop = this.k(3, t);
    const cut = a >= 1.3 ? 1 : 0;
    const eased = ease.inOutCubic(clamp((a - 1.0) / 0.6));
    let m = lerp(cut, eased, smooth);
    // the ending: before the loop fix it stays square (a pop at the wrap); after, it morphs back
    const back = ease.inOutCubic(clamp((a - 2.4) / 0.6));
    m = m * (1 - loop * back);
    return m;
  }
  drawPreview(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const a0 = prog(t, w.you!.start - 0.2, w.you!.start + 0.2);
    setWorld(ctx, c, PV.x, PV.y);
    ctx.globalAlpha = a0;
    ctx.fillStyle = rgba('ink', 0.95);
    ctx.fillRect(0, 0, PV.w, PV.h);
    ctx.strokeStyle = rgba('bone', 0.5);
    ctx.lineWidth = 1 / c.z;
    ctx.strokeRect(0, 0, PV.w, PV.h);
    label(ctx, 'PREVIEW', 0, -16, { size: 13, col: rgba('bone', 0.7) });
    const { a } = this.clock(t);
    ctx.font = font(F.mono(400), 13);
    ctx.fillStyle = rgba('ash', 0.85);
    ctx.textAlign = 'right';
    ctx.fillText(`a = ${a.toFixed(2)} s   ·   live`, PV.w, -16);
    ctx.textAlign = 'left';
    // the shape: circle ↔ square
    const m = this.morph(t, a);
    const swap = this.k(1, t);
    const col = mixCss('bone', 'signal', swap);
    const cx = PV.w / 2, cy = PV.h / 2 - 40, R = 100;
    ctx.beginPath();
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const u = i / N, an = u * TAU - Math.PI / 4;
      const circ = [Math.cos(an), Math.sin(an)];
      const sq = squareAt(u);
      const x = cx + lerp(circ[0]!, sq[0], m) * R, y = cy + lerp(circ[1]!, sq[1], m) * R;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.globalAlpha = a0 * 0.9;
    ctx.fill();
    ctx.globalAlpha = a0;
    // the puck's track and the puck
    const ty = PV.h - 110;
    ctx.fillStyle = rgba('ash', 0.6);
    ctx.fillRect(110, ty, PV.w - 220, 1.2 / c.z);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = this.puckWorld(t);
    const s = w2s(c, p.x, p.y);
    ctx.fillStyle = mixCss('signal', 'bone', swap);
    ctx.beginPath(); ctx.arc(s[0], s[1], 13 * c.z, 0, TAU); ctx.fill();
    // the transition's curve, inset in the corner: a step before, an S after
    setWorld(ctx, c, PV.x + PV.w - 190, PV.y + 24);
    ctx.fillStyle = rgba('ink2', 0.95);
    ctx.fillRect(0, 0, 166, 110);
    ctx.strokeStyle = rgba('bone', 0.3);
    ctx.lineWidth = 1 / c.z;
    ctx.strokeRect(0, 0, 166, 110);
    const smooth = this.k(0, t);
    ctx.strokeStyle = rgba(smooth > 0.5 ? 'signal' : 'bone', 0.95);
    ctx.lineWidth = 2 / c.z;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const v = lerp(u >= 0.5 ? 1 : 0, ease.inOutCubic(u), smooth);
      const x = 16 + u * 134, y = 92 - v * 72;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.font = font(F.mono(400), 11);
    ctx.fillStyle = rgba('ash', 0.85);
    ctx.fillText(smooth > 0.5 ? 'morph, eased' : 'cut', 16, 106 - 92);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** The preview's timeline: a bar with the transition's section; on "loop" it bends into a ring. */
  drawTimeline(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const a0 = prog(t, w.you!.start, w.you!.start + 0.3);
    const { lt, period, sec } = this.clock(t);
    const loop = this.k(3, t);
    const Lb = TL.w;
    const R = 0.62 * Lb / TAU;
    const ringC = pt(TL.x + TL.w / 2, TL.y + R + 14);
    const at = (u: number) => {
      const sx = TL.x + u * Lb, sy = TL.y;
      const an = -Math.PI / 2 + u * TAU;
      const rx = ringC.x + Math.cos(an) * R, ry = ringC.y + Math.sin(an) * R;
      return w2s(c, lerp(sx, rx, loop), lerp(sy, ry, loop));
    };
    ctx.globalAlpha = a0;
    // the bar
    ctx.strokeStyle = rgba('bone', 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) { const p = at(i / 120); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    ctx.stroke();
    // ticks
    for (let i = 0; i <= 12; i++) {
      const p = at(i / 12), q = at(i / 12 + 0.0001);
      const an = Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + Math.cos(an) * 8 * c.z, p[1] + Math.sin(an) * 8 * c.z); ctx.stroke();
    }
    // the transition section, highlighted
    const s0 = 1.0 / period, s1 = (1.0 + sec) / period;
    ctx.strokeStyle = rgba('signal', 1);
    ctx.lineWidth = 6 * c.z;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) { const p = at(lerp(s0, s1, i / 40)); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    ctx.stroke();
    const pm = at((s0 + s1) / 2);
    ctx.font = font(F.mono(500), 13 * c.z);
    ctx.fillStyle = rgba('signal', 1);
    ctx.textAlign = 'center';
    ctx.fillText(this.k(2, t) > 0.5 ? 'transition ×0.5' : 'transition', pm[0], pm[1] - 16 * c.z);
    ctx.textAlign = 'left';
    // the playhead
    const ph = at(lt / period);
    ctx.fillStyle = rgba('bone', 1);
    ctx.beginPath(); ctx.arc(ph[0], ph[1], 7 * c.z, 0, TAU); ctx.fill();
    // ends: "start" and "end" labels meet when looped
    const e0 = at(0), e1 = at(1);
    ctx.font = font(F.mono(400), 13 * c.z);
    ctx.fillStyle = rgba('ash', 0.85);
    ctx.fillText('start', e0[0] - 4 * c.z, e0[1] + 26 * c.z);
    ctx.textAlign = 'right';
    ctx.fillText(loop > 0.9 ? 'end = start' : 'end', e1[0] + 4 * c.z, e1[1] + (loop > 0.9 ? -16 : 26) * c.z);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- 2. the chat
  drawChat(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const a0 = prog(t, w.tell!.start, w.tell!.start + 0.3);
    setWorld(ctx, c, CH.x, CH.y);
    ctx.globalAlpha = a0;
    label(ctx, 'CHAT', 0, -14, { size: 13, col: rgba('bone', 0.7) });
    label(ctx, 'TO  CLAUDE', 90, -14, { size: 13, col: mixCss('signal', 'ash', prog(t, w.claude!.end, w.claude!.end + 0.6)) });
    ctx.fillStyle = rgba('bone', 0.3);
    ctx.fillRect(0, 0, CH.w, 1 / c.z);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const allMod = prog(t, w.modify!.start, w.modify!.start + 0.3);
    this.cmds.forEach((cm, i) => {
      const L = cm.line;
      if (t < L.start - 0.15) return;
      const y = cm.y - CH.y;
      setWorld(ctx, c, CH.x, CH.y + y);
      // the user bubble, typed as said (wrapped into rows)
      const fs = CFS, adv = measure('0', F.mono(400), fs);
      const bh = 58 + (cm.rows.length - 1) * 42;
      ctx.fillStyle = rgba('ink2', 0.95);
      ctx.fillRect(0, 0, CH.w, bh);
      ctx.strokeStyle = rgba('bone', 0.35);
      ctx.lineWidth = 1 / c.z;
      ctx.strokeRect(0, 0, CH.w, bh);
      ctx.font = font(F.mono(400), fs);
      ctx.fillStyle = rgba('ash', 0.8);
      ctx.fillText('›', 16, 40);
      let x = 46, row = 0, wi = 0, cx = 46;
      const ws = L.words;
      cm.rows.forEach((r, ri) => {
        x = 46;
        r.forEach((s0) => {
          const wd = ws[wi++]!;
          const n = Math.ceil(s0.length * clamp((t - wd.start) / Math.max(0.1, (wd.end - wd.start) * 0.75)));
          if (n > 0) {
            const said = t < wd.end + 0.05;
            const cool = prog(t, wd.end, wd.end + 0.35);
            ctx.fillStyle = said ? rgba('signal', 1) : mixCss('signal', 'bone', cool);
            ctx.fillText(s0.slice(0, n), x, 40 + ri * 42);
            cx = x + Math.min(n, s0.length) * adv; row = ri;
          }
          x += (s0.length + 1) * adv;
        });
      });
      const yo = (cm.rows.length - 1) * 42;
      // the caret while typing
      if (t > L.start && t < cm.tDone) { ctx.fillStyle = rgba('signal', Math.floor(t * 4) % 2 ? 1 : 0.4); ctx.fillRect(cx + 3, 14 + row * 42, 3, 34); }
      // Claude's answer: a diff
      if (t > cm.tDone - 0.05) {
        const k = prog(t, cm.tDone - 0.05, cm.tDone + 0.2);
        const hot = Math.max(pulse(t, cm.tDone, 0.15), 0.6 * allMod * (0.5 + 0.5 * Math.sin(t * 9 + i)));
        ctx.font = font(F.mono(400), DFS);
        const [m, p] = cm.diffs;
        ctx.fillStyle = rgba('ash', 0.75 * k);
        ctx.fillText(m.slice(0, Math.ceil(m.length * k)), 46, 96 + yo);
        const mw = measure(m, F.mono(400), DFS);
        ctx.fillStyle = rgba('ash', 0.6 * k);
        ctx.fillRect(68, 88 + yo, (mw - 22) * k, 1.4 / c.z);
        ctx.fillStyle = hot > 0.05 ? mixCss('signal', 'ember', hot, k) : rgba('signal', k);
        ctx.fillText(p.slice(0, Math.ceil(p.length * prog(t, cm.tDone + 0.05, cm.tDone + 0.3))), 46, 128 + yo);
        ctx.font = font(F.mono(400), 14);
        ctx.fillStyle = rgba('ash', 0.85 * prog(t, cm.tDone + 0.25, cm.tDone + 0.4));
        ctx.textAlign = 'right';
        ctx.fillText('applied · keyframes touched: 0', CH.w, 96 + yo);
        ctx.textAlign = 'left';
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    });
    // the summary on "modify the underlying animation"
    if (t > w.modify!.start) {
      const k = prog(t, w.modify!.start, w.modify!.start + 0.3);
      const last = this.cmds[this.cmds.length - 1]!;
      setWorld(ctx, c, CH.x, last.y + 58 + (last.rows.length - 1) * 42 + 150);
      ctx.font = font(F.mono(500), 22);
      ctx.fillStyle = rgba('bone', 0.9 * k);
      ctx.fillText('4 edits to the code  ·  +4 −4 lines', 0, 0);
      ctx.font = font(F.mono(400), 16);
      ctx.fillStyle = rgba('ash', 0.85 * prog(t, w.underlying!.start, w.underlying!.start + 0.3));
      ctx.fillText('every frame re-derived from f(t). nothing moved by hand.', 0, 32);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  // ---------------------------------------------------------------- 3. hundreds of keyframes
  drawKeyframes(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const tIn = w.instead!.start - 0.1;
    if (t < tIn) return;
    const tKill = w.keyframes!.start;
    const hair = 1 / c.z;
    setWorld(ctx, c, KF.x, KF.y);
    const a0 = prog(t, tIn, tIn + 0.3);
    // ruler and row lines
    ctx.globalAlpha = a0;
    ctx.fillStyle = rgba('bone', 0.12);
    const rh = KF.h / KF.rows;
    for (let r = 0; r <= KF.rows; r++) ctx.fillRect(0, r * rh, KF.w, hair);
    ctx.font = font(F.mono(400), 11);
    ctx.fillStyle = rgba('ash', 0.7);
    for (let i = 0; i <= 20; i++) { ctx.fillRect((i / 20) * KF.w, -8, hair, 8); if (i % 4 === 0) ctx.fillText(`0:${String(i).padStart(2, '0')}`, (i / 20) * KF.w + 3, -12); }
    // the diamonds: they appear in a sweep, then fall away on "keyframes."
    const n = KF.rows * KF.cols;
    let moved = 0;
    for (let r = 0; r < KF.rows; r++) for (let q = 0; q < KF.cols; q++) {
      const i = r * KF.cols + q;
      const tApp = tIn + 0.05 + (q / KF.cols) * 0.5 + hash(i, 1) * 0.15;
      if (t < tApp) continue;
      const x = (q + 0.5 + (hash(i, 2) - 0.5) * 0.7) * (KF.w / KF.cols), y = (r + 0.5) * rh;
      const fall = Math.max(0, t - tKill - hash(i, 3) * 0.35);
      if (fall > 1.2) continue;
      const dy = fall > 0 ? 900 * fall * fall + 60 * fall : 0;
      const rot = Math.PI / 4 + fall * (hash(i, 4) - 0.5) * 8;
      const s = 7 * (1 + 0.6 * pulse(t, tApp, 0.08));
      const al = a0 * (1 - clamp(fall / 1.0));
      // the cursor's victims: a few diamonds dragged by hand, glowing
      const victim = i % 97 === 11 && t > w.manually!.start + (i % 7) * 0.12;
      if (victim) moved++;
      ctx.save();
      ctx.translate(x + (victim ? 18 : 0), y + dy);
      ctx.rotate(rot);
      ctx.fillStyle = victim ? rgba('signal', al) : rgba(hash(i, 5) < 0.3 ? 'bone' : 'ash', 0.8 * al);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // the counter
    const total = n;
    const k = prog(t, w.hundreds!.start, w.hundreds!.start + 0.4);
    ctx.font = font(F.mono(500), 30);
    ctx.textAlign = 'right';
    const after = t > tKill + 0.3;
    ctx.fillStyle = after ? rgba('signal', 1) : rgba('bone', 0.9 * a0);
    ctx.fillText(after ? 'keyframes to move by hand: 0' : `keyframes to move by hand: ${Math.round(lerp(moved, total, k))}`, KF.w, KF.h + 54);
    ctx.textAlign = 'left';
    // the hand: a cursor hopping from diamond to diamond, dragging each one a little
    const h0 = w.manually!.start - 0.1, h1 = tKill;
    if (t > h0 && t < h1 + 0.2) {
      const hops = 6, u = clamp((t - h0) / (h1 - h0)) * hops;
      const j = Math.min(hops - 1, Math.floor(u)), f = u - j;
      const tgt = (q: number) => { const r = 3 + ((q * 7) % 18), cc = 6 + ((q * 13) % 30); return pt((cc + 0.5) * (KF.w / KF.cols), (r + 0.5) * rh); };
      const A0 = tgt(j), B0 = tgt(j + 1);
      const mv = ease.inOutCubic(clamp(f / 0.55)), drag = clamp((f - 0.6) / 0.3);
      const cx = lerp(A0.x + 18, B0.x, mv) + 22 * drag, cy = lerp(A0.y, B0.y, mv);
      ctx.save();
      ctx.translate(cx + 2, cy + 2);
      ctx.scale(1.7, 1.7);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 24); ctx.lineTo(6, 18); ctx.lineTo(10.5, 27.5); ctx.lineTo(14, 26); ctx.lineTo(9.6, 16.8); ctx.lineTo(17, 16.8); ctx.closePath();
      ctx.fillStyle = drag > 0 ? rgba('signal', 1) : rgba('bone', 0.95);
      ctx.fill();
      ctx.strokeStyle = rgba('ink', 1); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    void LIN; void noise1; void drawPen;
  }
}

function squareAt(u: number): [number, number] {
  const s = ((u % 1) + 1) % 1 * 4, i = Math.floor(s), f = s - i;
  const P: [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  const a = P[i % 4]!, b = P[(i + 1) % 4]!;
  return [lerp(a[0], b[0], f) * 0.86, lerp(a[1], b[1], f) * 0.86];
}
