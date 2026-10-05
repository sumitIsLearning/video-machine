// VERDICT — "Does this replace After Effects? Not really. But for certain types of motion graphics…
// the fact that you can go from an idea to a working animation without touching a timeline is
// pretty insane."
// A. Paper: FORM 9, an exit questionnaire. The question is typewritten as it is said; on "Not
//    really." the pen ticks NOT REALLY. "But for certain types of motion graphics…": section 2 lists
//    the types, ticked one by one.
// B. Ink: the spark lights an idea (a point), then leaps in one arc to a working animation — over a
//    timeline that it never touches (clearance dimensioned, "touched: 0"). On "pretty insane."
//    the words slam full-frame, then everything implodes into the spark inside the crop marks:
//    the first frame of the video, so the end loops into the beginning.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font, layout, measure } from '../engine/type';
import { type Line, type Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, pulse, TAU } from '../engine/util';
import { sparkHead, sparkParticles } from './_motifs';
import { Plot, Cam2D, gridPass, setGrid, drawKaraoke, placeRow, w2s, setWorld, label, mixCss, lineOf, wordOf, pt, bezier, drawPen, type KWord, type Cam } from './_vo';

const PAPER = /* glsl */ `
uniform vec4 uCam; uniform vec2 uRes;
void main() {
  vec2 sp = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 d = sp - 0.5 * uRes;
  float c = cos(-uCam.w), s = sin(-uCam.w);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / uCam.z;
  vec2 p = uCam.xy + d;
  vec3 col = C_BONE * 0.965;
  float f = fbm(vec2(p.x * 0.004, p.y * 0.05), 4);
  float cloud = fbm(p * 0.0025 + 7.0, 4);
  col *= 1.0 - 0.035 * f - 0.03 * cloud;
  vec2 g = abs(fract(p / 24.0 + 0.5) - 0.5) * 24.0 * uCam.z;
  float gl = max(1.0 - smoothstep(0.0, 1.0, g.x), 1.0 - smoothstep(0.0, 1.0, g.y));
  col = mix(col, C_GRAPHITE, 0.035 * gl);
  fragColor = vec4(col, 1.0);
}`;

const ARCH = (wd: number, wt: number) => F.archivo(wd, wt);
const IDEA = pt(-780, 60);
const FRAME = { x: 360, y: -150, w: 480, h: 270 };
const TLN = { x0: -560, x1: 180, y: 60 };

export default class Verdict extends Scene {
  paper = new FSPass(PAPER, { uCam: { value: [0, 0, 1, 0] }, uRes: { value: [W, H] } });
  grid = gridPass(24, 96);
  pplot = new Plot();
  plot = new Plot();
  camA = new Cam2D();
  camB = new Cam2D();
  lines = new LineBatch(30000, { blend: 'normal' });
  glow = new LineBatch(30000);
  fx = new LineBatch(30000);
  ui = new Layer2D();
  kw: KWord[] = [];
  w: Record<string, Word> = {};
  L19!: Line; L20!: Line; L21!: Line; L22!: Line;
  tSplit = 0; tImp = 0; tEnd = 0;
  arc: { x: number; y: number }[] = [];
  types = ['kinetic typography', 'diagrams and explainers', 'charts and data', 'generative loops', 'this video'];

  override init() {
    const ly = this.ctx.lyrics;
    this.tEnd = this.ctx.end;
    this.L19 = lineOf(ly, 'Does this replace');
    this.L20 = lineOf(ly, 'Not really');
    this.L21 = lineOf(ly, 'But for certain types');
    this.L22 = lineOf(ly, 'the fact that you can go');
    const w = this.w;
    for (const [k, q] of [['does', 'Does'], ['this', 'this'], ['replace', 'replace'], ['after', 'After'], ['effects', 'Effects']] as const) w[k] = wordOf(this.L19, q);
    for (const [k, q] of [['not', 'Not'], ['really', 'really']] as const) w[k] = wordOf(this.L20, q);
    for (const [k, q] of [['but', 'But'], ['for', 'for'], ['certain', 'certain'], ['types', 'types'], ['of', 'of'], ['motion', 'motion'], ['graphics', 'graphics']] as const) w[k] = wordOf(this.L21, q);
    for (const [k, q] of [['the', 'the'], ['fact', 'fact'], ['that', 'that'], ['you', 'you'], ['can', 'can'], ['go', 'go'], ['from', 'from'], ['an', 'an'], ['idea', 'idea'], ['to', 'to'], ['a', 'a'],
      ['working', 'working'], ['animation', 'animation'], ['without', 'without'], ['touching', 'touching'], ['a2', 'a'], ['timeline', 'timeline'], ['is', 'is'], ['pretty', 'pretty'], ['insane', 'insane']] as const) w[k] = wordOf(this.L22, q, k === 'a2' ? 1 : 0);
    this.tSplit = w.the!.start - 0.12;
    this.tImp = w.insane!.end - 0.16;
    this.buildA();
    this.buildB();
  }

