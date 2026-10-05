// CRAZY — "And this is where it gets crazy. Claude doesn’t actually generate an MP4 directly."
// A. Ink on a signal field (the ⏎ keycap of the prompt filled the frame): one full-frame slam per
//    said word, each at its own Archivo width; CRAZY. lands last, its letters stretching through the
//    width axis; a deadpan CRAZINESS readout in the corner rolls up to 0.97.
// B. Back to ink: CLAUDE on the left, output.mp4 on the right, a dashed direct arrow between them.
//    On "doesn’t" a ✕ lands on the arrow (no direct path); on "MP4" the file card fills in, one
//    letter per spoken part; on "directly." the pen draws the real route — down to a { code } box and
//    up to the file — and the camera dives into the code box (→ code).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font, layout, measure } from '../engine/type';
import { type Line, type Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, pulse, TAU, frameIdx } from '../engine/util';
import {
  Plot, Cam2D, gridPass, setGrid, drawKaraoke, placeRow, drawPen, w2s, setWorld, label, mixCss,
  pt, rectPts, lineOf, wordOf, parts, returnArrow, type KWord, type Cam,
} from './_vo';

const ARCH = (wd: number, wt: number) => F.archivo(wd, wt);
const WIDTHS = [62, 75, 87.5, 100, 112.5, 125];

const FIELD = /* glsl */ `
uniform float t, k, close;
void main() {
  vec2 px = FRAG_PX;
  vec2 p = vUv - 0.5;
  vec3 col = C_SIGNAL * (1.0 + 0.12 * (0.5 - length(p * vec2(1.6, 1.0))));
  // engraved texture: fine diagonal hairlines in blood, very faint
  float h = hatch((px.x + px.y) / 9.0, 0.12 + 0.05 * snoise(px * 0.004 + t * 0.05));
  col = mix(col, C_BLOOD, 0.16 * h);
  col += C_EMBER * 0.25 * k * exp(-dot(p, p) * 6.0);
  // the field closes to ink like a shutter at the end of the beat
  float s = step(abs(vUv.y - 0.5), 0.5 * (1.0 - close));
  col = mix(C_INK, col, s);
  fragColor = vec4(col, 1.0);
}`;

interface Slam { w: Word; text: string; wd: number; size: number }

export default class Crazy extends Scene {
  field = new FSPass(FIELD, { t: { value: 0 }, k: { value: 0 }, close: { value: 0 } });
  grid = gridPass(24, 96);
  plot = new Plot();
  cam = new Cam2D();
  lines = new LineBatch(20000);
  fx = new LineBatch(20000);
  ui = new Layer2D();
  kw: KWord[] = [];
  L6!: Line; L7!: Line;
  w: Record<string, Word> = {};
  slams: Slam[] = [];
  tSplit = 0;
  nodes = { claude: pt(-480, 60), mp4: pt(480, 60), code: pt(0, 330) };

  override init() {
    const ly = this.ctx.lyrics;
    this.L6 = lineOf(ly, 'where it gets crazy');
    this.L7 = lineOf(ly, 'generate an MP4');
    const w = this.w;
    for (const [k, q] of [['and', 'And'], ['this', 'this'], ['is', 'is'], ['where', 'where'], ['it', 'it'], ['gets', 'gets'], ['crazy', 'crazy']] as const) w[k] = wordOf(this.L6, q);
    for (const [k, q] of [['claude', 'Claude'], ['doesnt', 'doesn’t'], ['actually', 'actually'], ['generate', 'generate'], ['an', 'an'], ['mp4', 'MP4'], ['directly', 'directly']] as const) w[k] = wordOf(this.L7, q);
    // A: the slams
    const spec: [string, string, number][] = [['and', 'AND', 125], ['this', 'THIS', 112.5], ['is', 'IS', 125], ['where', 'WHERE', 87.5], ['it', 'IT', 125], ['gets', 'GETS', 100]];
    for (const [k, txt, wd] of spec) {
      const fam = ARCH(wd, 900);
      const wid = measure(txt, fam, 100) / 100;
      const size = Math.min(1500 / wid, 700 / 0.7);
      this.slams.push({ w: w[k]!, text: txt, wd, size });
    }
    this.tSplit = w.claude!.start - 0.14;
    this.buildB();
    this.plot.alpha = () => 1;
  }

