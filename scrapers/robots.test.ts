import { describe, expect, it } from 'vitest';
import { crawlDelayFor, groupFor, isPathAllowed, parseRobotsTxt } from './robots';

const UA = 'PizzaValueQuestBot';

describe('parseRobotsTxt', () => {
  it('groups consecutive user-agent lines together', () => {
    const robots = parseRobotsTxt(`
      User-agent: Googlebot
      User-agent: Bingbot
      Disallow: /private

      User-agent: *
      Disallow: /admin
    `);
    expect(robots.groups).toHaveLength(2);
    expect(robots.groups[0]!.userAgents).toEqual(['googlebot', 'bingbot']);
    expect(robots.groups[1]!.userAgents).toEqual(['*']);
  });

  it('ignores comments and blank lines', () => {
    const robots = parseRobotsTxt(`
      # a comment
      User-agent: *   # trailing comment
      Disallow: /checkout
    `);
    expect(robots.groups[0]!.disallow).toEqual(['/checkout']);
  });

  it('reads crawl-delay', () => {
    const robots = parseRobotsTxt('User-agent: *\nCrawl-delay: 10\nDisallow: /x');
    expect(crawlDelayFor(robots, UA)).toBe(10);
  });
});

describe('groupFor', () => {
  it('prefers a group naming our agent over the wildcard', () => {
    const robots = parseRobotsTxt(`
      User-agent: *
      Disallow: /

      User-agent: pizzavaluequestbot
      Disallow: /checkout
    `);
    expect(groupFor(robots, UA)!.disallow).toEqual(['/checkout']);
  });

  it('falls back to the wildcard group', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow: /admin');
    expect(groupFor(robots, UA)!.userAgents).toEqual(['*']);
  });
});

describe('isPathAllowed', () => {
  const robots = parseRobotsTxt(`
    User-agent: *
    Disallow: /checkout
    Disallow: /account
    Allow: /account/public
    Disallow: /*.json$
  `);

  it('blocks a disallowed path', () => {
    expect(isPathAllowed(robots, UA, '/checkout')).toBe(false);
    expect(isPathAllowed(robots, UA, '/checkout/step-1')).toBe(false);
  });

  it('allows anything not disallowed', () => {
    expect(isPathAllowed(robots, UA, '/en/pages/order')).toBe(true);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    expect(isPathAllowed(robots, UA, '/account')).toBe(false);
    expect(isPathAllowed(robots, UA, '/account/public/faq')).toBe(true);
  });

  it('honours wildcards and end anchors', () => {
    expect(isPathAllowed(robots, UA, '/data/menu.json')).toBe(false);
    expect(isPathAllowed(robots, UA, '/data/menu.json?x=1')).toBe(true);
  });

  it('treats an empty Disallow as allowing everything', () => {
    const permissive = parseRobotsTxt('User-agent: *\nDisallow:');
    expect(isPathAllowed(permissive, UA, '/anything')).toBe(true);
  });

  it('allows everything when robots.txt has no rules at all', () => {
    expect(isPathAllowed(parseRobotsTxt(''), UA, '/anything')).toBe(true);
  });

  it('blocks the whole site when told to', () => {
    const closed = parseRobotsTxt('User-agent: *\nDisallow: /');
    expect(isPathAllowed(closed, UA, '/')).toBe(false);
    expect(isPathAllowed(closed, UA, '/en/pages/order')).toBe(false);
  });
});
