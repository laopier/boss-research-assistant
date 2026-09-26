/**
 * Browser-only DeepSeek key handling.
 *
 * The key deliberately lives in sessionStorage rather than the research ledger
 * or localStorage. It survives navigation and refreshes in the current tab, but
 * disappears when the tab is closed and is never exported with project data.
 */
export const API_KEY_SESSION_KEY = "boss.deepseek-api-key";
export const API_KEY_HEADER = "x-boss-api-key";

export function readSessionApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(API_KEY_SESSION_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveSessionApiKey(value: string): void {
  if (typeof window === "undefined") return;
  const key = value.trim();
  try {
    if (key) window.sessionStorage.setItem(API_KEY_SESSION_KEY, key);
    else window.sessionStorage.removeItem(API_KEY_SESSION_KEY);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // settings panel still keeps its in-memory value for the current render.
  }
}

export function apiRequestHeaders(
  base: Record<string, string> = {},
): Record<string, string> {
  const key = readSessionApiKey();
  return key ? { ...base, [API_KEY_HEADER]: key } : base;
}
