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
    // serverComponentsExternalPackages was *supposed* to skip
    // bundling and let the route handler require() it at runtime,
    // but as of Next.js 14.2 the route-handler bundle still wraps
    // the default import incorrectly — the prod build runs but the
    // request crashes with `TypeError: (0, r.default) is not a
    // function` at the archiver call site. We instead force the
    // externalization at the webpack-config layer (see `webpack`
    // below), which reliably emits `require('archiver')` so the
    // CJS module.exports = fn factory is returned directly. Used
    // by the Edge batch ZIP endpoints (/api/wholesale/edge/.../zip).
    serverComponentsExternalPackages: ['archiver'],
  },
  // Belt-and-suspenders externalization for archiver — see comment
  // on serverComponentsExternalPackages above. Webpack-level
  // externals are the canonical fix for CommonJS factory packages
  // that webpack 5 mis-wraps under Next 14.
  webpack: (config, { isServer }) => {
    if (isServer) {
      const existing = Array.isArray(config.externals) ? config.externals : (config.externals ? [config.externals] : [])
      config.externals = [
        ...existing,
        // Tuple form: webpack emits `module.exports = require('archiver')`
        // at the import site, fully bypassing the default-import wrapper.
        { archiver: 'commonjs archiver' },
      ]
    }
    return config
  },
}

module.exports = nextConfig
