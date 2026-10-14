// The only file that imports `playwright`; everything else drives the browser through `ReplayPage`, so tests pass a fake.
import { type BrowserContext, chromium, type Locator, type Page } from 'playwright';

export type Box = { x: number; y: number; w: number; h: number };

/** What the replay needs from a browser page. `close` resolves to the absolute path of the recording. */
export type ReplayPage = {
  goto(url: string): Promise<void>;
  click(target: string): Promise<void>;
  type(target: string, value: string): Promise<void>;
  scroll(): Promise<void>;
  wait(ms: number): Promise<void>;
  /** Scrolls the target into view and measures it; null when no visible element matches within 5 s. `input` looks for fields first. */
  box(target: string, input: boolean): Promise<Box | null>;
  /** True when the field the target names is `type="password"`. */
  isPassword(target: string): Promise<boolean>;
  screenshot(path: string): Promise<void>;
  text(): Promise<string>;
  url(): string;
  close(): Promise<string>;
};
export type Launch = (o: { profileDir: string; recordDir: string; headless: boolean }) => Promise<ReplayPage>;

const VIEWPORT = { width: 1280, height: 800 };
const ACTION_TIMEOUT_MS = 5000;
const GOTO_TIMEOUT_MS = 30_000;
const SETTLE_MS = 1000; // pages with analytics never reach "networkidle", so wait for "load" and then a moment
const POLL_MS = 100;
const SCROLL_PX = 600;

/** True when a launch error says the profile folder is held by another browser, or the browser closed on start. */
export const isProfileInUse = (message: string): boolean =>
  /in use|ProcessSingleton|SingletonLock|has been closed/i.test(message);

const firstLine = (cause: unknown): string =>
  String((cause as Error | undefined)?.message ?? cause).split('\n')[0] || 'unknown error';

/** Which browser Playwright can start: the system Chrome, its own Chromium, or none (null). Each probe is closed again. Used by the doctor, never during a replay. */
export async function browserChannel(): Promise<'chrome' | 'chromium' | null> {
  for (const [name, options] of [
    ['chrome', { channel: 'chrome' }],
    ['chromium', {}],
  ] as const) {
    try {
      await (await chromium.launch(options)).close();
      return name;
    } catch {
      // ponytail: any launch failure means "not available"; the next probe or null tells the caller what to install.
    }
  }
  return null;
}

/** Where a target may be: links and buttons by name, then any text; fields (for `input`) are tried first. */
const candidates = (page: Page, target: string, input: boolean): Locator[] => {
  const byRole = (roles: Array<'link' | 'button' | 'textbox' | 'searchbox' | 'combobox'>) =>
    roles.map((role) => page.getByRole(role, { name: target }));
  const named = [...byRole(['link', 'button']), page.getByText(target)];
  return input
    ? [
        page.getByLabel(target),
        page.getByPlaceholder(target),
        ...byRole(['textbox', 'searchbox', 'combobox']),
        ...named,
      ]
    : named;
};

/**
 * The first visible element for a target, in the order of `candidates`, waiting up to 5 s for the page to render it.
 * Returns the locator, or null when nothing shows up.
 */
const find = async (page: Page, target: string, input: boolean): Promise<Locator | null> => {
  const list = candidates(page, target, input).map((l) => l.first());
  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  for (;;) {
    for (const l of list) if (await l.isVisible()) return l;
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(POLL_MS);
  }
};

const mustFind = async (page: Page, action: string, target: string, input: boolean): Promise<Locator> => {
  const found = await find(page, target, input);
  if (!found)
    throw new Error(`${action}: Timeout ${ACTION_TIMEOUT_MS}ms exceeded: no visible element named "${target}"`);
  return found;
};

const openContext = async (profileDir: string, recordDir: string, headless: boolean): Promise<BrowserContext> => {
  const options = { headless, viewport: VIEWPORT, recordVideo: { dir: recordDir, size: VIEWPORT } };
  try {
    return await chromium.launchPersistentContext(profileDir, { ...options, channel: 'chrome' });
  } catch (chromeError) {
    // A held profile fails the same way in any browser; only a missing Chrome falls back to Playwright's Chromium.
    if (isProfileInUse(String((chromeError as Error).message))) throw chromeError;
    try {
      return await chromium.launchPersistentContext(profileDir, options);
    } catch (chromiumError) {
      throw new Error(`system Chrome: ${firstLine(chromeError)}; bundled Chromium: ${firstLine(chromiumError)}`, {
        cause: chromiumError,
      });
    }
  }
};

/**
 * Open a persistent browser profile that records video: system Chrome, else Playwright's Chromium.
 * Returns the page. Throws the Playwright error when the browser cannot start (the context is closed first).
 */
export const launchPlaywright: Launch = async ({ profileDir, recordDir, headless }) => {
  const context = await openContext(profileDir, recordDir, headless);
  let page: Page;
  try {
    page = context.pages()[0] ?? (await context.newPage());
  } catch (error) {
    await context.close();
    throw error;
  }
  return {
    goto: async (url) => {
      await page.goto(url, { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS });
      await page.waitForTimeout(SETTLE_MS);
    },
    click: async (target) => (await mustFind(page, 'click', target, false)).click({ timeout: ACTION_TIMEOUT_MS }),
    type: async (target, value) =>
      (await mustFind(page, 'type', target, true)).fill(value, { timeout: ACTION_TIMEOUT_MS }),
    scroll: () => page.mouse.wheel(0, SCROLL_PX),
    wait: (ms) => page.waitForTimeout(ms),
    box: async (target, input) => {
      const locator = await find(page, target, input);
      if (!locator) return null;
      await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
      const b = await locator.boundingBox({ timeout: 2000 });
      return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
    },
    isPassword: async (target) => {
      const locator = await find(page, target, true);
      return (await locator?.getAttribute('type', { timeout: 1000 }))?.toLowerCase() === 'password';
    },
    screenshot: async (file) => void (await page.screenshot({ path: file })),
    text: () => page.innerText('body'),
    url: () => page.url(),
    close: async () => {
      const video = page.video();
      await context.close(); // the recording is only complete after the context closes
      if (!video) throw new Error('the browser recorded no video');
      return video.path();
    },
  };
};
