import type { CSSProperties } from 'react';

/**
 * Pixel-art icons drawn on a 16x16 grid.
 *
 * Each sprite is a string array — one character per pixel, one string per row — so the
 * art is legible and editable in source rather than being an opaque path. `crispEdges`
 * stops the browser antialiasing the pixels back into mush at larger sizes.
 */

type Palette = Record<string, string>;

const P: Palette = {
  r: '#e84a30', // pepperoni / flame
  o: '#e8a33d', // crust
  y: '#f7d51d', // cheese / gold
  g: '#3ec46d', // leaf
  b: '#4aa8e8', // sky
  p: '#9b5de5', // grape
  w: '#e8e8f0', // ink
  d: '#8a8ab0', // dim
  k: '#0b0b16', // void
  n: '#7a4a1d', // brown
};

const SPRITES = {
  /** A whole pizza, seen from above. */
  pizza: [
    '................',
    '.....oooooo.....',
    '...oooooooooo...',
    '..oyyyyyyyyyyo..',
    '.oyyyryyyyryyyo.',
    '.oyyyyyyyyyyyyo.',
    'oyyyyyyryyyyyyyo',
    'oyyyryyyyyyryyyo',
    'oyyyyyyyyyyyyyyo',
    'oyyyyyryyyyyyyyo',
    '.oyyyyyyyyryyyo.',
    '.oyyyryyyyyyyyo.',
    '..oyyyyyyyyyyo..',
    '...oooooooooo...',
    '.....oooooo.....',
    '................',
  ],
  /** A single slice, used for the serving-size control. */
  slice: [
    '................',
    '.......oo.......',
    '......oooo......',
    '......oyyo......',
    '.....oyyyyo.....',
    '.....oyryyo.....',
    '....oyyyyyyo....',
    '....oyyyyyyo....',
    '...oyyyryyyyo...',
    '...oyyyyyyyyo...',
    '..oyyyyyyyyyyo..',
    '..oyyryyyyryyo..',
    '.oyyyyyyyyyyyyo.',
    '.oooooooooooooo.',
    '................',
    '................',
  ],
  /** Carryout: a takeaway box. */
  carryout: [
    '................',
    '................',
    '..wwwwwwwwwwww..',
    '..w..........w..',
    '..w.wwwwwwww.w..',
    '..w.w......w.w..',
    '..wwwwwwwwwwww..',
    '..oooooooooooo..',
    '..o..........o..',
    '..o.o......o.o..',
    '..o..........o..',
    '..o.oooooooo.o..',
    '..o..........o..',
    '..oooooooooooo..',
    '................',
    '................',
  ],
  /** Delivery: a car. */
  delivery: [
    '................',
    '................',
    '................',
    '.....bbbbbb.....',
    '....bbwwwwbb....',
    '...bbwwwwwwbb...',
    '.bbbbbbbbbbbbbb.',
    'bbbbbbbbbbbbbbbb',
    'bbrbbbbbbbbbbrbb',
    'bbbbbbbbbbbbbbbb',
    '.kkk.kkkkkk.kkk.',
    '.kwk.kkkkkk.kwk.',
    '.kkk.kkkkkk.kkk.',
    '................',
    '................',
    '................',
  ],
  /** Bundle: a stacked meal deal box. */
  bundle: [
    '................',
    '................',
    '..gggggggggggg..',
    '..g..........g..',
    '..g.gggggggg.g..',
    '..gggggggggggg..',
    '..oooooooooooo..',
    '..o.oooooooo.o..',
    '..o..........o..',
    '..oooooooooooo..',
    '..pppppppppppp..',
    '..p.pppppppp.p..',
    '..p..........p..',
    '..pppppppppppp..',
    '................',
    '................',
  ],
  /** A 2-litre bottle. */
  drink: [
    '................',
    '......dddd......',
    '......dwwd......',
    '......dwwd......',
    '.....dwwwwd.....',
    '....dwwwwwwd....',
    '...dwwwwwwwwd...',
    '...dwbbbbbbwd...',
    '...dwbbbbbbwd...',
    '...dwbbbbbbwd...',
    '...dwbbbbbbwd...',
    '...dwbbbbbbwd...',
    '...dwwwwwwwwd...',
    '...dddddddddd...',
    '................',
    '................',
  ],
  /** Breadsticks. */
  breadsticks: [
    '................',
    '................',
    '..o..o..o..o....',
    '.ooo.ooo.ooo.o..',
    '.oyo.oyo.oyo.oo.',
    '.oyo.oyo.oyo.oo.',
    '.oyo.oyo.oyo.oo.',
    '.oyo.oyo.oyo.oo.',
    '.oyo.oyo.oyo.oo.',
    '.oyo.oyo.oyo.oo.',
    '.oyo.oyo.oyo.oo.',
    '.ooo.ooo.ooo.oo.',
    '..o..o..o..o.o..',
    '................',
    '................',
    '................',
  ],
  /** Wings. */
  wings: [
    '................',
    '................',
    '.....nnnn.......',
    '....nrrrrn......',
    '...nrrrrrrn.....',
    '...nrrrrrrn.....',
    '....nrrrrn......',
    '.....nnnn.......',
    '......ww........',
    '.......ww.......',
    '........www.....',
    '.........www....',
    '..........ww....',
    '................',
    '................',
    '................',
  ],
  /** Coin, for price. */
  coin: [
    '................',
    '................',
    '.....yyyyyy.....',
    '...yyyyyyyyyy...',
    '..yyyyoooyyyyy..',
    '..yyyoyyyoyyyy..',
    '.yyyyoyyyyyyyyy.',
    '.yyyyoyyyyyyyyy.',
    '.yyyyyoooyyyyyy.',
    '.yyyyyyyyyoyyyy.',
    '.yyyyyyyyyoyyyy.',
    '..yyyyoyyyoyyy..',
    '..yyyyyoooyyyy..',
    '...yyyyyyyyyy...',
    '.....yyyyyy.....',
    '................',
  ],
  /** Warning, for stale data and refusals. */
  warning: [
    '................',
    '.......yy.......',
    '.......yy.......',
    '......yyyy......',
    '......ykky......',
    '.....yykkyy.....',
    '.....yykkyy.....',
    '....yyykkyyy....',
    '....yyykkyyy....',
    '...yyyykkyyyy...',
    '...yyyyyyyyyy...',
    '..yyyyykkyyyyy..',
    '..yyyyykkyyyyy..',
    '.yyyyyyyyyyyyyy.',
    '.yyyyyyyyyyyyyy.',
    '................',
  ],
  /** Info, for assumptions. */
  info: [
    '................',
    '.....bbbbbb.....',
    '...bbbbbbbbbb...',
    '..bbbbbwwbbbbb..',
    '..bbbbbwwbbbbb..',
    '.bbbbbbbbbbbbbb.',
    '.bbbbbwwwbbbbbb.',
    '.bbbbbbwwbbbbbb.',
    '.bbbbbbwwbbbbbb.',
    '.bbbbbbwwbbbbbb.',
    '..bbbbwwwwbbbb..',
    '..bbbbbbbbbbbb..',
    '...bbbbbbbbbb...',
    '.....bbbbbb.....',
    '................',
    '................',
  ],
  /** Trophy, for the top-ranked deal in a segment. */
  trophy: [
    '................',
    '..yyyyyyyyyyyy..',
    '..yyyyyyyyyyyy..',
    '.yyyyyyyyyyyyyy.',
    'yy.yyyyyyyyyy.yy',
    'yy.yyyyyyyyyy.yy',
    'yy..yyyyyyyy..yy',
    '.....yyyyyy.....',
    '......yyyy......',
    '......yyyy......',
    '.....yyyyyy.....',
    '....yyyyyyyy....',
    '...oooooooooo...',
    '..oooooooooooo..',
    '................',
    '................',
  ],
} as const;

