/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  // Allow importing shared TS modules from the parent src/ directory.
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
