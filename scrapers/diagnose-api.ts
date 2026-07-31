/**
 * Probes Domino's ordering endpoints and reports what they actually return.
 *
 *   npx tsx scrapers/diagnose-api.ts
 *
 * Read-only. Writes no snapshot, places no order, sends nothing but GETs.
 *
 * Runs in CI because this environment cannot reach the host, and prints its findings to
 * the log. It answers, in order:
 *
 *   1. Does robots.txt for order.dominos.com permit these paths? If not, everything
 *      below is moot and the run stops there.
 *   2. Does the store locator return a store for the San Diego reference market?
 *   3. What does the menu payload contain — coupons, sizes, prices?
 *   4. THE DECIDING QUESTION: does anything in the payload state a diameter in inches?
 *
 * (4) is what determines whether this approach is usable at all. The whole model rests
 * on comparing area, and requirement 1 forbids a hardcoded size table. If the endpoints
 * return "Large" but never 14", then structured prices have bought us nothing on the
 * dimension that matters, and we would still need a second source for diameter.
 */
import {
  REFERENCE_MARKET,
  assertAllowed,
  createApiClient,
  loadApiRobots,
  storeLocatorUrl,
  storeMenuUrl,
  storeProfileUrl,
  type StoreLocatorResponse,
  type StoreMenuResponse,
} from './dominos/api';
import { groupFor } from './robots';
import { USER_AGENT } from './session';

const INCH_PATTERN = /(\d{1,2}(?:\.\d)?)\s*(?:"|''|inch(?:es)?|in\b)/i;

/** Walks the whole payload looking for anything that states a size in inches. */
function findInchMentions(value: unknown, path = '$', found: string[] = [], depth = 0): string[] {
  if (found.length >= 30 || depth > 6) return found;

  if (typeof value === 'string') {
    if (INCH_PATTERN.test(value)) found.push(`${path} = ${JSON.stringify(value.slice(0, 90))}`);
    return found;
  }
  if (Array.isArray(value)) {
    value.slice(0, 40).forEach((v, i) => findInchMentions(v, `${path}[${i}]`, found, depth + 1));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value).slice(0, 60)) {
      findInchMentions(v, `${path}.${k}`, found, depth + 1);
      if (found.length >= 30) break;
    }
  }
  return found;
}