  // ================================================================== A: the questionnaire (paper)
  buildA() {
    const w = this.w, P = this.pplot;
    P.paper = true;
    // the tick on NOT REALLY: an X by the pen on "really"
    const bx = -150, by = -80, s = 30;
    P.add([pt(bx + 6, by + 6), pt(bx + s - 6, by + s - 6)], w.really!.start, w.really!.start + 0.1, 'signal', { pen: true, width: 5, group: 'x' });
    P.add([pt(bx + s - 6, by + 6), pt(bx + 6, by + s - 6)], w.really!.start + 0.12, w.really!.start + 0.22, 'signal', { pen: true, width: 5, group: 'x' });
    P.wp(pt(bx - 60, by - 40), w.not!.start, 0.1);
    // section 2 ticks, one per type, across "certain types of motion graphics…"
    const t0 = w.certain!.start, t1 = w.graphics!.end - 0.1;
    this.types.forEach((_, i) => {
      const tt = lerp(t0, t1, i / (this.types.length - 1)) - 0.05;
      const x = -760, y = 214 + i * 46;
      P.add([pt(x + 5, y + 14), pt(x + 12, y + 22), pt(x + 26, y + 4)], tt, tt + 0.1, 'signal', { pen: true, width: 4, group: 'ticks' });
    });
    const K = this.camA;
    K.key(this.ctx.start, -330, -200, 1.42, -0.015);
    K.key(w.effects!.end, -290, -190, 1.46, -0.01, ease.linear);
    K.key(w.not!.start + 0.15, -260, -90, 1.4, 0.01, ease.outExpo);
    K.key(w.really!.end + 0.1, -250, -80, 1.42, 0.01, ease.linear);
    K.key(w.certain!.start + 0.1, -300, 250, 1.22, -0.006, ease.inOutCubic);
    K.key(this.tSplit, -290, 270, 1.26, -0.006, ease.linear);
  }

