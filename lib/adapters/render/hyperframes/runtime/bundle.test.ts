import { expect, test } from 'bun:test';
import { vmScript } from './bundle';

const data = {
  format: { w: 1080, h: 1920, min_text_px: 68, max_text_px: 230 },
  scenes: {
    demo: {
      scene_id: 'demo',
      start: 1.6,
      duration: 3.9,
      lines: ['l2'],
      beats: [{ on: 'site', nth: 0, t: 0.95, hold: false }],
      words: [
        { line: 'l2', w: 'Crawl', start: 0.2, end: 0.6 },
        { line: 'l2', w: 'any', start: 0.65, end: 0.9 },
        { line: 'l2', w: 'site', start: 0.95, end: 1.3 },
        { line: 'l2', w: 'site', start: 1.4, end: 1.7 },
      ],
    },
  },
};
const load = async (d: typeof data = data) => {
  const win: Record<string, unknown> = {};
  new Function('window', await vmScript(d))(win);
  return win.VM as {
    scene: (id: string) => {
      duration: number;
      at: (w: string, nth?: number) => number;
      beat: (i: number) => number;
      fit: (el: unknown) => number;
      words: { w: string }[];
    };
  };
};

test('at and beat return scene-relative times', async () => {
  const s = (await load()).scene('demo');
  expect(s.duration).toBe(3.9);
  expect(s.at('any')).toBe(0.65);
  expect(s.at('any site')).toBe(0.65);
  expect(s.beat(0)).toBe(0.95);
});
test('at with nth returns the start of the nth match', async () => {
  const s = (await load()).scene('demo');
  expect(s.at('site', 1)).toBe(1.4);
});
test('at throws when the phrase has no words to match', async () => {
  const s = (await load()).scene('demo');
  expect(() => s.at('...')).toThrow(/demo/);
});
test('unknown scene, word or beat throws naming it', async () => {
  const vm = await load();
  expect(() => vm.scene('nope')).toThrow(/nope/);
  expect(() => vm.scene('demo').at('zebra')).toThrow(/demo.*zebra/);
  expect(() => vm.scene('demo').beat(4)).toThrow(/demo.*beat 4/);
});
test('fit sets the largest font size whose text stays inside the box', async () => {
  const el = {
    style: { fontSize: '' },
    clientWidth: 500,
    clientHeight: 200,
    get scrollWidth() {
      return Number.parseInt(this.style.fontSize) * 5;
    },
    get scrollHeight() {
      return 100;
    },
  };
  expect((await load()).scene('demo').fit(el)).toBe(100);
  expect(el.style.fontSize).toBe('100px');
});
test('vmScript is small enough to ship to the page', async () => {
  expect((await vmScript(data)).length).toBeLessThan(20000);
});
test('vmScript escapes "</script>" in data so the page script stays intact', async () => {
  const hostile = {
    ...data,
    scenes: {
      demo: {
        ...data.scenes.demo,
        words: [{ line: 'l2', w: '</script>', start: 0.2, end: 0.6 }],
      },
    },
  };
  const script = await vmScript(hostile);
  expect(script).not.toContain('</script>');
  const vm = await load(hostile);
  expect(vm.scene('demo').words[0]?.w).toBe('</script>');
});