async function main() {
  console.log(`user-agent: ${USER_AGENT}`);
  console.log(`market    : ${REFERENCE_MARKET.city}, ${REFERENCE_MARKET.region} ${REFERENCE_MARKET.postalCode}`);

  // ---------------------------------------------------------------- 1. robots.txt
  console.log(`\n${'='.repeat(78)}\n== 1. ROBOTS.TXT (order.dominos.com)\n${'='.repeat(78)}`);
  const robots = await loadApiRobots();
  const group = groupFor(robots, USER_AGENT);
  console.log(`matched group user-agents: ${group ? group.userAgents.join(', ') : '(none)'}`);
  console.log(`disallow rules: ${group ? JSON.stringify(group.disallow) : '[]'}`);
  console.log(`allow rules   : ${group ? JSON.stringify(group.allow) : '[]'}`);
  console.log(`crawl-delay   : ${group?.crawlDelaySeconds ?? '(none)'}`);

  const locatorUrl = storeLocatorUrl('Carryout');
  try {
    assertAllowed(robots, locatorUrl);
    console.log('\nstore-locator: ALLOWED');
  } catch {
    console.log('\n!! store-locator: DISALLOWED by robots.txt.');
    console.log('!! Stopping. The endpoints are not an option for this project.');
    process.exit(0);
  }

  const getJson = createApiClient({ robots });

  // ------------------------------------------------------------- 2. store locator
  console.log(`\n${'='.repeat(78)}\n== 2. STORE LOCATOR\n${'='.repeat(78)}`);
  const located = await getJson<StoreLocatorResponse>(locatorUrl);
  const stores = located.Stores ?? [];
  console.log(`stores returned: ${stores.length}`);
  for (const store of stores.slice(0, 5)) {
    console.log(
      `  ${store.StoreID}  open=${store.IsOpen}  online=${store.IsOnlineCapable}  ` +
        `${store.PostalCode ?? ''}  ${(store.AddressDescription ?? '').replace(/\s+/g, ' ').slice(0, 60)}`,
    );
  }

  const store = stores.find((s) => s.IsOnlineCapable && s.StoreID) ?? stores[0];
  if (!store?.StoreID) {
    console.log('\n!! No usable store returned; cannot continue.');
    process.exit(1);
  }
  console.log(`\nusing store: ${store.StoreID}`);

  // Profile is small and confirms we resolved a real, orderable store.
  try {
    const profileUrl = storeProfileUrl(store.StoreID);
    assertAllowed(robots, profileUrl);
    const profile = await getJson<Record<string, unknown>>(profileUrl);
    console.log(`profile keys: ${Object.keys(profile).slice(0, 18).join(', ')}`);
  } catch (error) {
    console.log(`profile fetch skipped: ${error instanceof Error ? error.message : error}`);
  }

  // -------------------------------------------------------------------- 3. menu
  console.log(`\n${'='.repeat(78)}\n== 3. MENU PAYLOAD\n${'='.repeat(78)}`);
  const menuUrl = storeMenuUrl(store.StoreID);
  assertAllowed(robots, menuUrl);
  const menu = await getJson<StoreMenuResponse>(menuUrl);

  console.log(`top-level keys: ${Object.keys(menu).join(', ')}`);
  for (const key of ['Products', 'Variants', 'Sizes', 'Coupons', 'Toppings'] as const) {
    const section = (menu as Record<string, unknown>)[key];
    if (section && typeof section === 'object') {
      console.log(`  ${key.padEnd(10)} ${Object.keys(section).length} entries`);
    }
  }

  console.log('\n-- sample coupons --');
  const coupons = Object.entries(menu.Coupons ?? {}).slice(0, 14);
  for (const [code, c] of coupons) {
    console.log(
      `  ${code.padEnd(10)} $${(c.Price ?? '?').padStart(6)}  ` +
        `svc=${(c.ValidServiceMethods ?? []).join('/') || '?'}  local=${c.Local ?? '?'}\n` +
        `             ${(c.Name ?? '').slice(0, 70)}\n` +
        `             ${(c.Description ?? '').replace(/\s+/g, ' ').slice(0, 100)}`,
    );
  }
  if (coupons.length === 0) console.log('  (no coupons in payload)');

  console.log('\n-- sample pizza variants (name, price, size code) --');
  const variants = Object.entries(menu.Variants ?? {})
    .filter(([code]) => /^(?:P|S)/.test(code))
    .slice(0, 14);
  for (const [code, v] of variants) {
    console.log(`  ${code.padEnd(12)} $${(v.Price ?? '?').padStart(6)}  size=${v.SizeCode ?? '?'}  ${(v.Name ?? '').slice(0, 60)}`);
  }

  console.log('\n-- Sizes section --');
  console.log(`  ${JSON.stringify(menu.Sizes ?? {}).slice(0, 600)}`);

  // ------------------------------------------------------- 4. the deciding question
  console.log(`\n${'='.repeat(78)}\n== 4. DOES THE PAYLOAD STATE DIAMETER IN INCHES?\n${'='.repeat(78)}`);
  const mentions = findInchMentions(menu);
  if (mentions.length === 0) {
    console.log('  NO. Nothing in the menu payload states a size in inches.');
    console.log('  Structured prices do not help with area — diameter needs another source,');
    console.log('  and requirement 1 forbids hardcoding it.');
  } else {
    console.log(`  YES — ${mentions.length} mentions:`);
    for (const line of mentions) console.log(`    ${line}`);
  }
}

main().catch((error) => {
  console.error('API probe failed:', error);
  process.exit(1);
});
