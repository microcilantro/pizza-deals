import type { Config } from 'tailwindcss';

/**
 * Palette is a deliberately small, NES-ish ramp. Constraining it is most of what makes
 * the 8-bit look read as intentional rather than as "monospace with thick borders".
 */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#0b0b16',
        panel: '#1a1a2e',
        panelLit: '#252545',
        ink: '#e8e8f0',
        dim: '#8a8ab0',
        crt: '#2a2a4a',
        gold: '#f7d51d',
        flame: '#e84a30',
        crust: '#e8a33d',
        leaf: '#3ec46d',
        sky: '#4aa8e8',
        grape: '#9b5de5',
      },
      fontFamily: {
        pixel: ['var(--font-pixel)', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
        // Pixel-styled but far more legible for running prose than Silkscreen, which is
        // built for short uppercase labels. Used for assumptions and warnings.
        body: ['var(--font-pixel-body)', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        pixel: '4px 4px 0 0 #0b0b16',
        pixelSm: '2px 2px 0 0 #0b0b16',
        pixelLit: '4px 4px 0 0 #f7d51d',
      },
    },
  },
  plugins: [],
} satisfies Config;
