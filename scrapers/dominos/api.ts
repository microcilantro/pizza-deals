import { isPathAllowed, parseRobotsTxt, type RobotsTxt } from '../robots';
import { USER_AGENT } from '../session';

/**
 * Domino's public ordering endpoints.
 *
 * These are the same unauthenticated JSON endpoints the website's own front end calls.
 * Reading them instead of the rendered page solves the problem the DOM diagnostic
 * uncovered: the coupon page renders nothing until a store is chosen, so there is no
 * markup to parse. The endpoints take the store as a parameter, which makes the
 * reference market (D5) an explicit input rather than an implicit browser state.
 *
 * They also return structured sizes and prices, which removes a whole class of parsing
 * error — no more reading "$7.99" out of a text node.
 *
 * Access rules are unchanged and non-negotiable: robots.txt is fetched for this host and
 * every path is checked against it before any request. `order.dominos.com` is a
 * different host from `www.dominos.com`, so it gets its own robots.txt — reusing the
 * www rules would be assuming permission we were never granted.
 */

export const ORDER_ORIGIN = 'https://order.dominos.com';

export interface Market {
  city: string;
  region: string;
  postalCode: string;
}

/** D5: the reference market every price is scoped to. */
export const REFERENCE_MARKET: Market = {
  city: 'San Diego',
  region: 'CA',
  postalCode: '92101',
} as const;

/**
 * A second, deliberately distant market, used only to decide which offers are national.
 *
 * The menu payload's `Local` flag does not mean what its name suggests — every coupon in
 * a store menu carries it, because the menu is store-scoped by construction. So it
 * cannot separate a national promotion from a store's own. Comparing two markets can:
 * an offer present in both San Diego and Columbus is running nationally; one present in
 * only one is not. Prices still come from the reference market.
 */
export const COMPARISON_MARKET: Market = {
  city: 'Columbus',
  region: 'OH',
  postalCode: '43215',
};

export function storeLocatorUrl(
  type: 'Carryout' | 'Delivery',
  market: Market = REFERENCE_MARKET,
): string {
  const params = new URLSearchParams({
    type,
    c: `${market.city}, ${market.region} ${market.postalCode}`,
    s: '',
  });
  return `${ORDER_ORIGIN}/power/store-locator?${params}`;
}

export function storeMenuUrl(storeId: string): string {
  return `${ORDER_ORIGIN}/power/store/${storeId}/menu?lang=en&structured=true`;
}

export function storeProfileUrl(storeId: string): string {
  return `${ORDER_ORIGIN}/power/store/${storeId}/profile`;
}

export class ApiRobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt for ${ORDER_ORIGIN} disallows ${url}`);
    this.name = 'ApiRobotsDisallowedError';
  }
}

/**
 * Fetches robots.txt for the ordering host.
 *
 * A 404 is treated as "no restrictions", which is the RFC behaviour. Any other failure
 * throws: an unreadable robots.txt must stop the run, because failing open on a
 * permissions check is how a well-behaved client becomes someone's incident.
 */
export async function loadApiRobots(fetchImpl: typeof fetch = fetch): Promise<RobotsTxt> {
  const response = await fetchImpl(`${ORDER_ORIGIN}/robots.txt`, {
    headers: { 'user-agent': USER_AGENT },
  });

  if (response.status === 404) return parseRobotsTxt('');
  if (!response.ok) {
    throw new Error(`Could not read ${ORDER_ORIGIN}/robots.txt (HTTP ${response.status})`);
  }
  return parseRobotsTxt(await response.text());
}

export function assertAllowed(robots: RobotsTxt, url: string): void {
  const { pathname, search } = new URL(url);
  if (!isPathAllowed(robots, USER_AGENT, `${pathname}${search}`)) {
    throw new ApiRobotsDisallowedError(url);
  }
}

/** Conservative pacing. The job runs once a day; there is no reason to hurry. */
export const API_REQUEST_INTERVAL_MS = 3_000;

export interface ApiClientOptions {
  robots: RobotsTxt;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
}

/** Rate-limited, robots-checked JSON GET. */
export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const intervalMs = options.intervalMs ?? API_REQUEST_INTERVAL_MS;
  let lastRequestAt = 0;

  return async function getJson<T = unknown>(url: string): Promise<T> {
    assertAllowed(options.robots, url);

    const wait = lastRequestAt + intervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`GET ${url} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  };
}

/* ------------------------------------------------------------------ payload shapes */

export interface StoreLocatorResponse {
  Stores?: {
    StoreID?: string;
    IsOnlineCapable?: boolean;
    IsDeliveryStore?: boolean;
    IsOpen?: boolean;
    ServiceIsOpen?: Record<string, boolean>;
    AddressDescription?: string;
    PostalCode?: string;
  }[];
}

/**
 * Only the parts we rely on. The payload is large and its shape is the chain's to
 * change, so everything is optional and nothing is assumed present.
 */
export interface StoreMenuResponse {
  Misc?: Record<string, unknown>;
  Products?: Record<string, { Name?: string; Description?: string; Tags?: Record<string, unknown> }>;
  Variants?: Record<
    string,
    {
      Name?: string;
      Price?: string;
      ProductCode?: string;
      SizeCode?: string;
      FlavorCode?: string;
      Tags?: Record<string, unknown>;
    }
  >;
  Sizes?: Record<string, unknown>;
  Coupons?: Record<
    string,
    {
      Name?: string;
      Description?: string;
      Price?: string;
      Tags?: Record<string, unknown>;
      ValidServiceMethods?: string[];
      Local?: boolean;
    }
  >;
}
