/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
  // Force-include public assets that are read via fs at runtime in
  // serverless routes (e.g., the bundled BEB wordmark used by the
  // expense-report PDF generator's fallback path). Without this,
  // Next.js's static analysis can't see the dynamic readFile() and
  // strips the file from the deploy artifact.
  experimental: {
    outputFileTracingIncludes: {
      '/api/expense-reports/**/*': ['./public/beb-wordmark.png'],
      '/api/expenses/**/*': ['./public/beb-wordmark.png'],
    },
    // archiver (and its lazystream sub-dep) ship a malformed
    // `exports` field that Webpack 5 chokes on with "Default
    // condition should be last one" during the prod build.
    // Marking it server-external skips webpack bundling and loads
    // it from node_modules at runtime — standard fix per
    // https://github.com/vercel/next.js/issues/40647. Used by the
    // Edge batch ZIP endpoints (/api/wholesale/edge/.../zip).
    serverComponentsExternalPackages: ['archiver'],
  },
}

module.exports = nextConfig
