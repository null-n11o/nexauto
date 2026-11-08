import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    // Preserve bookmarks and existing password-reset email redirect URLs.
    return [
      'posts',
      'publishing',
      'accounts',
      'analytics',
      'users',
      'companies',
      'login',
      'forgot-password',
      'reset-password',
    ].map((route) => ({
      source: `/${route}/:path*`,
      destination: `/app/${route}/:path*`,
      permanent: true,
    }));
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
