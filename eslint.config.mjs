import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // `.next-*/` mirrors .gitignore: when the build directory has to be set aside
  // (e.g. a locked file aborts a rebuild), the copy is generated output, not
  // source, and linting 350 bundled files says nothing about this codebase.
  globalIgnores([".next/**", ".next-*/**", "out/**", "next-env.d.ts"]),
]);
