/** @type {import('next').NextConfig} */

/**
 * Where the backend lives.
 *
 * This was a hardcoded `http://127.0.0.1:8000`. That works on a laptop with the
 * API running beside the dev server and nowhere else: in any container, VM, or
 * static host the address resolves to that machine's own loopback, so the
 * rewrite silently proxies to nothing. It is read from the environment now, with
 * the same default so local development is unchanged.
 */
const API_ORIGIN = process.env.API_ORIGIN || 'http://127.0.0.1:8000';

/**
 * The origin the *server-side* fetch layer should use.
 *
 * The frontend resolves API calls to `/api/v1/...`, which the rewrite above sends
 * to the backend. That only works in the browser: a React Server Component
 * calling the same relative URL has no rewrite in front of it, and `fetch` there
 * fails to parse a relative URL. `app/page.tsx` fetches on the server, so it
 * needs an absolute origin. `SERVER_API_ORIGIN` is that value; when it is unset
 * we fall back to `API_ORIGIN` on the assumption the backend is reachable
 * directly, which is the only way a server-side fetch can work at all.
 */
const SERVER_API_ORIGIN = process.env.SERVER_API_ORIGIN || API_ORIGIN;

const nextConfig = {
  reactStrictMode: true,

  env: {
    // Exposed to the client bundle. The client must keep using the relative
    // path so requests go through the rewrite above rather than cross-origin.
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '/api/v1',
    // Not prefixed `NEXT_PUBLIC_`, so it is only available in server components.
    SERVER_API_URL: `${SERVER_API_ORIGIN}/api/v1`,
  },

  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_ORIGIN}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
