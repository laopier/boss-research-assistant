/**
 * Next.js configuration.
 *
 * Deployment target is deliberately platform-neutral: `output: "standalone"`
 * produces a self-contained server bundle at `.next/standalone` that runs with
 * `node server.js` on any Node host, and drops straight into a container image.
 * The same build is also accepted unchanged by Vercel, which ignores the
 * Dockerfile, so no platform is locked in.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: "standalone",

  /**
   * The Goal Discovery factory (`src/lib/goal-discovery/factory.ts`) locates the
   * demo fixtures at *runtime* with `readFileSync`, building the path from
   * `resolve(__dirname, "../../..")` or `process.cwd()`. Output file tracing
   * works by static analysis and cannot follow those dynamic paths, and the
   * loader deliberately treats an unreadable fixture as "skip it" rather than
   * an error.
   *
   * Consequence if these files are not listed explicitly: a deployed build
   * would silently find zero known fixtures and the plagiarism guard
   * (validation rule S8) would stop working, with no error anywhere. Declaring
   * the includes keeps the deployed behaviour identical to local development.
   */
  outputFileTracingIncludes: {
    "/api/contracts/generate": ["./examples/**/*.json"],
  },
};

export default nextConfig;
