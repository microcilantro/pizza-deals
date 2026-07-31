import { ImageResponse } from 'next/og';

// Static export has no server to generate this on demand; bake it at build time.
export const dynamic = 'force-static';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * Favicon: a pixel pizza, generated at build time so no binary asset is checked in and
 * nothing is fetched at runtime.
 */
export default function Icon() {
  const P = { o: '#e8a33d', y: '#f7d51d', r: '#e84a30', t: 'transparent' } as const;
  const grid = [
    'ttooooootttttttt'.slice(0, 8),
    'toooooooo',
    'oyyyyyyyo',
    'oyyryyyyo',
    'oyyyyyryo',
    'oyryyyyyo',
    'oyyyyyyyo',
    'toooooooo',
  ];

  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexWrap: 'wrap', width: 32, height: 32, background: '#0b0b16' }}>
        {grid.flatMap((row, y) =>
          row.split('').map((ch, x) => (
            <div
              key={`${x}-${y}`}
              style={{
                position: 'absolute',
                left: x * 4,
                top: y * 4,
                width: 4,
                height: 4,
                background: P[ch as keyof typeof P] ?? 'transparent',
              }}
            />
          )),
        )}
      </div>
    ),
    size,
  );
}
