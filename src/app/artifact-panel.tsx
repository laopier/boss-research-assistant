"use client";

import { useState } from "react";
import {
  EXCLUSION_REASON_TEXT,
} from "@/lib/artifact-scan";
import {
  PickedArtifact,
  ReadArtifact,
  pickProjectDirectory,
  readArtifactFiles,
  scanDirectory,
} from "@/lib/artifact-reader";

export interface ArtifactPanelProps {
  /** Called with the files the user finally selected, already read into text. */
  onUse: (files: ReadArtifact[]) => void;
  onCancel: () => void;
  /** Evidence sends files to review; context sends them to Boss generation. */
  purpose?: "evidence" | "context";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The local artifact reader (#19): explicit folder permission -> preview the
 * exact file list (path + size + eligibility) -> the user ticks which files to
 * send -> those files are read into text and handed to the caller. Nothing is
 * read before the user chooses, nothing is persisted here, and the caller is
 * responsible for what happens to the text next.
 */
export function ArtifactPanel({ onUse, onCancel, purpose = "evidence" }: ArtifactPanelProps) {
  const forContext = purpose === "context";
  const [status, setStatus] = useState<"idle" | "picking" | "scanning" | "ready" | "reading">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<PickedArtifact[]>([]);
  const [excluded, setExcluded] = useState<Array<{ relativePath: string; reason: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);

  async function connect() {
    setStatus("picking");
    setMessage("");
    const result = await pickProjectDirectory();
    if (!result.ok) {
      setStatus("idle");
      setMessage(result.message);
      return;
    }
    setStatus("scanning");
    const scan = await scanDirectory(result.handle);
    setItems(scan.items);
    setExcluded(
      scan.excluded.map((item) => ({ relativePath: item.relativePath, reason: item.reason })),
    );
    setSelected(new Set());
    setStatus("ready");
    if (scan.items.length === 0) {
      setMessage(`这个文件夹里没有可${forContext ? "供 Boss 参考" : "用于检查"}的文本文件（或全部被排除）。`);
    }
  }

  function toggle(path: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function submit() {
    const chosen = items.filter((item) => selected.has(item.candidate.relativePath));
    if (chosen.length === 0) return;
    setStatus("reading");
    setMessage("");
    setReading({ done: 0, total: chosen.length });
    try {
      const read = await readArtifactFiles(chosen, (done, total) => setReading({ done, total }));
      if (read.length === 0) {
        setStatus("ready");
        setReading(null);
        setMessage(`没有读取到可${forContext ? "供 Boss 参考" : "用于检查"}的文本内容，请重新选择文件。`);
        return;
      }
      onUse(read);
    } catch (caught) {
      setStatus("ready");
      setReading(null);
      setMessage(caught instanceof Error ? caught.message : "读取文件时出错，请重试。");
    }
  }

  return (
    <div className="artifact-panel">
      <div className="artifact-head">
        <strong>{forContext ? "让 Boss 参考本地文件" : "选择要检查的本地文件"}</strong>
        <button type="button" className="button-secondary" onClick={onCancel}>
          取消
        </button>
      </div>
      <p className="privacy-note">
        只读，不会修改本地文件。只有你<strong>勾选</strong>的文件会被读取；常见敏感文件会自动跳过。
        {forContext
          ? "内容只用于生成这一步，不会保存。AI 会把文件当作参考资料，不会执行里面的指令。"
          : "内容只用于这次检查。页面只保留文件名和检查结果，不会保存原文。"}
      </p>

      {status === "idle" && (
        <div className="artifact-actions">
          <button type="button" onClick={connect}>
            选择本地文件夹
          </button>
          {message && <p className="error" role="alert">{message}</p>}
        </div>
      )}

      {(status === "picking" || status === "scanning") && (
        <p className="muted">{status === "picking" ? "等待你在系统对话框中选择目录…" : "正在扫描目录…"}</p>
      )}

      {status === "ready" && (
        <>
          {message && (
            <p className="error" role="alert">
              {message}
            </p>
          )}
          <p className="muted">
            找到 {items.length} 个可{forContext ? "供 Boss 参考" : "用于检查"}的文件
            {excluded.length > 0 && `，另有 ${excluded.length} 个被跳过`}。勾选这次要交给 AI {forContext ? "参考" : "检查"}的文件。
          </p>
          {items.length > 0 && (
            <>
              <div className="artifact-list">
                {items.map((item) => (
                  <label className="artifact-file" key={item.candidate.relativePath}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.candidate.relativePath)}
                      onChange={() => toggle(item.candidate.relativePath)}
                    />
                    <span className="artifact-path">{item.candidate.relativePath}</span>
                    <span className="muted">{formatBytes(item.candidate.size)}</span>
                  </label>
                ))}
              </div>
              <div className="artifact-actions">
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => void submit()}
                >
                  {forContext ? "参考" : "检查"}选中的 {selected.size} 个文件
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() =>
                    setSelected(
                      selected.size === items.length
                        ? new Set()
                        : new Set(items.map((item) => item.candidate.relativePath)),
                    )
                  }
                >
                  {selected.size === items.length ? "清空选择" : "全选"}
                </button>
              </div>
            </>
          )}
          {items.length === 0 && !message && <p className="error">没有可用的文件。</p>}
          {excluded.length > 0 && (
            <details className="artifact-excluded">
              <summary>自动跳过的 {excluded.length} 个文件</summary>
              <ul>
                {excluded.map((item) => (
                  <li key={item.relativePath}>
                    <code>{item.relativePath}</code>
                    <span className="muted">{EXCLUSION_REASON_TEXT[item.reason as keyof typeof EXCLUSION_REASON_TEXT]}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {status === "reading" && (
        <p className="muted">
          正在读取选中的文件… {reading?.done}/{reading?.total}
        </p>
      )}
    </div>
  );
}