  buildB() {
    const w = this.w, P = this.plot, n = this.nodes;
    this.kw.push(...placeRow([w.claude!, w.doesnt!, w.actually!, w.generate!], -650, -250, 76, ARCH(100, 700), 'B', { ant: 0.25 }).words);
    this.kw.push(...placeRow([w.an!, w.mp4!, w.directly!], -650, -164, 76, ARCH(100, 700), 'B', { ant: 0.25 }).words);
    // the dashed direct arrow
    const a = pt(n.claude.x + 170, n.claude.y), b = pt(n.mp4.x - 150, n.mp4.y);
    P.add([a, b], this.tSplit + 0.1, this.tSplit + 0.45, 'cons', { ez: ease.outCubic, alpha: 0.9, dash: 14, width: 1.4, group: 'direct' });
    // the ✕ on "doesn't"
    const m = pt((a.x + b.x) / 2, a.y), r = 22, td = w.doesnt!.start;
    P.add([pt(m.x - r, m.y - r), pt(m.x + r, m.y + r)], td, td + 0.08, 'signal', { pen: true, width: 4, group: 'x' });
    P.add([pt(m.x + r, m.y - r), pt(m.x - r, m.y + r)], td + 0.1, td + 0.18, 'signal', { pen: true, width: 4, group: 'x' });
    P.note('no direct path', m.x, m.y - 42, td + 0.15, { size: 19, col: 'ash', align: 'center', group: 'x' });
    // the real route, drawn on "directly."
    const tr = w.directly!.start - 0.05;
    const c = n.code;
    const route = [pt(n.claude.x, n.claude.y + 80), pt(n.claude.x, c.y), pt(c.x - 150, c.y)];
    const route2 = [pt(c.x + 150, c.y), pt(n.mp4.x, c.y), pt(n.mp4.x, n.mp4.y + 170)];
    P.add(route, tr, tr + 0.24, 'plot', { pen: true, ez: ease.inOutQuad, width: 2, group: 'route' });
    P.add(rectPts(c.x - 150, c.y - 62, 300, 124), tr + 0.24, tr + 0.4, 'plot', { pen: true, ez: ease.inOutQuad, width: 1.6, group: 'route' });
    P.add(route2, tr + 0.4, tr + 0.62, 'plot', { pen: true, ez: ease.inOutQuad, width: 2, group: 'route' });
    P.note('1  write code', n.claude.x + 16, c.y - 18, tr + 0.2, { size: 17, col: 'ash', group: 'route' });
    P.note('2  render it', n.mp4.x - 16, c.y - 18, tr + 0.55, { size: 17, col: 'ash', group: 'route', align: 'right' });
    P.wp(pt(c.x, c.y), tr + 0.7, 1.0);
    // camera B
    const K = this.cam;
    K.key(this.tSplit, 0, -10, 1.04, 0);
    K.key(w.mp4!.start, 10, 0, 1.08, 0.005, ease.linear);
    K.key(w.directly!.start + 0.2, 0, 50, 1.02, 0, ease.inOutQuad);
    K.key(this.ctx.end, c.x, c.y, 5.5, 0, ease.inQuart);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, w = this.w;
    if (t < this.tSplit) return this.renderA(t, out);
    const c = this.cam.at(t);
    const pen = this.plot.penAt(t);
    const ps = pen ? w2s(c, pen.x, pen.y) : null;
    setGrid(this.grid, c, { reveal: [0, 0, 1e5], ink: 0.75, pen: ps ? [ps[0], ps[1], 1] : [0, 0, 0] });
    this.grid.render(renderer, out);
    const L = this.lines; L.clear();
    this.plot.draw(t, c, L);
    L.render(renderer, out);
    const U = this.ui; U.clear();
    const ctx = U.ctx;
    this.drawB(ctx, t, c);
    this.plot.drawNotes(t, c, ctx);
    drawKaraoke(ctx, c, t, this.kw, { pop: 0.0 });
    comp.draw(renderer, U.upload(), out);
    const X = this.fx; X.clear();
    if (t > w.doesnt!.start - 0.3) drawPen(X, t, (tt) => { if (tt < w.doesnt!.start - 0.3) return null; const q = this.plot.penAt(tt); return q ? w2s(c, q.x, q.y) : null; }, { scale: 0.9, rate: 55, from: w.doesnt!.start - 0.3 });
    X.render(renderer, out);
    const punch = 0.014 * pulse(t, w.doesnt!.start, 0.08) + 0.012 * pulse(t, w.mp4!.start, 0.08);
    return { bloom: 0.7, bloomThreshold: 0.84, vignette: 0.42, zoom: 1 + punch, grain: 0.05 };
  }

