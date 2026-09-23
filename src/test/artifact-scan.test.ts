/**
 * Artifact scanner decision-logic tests (#19).
 *
 * The rules under test are the whitelist, the exclusions and the size cap: a
 * file must pass all four to be offered, and each rejection has a distinct,
 * explainable reason. These are pure functions so the whole matrix is testable
 * without a browser or a directory picker.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyArtifact,
  isBlockedArtifactPath,
  summarizeScan,
} from "../lib/artifact-scan";
import { combineArtifactContentsBounded } from "../lib/artifact-reader";

describe("classifyArtifact", () => {
  it("allows whitelisted source and text files", () => {
    for (const path of [
      "src/model.py",
      "src/app/page.tsx",
      "scripts/run.ts",
      "utils/helper.js",
      "README.md",
      "notes.txt",
      "results/run.log",
      "config.json",
    ]) {
      assert.deepEqual(classifyArtifact(path, 10), { ok: true }, `${path} should be allowed`);
    }
  });

  it("rejects non-whitelisted extensions", () => {
    const verdict = classifyArtifact("model.pt", 10);
    assert.deepEqual(verdict, { ok: false, reason: "NOT_WHITELISTED" });
    assert.deepEqual(classifyArtifact("image.png", 10), { ok: false, reason: "NOT_WHITELISTED" });
    assert.deepEqual(classifyArtifact("data.bin", 10), { ok: false, reason: "NOT_WHITELISTED" });
    assert.deepEqual(classifyArtifact("notes", 10), { ok: false, reason: "NOT_WHITELISTED" });
  });

  it("rejects anything inside dependency, build or VCS directories", () => {
    for (const path of [
      "node_modules/x/readme.md",
      "node_modules/a/b/c.js",
      ".git/config",
      "venv/lib/site.py",
      ".next/build-manifest.json",
      "dist/out.txt",
      "__pycache__/mod.py",
      "build/app.js",
    ]) {
      assert.deepEqual(classifyArtifact(path, 10), { ok: false, reason: "BLOCKED_PATH" }, path);
    }
  });

  it("rejects files that look like secrets regardless of location", () => {
    for (const path of [
      ".env",
      ".env.local",
      "config/credentials.json",
      "token.txt",
      "id_rsa",
      "server.key",
      "secret.py",
    ]) {
      const verdict = classifyArtifact(path, 10);
      assert.equal(verdict.ok, false, `${path} must be excluded`);
      if (!verdict.ok) assert.equal(verdict.reason, "SENSITIVE");
    }
  });

  it("rejects files over the size cap", () => {
    const verdict = classifyArtifact("big/train.py", 201 * 1024);
    assert.deepEqual(verdict, { ok: false, reason: "TOO_LARGE" });
  });

  it("keeps the reason distinct when a file violates several rules", () => {
    // sensitive name outranks size: it is the more specific explanation
    assert.deepEqual(classifyArtifact("secret.py", 999999), { ok: false, reason: "SENSITIVE" });
    // a dependency file is blocked because of where it lives, not its extension
    assert.deepEqual(classifyArtifact("node_modules/x.bin", 10), {
      ok: false,
      reason: "BLOCKED_PATH",
    });
    // a dotfile like .env is sensitive, not merely "not whitelisted"
    assert.deepEqual(classifyArtifact(".env", 10), { ok: false, reason: "SENSITIVE" });
  });

  it("is case-insensitive about extensions and directory names", () => {
    assert.deepEqual(classifyArtifact("A.PY", 10), { ok: true });
    assert.deepEqual(classifyArtifact("Node_Modules/a.js", 10), { ok: false, reason: "BLOCKED_PATH" });
  });
});

describe("summarizeScan", () => {
  it("counts allowed and excluded, keeping the reason", () => {
    const summary = summarizeScan([
      { relativePath: "src/a.py", size: 10 },
      { relativePath: "src/b.pt", size: 10 },
      { relativePath: "node_modules/c.js", size: 10 },
      { relativePath: ".env", size: 10 },
    ]);
    assert.equal(summary.total, 4);
    assert.equal(summary.allowed, 1);
    assert.equal(summary.excluded.length, 3);
    assert.deepEqual(
      summary.excluded.map((item) => item.reason),
      ["NOT_WHITELISTED", "BLOCKED_PATH", "SENSITIVE"],
    );
  });

  it("is empty for an empty directory", () => {
    assert.deepEqual(summarizeScan([]), { total: 0, allowed: 0, excluded: [] });
  });
});

describe("blocked-directory pruning", () => {
  it("recognizes a blocked directory before the scanner descends into it", () => {
    assert.equal(isBlockedArtifactPath("node_modules/"), true);
    assert.equal(isBlockedArtifactPath("packages/app/.git/"), true);
    assert.equal(isBlockedArtifactPath("src/components/"), false);
  });
});

describe("combineArtifactContentsBounded", () => {
  it("reports exactly which selected files fit into the review payload", () => {
    const files = [
      { relativePath: "src/a.py", content: "a".repeat(80) },
      { relativePath: "src/b.py", content: "b".repeat(80) },
    ];
    const bundle = combineArtifactContentsBounded(files, 70);

    assert.equal(bundle.content.length, 70);
    assert.deepEqual(bundle.includedFiles.map((item) => item.relativePath), ["src/a.py"]);
    assert.equal(bundle.omittedCount, 1);
    assert.equal(bundle.truncated, true);
    assert.match(bundle.content, /file: src\/a\.py/);
    assert.doesNotMatch(bundle.content, /src\/b\.py/);
  });

  it("does not claim any selected file was included when the limit is zero", () => {
    const bundle = combineArtifactContentsBounded(
      [{ relativePath: "README.md", content: "hello" }],
      0,
    );
    assert.equal(bundle.content, "");
    assert.deepEqual(bundle.includedFiles, []);
    assert.equal(bundle.omittedCount, 1);
    assert.equal(bundle.truncated, false);
  });
});
