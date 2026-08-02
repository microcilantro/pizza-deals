/**
 * Host probe: do Papa John's or Pizza Hut expose an ordering API we may use?
 *
 *   npx tsx scrapers/diagnose-hosts.ts papa_johns
 *
 * Domino's data lives on `order.dominos.com`, a different host from `www.dominos.com`
 * with its own robots.txt. So a disallow on `www.papajohns.com/order/deals` says nothing
 * about `api.papajohns.com` — that host has to be asked separately.
 *
 * For each candidate host this reports, in order:
 *   1. Is the host reachable at all? (Pizza Hut's www times out from CI.)
 *   2. What does THAT host's robots.txt say?
 *   3. For paths it permits, what does a GET actually return?
 *
 * Nothing is fetched before its own host's robots.txt has been read and consulted. An
 * unreadable robots.txt means no requests to that host — same fail-closed rule as
 * everywhere else.
 */
import { isPathAllowed, parseRobotsTxt, type RobotsTxt } from './robots';
import { USER_AGENT } from './session';

interface HostProbe {
  origin: string;
  paths: string[];
}

const TARGETS: Record<string, HostProbe[]> = {
  papa_johns: [
    { origin: 'https://api.papajohns.com', paths: ['/', '/v1/stores', '/webapi/stores'] },
    { origin: 'https://order.papajohns.com', paths: ['/', '/api/stores'] },
    {
      origin: 'https://www.papajohns.com',
      paths: ['/api/store/search', '/webapi/store/search', '/order/menu'],
    },
  ],
  pizza_hut: [
    { origin: 'https://api.pizzahut.com', paths: ['/', '/v1/stores'] },
    { origin: 'https://order.pizzahut.com', paths: ['/', '/api/stores'] },
    { origin: 'https://www.pizzahut.com', paths: ['/api/store/search'] },
  ],
};

const TIMEOUT_MS = 15_000;

async function timedFetch(url: string): Promise<Response | { error: string }> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause;
    return { error: cause?.code ?? (error as Error).name ?? String(error) };
  }
}

async function probeHost(probe: HostProbe): Promise<void> {
  console.log(`\n${'='.repeat(72)}\n== ${probe.origin}\n${'='.repeat(72)}`);

  // 1/2. That host's own robots.txt.
  const robotsResponse = await timedFetch(`${probe.origin}/robots.txt`);
  if ('error' in robotsResponse) {
    console.log(`  robots.txt: UNREACHABLE (${robotsResponse.error}) — host not usable`);
    return;
  }

  let robots: RobotsTxt;
  if (robotsResponse.status === 404) {
    console.log('  robots.txt: 404 — no restrictions stated');
    robots = parseRobotsTxt('');
  } else if (!robotsResponse.ok) {
    console.log(`  robots.txt: HTTP ${robotsResponse.status} — unreadable, refusing this host`);
    return;
  } else {
    const text = await robotsResponse.text();
    robots = parseRobotsTxt(text);
    console.log(`  robots.txt: HTTP 200, ${text.length}b`);
  }

  // 3. Only paths this host permits.
  for (const path of probe.paths) {
    if (!isPathAllowed(robots, USER_AGENT, path)) {
      console.log(`  DISALLOW  ${path}`);
      continue;
    }

    const response = await timedFetch(`${probe.origin}${path}`);
    if ('error' in response) {
      console.log(`  ALLOWED   ${path} -> ${response.error}`);
      continue;
    }

    const type = response.headers.get('content-type') ?? '';
    const body = await response.text().catch(() => '');
    const json = type.includes('json');
    let shape = '';
    if (json) {
      try {
        const parsed = JSON.parse(body);
        shape = Array.isArray(parsed)
          ? `[array of ${parsed.length}]`
          : Object.keys(parsed).slice(0, 10).join(', ');
      } catch {
        shape = '(unparseable json)';
      }
    }
    console.log(
      `  ALLOWED   ${path} -> HTTP ${response.status} ${type.split(';')[0]} ${body.length}b` +
        (shape ? `\n              keys: ${shape}` : ''),
    );
    if (json && body.length < 400) console.log(`              body: ${body.slice(0, 300)}`);
  }
}

async function main() {
  const chain = process.argv[2] ?? 'papa_johns';
  const probes = TARGETS[chain];
  if (!probes) {
    console.error(`Unknown chain "${chain}". Known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }

  console.log(`user-agent: ${USER_AGENT}`);
  for (const probe of probes) await probeHost(probe);
}

main().catch((error) => {
  console.error('Host probe crashed:', error);
  process.exit(1);
});
