// HOOK — "What if I told you… you can create motion graphics like this without even opening After
// Effects? And no — I'm not talking about an After Effects MCP."
// A. Black, crop marks, the spark at rest (the video's first and last frame). On "What" it flares and
//    writes the question in plotter lettering, each word as it is said, while the camera pulls back.
// B. "you can create motion graphics like this": a whip down; on "create" the pen ignites the graph
//    paper (axes, a shockwave ring); MOTION lands as kinetic type (each letter steps through Archivo's
//    widths, 62 → 100), GRAPHICS slams in letter by letter over a motion curve with its handles; on
//    "like this" a width ripple runs through both words and the sheet's title block types itself.
// C. "without even opening After Effects?": a generic keyframe timeline (layers, diamonds, a playhead)
//    slides in and the pen crosses it out in signal orange; AFTER EFFECTS? lands under it.
// D. "And no — I'm not talking about an After Effects MCP.": a hairline diagram CLAUDE → MCP →
//    AFTER EFFECTS with packets running; on "not" the pen snips the first link (the halves recoil);
//    on "MCP." the far nodes are struck out and sink; the camera dives into the CLAUDE node (→ model).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font, layout, measure } from '../engine/type';
import { type Line, type Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, pulse, TAU } from '../engine/util';
import { sparkHead } from './_motifs';
import { strokeText } from '../engine/stroke';
import {
  Plot, Cam2D, gridPass, setGrid, drawKaraoke, placeRow, fitRow, drawPen, w2s, setWorld, label, mixCss,
  pt, arc, rectPts, bezier, lineOf, wordOf, type P, type KWord, type Cam,
} from './_vo';

const ARCH = (wd: number, wt: number) => F.archivo(wd, wt);
const WIDTHS = [62, 75, 87.5, 100, 112.5, 125];

export default class Hook extends Scene {
  plot = new Plot();
  cam = new Cam2D();
  grid = gridPass(24, 96);
  lines = new LineBatch(60000);
  fx = new LineBatch(30000);
  ui = new Layer2D();
  kw: KWord[] = [];
  L0!: Line; L1!: Line;
  w: Record<string, Word> = {};
  rest = pt(0, 0);
  // shot B geometry
  X0 = -760; CW = 1520;
  yRow = 300; ySm = 64; yM = 0; sM = 0; yG = 0; sG = 0;
  O = pt(0, 0);
  likeEnd = pt(0, 0);
  tb = { x: 0, y: 0, w: 560, rh: 30 };
  // shot C
  pan = { x: -760, y: 1300, w: 1520, h: 400 };
  // shot D
  nodes: { id: string; label: string; sub: string; x: number; y: number }[] = [];
  tEnd = 0;

  override init() {
    const ly = this.ctx.lyrics;
    this.tEnd = this.ctx.end;
    this.L0 = lineOf(ly, 'What if I told you');
    this.L1 = lineOf(ly, 'And no');
    const w = this.w, L0 = this.L0, L1 = this.L1;
    for (const [k, q, n] of [['what', 'What', 0], ['if', 'if', 0], ['I', 'I', 0], ['told', 'told', 0], ['you1', 'you', 0], ['you2', 'you', 1], ['can', 'can', 0],
      ['create', 'create', 0], ['motion', 'motion', 0], ['graphics', 'graphics', 0], ['like', 'like', 0], ['this', 'this', 0], ['without', 'without', 0],
      ['even', 'even', 0], ['opening', 'opening', 0], ['after', 'After', 0], ['effects', 'Effects', 0]] as const) w[k] = wordOf(L0, q, n);
    for (const [k, q] of [['and', 'And'], ['no', 'no'], ['dash', '—'], ['im', 'I’m'], ['not', 'not'], ['talking', 'talking'], ['about', 'about'], ['an', 'an'], ['after2', 'After'], ['effects2', 'Effects'], ['mcp', 'MCP']] as const) w[k] = wordOf(L1, q);

    this.buildA();
    this.buildB();
    this.buildC();
    this.buildD();
    this.buildCamera();
    this.plot.alpha = (g, t) => this.groupAlpha(g, t);
  }

  // ================================================================== A: the question, written
  buildA() {
    const w = this.w;
    const text = 'What if I told you…';
    const tw = 1180;
    // measure at 100 then scale to the target width
    const size = (100 * tw) / strokeText(text, 'readable', 100).width;
    const x = -tw / 2, y = 30;
    const st = this.plot.writeWords(text, [w.what!, w.if!, w.I!, w.told!, w.you1!], 'readable', size, x, y, 'A', { width: 2.2, endEarly: 0.02 });
    const first = st.strokes[0]![0]!;
    this.rest = pt(x + first.x, y + first.y);
    // the pen waits at rest from the first frame
    this.plot.wp(this.rest, 0.0, Math.max(0.01, w.what!.start - 0.01));
    // a hairline baseline under the question, ruled as "you…" is said
    this.plot.add([pt(x - 40, y + 26), pt(x + tw + 40, y + 26)], w.you1!.start, w.you1!.start + 0.35, 'cons', { ez: ease.outCubic, alpha: 0.6, group: 'A' });
    this.plot.note('fig. 0', x - 40, y + 56, w.you1!.start + 0.15, { size: 13, col: 'ash', group: 'A' });
    this.plot.note('a rhetorical question', x + tw + 40, y + 56, w.you1!.start + 0.2, { size: 13, col: 'ash', group: 'A', align: 'right' });
  }

