import {
  ArtifactCandidate,
  ArtifactExclusionReason,
  classifyArtifact,
} from "./artifact-scan";
import type { FileSystemDirectoryHandle, FileSystemFileHandle } from "../types/file-system-access";

/**
 * The browser half of the local artifact reader (#19).
 *
 * Every function here is deliberately shallow: `pickProjectDirectory` gets
 * explicit user permission via `showDirectoryPicker` (and only from within a
 * user gesture), `scanDirectory` walks the chosen tree applying the decision
 * logic from `artifact-scan`, and `readArtifactFiles` reads the files the user
 * actually selected. Nothing here writes to the local project, and nothing
 * persists file contents — callers get the text to pass to the review request
 * and drop it afterwards, matching the evidence form's existing privacy rule.
 */

export interface PickedArtifact {
  candidate: ArtifactCandidate;
  handle: FileSystemFileHandle;
}

export interface ScanResult {
  /** Files the scanner will offer, sorted by relative path. */
  items: PickedArtifact[];
  /** Files left out, with the reason, so the UI can explain each exclusion. */
  excluded: Array<{ relativePath: string; reason: ArtifactExclusionReason }>;
}

export type PickDirectoryResult =
  | { ok: true; handle: FileSystemDirectoryHandle }
  | { ok: false; reason: "CANCELLED" | "UNSUPPORTED" | "ERROR"; message: string };

/**
 * Asks the user to pick a project directory, with explicit permission.
 *
 * `showDirectoryPicker` only exists in Chromium/Edge and only fires inside a
 * user gesture, so this must be called from a click handler. A cancel, a
 * non-Chromium browser and a security error each return a distinct, explainable
 * result instead of throwing.
 */
export async function pickProjectDirectory(): Promise<PickDirectoryResult> {
  const picker = typeof window !== "undefined" ? window.showDirectoryPicker : undefined;
  if (!picker) {
    return {
      ok: false,
      reason: "UNSUPPORTED",
      message: "当前浏览器不支持文件夹授权，请使用最新版 Chrome 或 Edge。",
    };
  }
  try {
    const handle = await picker({ mode: "read" });
    return { ok: true, handle };
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      return { ok: false, reason: "CANCELLED", message: "已取消选择，没有读取任何文件。" };
    }
    if (caught instanceof DOMException && caught.name === "NotAllowedError") {
      return {
        ok: false,
        reason: "ERROR",
        message: "授权被拒绝。你可以在浏览器地址栏的权限设置里撤销或重新允许。",
      };
    }
    return {
      ok: false,
      reason: "ERROR",
      message: caught instanceof Error ? caught.message : "读取目录时出错。",
    };
  }
}

/**
 * Walks the chosen directory, offering only files `classifyArtifact` allows.
 *
 * Deliberately shallow: the decision logic is in `artifact-scan` so it is
 * unit-tested; here we only recurse and build `ArtifactCandidate`s, and we do
 * NOT read contents yet — the preview lists metadata before any text leaves
 * the device.
 */
export async function scanDirectory(root: FileSystemDirectoryHandle): Promise<ScanResult> {
  const results: PickedArtifact[] = [];
  const excluded: ScanResult["excluded"] = [];
  await walk(root, "", results, excluded);
  return {
    items: results.sort((a, b) =>
      a.candidate.relativePath.localeCompare(b.candidate.relativePath),
    ),
    excluded,
  };
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: PickedArtifact[],
  excluded: ScanResult["excluded"],
): Promise<void> {
  for await (const handle of dir.values()) {
    if (handle.kind === "directory") {
      await walk(handle, `${prefix}${handle.name}/`, out, excluded);
      continue;
    }
    const file = await handle.getFile().catch(() => null);
    if (!file) continue;
    const relativePath = `${prefix}${handle.name}`;
    const verdict = classifyArtifact(relativePath, file.size);
    if (!verdict.ok) {
      excluded.push({ relativePath, reason: verdict.reason });
      continue;
    }
    out.push({
      candidate: {
        relativePath,
        name: handle.name,
        size: file.size,
        extension: relativePath.slice(relativePath.lastIndexOf(".")).toLowerCase(),
      },
      handle,
    });
  }
}

export interface ReadArtifact {
  relativePath: string;
  content: string;
}

/**
 * Joins the selected files into one reviewable text, with a marker line per
 * file so the reviewer can attribute content. This is the only thing that
 * leaves the component; it is handed to the review request and never stored.
 */
export function combineArtifactContents(files: ReadArtifact[]): string {
  return files
    .map((file) => `--- file: ${file.relativePath} ---\n${file.content}`)
    .join("\n\n");
}

/** A source name for the review request, bounded to the wire limit. */
export function artifactSourceName(files: ReadArtifact[], maxLength: number): string {
  const names = files.map((file) => file.relativePath.split("/").pop() ?? file.relativePath);
  const base = `本地项目（${files.length} 个文件）：${names.slice(0, 3).join("、")}${
    names.length > 3 ? ` 等` : ""
  }`;
  return base.length <= maxLength ? base : `${base.slice(0, maxLength - 1)}…`;
}

/** Reads the selected files and returns their text (never persisted). */
export async function readArtifactFiles(
  items: PickedArtifact[],
  onProgress?: (read: number, total: number) => void,
): Promise<ReadArtifact[]> {
  const out: ReadArtifact[] = [];
  let index = 0;
  for (const item of items) {
    index += 1;
    onProgress?.(index, items.length);
    const file = await item.handle.getFile().catch(() => null);
    if (!file) continue;
    const content = await file.text().catch(() => "");
    out.push({ relativePath: item.candidate.relativePath, content });
  }
  return out;
}
