/**
 * Static export, so the app can be hosted anywhere that serves files — including
 * GitHub Pages, which has no server at all.
 *
 * `BASE_PATH` is set by the Pages workflow to the repository name, because Pages serves
 * a project site from `https://<user>.github.io/<repo>/`. Left empty for local builds
 * and for any host serving from the domain root.
 */
const basePath = process.env.BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
