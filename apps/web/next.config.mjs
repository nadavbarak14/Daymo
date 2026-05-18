/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  // Allow importing shared TS modules from the parent src/ directory.
  experimental: {
    externalDir: true,
  },
  // Allow .js import specifiers to resolve .ts source files (ESM-style imports).
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
