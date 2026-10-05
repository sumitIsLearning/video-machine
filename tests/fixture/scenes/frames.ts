// FRAMES — "Then that code is rendered frame by frame and turned into a video."
// 1. "Then that code is rendered": frame 0001 of the artboard, still a vector drawing; a scanline
//    sweeps down it and leaves pixels behind (filled shapes on a pixel grid).
// 2. "frame by frame": the frame becomes a film strip; one new frame snaps in per said word, each
//    the artboard at its own t (MOTION slides, the square turns, the puck rides e(t)); then the strip
//    runs, faster and faster (the export's motion blur smears it), the counter rolling.
// 3. "and turned into a video.": the strip collapses into one frame, which becomes a player:
//    a scrubber, the timecode, and a play triangle that fills in signal on "video".
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { type Line, type Word } from '../engine/lyrics';
import { clamp, ease, lerp, prog, pulse, TAU, noise1 } from '../engine/util';
import { Cam2D, gridPass, setGrid, drawKaraoke, placeRow, w2s, setWorld, label, mixCss, drawPen, lineOf, wordOf, pt, type KWord, type Cam } from './_vo';

const ARCH = (wd: number, wt: number) => F.archivo(wd, wt);
const expo = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
const FW = 640, FH = 360, GAP = 48;

export default class Frames extends Scene {
  cam = new Cam2D();
  grid = gridPass(24, 96);
  fx = new LineBatch(20000);
  ui = new Layer2D();
  kw: KWord[] = [];
  L!: Line;
  w: Record<string, Word> = {};
  tScan0 = 0; tScan1 = 0; tRun = 0; tCol = 0;

  override init() {
    const ly = this.ctx.lyrics;
    this.L = lineOf(ly, 'Then that code is rendered');
    const w = this.w;
    for (const [k, q, n] of [['then', 'Then', 0], ['that', 'that', 0], ['code', 'code', 0], ['is', 'is', 0], ['rendered', 'rendered', 0], ['frame1', 'frame', 0], ['by', 'by', 0],
      ['frame2', 'frame', 1], ['and', 'and', 0], ['turned', 'turned', 0], ['into', 'into', 0], ['a', 'a', 0], ['video', 'video', 0]] as const) w[k] = wordOf(this.L, q, n);
    this.tScan0 = w.rendered!.start; this.tScan1 = w.rendered!.end + 0.08;
    this.tRun = w.frame2!.end;
    this.tCol = w.and!.start;
    const fam7 = ARCH(100, 700);
    this.kw.push(...placeRow([w.then!, w.that!, w.code!, w.is!, w.rendered!], -FW / 2, -FH / 2 - 44, 62, fam7, 'r1', { ant: 0.2 }).words);
    this.kw.push(...placeRow([w.frame1!, w.by!, w.frame2!], -FW / 2, FH / 2 + 150, 120, ARCH(100, 900), 'r2', { ant: 0.15 }).words);
    this.kw.push(...placeRow([w.and!, w.turned!, w.into!, w.a!, w.video!], -FW / 2, FH / 2 + 118, 62, fam7, 'r3', { ant: 0.2 }).words);
    const K = this.cam;
    K.key(this.ctx.start, 0, -20, 1.55, 0);
    K.key(w.rendered!.end, 0, 0, 1.62, 0.004, ease.linear);
    K.key(w.frame1!.start + 0.3, 340, 60, 0.82, -0.01, ease.outExpo);
    K.key(this.tRun, 360, 70, 0.78, -0.012, ease.linear);
    K.key(this.tCol + 0.3, 0, 60, 1.05, 0, ease.inOutCubic);
    K.key(this.ctx.end, 0, 50, 1.12, 0, ease.linear);
  }

  /** How far the strip has scrolled (in frames): one snap per word of "frame by frame", then running. */
  scroll(t: number) {
    const w = this.w;
    let s = 0;
    for (const wd of [w.frame1!, w.by!, w.frame2!]) s += ease.outExpo(prog(t, wd.start, wd.start + 0.22));
    const r = Math.max(0, t - this.tRun);
    s += 2.2 * r * r * 10 + 4 * r; // accelerating
    return s;
  }
  collapse(t: number) { return ease.inOutCubic(prog(t, this.tCol, this.w.turned!.end + 0.1)); }
  frameNo(t: number) { return Math.min(5558, 1 + Math.floor(this.scroll(t) * 5 * (1 + Math.max(0, t - this.tRun) * 40))); }

