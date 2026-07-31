import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// Self-hosted so the build never depends on a font CDN.
const silkscreen = localFont({
  src: './fonts/Silkscreen-Regular.ttf',
  variable: '--font-pixel',
  display: 'swap',
});

const pixelify = localFont({
  src: './fonts/PixelifySans-Medium.ttf',
  variable: '--font-pixel-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PIZZA VALUE QUEST',
  description:
    'National pizza deals from the three largest US chains, normalized to cost per square inch.',
};

export const viewport: Viewport = {
  themeColor: '#0b0b16',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${silkscreen.variable} ${pixelify.variable}`}>
      <body className="min-h-screen font-pixel antialiased">{children}</body>
    </html>
  );
}
