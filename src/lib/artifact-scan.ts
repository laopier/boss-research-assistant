/**
 * Local artifact reader — the decision logic, kept DOM-free so it is unit-
 * testable (#19).
 *
 * The browser can read a user-chosen directory only with explicit permission;
 * this module decides, for each file the reader encounters, whether it is
 * safe and useful to offer. The whitelist and the exclusions live here as a
 * single table so the UI and the tests agree, and the reasoning is local:
 * the server's validation module must not reach the browser bundle, and this
 * table is about what the *browser* may offer, not what the server accepts.
 */

/** Extensions the reader may offer. Plain-text, reviewable, small. */
export const ARTIFACT_WHITELIST = [
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".txt",
  ".log",
] as const;

/** Path segments that are never source material. Matched against every part. */
export const BLOCKED_SEGMENTS = [
  ".git",
  "node_modules",
  "venv",
  ".venv",
  "env",
  ".next",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".cache",
  ".idea",
  ".vscode",
  ".learnbuddy",
] as const;

/** File names (or substrings) that look like secrets or credentials. */
export const SENSITIVE_PATTERNS = [
  ".env",
  "credentials",
  "credential",
  "token",
  "secret",
  "id_rsa",
  "id_ed25519",
  "id_dsa",
  ".pem",
  ".key",
  ".p12",
  "password",
] as const;

/** Files larger than this are not pasted into a review request. */
export const MAX_ARTIFACT_BYTES = 200 * 1024;

export type ArtifactExclusionReason =
  | "NOT_WHITELISTED"
  | "BLOCKED_PATH"
  | "SENSITIVE"
  | "TOO_LARGE";

export type ArtifactVerdict =
  | { ok: true }
  | { ok: false; reason: ArtifactExclusionReason };

/** A file the scanner decided to offer, with only the cheap metadata. */
export interface ArtifactCandidate {
  relativePath: string;
  name: string;
  size: number;
  extension: string;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** Matches a path against a list of segments, case-insensitively. */
function pathHasAny(relativePath: string, segments: readonly string[]): boolean {
  const parts = relativePath.toLowerCase().split(/[\\/]+/);
  return parts.some((part) => segments.includes(part as (typeof segments)[number]));
}

/**
 * The single decision: may this file be offered for review?
 *
 * Order is the safety-and-clarity contract, most specific first: a name that
 * looks like a secret is excluded no matter its extension or location (a
 * `.env` is not "not whitelisted", it is sensitive); a file inside a
 * dependency/build/VCS directory is excluded because of where it lives; then
 * the extension whitelist; then size. Each exclusion carries a distinct reason
 * so the UI can say WHY, which the acceptance criteria ask for explicitly.
 */
export function classifyArtifact(relativePath: string, size: number): ArtifactVerdict {
  const name = relativePath.split(/[\\/]/).pop() ?? relativePath;
  const extension = extensionOf(name);

  if (SENSITIVE_PATTERNS.some((pattern) => name.toLowerCase().includes(pattern))) {
    return { ok: false, reason: "SENSITIVE" };
  }
  if (pathHasAny(relativePath, BLOCKED_SEGMENTS)) {
    return { ok: false, reason: "BLOCKED_PATH" };
  }
  if (!ARTIFACT_WHITELIST.includes(extension as (typeof ARTIFACT_WHITELIST)[number])) {
    return { ok: false, reason: "NOT_WHITELISTED" };
  }
  if (size > MAX_ARTIFACT_BYTES) {
    return { ok: false, reason: "TOO_LARGE" };
  }
  return { ok: true };
}

export interface ScanSummary {
  total: number;
  allowed: number;
  /** Excluded files, in encounter order, with the reason the UI explains. */
  excluded: Array<{ relativePath: string; reason: ArtifactExclusionReason }>;
}

/**
 * Aggregates a scan so the UI can show "found 12 files, 9 eligible, 3 left
 * out (1 dependency, 1 secret, 1 too large)".
 */
export function summarizeScan(files: Array<{ relativePath: string; size: number }>): ScanSummary {
  const summary: ScanSummary = { total: files.length, allowed: 0, excluded: [] };
  for (const file of files) {
    const verdict = classifyArtifact(file.relativePath, file.size);
    if (verdict.ok) summary.allowed += 1;
    else summary.excluded.push({ relativePath: file.relativePath, reason: verdict.reason });
  }
  return summary;
}

/** The human-readable reason text, shared by the UI and the empty states. */
export const EXCLUSION_REASON_TEXT: Record<ArtifactExclusionReason, string> = {
  NOT_WHITELISTED: "不在允许的文件类型里",
  BLOCKED_PATH: "来自依赖、构建或版本目录",
  SENSITIVE: "看起来像密钥或凭据",
  TOO_LARGE: "超过大小上限",
};