  groupAlpha(g: string, t: number) {
    const w = this.w;
    if (g === 'r1') return 1 - prog(t, w.frame1!.start - 0.1, w.frame1!.start + 0.25);
    if (g === 'r2') return 1 - prog(t, this.tCol - 0.05, this.tCol + 0.25);
    return 1;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, w = this.w;
    const c = this.cam.at(t);
    setGrid(this.grid, c, { reveal: [0, 0, 1e5], ink: 0.7 });
    this.grid.render(renderer, out);
    const U = this.ui; U.clear();
    const ctx = U.ctx;
    const col = this.collapse(t);
    const sc = this.scroll(t);
    // the strip: frames i = 0..; frame i sits at x = i*(FW+GAP) - scroll; collapsing pulls them all to 0
    const n0 = Math.max(0, Math.floor(sc) - 3), n1 = Math.floor(sc) + 6;
    const strip = t >= w.frame1!.start - 0.05 ? 1 : 0;
    for (let i = n1; i >= n0; i--) {
      if (i > 0 && !strip) continue;
      const appear = i === 0 ? 1 : prog(sc + 3.2, i, i + 0.4);
      if (appear <= 0) continue;
      const x0 = (i - sc) * (FW + GAP);
      const x = lerp(x0, 0, col) - FW / 2;
      const y = -FH / 2;
      const alpha = appear * (i === Math.round(lerp(sc, sc, 1)) ? 1 : 1) * (col > 0 && i !== Math.floor(sc) ? 1 - col : 1);
      if (alpha <= 0.01) continue;
      const tf = (i * 5) / 60 + (i > 0 ? 0.0 : 1.2);
      const raster = i > 0 ? 1 : this.scanK(t);
      this.drawFrame(ctx, c, x, y, tf, raster, alpha, i, t);
    }
    // the player, on "turned into a video"
    if (col > 0) this.drawPlayer(ctx, c, t, col);
    // the counter
    if (strip && col < 1) {
      const a = 1 - col;
      setWorld(ctx, c, -FW / 2, FH / 2 + 34, 0.2);
      ctx.font = font(F.mono(500), 100);
      ctx.fillStyle = rgba('bone', 0.9 * a);
      ctx.fillText(`frame ${String(this.frameNo(t)).padStart(4, '0')} / 5558`, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    drawKaraoke(ctx, c, t, this.kw, { alpha: (g, tt) => this.groupAlpha(g, tt) });
    comp.draw(renderer, U.upload(), out);
    // the scanline's spark
    const X = this.fx; X.clear();
    const sk = this.scanK(t);
    if (sk > 0 && sk < 1) {
      const y = -FH / 2 + sk * FH;
      drawPen(X, t, (tt) => { const k = this.scanK(tt); if (k <= 0 || k >= 1) return null; const yy = -FH / 2 + k * FH; const xx = FW / 2 - (k * 9 % 1) * FW; return w2s(c, xx, yy); }, { scale: 0.7, rate: 40 });
      void y;
    }
    X.render(renderer, out);
    const run = Math.max(0, t - this.tRun) * (1 - col);
    return {
      bloom: 0.7, bloomThreshold: 0.84, vignette: 0.42, grain: 0.05,
      zoom: 1 + 0.012 * (pulse(t, w.frame1!.start, 0.08) + pulse(t, w.by!.start, 0.08) + pulse(t, w.frame2!.start, 0.08)) + 0.02 * pulse(t, w.video!.start, 0.1),
      ca: 1.2 + 3 * run,
      shake: [noise1(t * 40, 1) * 4 * run, 0],
    };
  }

  scanK(t: number) { return prog(t, this.tScan0, this.tScan1, ease.inOutQuad); }

  /** One frame of the film strip: the artboard at time tf; `raster` 0 = vector hairlines, 1 = pixels. */
  drawFrame(ctx: CanvasRenderingContext2D, c: Cam, x: number, y: number, tf: number, raster: number, alpha: number, i: number, t: number) {
    const hair = 1 / c.z;
    setWorld(ctx, c, x, y);
    ctx.globalAlpha = alpha;
    // sprocket holes (film strip) once the strip exists
    if (t >= this.w.frame1!.start - 0.05) {
      ctx.fillStyle = rgba('ink2', 1);
      ctx.fillRect(-GAP / 2, -46, FW + GAP, FH + 92);
      for (let k = 0; k < 10; k++) {
        ctx.fillStyle = rgba('bone', 0.35);
        ctx.fillRect(-GAP / 2 + 14 + k * ((FW + GAP) / 10), -34, 22, 16);
        ctx.fillRect(-GAP / 2 + 14 + k * ((FW + GAP) / 10), FH + 18, 22, 16);
      }
    }
    ctx.fillStyle = rgba('ink', 1);
    ctx.fillRect(0, 0, FW, FH);
    // content (scaled from the 880×495 artboard)
    const s = FW / 880;
    const paint = (filled: boolean) => {
      ctx.save();
      ctx.scale(s, s);
      const u = clamp(tf / 0.6);
      ctx.font = font(ARCH(100, 900), 128);
      ctx.fillStyle = rgba('bone', filled ? 1 : 0);
      ctx.strokeStyle = rgba('bone', 0.8);
      ctx.lineWidth = 1.2 / (c.z * s);
      const tx = 64 - 160 * (1 - expo(u));
      if (filled) ctx.fillText('MOTION', tx, 168); else ctx.strokeText('MOTION', tx, 168);
      ctx.lineWidth = (filled ? 3 : 1.2) / (c.z * s);
      ctx.strokeStyle = rgba('bone', filled ? 1 : 0.8);
      ctx.beginPath(); ctx.arc(640, 300, 112, 0, TAU); ctx.stroke();
      const rot = 0.4 * tf;
      ctx.save(); ctx.translate(330, 342); ctx.rotate(rot); ctx.strokeRect(-62, -62, 124, 124); ctx.restore();
      ctx.fillStyle = filled ? rgba('signal', 1) : rgba('signal', 0.6);
      const pu = ((tf % 1.6) / 1.6) / 0.75;
      ctx.beginPath(); ctx.arc(lerp(70, 810, expo(clamp(pu))), 452, 9, 0, TAU); ctx.fill();
      ctx.restore();
    };
    if (raster < 1) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, raster * FH, FW, FH * (1 - raster)); ctx.clip(); paint(false); ctx.restore();
    }
    if (raster > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, FW, raster * FH); ctx.clip();
      paint(true);
      // the pixel grid
      ctx.fillStyle = rgba('ink', 0.35);
      for (let gx = 0; gx < FW; gx += 8) ctx.fillRect(gx, 0, hair, FH);
      for (let gy = 0; gy < FH; gy += 8) ctx.fillRect(0, gy, FW, hair);
      ctx.restore();
      if (raster < 1) { ctx.fillStyle = rgba('signal', 1); ctx.fillRect(0, raster * FH - 1.5 / c.z, FW, 3 / c.z); }
    }
    ctx.strokeStyle = rgba('bone', 0.55);
    ctx.lineWidth = hair;
    ctx.strokeRect(0, 0, FW, FH);
    // labels
    ctx.font = font(F.mono(500), 15);
    ctx.fillStyle = rgba('bone', 0.75);
    ctx.fillText(String(i * 5 + 1).padStart(4, '0'), 0, -56 + (t >= this.w.frame1!.start - 0.05 ? 0 : 40));
    ctx.textAlign = 'right';
    ctx.fillStyle = rgba('ash', 0.85);
    ctx.fillText(`t = ${((i * 5) / 60).toFixed(3)}`, FW, -56 + (t >= this.w.frame1!.start - 0.05 ? 0 : 40));
    ctx.textAlign = 'left';
    if (raster > 0 && raster < 1) { ctx.fillStyle = rgba('signal', 0.95); ctx.fillText('rendering…', 0, FH + 26); }
    if (i === 0 && raster >= 1 && t < this.w.frame1!.start) { ctx.fillStyle = rgba('ash', 0.85); ctx.fillText('1920×1080 · RGBA8 · 0.31 ms', 0, FH + 26); }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawPlayer(ctx: CanvasRenderingContext2D, c: Cam, t: number, col: number) {
    const w = this.w;
    const x = -FW / 2, y = -FH / 2;
    setWorld(ctx, c, x, y);
    ctx.globalAlpha = col;
    ctx.fillStyle = rgba('ink', 1);
    ctx.fillRect(0, 0, FW, FH);
    ctx.strokeStyle = rgba('bone', 0.6);
    ctx.lineWidth = 1 / c.z;
    ctx.strokeRect(0, 0, FW, FH);
    // the play triangle: hairline, filling in signal on "video"
    const tv = w.video!.start;
    const fill = prog(t, tv, tv + 0.15);
    const r = 62;
    ctx.beginPath();
    ctx.moveTo(FW / 2 - r * 0.62, FH / 2 - r); ctx.lineTo(FW / 2 + r * 0.95, FH / 2); ctx.lineTo(FW / 2 - r * 0.62, FH / 2 + r); ctx.closePath();
    if (fill > 0) { ctx.fillStyle = rgba('signal', fill); ctx.fill(); }
    ctx.strokeStyle = fill > 0 ? rgba('signal', 1) : rgba('bone', 0.85);
    ctx.lineWidth = 2 / c.z;
    ctx.stroke();
    // scrubber
    const sy = FH + 34;
    ctx.fillStyle = rgba('bone', 0.25);
    ctx.fillRect(0, sy, FW, 2 / c.z);
    const pos = 51.5 / 92.64;
    ctx.fillStyle = rgba('signal', 1);
    ctx.fillRect(0, sy - 1 / c.z, FW * pos * col, 4 / c.z);
    ctx.beginPath(); ctx.arc(FW * pos * col, sy, 7, 0, TAU); ctx.fill();
    ctx.font = font(F.mono(400), 15);
    ctx.fillStyle = rgba('ash', 0.9);
    ctx.fillText('00:51.50', 0, sy + 30);
    ctx.textAlign = 'right';
    ctx.fillText('01:32.64', FW, sy + 30);
    ctx.textAlign = 'left';
    label(ctx, 'OUTPUT.MP4', 0, -18, { size: 13, col: rgba('bone', 0.7) });
    ctx.font = font(F.mono(400), 13);
    ctx.fillStyle = rgba('ash', 0.85);
    ctx.textAlign = 'right';
    ctx.fillText('1920×1080 · 60 fps · h.264 · this video', FW, -18);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    void mixCss; void LIN; void pt;
  }
}