export type PixelIconName = keyof typeof SPRITES;

interface PixelIconProps {
  name: PixelIconName;
  /** Rendered size in px. Multiples of 16 stay perfectly crisp. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Decorative by default; pass a label when the icon carries meaning alone. */
  label?: string;
}

export function PixelIcon({ name, size = 32, className, style, label }: PixelIconProps) {
  const sprite = SPRITES[name];
  const rects: React.ReactElement[] = [];

  sprite.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      if (ch === '.') {
        x += 1;
        continue;
      }
      // Collapse horizontal runs of the same colour into one rect — fewer nodes, and
      // it keeps the DOM manageable when a page shows dozens of icons.
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run += 1;
      rects.push(
        <rect key={`${x}-${y}`} x={x} y={y} width={run} height={1} fill={P[ch] ?? '#f0f'} />,
      );
      x += run;
    }
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {rects}
    </svg>
  );
}

/** Maps a component category from the data to the closest sprite we have. */
export function iconForCategory(category: string): PixelIconName {
  const c = category.toLowerCase();
  if (c.includes('wing')) return 'wings';
  if (c.includes('bread') || c.includes('stick')) return 'breadsticks';
  if (c.includes('drink') || c.includes('soda') || c.includes('liter')) return 'drink';
  return 'bundle';
}
