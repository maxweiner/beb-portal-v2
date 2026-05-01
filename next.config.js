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
  },
}

module.exports = nextConfig
