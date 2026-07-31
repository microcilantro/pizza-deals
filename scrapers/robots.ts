/**
 * Minimal robots.txt parser, sufficient for deciding whether we may fetch a path.
 *
 * The brief requires respecting robots.txt, and "respecting" has to mean refusing to
 * fetch, not logging a warning and continuing. `isPathAllowed` returns false on a
 * disallow, and the runner treats that as a hard stop for the affected URL.
 *
 * Deliberately not a full implementation: no sitemap handling, no wildcard-only groups
 * beyond `*`, no crawl-delay negotiation beyond reading the value. It follows the
 * longest-match rule, which is the part that decides access.
 */

export interface RobotsGroup {
  userAgents: string[];
  allow: string[];
  disallow: string[];
  crawlDelaySeconds: number | null;
}

export interface RobotsTxt {
  groups: RobotsGroup[];
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  // Consecutive User-agent lines share one group; a rule line closes the agent list.
  let acceptingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !acceptingAgents) {
        current = { userAgents: [], allow: [], disallow: [], crawlDelaySeconds: null };
        groups.push(current);
        acceptingAgents = true;
      }
      current.userAgents.push(value.toLowerCase());
      continue;
    }

    if (!current) continue;
    acceptingAgents = false;

    if (field === 'allow' && value) current.allow.push(value);
    else if (field === 'disallow') current.disallow.push(value);
    else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelaySeconds = n;
    }
  }

  return { groups };
}

/** The group matching our agent, falling back to the `*` group. */
export function groupFor(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();
  const specific = robots.groups.find((g) => g.userAgents.some((a) => a !== '*' && ua.includes(a)));
  if (specific) return specific;
  return robots.groups.find((g) => g.userAgents.includes('*')) ?? null;
}

/**
 * Longest matching rule wins; Allow beats Disallow at equal length. An empty Disallow
 * value means "allow everything", per the spec.
 */
export function isPathAllowed(robots: RobotsTxt, userAgent: string, path: string): boolean {
  const group = groupFor(robots, userAgent);
  if (!group) return true;

  let bestAllow = -1;
  let bestDisallow = -1;

  for (const rule of group.allow) {
    if (matches(rule, path)) bestAllow = Math.max(bestAllow, ruleLength(rule));
  }
  for (const rule of group.disallow) {
    if (rule === '') continue; // "Disallow:" with no value allows everything.
    if (matches(rule, path)) bestDisallow = Math.max(bestDisallow, ruleLength(rule));
  }

  if (bestDisallow === -1) return true;
  return bestAllow >= bestDisallow;
}

export function crawlDelayFor(robots: RobotsTxt, userAgent: string): number | null {
  return groupFor(robots, userAgent)?.crawlDelaySeconds ?? null;
}

function ruleLength(rule: string): number {
  return rule.replace(/\*/g, '').length;
}

function matches(rule: string, path: string): boolean {
  const endAnchored = rule.endsWith('$');
  const pattern = endAnchored ? rule.slice(0, -1) : rule;
  const segments = pattern.split('*');

  let cursor = 0;
  for (const [i, segment] of segments.entries()) {
    if (segment === '') continue;
    const found = i === 0 ? (path.startsWith(segment) ? 0 : -1) : path.indexOf(segment, cursor);
    if (found === -1) return false;
    cursor = found + segment.length;
  }

  if (endAnchored) {
    const tail = segments[segments.length - 1] ?? '';
    return tail === '' ? true : path.endsWith(tail);
  }
  return true;
}