  // ================================================================== B: idea → animation, over a timeline
  buildB() {
    const w = this.w, P = this.plot;
    const fam7 = ARCH(100, 700);
    this.kw.push(...placeRow([w.the!, w.fact!, w.that!, w.you!, w.can!, w.go!, w.from!, w.an!], -880, -330, 60, fam7, 'B1', { ant: 0.2 }).words);
    this.kw.push(...placeRow([w.idea!], IDEA.x - 40, IDEA.y + 96, 64, ARCH(100, 900), 'B2', { ant: 0.2, hot: 'signal' }).words);
    this.kw.push(...placeRow([w.to!, w.a!, w.working!, w.animation!], FRAME.x, FRAME.y - 34, 56, fam7, 'B2', { ant: 0.2 }).words);
    this.kw.push(...placeRow([w.without!, w.touching!, w.a2!, w.timeline!], TLN.x0, TLN.y + 130, 56, fam7, 'B2', { ant: 0.2 }).words);
    // the leap: from the idea, high over the timeline, down into the frame
    const a = pt(IDEA.x, IDEA.y), d = pt(FRAME.x, FRAME.y + FRAME.h / 2);
    this.arc = bezier(a, pt(-560, -420), pt(120, -420), d, 120);
    P.wp(a, w.go!.start, Math.max(0.01, w.to!.start - w.go!.start));
    P.add(this.arc, w.to!.start, w.animation!.start, 'plot', { pen: true, ez: ease.inOutCubic, width: 2.4, group: 'arc' });
    // the timeline: ruled on "without", diamonds on "touching", never touched
    const tw = w.without!.start;
    P.add([pt(TLN.x0, TLN.y), pt(TLN.x1, TLN.y)], tw, tw + 0.35, 'axis', { ez: ease.outCubic, width: 1.4, group: 'tl' });
    for (let i = 0; i <= 14; i++) {
      const x = lerp(TLN.x0, TLN.x1, i / 14), tt = tw + 0.02 * i;
      P.add([pt(x, TLN.y), pt(x, TLN.y + (i % 2 ? 6 : 12))], tt, tt + 0.03, 'axis', { group: 'tl' });
    }
    P.note('TIMELINE', TLN.x0, TLN.y - 18, tw + 0.1, { size: 14, col: 'bone', a: 0.75, spacing: 0.25, group: 'tl' });
    // clearance: the arc's apex height over the timeline, dimensioned
    let apex = this.arc[0]!;
    for (const p of this.arc) if (p.y < apex.y) apex = p;
    this.apex = apex;
    P.dimension(pt(apex.x, TLN.y - 6), pt(apex.x, apex.y + 8), `${Math.round(TLN.y - apex.y)} px clearance`, w.touching!.start + 0.1, 'tl', 15, -1);
    const K = this.camB;
    K.key(this.tSplit, -160, -40, 1.0, 0);
    K.key(w.idea!.start, -180, -20, 1.03, -0.006, ease.linear);
    K.key(w.animation!.start + 0.2, 0, -30, 0.93, 0.004, ease.inOutCubic);
    K.key(w.timeline!.end, 0, 0, 0.95, 0, ease.linear);
    K.key(this.tEnd, 0, 0, 0.97, 0, ease.linear);
  }
  apex = pt(0, 0);

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    return f.t < this.tSplit ? this.renderA(f.t, out) : this.renderB(f.t, out);
  }

  // ---------------------------------------------------------------- A
  renderA(t: number, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const w = this.w;
    const c0 = this.camA.at(t);
    const c: Cam = { cx: c0.cx + 5 * noise1(t * 0.7, 1), cy: c0.cy + 4 * noise1(t * 0.6, 2), z: c0.z, roll: c0.roll + 0.004 * noise1(t * 0.5, 3) };
    (this.paper.u.uCam!.value as number[]).splice(0, 4, c.cx, c.cy, c.z, c.roll);
    this.paper.render(renderer, out);
    const U = this.ui; U.clear();
    const ctx = U.ctx;
    // header
    setWorld(ctx, c, -860, -470);
    ctx.fillStyle = rgba('ink', 0.94);
    ctx.fillRect(0, 0, 1720, 104);
    ctx.font = font(F.archivo(112.5, 900), 64);
    ctx.fillStyle = rgba('bone', 0.97);
    ctx.fillText('FORM 9', 34, 76);
    label(ctx, 'EXIT QUESTIONNAIRE', 400, 44, { size: 19, col: rgba('bone', 0.95), spacing: 5 });
    label(ctx, 'ONE ANSWER PER QUESTION   ·   BE HONEST', 400, 76, { size: 14, col: rgba('bone', 0.75), spacing: 5 });
    ctx.fillStyle = rgba('ink', 0.85);
    ctx.fillRect(0, 150, 1720, 1.6 / c.z);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Q1, typed
    const typed = (x: number, y: number, words: Word[], texts: string[], size: number) => {
      setWorld(ctx, c, x, y);
      ctx.font = font(F.mono(400), size);
      let xx = 0;
      words.forEach((wd, i) => {
        const s = texts[i]!;
        const n = Math.ceil(s.length * clamp((t - wd.start) / Math.max(0.1, (wd.end - wd.start) * 0.8)));
        const hot = t < wd.start ? 0 : t < wd.end ? 1 : 1 - clamp((t - wd.end) / 0.35);
        for (let k = 0; k < Math.min(n, s.length); k++) {
          ctx.fillStyle = hot > 0 ? mixCss('signal', 'ink', 1 - hot, 0.92) : rgba('ink', 0.88);
          ctx.fillText(s[k]!, xx + measure(s.slice(0, k), F.mono(400), size), (hash(i, k, 5) - 0.5) * 1.6);
        }
        xx += measure(s + ' ', F.mono(400), size);
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    setWorld(ctx, c, -860, -240);
    label(ctx, '1.', 0, 0, { size: 18, col: rgba('ink', 0.9), weight: 600 });
    label(ctx, 'QUESTION', 40, 0, { size: 18, col: rgba('ink', 0.9), weight: 600 });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    typed(-860, -176, [w.does!, w.this!, w.replace!, w.after!, w.effects!], ['Does', 'this', 'replace', 'After', 'Effects?'], 46);
    // the answers
    const ans = [['YES', -760], ['NO', -470], ['NOT REALLY', -150]] as const;
    for (const [s, x] of ans) {
      const a = prog(t, w.effects!.end - 0.1, w.effects!.end + 0.25);
      setWorld(ctx, c, x, -80);
      ctx.strokeStyle = rgba('ink', 0.85 * a);
      ctx.lineWidth = 2 / c.z;
      ctx.strokeRect(0, 0, 30, 30);
      label(ctx, s, 48, 26, { size: 26, col: rgba(s === 'NOT REALLY' && t > w.really!.start ? 'blood' : 'ink', 0.9 * a), spacing: 4, weight: 500 });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Q2
    if (t > w.but!.start - 0.2) {
      setWorld(ctx, c, -860, 120);
      label(ctx, '2.', 0, 0, { size: 18, col: rgba('ink', 0.9), weight: 600 });
      label(ctx, 'EXCEPTIONS', 40, 0, { size: 18, col: rgba('ink', 0.9), weight: 600 });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      typed(-860, 176, [w.but!, w.for!, w.certain!, w.types!, w.of!, w.motion!, w.graphics!], ['But', 'for', 'certain', 'types', 'of', 'motion', 'graphics…'], 40);
      const t0 = w.certain!.start, t1 = w.graphics!.end - 0.1;
      this.types.forEach((s, i) => {
        const tt = lerp(t0, t1, i / (this.types.length - 1)) - 0.12;
        if (t < tt) return;
        const y = 214 + i * 46;
        setWorld(ctx, c, -760, y);
        ctx.strokeStyle = rgba('ink', 0.8);
        ctx.lineWidth = 1.6 / c.z;
        ctx.strokeRect(0, 0, 28, 28);
        ctx.font = font(F.mono(400), 26);
        ctx.fillStyle = rgba(i === 4 ? 'blood' : 'ink', 0.9);
        ctx.fillText(s.slice(0, Math.ceil(s.length * prog(t, tt, tt + 0.15))), 48, 24);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      });
    }
    // fine print
    setWorld(ctx, c, -860, 520);
    ctx.font = font(F.mono(400), 15);
    ctx.fillStyle = rgba('ink', 0.75);
    ctx.fillText('* “Not really” is an accepted answer on this form.', 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, U.upload(), out);
    const L = this.lines; L.clear();
    this.pplot.draw(t, c, L);
    L.render(renderer, out);
    return { bloom: 0.15, bloomThreshold: 1.4, vignette: 0.28, grain: 0.04, halation: 0.05, ca: 0.6, paper: 1, zoom: 1 + 0.02 * pulse(t, w.really!.start, 0.08) };
  }

  // ---------------------------------------------------------------- B
  renderB(t: number, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const w = this.w;
    const c = this.camB.at(t);
    const imp = ease.inCubic(prog(t, this.tImp, this.tEnd - 0.08));
    const fin = t >= this.tEnd - 0.08;
    // the bookend: the video's first frame (ink, crop marks, the spark at rest in the centre)
    if (fin) {
      renderer.setRenderTarget(out);
      renderer.setClearColor(new THREE.Color().setRGB(LIN.ink[0], LIN.ink[1], LIN.ink[2], THREE.LinearSRGBColorSpace), 1);
      renderer.clear(true, true, true);
      const X = this.fx; X.clear();
      sparkHead(X, W / 2, H / 2, t, 0.75, 0.55);
      X.render(renderer, out);
      return { bloom: 0.72, bloomThreshold: 0.82, vignette: 0.42, grain: 0.05, frame: 1 };
    }
    setGrid(this.grid, c, { reveal: [0, 0, 1e5], ink: 0.8 * (1 - imp) });
    this.grid.render(renderer, out);
    const L = this.glow; L.clear();
    const under = 1 - 0.88 * prog(t, this.w.pretty!.start - 0.05, this.w.pretty!.start + 0.2);
    this.plot.alpha = () => (1 - imp) * under;
    this.plot.draw(t, c, L);
    L.render(renderer, out);
    const U = this.ui; U.clear();
    const ctx = U.ctx;
    const slam0 = w.pretty!.start;
    const preSlam = 1 - prog(t, slam0 - 0.05, slam0 + 0.05);
    if (preSlam > 0) {
      ctx.globalAlpha = preSlam;
      this.drawIdea(ctx, t, c);
      this.drawFrame(ctx, t, c);
      this.drawTimeline(ctx, t, c);
      this.plot.drawNotes(t, c, ctx, preSlam);
      drawKaraoke(ctx, c, t, this.kw, { alpha: (g, tt) => (g === 'B1' ? 1 - 0.6 * prog(tt, w.idea!.start, w.to!.start) : 1) * preSlam });
      ctx.globalAlpha = 1;
    }
    this.drawSlam(ctx, t, imp);
    comp.draw(renderer, U.upload(), out);
    // the spark: the pen while it leaps; on the slam it waits at the centre; the implosion pulls into it
    const X = this.fx; X.clear();
    if (t < slam0) {
      drawPen(X, t, (tt) => { const q = this.plot.penAt(tt); return q && tt >= w.go!.start - 0.05 ? w2s(c, q.x, q.y) : null; }, { scale: 1.0 + 0.8 * pulse(t, w.go!.start, 0.12) + 0.6 * pulse(t, w.animation!.start, 0.1), rate: 70, from: w.go!.start - 0.05 });
    } else {
      sparkHead(X, W / 2, H / 2, t, lerp(1.6, 0.75, imp) + 1.2 * pulse(t, this.tImp, 0.08), lerp(1.0, 0.55, imp));
      if (t > this.tImp) sparkParticles(X, t, (tb) => (tb >= this.tImp ? { x: W / 2, y: H / 2 } : null), { rate: 300, intensity: 1.2, speed: 520, seed: 9, life: 0.35 });
    }
    X.render(renderer, out);
    const slam = Math.max(pulse(t, slam0, 0.08), pulse(t, w.insane!.start, 0.09));
    return {
      bloom: 0.72, bloomThreshold: 0.84, vignette: 0.42, grain: 0.05,
      zoom: 1 + 0.03 * slam, shake: [10 * slam * noise1(t * 50, 1), 10 * slam * noise1(t * 50, 2)],
      flash: 0.25 * pulse(t, this.tImp + 0.1, 0.05),
      frame: ease.inOutCubic(prog(t, this.tImp, this.tEnd - 0.08)),
    };
  }

  drawIdea(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    if (t < w.go!.start - 0.1) return;
    const s = w2s(c, IDEA.x, IDEA.y);
    const r = 46 * c.z * (1 + 0.15 * pulse(t, w.idea!.start, 0.12));
    ctx.strokeStyle = rgba('bone', 0.45 * prog(t, w.idea!.start - 0.1, w.idea!.start + 0.2));
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, TAU); ctx.stroke();
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.arc(s[0], s[1], r * 1.6, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  drawFrame(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const tA = w.animation!.start;
    const a = prog(t, w.working!.start - 0.1, w.working!.start + 0.2);
    if (a <= 0) return;
    const on = prog(t, tA, tA + 0.15);
    setWorld(ctx, c, FRAME.x, FRAME.y);
    ctx.fillStyle = rgba('ink', 0.95 * a);
    ctx.fillRect(0, 0, FRAME.w, FRAME.h);
    ctx.strokeStyle = on > 0 ? mixCss('signal', 'bone', prog(t, tA + 0.2, tA + 0.8), 0.8 * a) : rgba('bone', 0.4 * a);
    ctx.lineWidth = 1.2 / c.z;
    ctx.strokeRect(0, 0, FRAME.w, FRAME.h);
    // the working animation: a small loop (circle ↔ square, a puck crossing) once it lands
    if (on > 0) {
      const lt = Math.max(0, t - tA);
      const m = 0.5 - 0.5 * Math.cos(lt * 2.6);
      ctx.save();
      ctx.translate(FRAME.w / 2, FRAME.h / 2 - 18);
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const u = i / 64, an = u * TAU - Math.PI / 4;
        const sq = squareAt(u);
        const x = lerp(Math.cos(an), sq[0], m) * 56, y = lerp(Math.sin(an), sq[1], m) * 56;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = rgba('bone', 0.92 * on);
      ctx.fill();
      ctx.restore();
      const px = lerp(60, FRAME.w - 60, 0.5 - 0.5 * Math.cos(lt * 1.9));
      ctx.fillStyle = rgba('signal', on);
      ctx.beginPath(); ctx.arc(px, FRAME.h - 44, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba('ash', 0.5 * on);
      ctx.fillRect(60, FRAME.h - 44, FRAME.w - 120, 1 / c.z);
      label(ctx, 'PLAYING', 0, FRAME.h + 26, { size: 12, col: rgba('signal', 0.9 * on) });
      ctx.font = font(F.mono(400), 12);
      ctx.fillStyle = rgba('ash', 0.85 * on);
      ctx.textAlign = 'right';
      ctx.fillText('60 fps · loop: true', FRAME.w, FRAME.h + 26);
      ctx.textAlign = 'left';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawTimeline(ctx: CanvasRenderingContext2D, t: number, c: Cam) {
    const w = this.w;
    const tw = w.touching!.start;
    if (t < tw - 0.1) return;
    // keyframe diamonds on the timeline: present, untouched
    for (let i = 0; i < 9; i++) {
      const tt = tw + i * 0.04;
      if (t < tt) continue;
      const x = lerp(TLN.x0 + 40, TLN.x1 - 40, (i + 0.3 * hash(i, 2)) / 8.6);
      const s = w2s(c, x, TLN.y);
      ctx.save();
      ctx.translate(s[0], s[1]);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = rgba('ash', 0.85 * prog(t, tt, tt + 0.1));
      const k = 7 * c.z;
      ctx.fillRect(-k / 2, -k / 2, k, k);
      ctx.restore();
    }
    // the deadpan count
    const tl = w.timeline!.start;
    if (t > tl) {
      setWorld(ctx, c, TLN.x1, TLN.y - 18);
      ctx.font = font(F.mono(500), 18);
      ctx.textAlign = 'right';
      ctx.fillStyle = rgba('signal', prog(t, tl, tl + 0.2));
      ctx.fillText('touched: 0', 0, 0);
      ctx.textAlign = 'left';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  /** "pretty insane." full-frame, imploding into the spark at the end. */
  drawSlam(ctx: CanvasRenderingContext2D, t: number, imp: number) {
    const w = this.w;
    const words: [Word, string][] = [[w.pretty!, 'PRETTY'], [w.insane!, 'INSANE.']];
    const fam = ARCH(100, 900);
    const sizes = words.map(([, s]) => Math.min(1520 / (layout(s, fam, 100).width / 100), 400));
    const total = sizes.reduce((a, s) => a + 0.7 * s, 0) + 0.18 * sizes[0]!;
    let y = H / 2 - total / 2;
    words.forEach(([wd, s], i) => {
      const size = sizes[i]!;
      y += 0.7 * size;
      if (t < wd.start) { y += 0.18 * size; return; }
      const age = t - wd.start;
      const sc = (1 + 0.22 * (1 - ease.outExpo(clamp(age / 0.16)))) * (1 - imp);
      const hot = Math.pow(0.5, age / 0.08);
      const cool = prog(t, wd.end, wd.end + 0.4);
      const wid = (layout(s, fam, 100).width / 100) * size;
      const x = W / 2 - wid / 2;
      // scale about the frame's centre (the implosion pulls into the spark)
      const k = (size / 100) * sc;
      ctx.setTransform(k, 0, 0, k, W / 2 + (x - W / 2) * sc, H / 2 + (y - H / 2) * sc);
      ctx.font = font(fam, 100);
      ctx.fillStyle = hot > 0.1 ? mixCss('ember', 'signal', 1 - hot) : i === 1 ? mixCss('signal', 'bone', cool * 0.0) : mixCss('signal', 'bone', cool);
      ctx.fillText(s, 0, 0);
      y += 0.18 * size;
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

function squareAt(u: number): [number, number] {
  const s = ((u % 1) + 1) % 1 * 4, i = Math.floor(s), f = s - i;
  const P: [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  const a = P[i % 4]!, b = P[(i + 1) % 4]!;
  return [lerp(a[0], b[0], f) * 0.86, lerp(a[1], b[1], f) * 0.86];
}