  // ---------------------------------------------------------------- A: the slams on signal
  renderA(t: number, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const w = this.w;
    const cr = w.crazy!;
    const close = ease.inQuart(prog(t, cr.end + 0.04, this.tSplit));
    this.field.u.t!.value = t;
    this.field.u.k!.value = pulse(t, cr.start, 0.2);
    this.field.u.close!.value = close;
    this.field.render(renderer, out);
    const U = this.ui; U.clear();
    const c = U.ctx;
    c.textBaseline = 'alphabetic';
    // the ⏎ glyph of the keycap, shrinking away
    const g0 = prog(t, this.ctx.start, this.ctx.start + 0.35, ease.inCubic);
    if (g0 < 1) {
      const s = lerp(560, 0, g0);
      c.save();
      c.strokeStyle = rgba('ink', 1 - g0);
      c.lineWidth = s * 0.07; c.lineCap = 'square'; c.lineJoin = 'miter';
      returnArrow(c, W / 2, H / 2, s * 0.42);
      c.restore();
    }
    // current slam
    let cur: Slam | null = null;
    for (const s of this.slams) if (t >= s.w.start) cur = s;
    if (cur && t < cr.start) {
      const age = t - cur.w.start;
      const sc = 1 + 0.25 * (1 - ease.outExpo(clamp(age / 0.16)));
      const fam = ARCH(cur.wd, 900);
      c.font = font(fam, 100);
      const wid = (measure(cur.text, fam, 100) / 100) * cur.size;
      const x = W / 2 - (wid / 2) * sc, y = H / 2 + 0.35 * cur.size * sc;
      c.setTransform((cur.size / 100) * sc, 0, 0, (cur.size / 100) * sc, x, y);
      c.fillStyle = rgba('ink', 1);
      c.fillText(cur.text, 0, 0);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    // CRAZY.: letters stretch through the widths, jittering, then hold
    if (t >= cr.start) {
      const txt = 'CRAZY.';
      const age = t - cr.start;
      const lay = layout(txt, ARCH(125, 900), 100);
      const size = Math.min(1700 / (lay.width / 100), 760);
      const baseX = W / 2 - (lay.width / 200) * size, y = H / 2 + 0.35 * size;
      const sh = (1 - close);
      for (const g of lay.glyphs) {
        const ta = age - g.i * 0.05;
        if (ta < 0) continue;
        const k = ease.outExpo(clamp(ta / 0.3));
        const wd = WIDTHS[Math.min(5, Math.floor(k * 5.999))]!;
        const fam = ARCH(wd, 900);
        const gw = measure(g.ch, fam, 100);
        const cx = baseX + ((g.x + g.w / 2) / 100) * size;
        const jit = 6 * pulse(t, cr.start + g.i * 0.05, 0.12) * sh;
        const fi = frameIdx(t);
        const jx = (hash(g.i, fi, 1) - 0.5) * jit, jy = (hash(g.i, fi, 2) - 0.5) * jit;
        const sc = 1 + 0.3 * (1 - ease.outExpo(clamp(ta / 0.15)));
        c.setTransform((size / 100) * sc, 0, 0, (size / 100) * sc, cx - (gw / 200) * size * sc + jx, y + jy);
        c.font = font(fam, 100);
        c.fillStyle = rgba('ink', 1);
        c.fillText(g.ch, 0, 0);
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    // corner furniture: plate number, the CRAZINESS readout
    const fa = 1 - close;
    c.globalAlpha = fa;
    label(c, 'PLATE 04', 72, 86, { size: 13, col: rgba('ink', 0.8) });
    label(c, 'WHERE IT GETS', 72, 108, { size: 13, col: rgba('ink', 0.55) });
    const v = 0.12 + 0.85 * ease.outExpo(prog(t, cr.start, cr.start + 0.6)) + 0.004 * noise1(t * 3, 7);
    const x = W - 72 - 220, y = H - 96;
    label(c, 'CRAZINESS', x, y - 44, { size: 13, col: rgba('ink', 0.75) });
    c.font = font(F.mono(400), 40);
    c.fillStyle = rgba('ink', 0.92);
    c.fillText(v.toFixed(2), x - 2, y);
    c.fillStyle = rgba('ink', 0.3);
    c.fillRect(x, y + 16, 220, 1);
    for (let i = 0; i <= 10; i++) c.fillRect(x + 22 * i, y + 16 - (i % 5 === 0 ? 5 : 3), 1, i % 5 === 0 ? 5 : 3);
    c.fillStyle = rgba('ink', 1);
    c.fillRect(x, y + 15, 220 * clamp(v), 3);
    c.globalAlpha = 1;
    comp.draw(renderer, U.upload(), out);
    const kick = Math.max(...this.slams.map((s) => pulse(t, s.w.start, 0.07)), pulse(t, cr.start, 0.1));
    const sh = 14 * pulse(t, cr.start, 0.1) * (1 - close);
    return {
      bloom: 0.4, bloomThreshold: 1.2, vignette: 0.3, grain: 0.06, zoom: 1 + 0.02 * kick,
      shake: [sh * noise1(t * 50, 1), sh * noise1(t * 50, 2)], ca: 1.2 + 3 * pulse(t, cr.start, 0.12),
    };
  }

  // ---------------------------------------------------------------- B: the diagram
  drawB(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w, n = this.nodes;
    const t0 = this.tSplit;
    const hair = 1 / c.z;
    // CLAUDE node
    const a0 = prog(t, t0, t0 + 0.2);
    setWorld(ctx, c, n.claude.x - 170, n.claude.y - 80);
    ctx.fillStyle = rgba('ink', 0.92);
    ctx.fillRect(0, 0, 340, 160);
    ctx.strokeStyle = rgba('bone', 0.5 * a0);
    ctx.lineWidth = hair;
    ctx.strokeRect(0, 0, 340, 160);
    label(ctx, 'CLAUDE', 170, 78, { size: 24, col: rgba('bone', 0.92 * a0), spacing: 5, align: 'center' });
    ctx.font = font(F.mono(400), 14);
    ctx.fillStyle = rgba('ash', 0.8 * a0);
    ctx.textAlign = 'center';
    ctx.fillText('opus 5.5', 170, 108);
    ctx.textAlign = 'left';
    // the file card: output.mp4 (ghosted until "MP4")
    const tm = w.mp4!.start;
    const fill = prog(t, tm, tm + 0.25);
    const fw = 300, fh = 340, fx = n.mp4.x - fw / 2, fy = n.mp4.y - fh / 2;
    setWorld(ctx, c, fx, fy);
    ctx.fillStyle = rgba('ink', 0.92);
    ctx.fillRect(0, 0, fw, fh);
    ctx.strokeStyle = rgba('bone', 0.35 + 0.4 * fill);
    ctx.lineWidth = hair * 1.2;
    ctx.setLineDash(fill < 1 ? [8 / c.z, 6 / c.z] : []);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(fw - 56, 0); ctx.lineTo(fw, 56); ctx.lineTo(fw, fh); ctx.lineTo(0, fh); ctx.closePath();
    ctx.moveTo(fw - 56, 0); ctx.lineTo(fw - 56, 56); ctx.lineTo(fw, 56);
    ctx.stroke();
    ctx.setLineDash([]);
    // film strip glyph
    const sx = 50, sy = 86, sw = 200, sh = 110;
    ctx.strokeStyle = rgba('bone', 0.25 + 0.55 * fill);
    ctx.strokeRect(sx, sy, sw, sh);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = rgba('bone', 0.2 + 0.5 * fill);
      ctx.fillRect(sx + 10 + i * 24, sy + 8, 12, 9);
      ctx.fillRect(sx + 10 + i * 24, sy + sh - 17, 12, 9);
    }
    for (let i = 1; i < 3; i++) { ctx.fillStyle = rgba('bone', 0.12 + 0.3 * fill); ctx.fillRect(sx + (sw * i) / 3, sy + 24, hair, sh - 48); }
    // the file name, one part per spoken letter-group (EM / PEE / FOUR)
    const ps = parts(w.mp4!);
    ctx.font = font(F.mono(500), 30);
    const name = ['output.', 'm', 'p', '4'];
    let x = 34;
    name.forEach((s, i) => {
      const on = i === 0 ? fill > 0 || t > tm - 0.6 : t >= ps[i - 1]![0];
      const hot = i > 0 ? pulse(t, ps[i - 1]![0], 0.12) : 0;
      ctx.fillStyle = !on ? rgba('graphite', 0.8) : hot > 0.05 ? mixCss('bone', 'signal', hot) : rgba(i === 0 ? 'bone' : 'bone', 0.95);
      ctx.fillText(s, x, 256);
      x += measure(s, F.mono(500), 30);
    });
    ctx.font = font(F.mono(400), 16);
    ctx.fillStyle = rgba('ash', 0.85);
    const st = t < w.directly!.end ? 'status   not generated' : 'status   rendered from code';
    ctx.fillText('size     0 bytes', 34, 292);
    ctx.fillStyle = t < w.directly!.end ? rgba('ash', 0.85) : rgba('signal', 0.95);
    ctx.fillText(st, 34, 316);
    // the code box label
    const tr = w.directly!.start + 0.25;
    if (t > tr) {
      const k = prog(t, tr, tr + 0.2);
      setWorld(ctx, c, n.code.x, n.code.y + 14);
      ctx.font = font(F.mono(500), 40);
      ctx.textAlign = 'center';
      ctx.fillStyle = mixCss('signal', 'bone', prog(t, tr + 0.2, tr + 0.6), k);
      ctx.fillText('{ code }', 0, 0);
      ctx.textAlign = 'left';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    void hash; void LIN; void TAU;
  }
}
