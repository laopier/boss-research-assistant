"use client";

import { useEffect, useState } from "react";
import { readSessionApiKey, saveSessionApiKey } from "@/lib/client-api-key";

export function ApiKeyPanel() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = readSessionApiKey();
    setKey(existing);
    setSaved(Boolean(existing));
  }, []);

  function save() {
    saveSessionApiKey(key);
    const stored = readSessionApiKey();
    setKey(stored);
    setSaved(Boolean(stored));
  }

  function clear() {
    saveSessionApiKey("");
    setKey("");
    setSaved(false);
  }

  return (
    <details className="api-key-panel">
      <summary>
        <span>AI 模式</span>
        <span className={`api-mode ${saved ? "api-mode-live" : "api-mode-demo"}`}>
          {saved ? "已连接 DeepSeek" : "无密钥演示"}
        </span>
      </summary>
      <div className="api-key-body">
        <label htmlFor="deepseek-api-key">DeepSeek API Key（可选）</label>
        <div className="api-key-row">
          <input
            id="deepseek-api-key"
            type="password"
            value={key}
            onChange={(event) => {
              saveSessionApiKey("");
              setKey(event.target.value);
              setSaved(false);
            }}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" onClick={save} disabled={!key.trim()}>
            本次会话使用
          </button>
          {saved && (
            <button type="button" className="button-secondary" onClick={clear}>
              清除
            </button>
          )}
        </div>
        <p>
          不填写也能体验固定演示。填写后，生成、材料检查和计划协商会使用真实 DeepSeek；
          Key 只保留在当前浏览器标签页，关闭标签页即清除，不会写入科研记录。
        </p>
      </div>
    </details>
  );
}
