# Goal to Contract API Boundary

## Canonical Contract

The response contract is defined by `schemas/boss-contract.v0.schema.json`. The fixed integration example is `examples/waca-se-boss.json`. These existing repository files are authoritative.

## Request

`POST /api/contracts/generate`

```json
{
  "schemaVersion": "boss-contract.v0",
  "goal": "我想复现 WACA 论文，但不知道从哪里开始",
  "projectContext": {
    "sourceName": "用户选择的本地项目文件（2 个）",
    "fileNames": ["README.md", "notes/progress.md"],
    "content": "--- file: README.md ---\n..."
  }
}
```

The trimmed goal must contain 1 to 500 characters.

`projectContext` is optional. It may contain at most 20 explicitly selected text files and 24,000 characters. The browser must obtain permission through the system folder picker; a web page cannot silently read an arbitrary local path. Selected content is treated as untrusted data, is used only for this generation request, and is not persisted in the local ledger. File names may be retained as provenance metadata.

## Success Response

```json
{
  "generation": "MOCK",
  "contract": {
    "schemaVersion": "boss-contract.v0",
    "recordKind": "DEMO_FIXTURE",
    "revision": 1,
    "...": "all remaining fields follow schemas/boss-contract.v0.schema.json"
  }
}
```

MVP-0 returns the fixed WACA-SE fixture and replaces its `rawGoal` with the submitted goal. When the AI workflow is connected, `generation` changes to `AI`; the `contract` shape remains unchanged.

## Error Response

HTTP 400:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "请输入 1 到 500 个字符的科研目标，并使用当前接口版本。"
  }
}
```
