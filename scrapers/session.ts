import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { crawlDelayFor, isPathAllowed, parseRobotsTxt, type RobotsTxt } from './robots';

/**
 * Shared browser plumbing for every chain scraper: robots.txt enforcement, rate
 * limiting, and failure artifacts.
 *
 * Kept chain-agnostic so a break in one chain's parser cannot take down the others —
 * each scraper gets its own session and its own try/catch, and the runner records a
 * per-chain status.
 */

export const USER_AGENT =
  'PizzaValueQuestBot/0.1 (+https://github.com/microcilantro/pizza-deals; daily national deal comparison)';

/** Conservative floor between requests. The job runs at most daily; there is no hurry. */
export const MIN_REQUEST_INTERVAL_MS = 5_000;

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows fetching ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

export interface SessionOptions {
  chain: string;
  /** Where screenshots and HTML dumps go on failure. */
  artifactDir: string;
  /** Overrides the robots crawl-delay when that is shorter than our own floor. */
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class ScrapeSession {
  private robots: RobotsTxt | null = null;
  private lastRequestAt = 0;
  private intervalMs: number;
  readonly artifacts: string[] = [];

  constructor(
    private readonly context: BrowserContext,
    private readonly options: SessionOptions,
  ) {
    this.intervalMs = options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
  }

  /**
   * Fetches and applies robots.txt. If it cannot be read we stop rather than assume
   * permission — failing open on a permissions check is how well-meaning scrapers
   * become a problem.
   */
  async loadRobots(origin: string): Promise<void> {
    const page = await this.context.newPage();
    try {
      const response = await page.goto(`${origin}/robots.txt`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      if (!response || !response.ok()) {
        throw new Error(`robots.txt returned ${response?.status() ?? 'no response'}`);
      }
      this.robots = parseRobotsTxt(await response.text());

      // Honour a crawl-delay longer than our own floor; never shorten below it.
      const delay = crawlDelayFor(this.robots, USER_AGENT);
      if (delay !== null) {
        this.intervalMs = Math.max(this.intervalMs, delay * 1000);
      }
    } finally {
      await page.close();
    }
  }

  isAllowed(url: string): boolean {
    if (!this.robots) return false;
    const { pathname, search } = new URL(url);
    return isPathAllowed(this.robots, USER_AGENT, `${pathname}${search}`);
  }

  /** Navigates to a URL, enforcing robots.txt and the rate limit first. */
  async open(url: string): Promise<Page> {
    if (!this.robots) {
      throw new Error('loadRobots() must be called before opening any page');
    }
    if (!this.isAllowed(url)) {
      throw new RobotsDisallowedError(url);
    }

    await this.throttle();

    const page = await this.context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    return page;
  }

  private async throttle(): Promise<void> {
    const now = (this.options.now ?? Date.now)();
    const wait = this.lastRequestAt + this.intervalMs - now;
    if (wait > 0) {
      const sleep = this.options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
      await sleep(wait);
    }
    this.lastRequestAt = (this.options.now ?? Date.now)();
  }

  /**
   * Captures a screenshot and the page HTML when parsing fails.
   *
   * Both, not just the screenshot: the image tells you the page changed, the HTML tells
   * you what to change the selector to.
   */
  async captureFailure(page: Page, label: string): Promise<string[]> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(this.options.artifactDir, `${this.options.chain}-${label}-${stamp}`);
    await mkdir(this.options.artifactDir, { recursive: true });

    const written: string[] = [];
    try {
      const png = `${base}.png`;
      await page.screenshot({ path: png, fullPage: true });
      written.push(png);
    } catch (error) {
      console.error(`[${this.options.chain}] screenshot failed:`, error);
    }
    try {
      const html = `${base}.html`;
      await writeFile(html, await page.content(), 'utf8');
      written.push(html);
    } catch (error) {
      console.error(`[${this.options.chain}] html capture failed:`, error);
    }

    this.artifacts.push(...written);
    return written;
  }
}

export async function createSession(
  browser: Browser,
  options: SessionOptions,
): Promise<{ session: ScrapeSession; context: BrowserContext }> {
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    // A fixed viewport and locale keep day-over-day comparisons stable (D5).
    viewport: { width: 1280, height: 1024 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  return { session: new ScrapeSession(context, options), context };
}