  // ================================================================== B: motion graphics
  buildB() {
    const w = this.w, P = this.plot;
    const famM = ARCH(100, 900);
    this.sM = fitRow(['MOTION'], this.CW, famM, 420);
    this.sG = fitRow(['GRAPHICS'], this.CW, famM, 420);
    const cap = 0.7;
    this.yM = this.yRow + 40 + cap * this.sM;
    this.yG = this.yM + 0.2 * this.sM + cap * this.sG;
    // "you can create" (small row above), "like this" (small row under, right-aligned)
    const r1 = placeRow([w.you2!, w.can!, w.create!], this.X0, this.yRow, this.ySm, ARCH(100, 700), 'B', { ant: 0.15 });
    this.kw.push(...r1.words);
    const famS = ARCH(100, 700);
    const r2 = placeRow([w.like!, w.this!], this.X0, this.yG + 44 + 0.72 * this.ySm, this.ySm, famS, 'B', { ant: 0.15 });
    this.kw.push(...r2.words);
    this.likeEnd = pt(this.X0 + r2.width + 18, this.yG + 44 + 0.36 * this.ySm);
    // ignition: the pen strikes at O (left end of MOTION's baseline) on "create"
    const O = pt(this.X0 - 70, this.yM);
    this.O = O;
    const tI = w.create!.start;
    P.wp(O, tI - 0.01, 0.01);
    const ax = (b: P, d: number, g = 'Baxes') => P.add([O, b], tI + d, tI + d + 0.55, 'axis', { ez: ease.outExpo, width: 1.1, group: g });
    ax(pt(O.x + this.CW + 260, O.y), 0);
    ax(pt(O.x - 900, O.y), 0.01);
    ax(pt(O.x, O.y - 900), 0.03);
    ax(pt(O.x, O.y + 900), 0.04);
    // ticks along the baseline axis, cascading with the ray head
    const reach = (d: number, len: number) => { let lo = 0, hi = 1; for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (ease.outExpo(m) * len < d) lo = m; else hi = m; } return tI + 0.55 * hi; };
    for (let i = 1; i <= 17; i++) {
      const d = i * 100, ti = reach(d, this.CW + 260);
      P.add([pt(O.x + d, O.y - 7), pt(O.x + d, O.y + 7)], ti, ti + 0.04, 'axis', { width: 1, group: 'Baxes' });
      P.note(String(i * 100), O.x + d, O.y + 26, ti + 0.02, { size: 11, align: 'center', col: 'ash', a: 0.7, group: 'Bticks', dur: 0.03 });
    }
    P.note('(0, 0)', O.x - 10, O.y + 26, tI + 0.08, { size: 11, align: 'right', col: 'ash', group: 'Bticks', dur: 0.05 });
    // cap line of MOTION and GRAPHICS, dashed construction
    P.add([pt(this.X0 - 40, this.yM - 0.7 * this.sM), pt(this.X0 + this.CW + 60, this.yM - 0.7 * this.sM)], w.motion!.start - 0.05, w.motion!.start + 0.3, 'cons', { ez: ease.outCubic, alpha: 0.55, dash: 10, group: 'Bcons' });
    P.add([pt(this.X0 - 40, this.yG), pt(this.X0 + this.CW + 60, this.yG)], w.graphics!.start - 0.04, w.graphics!.start + 0.3, 'cons', { ez: ease.outCubic, alpha: 0.6, group: 'Bcons' });
    P.add([pt(this.X0 - 40, this.yG - 0.7 * this.sG), pt(this.X0 + this.CW + 60, this.yG - 0.7 * this.sG)], w.graphics!.start, w.graphics!.start + 0.3, 'cons', { ez: ease.outCubic, alpha: 0.45, dash: 10, group: 'Bcons' });
    P.note('cap height', this.X0 + this.CW + 70, this.yM - 0.7 * this.sM + 4, w.motion!.start + 0.25, { size: 11, col: 'ash', group: 'Bcons' });
    P.note('baseline', this.X0 + this.CW + 70, this.yG + 4, w.graphics!.start + 0.25, { size: 11, col: 'ash', group: 'Bcons' });
    // the motion curve: a bezier through the type with its two handles (graph-editor idiom)
    const g0 = w.graphics!.start;
    const c0 = pt(this.X0 - 20, this.yG + 70), c3 = pt(this.X0 + this.CW + 20, this.yM - 0.7 * this.sM - 40);
    const c1 = pt(this.X0 + this.CW * 0.62, this.yG + 90), c2 = pt(this.X0 + this.CW * 0.38, this.yM - 0.7 * this.sM - 60);
    P.add([c0, c1], g0 + 0.02, g0 + 0.12, 'cons', { alpha: 0.7, dash: 6, group: 'Bcurve' });
    P.add([c3, c2], g0 + 0.04, g0 + 0.14, 'cons', { alpha: 0.7, dash: 6, group: 'Bcurve' });
    for (const q of [c1, c2]) P.add(arc(q.x, q.y, 7, 0, TAU, 20), g0 + 0.1, g0 + 0.16, 'dim', { group: 'Bcurve' });
    P.add(bezier(c0, c1, c2, c3, 80), g0 + 0.06, w.graphics!.end + 0.05, 'plot', { pen: true, ez: ease.inOutCubic, width: 2.0, group: 'Bcurve' });
    P.note('ease.inOutCubic', c1.x + 14, c1.y + 24, g0 + 0.18, { size: 12, col: 'ash', group: 'Bcurve' });
    P.note('cubic-bezier(.62, 0, .38, 1)', c2.x - 14, c2.y - 14, g0 + 0.2, { size: 12, col: 'ash', group: 'Bcurve', align: 'right' });
    // the sheet's title block (bottom right), on "like this"
    const tb = { x: this.X0 + this.CW - 560, y: this.yG + 62, w: 560, rh: 30 };
    this.tb = tb;
    const tt = w.like!.start;
    P.add(rectPts(tb.x, tb.y, tb.w, tb.rh * 3), tt, tt + 0.22, 'cons', { pen: true, alpha: 0.75, group: 'Btitle' });
    for (let r = 1; r < 3; r++) P.add([pt(tb.x, tb.y + r * tb.rh), pt(tb.x + tb.w, tb.y + r * tb.rh)], tt + 0.1, tt + 0.22, 'cons', { alpha: 0.55, group: 'Btitle' });
    P.add([pt(tb.x + 300, tb.y + tb.rh), pt(tb.x + 300, tb.y + 3 * tb.rh)], tt + 0.14, tt + 0.25, 'cons', { alpha: 0.55, group: 'Btitle' });
    const cell = (s: string, dx: number, r: number, d: number, col = 'ash') => P.note(s, tb.x + dx, tb.y + r * tb.rh + 20, tt + d, { size: 12, col, group: 'Btitle', dur: 0.15 });
    cell('TITLE      motion graphics (this one)', 12, 0, 0.18, 'bone');
    cell('DRAWN BY   code', 12, 1, 0.26);
    cell('KEYFRAMES  0', 312, 1, 0.32);
    cell('SCALE      1:1', 12, 2, 0.38);
    cell('SHEET      1 of 9', 312, 2, 0.44);
    // the pen visits the title block, then idles near "this"
    P.wp(pt(tb.x + tb.w - 6, tb.y + 3 * tb.rh + 4), w.this!.end + 0.05, 0.05);
  }

  // ================================================================== C: the timeline, crossed out
  buildC() {
    const w = this.w, P = this.plot, p = this.pan;
    const r1 = placeRow([w.without!, w.even!, w.opening!], p.x, p.y - 36, 64, ARCH(100, 700), 'C', { ant: 0.2 });
    this.kw.push(...r1.words);
    const fam = ARCH(100, 900);
    const sz = Math.min(200, fitRow(['After', 'Effects?'], p.w, fam));
    const r2 = placeRow([w.after!, w.effects!], p.x, p.y + p.h + 40 + 0.7 * sz, sz, fam, 'C2', { ant: 0.25 });
    this.kw.push(...r2.words);
    // the pen crosses the panel out: one stroke on "opening", the other on "After"
    const a = pt(p.x - 24, p.y - 14), b = pt(p.x + p.w + 24, p.y + p.h + 14);
    const c = pt(p.x + p.w + 24, p.y - 14), d = pt(p.x - 24, p.y + p.h + 14);
    P.add([a, b], w.opening!.start, w.opening!.start + 0.2, 'signal', { pen: true, ez: ease.inOutQuad, width: 6, group: 'Cx' });
    P.add([c, d], w.after!.start, w.after!.start + 0.2, 'signal', { pen: true, ez: ease.inOutQuad, width: 6, group: 'Cx' });
  }

  // ================================================================== D: the MCP diagram
  buildD() {
    const w = this.w, P = this.plot;
    const cy = 1560, x0 = 2240, dx = 620;
    this.nodes = [
      { id: 'claude', label: 'CLAUDE', sub: 'the model', x: x0, y: cy },
      { id: 'mcp', label: 'MCP SERVER', sub: 'remote control', x: x0 + dx, y: cy },
      { id: 'ae', label: 'AFTER EFFECTS', sub: 'layers · keyframes', x: x0 + 2 * dx, y: cy },
    ];
    const r1 = placeRow([w.and!, w.no!, w.dash!], x0 - 170, cy - 170, 150, ARCH(100, 900), 'D', { ant: 0.25 });
    this.kw.push(...r1.words);
    const r2 = placeRow([w.im!, w.not!, w.talking!, w.about!, w.an!, w.after2!, w.effects2!, w.mcp!], x0 - 170, cy + 175, 54, ARCH(100, 700), 'D', { ant: 0.2 });
    this.kw.push(...r2.words);
    // snip: the pen arrives at the first link's midpoint and slashes it on "not"
    const mx = x0 + dx / 2, tn = w.not!.start;
    P.add([pt(mx + 16, cy - 44), pt(mx - 16, cy + 44)], tn, tn + 0.08, 'signal', { pen: true, width: 3, group: 'Dsnip', e0: tn + 0.25, e1: tn + 0.55 });
    // strike the MCP node on "MCP."
    const m = this.nodes[1]!, tm = w.mcp!.start;
    P.add([pt(m.x - 190, m.y), pt(m.x + 190, m.y)], tm, tm + 0.16, 'signal', { pen: true, ez: ease.inOutQuad, width: 5, group: 'Dstrike' });
    P.add([pt(this.nodes[2]!.x - 190, cy), pt(this.nodes[2]!.x + 190, cy)], tm + 0.2, tm + 0.34, 'signal', { pen: true, ez: ease.inOutQuad, width: 5, group: 'Dstrike' });
    // the pen comes home to the CLAUDE node and rests there
    P.wp(pt(this.nodes[0]!.x, this.nodes[0]!.y + 2), w.mcp!.end - 0.02, this.tEnd - w.mcp!.end + 0.2);
  }

  // ================================================================== camera
  buildCamera() {
    const w = this.w, K = this.cam;
    const r = this.rest;
    K.key(0, r.x, r.y, 2.4, 0.06);
    K.key(w.what!.start, r.x, r.y, 2.4, 0.06);
    K.key(w.told!.start, -170, -10, 1.45, 0.02, ease.outCubic);
    K.key(w.you1!.end + 0.1, 40, -20, 1.12, 0, ease.inOutQuad);
    // whip down to B
    const bcx = this.X0 + this.CW / 2, bcy = (this.yRow - 60 + this.yG + 160) / 2;
    K.key(w.you2!.start - 0.06, 60, 30, 1.12, 0, ease.linear);
    K.key(w.you2!.start + 0.22, bcx - 30, bcy - 10, 0.86, -0.02, ease.outExpo);
    K.key(w.create!.start, bcx - 20, bcy, 0.88, -0.015, ease.linear);
    K.key(w.create!.start + 0.3, bcx - 10, bcy + 5, 0.9, 0.0, ease.outExpo);
    K.key(w.this!.end, bcx, bcy + 10, 0.95, 0.008, ease.linear);
    // whip down to C
    const p = this.pan, ccx = p.x + p.w / 2, ccy = p.y + p.h / 2 + 60;
    K.key(w.without!.start - 0.08, bcx, bcy + 25, 0.95, 0.008, ease.linear);
    K.key(w.without!.start + 0.2, ccx, ccy - 20, 0.92, -0.01, ease.outExpo);
    K.key(w.opening!.start, ccx, ccy - 10, 0.93, -0.008, ease.linear);
    K.key(w.opening!.start + 0.16, ccx, ccy, 0.97, 0.012, ease.outExpo);
    K.key(w.effects!.end + 0.25, ccx + 10, ccy + 10, 1.0, 0.012, ease.linear);
    // whip right to D
    const n0 = this.nodes[0]!, n1 = this.nodes[1]!;
    K.key(w.and!.start - 0.12, ccx + 30, ccy + 10, 1.0, 0.012, ease.linear);
    K.key(w.and!.start + 0.16, n1.x - 10, n1.y - 20, 0.88, -0.012, ease.outExpo);
    K.key(w.not!.start, n1.x, n1.y - 15, 0.9, -0.008, ease.linear);
    K.key(w.not!.start + 0.14, n1.x - 40, n1.y - 5, 0.95, 0.008, ease.outExpo);
    K.key(w.mcp!.start, n1.x - 30, n1.y - 5, 0.97, 0.008, ease.linear);
    K.key(w.mcp!.end + 0.02, n0.x + 120, n0.y, 1.3, 0.0, ease.inOutCubic);
    K.key(this.tEnd, n0.x, n0.y + 2, 5.2, 0.0, ease.inQuart);
  }

  // ================================================================== group visibility
  groupAlpha(g: string, t: number): number {
    const w = this.w;
    switch (g) {
      case 'A': return 1 - 0.75 * prog(t, w.you2!.start, w.you2!.start + 0.4);
      case 'Baxes': return 1 - 0.55 * prog(t, w.without!.start, w.without!.start + 0.4);
      case 'Bticks': return 0.9 - 0.7 * prog(t, w.like!.start, w.this!.end);
      case 'Bcons': case 'Bcurve': case 'Btitle': case 'B': return 1;
      case 'C': case 'C2': return 1;
      default: return 1;
    }
  }

  // ================================================================== render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, w = this.w;
    const c = this.cam.at(t);
    const tI = w.create!.start;
    const pen = this.plot.penAt(t);
    const ps = pen ? w2s(c, pen.x, pen.y) : null;
    // ---- the sheet: graph paper ignites from O on "create"
    setGrid(this.grid, c, {
      reveal: [this.O.x, this.O.y, t < tI ? 0 : 5200 * ease.outCubic(prog(t, tI + 0.05, tI + 1.4))],
      ink: 1, pen: ps ? [ps[0], ps[1], prog(t, w.what!.start - 0.05, w.what!.start + 0.05)] : [0, 0, 0],
    });
    this.grid.render(renderer, out);

    // ---- strokes
    const L = this.lines; L.clear();
    this.plot.draw(t, c, L);
    this.drawRing(t, c, L);
    L.render(renderer, out);

    // ---- type & UI
    const U = this.ui; U.clear();
    const ctx = U.ctx;
    this.drawPanel(ctx, t, c);
    this.drawNodes(ctx, t, c);
    this.plot.drawNotes(t, c, ctx);
    drawKaraoke(ctx, c, t, this.kw, { alpha: (g, tt) => this.groupAlpha(g, tt) });
    this.drawHero(ctx, t, c);
    comp.draw(renderer, U.upload(), out);

    // ---- the pen and other sparks
    const X = this.fx; X.clear();
    const flare = prog(t, w.what!.start - 0.03, w.what!.start + 0.02);
    drawPen(X, t, (tt) => { const q = this.plot.penAt(tt); return q ? w2s(c, q.x, q.y) : null; }, {
      scale: 0.75 + 0.5 * flare + 0.9 * pulse(t, tI, 0.14) + 0.4 * pulse(t, w.not!.start, 0.1),
      intensity: 0.55 + 0.45 * flare, rate: t < w.what!.start ? 0 : 60, from: w.what!.start,
    });
    this.drawPackets(X, t, c);
    this.drawSnipSparks(X, t, c);
    X.render(renderer, out);

    // ---- post
    const punch = 0.02 * pulse(t, tI, 0.09) + 0.014 * pulse(t, w.motion!.start, 0.08) + 0.012 * pulse(t, w.graphics!.start, 0.08)
      + 0.016 * pulse(t, w.opening!.start, 0.08) + 0.01 * pulse(t, w.after!.start, 0.08) + 0.014 * pulse(t, w.not!.start, 0.08) + 0.01 * pulse(t, w.mcp!.start, 0.08);
    const sh = 10 * pulse(t, tI, 0.07) + 6 * pulse(t, w.opening!.start, 0.06) + 7 * pulse(t, w.not!.start, 0.06);
    return {
      bloom: 0.72 - 0.25 * pulse(t, tI, 0.25), bloomThreshold: 0.82, vignette: 0.42, grain: 0.05,
      flash: 0.012 * pulse(t, tI, 0.03) + 0.008 * pulse(t, w.what!.start, 0.04),
      zoom: 1 + punch, shake: [sh * noise1(t * 45, 3), sh * noise1(t * 51, 4)],
      // the crop marks: in place on the first frame (the loop point), flying out on the whip to B
      frame: 1 - prog(t, w.you2!.start - 0.1, w.you2!.start + 0.2, ease.inOutCubic),
    };
  }

  // ---------------------------------------------------------------- B: ignition ring
  drawRing(t: number, c: Cam, L: LineBatch) {
    const t0 = this.w.create!.start, age = t - t0;
    if (age < 0 || age > 0.75) return;
    const R = 30 + 900 * ease.outCubic(age / 0.75), I = Math.pow(1 - age / 0.75, 1.5);
    const sig = LIN.signal, bone = LIN.bone;
    let prev: [number, number] | null = null;
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU;
      const cur = w2s(c, this.O.x + R * Math.cos(a), this.O.y + R * Math.sin(a));
      if (prev) L.seg2(prev[0], prev[1], cur[0], cur[1], 1.3, [sig[0] * 0.9 * I + bone[0] * 0.35 * I, sig[1] * 0.9 * I + bone[1] * 0.35 * I, sig[2] * 0.9 * I + bone[2] * 0.35 * I], I);
      prev = cur;
    }
  }

  // ---------------------------------------------------------------- B: kinetic hero type
  drawHero(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    if (t < w.motion!.start - 0.05) return;
    const ripple0 = w.like!.start;
    const draw = (text: string, word: Word, y: number, size: number, mode: 'morph' | 'slam', row: number) => {
      const fam100 = ARCH(100, 900);
      const lay = layout(text, fam100, 100);
      const n = lay.glyphs.length;
      const dur = Math.max(0.2, word.end - word.start);
      lay.glyphs.forEach((g, i) => {
        const ti = word.start + (i / n) * dur * 0.85;
        if (t < ti) return;
        const age = t - ti;
        // glyph centre at its final (width 100) position
        const cx = this.X0 + ((g.x + g.w / 2) / 100) * size;
        let wd = 100, dy = 0, sc = 1;
        if (mode === 'morph') {
          // condensed → normal in Archivo's width steps
          const k = ease.outExpo(clamp(age / 0.32));
          wd = WIDTHS[Math.min(3, Math.floor(k * 3.999))]!;
          dy = (1 - ease.outCubic(clamp(age / 0.25))) * -0.12 * size;
        } else {
          sc = 1 + 0.22 * (1 - ease.outExpo(clamp(age / 0.18)));
        }
        // the ripple on "like this": a width bump that runs through both words
        const rp = t - ripple0 - (row * 0.14 + i * 0.045);
        if (rp > 0 && rp < 0.42) {
          const b = Math.sin((rp / 0.42) * Math.PI);
          wd = WIDTHS[Math.min(5, 3 + Math.round(b * 2))]!;
        }
        const fam = ARCH(wd, 900);
        const gw = measure(g.ch, fam, 100);
        const hot = Math.pow(0.5, age / 0.09);
        const cool = prog(t, ti + 0.05, ti + 0.45);
        ctx.font = font(fam, 100);
        setWorld(ctx, c, cx - ((gw / 2) / 100) * size * sc, y + dy, (size / 100) * sc);
        ctx.fillStyle = hot > 0.08 ? mixCss('ember', 'signal', 1 - hot) : mixCss('signal', 'bone', cool);
        ctx.fillText(g.ch, 0, 0);
      });
    };
    draw('MOTION', w.motion!, this.yM, this.sM, 'morph', 0);
    draw('GRAPHICS', w.graphics!, this.yG, this.sG, 'slam', 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // a deadpan callout on "this": a leader from the word to the title block's TITLE cell
    const tt = w.this!.start;
    if (t > tt) {
      const k = prog(t, tt, tt + 0.22, ease.outCubic);
      const a = prog(t, tt, tt + 0.1);
      const e = this.likeEnd, tb = this.tb;
      const pts = [w2s(c, e.x, e.y), w2s(c, tb.x - 40, e.y), w2s(c, tb.x - 40, tb.y + 15), w2s(c, tb.x - 6, tb.y + 15)];
      ctx.strokeStyle = rgba('ash', 0.85 * a);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      const segs = pts.length - 1, u = k * segs;
      for (let i = 1; i <= segs; i++) {
        const f = clamp(u - (i - 1));
        if (f <= 0) break;
        ctx.lineTo(lerp(pts[i - 1]![0], pts[i]![0], f), lerp(pts[i - 1]![1], pts[i]![1], f));
      }
      ctx.stroke();
      if (k >= 1) { ctx.fillStyle = rgba('ash', 0.9 * a); ctx.beginPath(); ctx.arc(pts[0]![0] - 6, pts[0]![1], 3, 0, TAU); ctx.fill(); }
    }
  }

  // ---------------------------------------------------------------- C: the keyframe timeline
  drawPanel(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w, p = this.pan;
    const t0 = w.without!.start - 0.1;
    if (t < t0) return;
    const reveal = ease.outExpo(prog(t, t0, t0 + 0.45));
    const crossed = prog(t, w.after!.start + 0.15, w.effects!.end, ease.inOutQuad);
    const dim = 1 - 0.6 * crossed;
    const slide = (1 - ease.outExpo(prog(t, t0, t0 + 0.5))) * 120;
    ctx.save();
    setWorld(ctx, c, p.x, p.y + slide);
    // clip: wipe in from the left
    ctx.beginPath(); ctx.rect(-30, -60, (p.w + 60) * reveal, p.h + 120); ctx.clip();
    const hair = 1 / c.z;
    ctx.fillStyle = rgba('ink2', 0.92);
    ctx.fillRect(0, 0, p.w, p.h);
    ctx.lineWidth = hair;
    ctx.strokeStyle = rgba('bone', 0.4 * dim);
    ctx.strokeRect(0, 0, p.w, p.h);
    const head = 46, lc = 230, rows = 6, rh = (p.h - head - 14) / rows;
    const x0 = lc, x1 = p.w - 18, tl = (x1 - x0);
    // header: ruler
    ctx.fillStyle = rgba('bone', 0.18 * dim);
    ctx.fillRect(0, head, p.w, hair);
    ctx.fillRect(lc, 0, hair, p.h);
    ctx.font = font(F.mono(400), 12);
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i <= 60; i++) {
      const x = x0 + (i / 60) * tl;
      const big = i % 10 === 0;
      ctx.fillStyle = rgba('ash', (big ? 0.7 : 0.35) * dim);
      ctx.fillRect(x, head - (big ? 14 : 6), hair, big ? 14 : 6);
      if (big) ctx.fillText(`0:${String(i / 4).padStart(2, '0')}`.replace('.5', ':30'), x + 4, head - 18);
    }
    label(ctx, 'TIMELINE', 14, 28, { size: 12, col: rgba('bone', 0.65 * dim) });
    ctx.textAlign = 'right';
    ctx.font = font(F.mono(400), 12);
    ctx.fillStyle = rgba('ash', 0.75 * dim);
    ctx.fillText('comp 1 · 1920×1080 · 60 fps', p.w - 14, -12);
    ctx.textAlign = 'left';
    // layers
    const names = ['TEXT 01', 'SHAPE 02', 'SHAPE 03', 'CAMERA', 'NULL 05', 'ADJUST 06'];
    let nk = 0;
    names.forEach((nm, r) => {
      const y = head + 7 + r * rh;
      const tr = t0 + 0.08 + r * 0.04;
      const ra = prog(t, tr, tr + 0.15) * dim;
      ctx.fillStyle = rgba('bone', 0.1 * ra);
      ctx.fillRect(0, y + rh, p.w, hair);
      label(ctx, nm, 16, y + rh * 0.62, { size: 12, col: rgba('bone', 0.6 * ra), spacing: 2 });
      // the layer bar
      const b0 = x0 + tl * (0.02 + 0.12 * hash(r, 3)), b1 = x0 + tl * (0.7 + 0.28 * hash(r, 4));
      ctx.fillStyle = rgba('graphite', 0.35 * ra);
      ctx.fillRect(b0, y + rh * 0.28, (b1 - b0) * reveal, rh * 0.44);
      ctx.strokeStyle = rgba('ash', 0.5 * ra);
      ctx.strokeRect(b0, y + rh * 0.28, (b1 - b0) * reveal, rh * 0.44);
      // keyframes (hand-set, of course)
      const nkr = 4 + Math.floor(hash(r, 5) * 6);
      for (let k = 0; k < nkr; k++) {
        const kx = lerp(b0 + 14, b1 - 14, (k + hash(r, k, 6) * 0.6) / nkr);
        const tk = tr + 0.1 + k * 0.03;
        const ka = prog(t, tk, tk + 0.08) * dim;
        if (ka <= 0) continue;
        nk++;
        const s = 7;
        ctx.save();
        ctx.translate(kx, y + rh * 0.5);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = rgba(k % 3 === 0 ? 'bone' : 'ash', 0.85 * ka);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
    });
    // playhead
    const ph = x0 + tl * (0.42 + 0.02 * Math.sin(t * 1.3));
    ctx.fillStyle = rgba('signal', 0.9 * dim);
    ctx.fillRect(ph, head - 2, Math.max(hair, 1.5 / c.z), p.h - head);
    ctx.beginPath(); ctx.moveTo(ph - 7, head - 14); ctx.lineTo(ph + 7, head - 14); ctx.lineTo(ph, head - 3); ctx.closePath(); ctx.fill();
    // the fine print
    ctx.font = font(F.mono(400), 12);
    ctx.fillStyle = rgba('ash', 0.8 * dim);
    ctx.textAlign = 'right';
    ctx.fillText(`keyframes set by hand: ${String(nk).padStart(2, '0')}`, p.w - 14, p.h + 22);
    ctx.textAlign = 'left';
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------------------------------------------------------------- D: nodes and links
  drawNodes(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const t0 = w.and!.start - 0.1;
    if (t < t0) return;
    const hair = 1 / c.z;
    const tm = w.mcp!.start;
    const sink = ease.inOutCubic(prog(t, tm + 0.25, tm + 0.7));
    const cut = w.not!.start;
    this.nodes.forEach((n, i) => {
      const a0 = prog(t, t0 + i * 0.08, t0 + i * 0.08 + 0.25);
      if (a0 <= 0) return;
      const far = i > 0 ? sink : 0;
      const y = n.y + far * 40;
      const al = a0 * (1 - 0.7 * far);
      const bw = 340, bh = 130;
      setWorld(ctx, c, n.x - bw / 2, y - bh / 2);
      ctx.fillStyle = rgba('ink', 0.9);
      ctx.fillRect(0, 0, bw, bh);
      ctx.lineWidth = hair;
      const home = i === 0 && t > w.mcp!.end;
      ctx.strokeStyle = home ? mixCss('bone', 'signal', prog(t, w.mcp!.end, w.mcp!.end + 0.3), 0.9 * al) : rgba('bone', 0.45 * al);
      ctx.strokeRect(0, 0, bw, bh);
      // registration ticks
      ctx.strokeStyle = rgba('bone', 0.7 * al);
      ctx.beginPath();
      for (const [x, yy, sx, sy] of [[0, 0, -1, -1], [bw, 0, 1, -1], [0, bh, -1, 1], [bw, bh, 1, 1]] as const) {
        ctx.moveTo(x + sx * 6, yy); ctx.lineTo(x + sx * 18, yy);
        ctx.moveTo(x, yy + sy * 6); ctx.lineTo(x, yy + sy * 18);
      }
      ctx.stroke();
      label(ctx, n.label, bw / 2, 62, { size: 22, col: rgba('bone', 0.92 * al), spacing: 4, align: 'center' });
      ctx.font = font(F.mono(400), 13);
      ctx.fillStyle = rgba('ash', 0.8 * al);
      ctx.textAlign = 'center';
      ctx.fillText(n.sub, bw / 2, 92);
      ctx.textAlign = 'left';
      label(ctx, `0${i + 1}`, 0, -12, { size: 11, col: rgba('signal', 0.9 * al) });
    });
    // links: CLAUDE → MCP (snipped on "not"), MCP → AE
    for (let i = 0; i < 2; i++) {
      const a = this.nodes[i]!, b = this.nodes[i + 1]!;
      const la = prog(t, t0 + 0.15 + i * 0.1, t0 + 0.45 + i * 0.1, ease.outCubic);
      if (la <= 0) continue;
      const far = sink;
      const ya = a.y + (i > 0 ? far * 40 : 0), yb = b.y + far * 40;
      const xa = a.x + 170, xb = b.x - 170;
      const al = (1 - 0.7 * (i > 0 ? far : 0));
      ctx.lineWidth = 1.4 / c.z;
      ctx.strokeStyle = rgba('bone', 0.75 * al);
      if (i === 0 && t > cut) {
        // the snip: both halves recoil toward their nodes (a damped spring)
        const age = t - cut, mx = (xa + xb) / 2;
        const rec = 1 - Math.exp(-age * 9) * Math.cos(age * 30) * 0.15;
        const gap = 14 + 90 * clamp(rec, 0, 1.2);
        const la1 = w2s(c, xa, ya), m1 = w2s(c, mx - gap, lerp(ya, ya + 26, clamp(age * 3))), m2 = w2s(c, mx + gap, lerp(yb, yb + 34, clamp(age * 3))), lb1 = w2s(c, xb, yb);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(la1[0], la1[1]); ctx.lineTo(m1[0], m1[1]); ctx.moveTo(m2[0], m2[1]); ctx.lineTo(lb1[0], lb1[1]); ctx.stroke();
        continue;
      }
      const p0 = w2s(c, xa, ya), p1 = w2s(c, lerp(xa, xb, la), lerp(ya, yb, la));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      if (la >= 1) {
        ctx.lineWidth = 1.4;
        const e = w2s(c, xb, yb);
        ctx.beginPath(); ctx.moveTo(e[0] - 11 * c.z, e[1] - 6 * c.z); ctx.lineTo(e[0], e[1]); ctx.lineTo(e[0] - 11 * c.z, e[1] + 6 * c.z); ctx.stroke();
      }
    }
    // the fine print under the diagram
    const fa = prog(t, t0 + 0.6, t0 + 0.9) * (1 - prog(t, tm, tm + 0.3));
    if (fa > 0) {
      setWorld(ctx, c, this.nodes[0]!.x - 170, this.nodes[0]!.y - 104, 0.13);
      ctx.font = font(F.mono(400), 100);
      ctx.fillStyle = rgba('ash', 0.85 * fa);
      ctx.fillText('fig. 0b — remote-controlling the app', 0, 0);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Packets running along the links (they stop when the first link is cut). */
  drawPackets(X: LineBatch, t: number, c: Cam) {
    const w = this.w;
    const t0 = w.and!.start + 0.3;
    if (t < t0) return;
    const cut = w.not!.start, tm = w.mcp!.start;
    const sink = ease.inOutCubic(prog(t, tm + 0.25, tm + 0.7));
    for (let i = 0; i < 2; i++) {
      const a = this.nodes[i]!, b = this.nodes[i + 1]!;
      const xa = a.x + 175, xb = b.x - 178, len = xb - xa;
      for (let k = 0; k < 6; k++) {
        // packet k leaves the left node at tb = t0 + k*0.22 + n*1.32 (i.e. a steady stream)
        const tb0 = t0 + i * 0.35 + k * 0.22;
        const per = 1.32, n = Math.floor((t - tb0) / per);
        if (n < 0) continue;
        const tb = tb0 + n * per;
        if (tb > cut + (i === 1 ? len / 520 : 0)) continue; // no packets leave after the cut
        const s = (t - tb) * 520;
        if (s < 0 || s > len) continue;
        const y = lerp(a.y + (i > 0 ? sink * 40 : 0), b.y + sink * 40, s / len);
        const [sx, sy] = w2s(c, xa + s, y);
        const I = 1.6 * (1 - 0.7 * (i > 0 ? sink : 0));
        X.seg2(sx - 9 * c.z, sy, sx, sy, 3 * c.z, [LIN.signal[0] * I, LIN.signal[1] * I, LIN.signal[2] * I], 0.9);
        X.seg2(sx, sy, sx + 0.01, sy, 5 * c.z, [LIN.ember[0] * 2 * I, LIN.ember[1] * 2 * I, LIN.ember[2] * 2 * I], 1);
      }
    }
  }

  /** The snip throws sparks; the strike on MCP too. */
  drawSnipSparks(X: LineBatch, t: number, c: Cam) {
    const w = this.w;
    const bursts: [number, P, number][] = [[w.not!.start + 0.04, pt(this.nodes[0]!.x + 310, this.nodes[0]!.y), 70], [w.opening!.start + 0.2, pt(this.pan.x + this.pan.w + 24, this.pan.y + this.pan.h + 14), 40]];
    for (const [tb, p, n] of bursts) {
      const age = t - tb;
      if (age < 0 || age > 0.8) continue;
      for (let i = 0; i < n; i++) {
        const life = 0.3 + 0.45 * hash(i, 31, tb);
        if (age > life) continue;
        const an = hash(i, 33, tb) * TAU;
        const sp = 120 + 520 * hash(i, 34, tb) ** 2;
        const pos = (a: number) => w2s(c, p.x + Math.cos(an) * sp * a, p.y + Math.sin(an) * sp * a + 420 * a * a);
        const p1 = pos(age), p0 = pos(Math.max(0, age - 0.022));
        const k = 1 - age / life;
        X.seg2(p0[0], p0[1], p1[0], p1[1], 1.1 + k, [(LIN.signal[0] + k) * 2.2, (LIN.signal[1] + 0.6 * k * k) * 2.2, (LIN.signal[2] + 0.3 * k * k) * 2.2], Math.min(1, k * 1.5));
      }
    }
    void sparkHead;
  }
}
