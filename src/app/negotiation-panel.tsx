"use client";

import { useState } from "react";
import { Ledger } from "@/lib/failure-ledger";
import {
  NegotiationKind,
  NegotiationProposal,
  ProposalInput,
  draftProposal,
  previewImpact,
} from "@/lib/negotiation";
import { RoadmapDerivation } from "@/lib/roadmap";

export interface NegotiationPanelProps {
  ledger: Ledger;
  roadmap: RoadmapDerivation;
  /** Applies an accepted proposal to the roadmap (page-level ledger write). */
  onApply: (proposal: NegotiationProposal, input: ProposalInput) => void;
  onClose: () => void;
}

const KIND_OPTIONS: Array<{ value: NegotiationKind; label: string }> = [
  { value: "DEFER_BOSS", label: "把一个 Boss 延期到最后的阶段" },
  { value: "MOVE_BOSS", label: "把一个 Boss 移动到其他里程碑" },
  { value: "ADD_MILESTONE", label: "新增一个里程碑（新阶段）" },
  { value: "REMOVE_MILESTONE", label: "删除一个里程碑（其中的 Boss 会保留）" },
  { value: "DROP_BOSS", label: "把一个 Boss 移出路线图（暂停）" },
];

/**
 * The negotiation surface (#18 §2).
 *
 * Three steps, in the issue's order: the user states what to change (as a
 * structured choice plus a written reason — the structured choice is what a
 * rule-based composer can decide honestly; free-text understanding is the AI
 * slot), the proposal is drafted and previewed with its progress impact
 * BEFORE anything is stored, and only the accept button writes — one new plan
 * revision with the reason, the diff and the before/after progress.
 */
export function NegotiationPanel({ ledger, roadmap, onApply, onClose }: NegotiationPanelProps) {
  const [kind, setKind] = useState<NegotiationKind>("DEFER_BOSS");
  const [contractId, setContractId] = useState(roadmap.currentBossId ?? "");
  const [milestoneId, setMilestoneId] = useState(roadmap.milestones[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<{ proposal: NegotiationProposal; input: ProposalInput } | null>(
    null,
  );
  const [error, setError] = useState("");

  const bossOptions = roadmap.milestones.flatMap((milestone) =>
    milestone.bossIds
      .map((id) => ({ id, objective: ledger.contracts[id]?.objective ?? id }))
      .map((item) => ({ ...item, label: `${item.objective.slice(0, 30)}（${milestone.title}）` })),
  );

  function generate() {
    setError("");
    if (reason.trim().length < 8) {
      setError("请用至少 8 个字说明为什么需要这个调整——它会和变更一起保存进修订历史。");
      return;
    }
    const input: ProposalInput = { kind, contractId, milestoneId, title };
    const proposal = draftProposal(input, reason, ledger, `np-${Date.now()}`, new Date().toISOString());
    if ("error" in proposal) {
      setError(proposal.error);
      return;
    }
    setDraft({ proposal, input });
  }

  function accept() {
    if (!draft) return;
    onApply(draft.proposal, draft.input);
    setDraft(null);
    setReason("");
  }

  const impact = draft ? previewImpact(ledger, draft.proposal, draft.input) : null;
  const delta =
    impact === null ? null : impact.progressAfter - impact.progressBefore;

  return (
    <section className="negotiation" aria-label="协商调整路线">
      <div className="negotiation-head">
        <h3>与 Boss 协商调整路线</h3>
        <button type="button" className="button-secondary" onClick={onClose}>
          关闭
        </button>
      </div>
      <p className="muted">
        提案在你看清影响并确认之前不会改变路线图；普通对话与浏览永远不能修改计划。
      </p>

      {!draft && (
        <div className="negotiation-form">
          <label>
            想做什么调整
            <select value={kind} onChange={(event) => setKind(event.target.value as NegotiationKind)}>
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {(kind === "DEFER_BOSS" || kind === "MOVE_BOSS" || kind === "DROP_BOSS") && (
            <label>
              选择 Boss
              <select value={contractId} onChange={(event) => setContractId(event.target.value)}>
                {bossOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {kind === "MOVE_BOSS" && (
            <label>
              目标里程碑
              <select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)}>
                {roadmap.milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          {kind === "REMOVE_MILESTONE" && (
            <label>
              选择要删除的里程碑
              <select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)}>
                {roadmap.milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          {kind === "ADD_MILESTONE" && (
            <label>
              新里程碑名称
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={40}
                placeholder="例如：多随机种子验证"
              />
            </label>
          )}

          <label>
            为什么需要这个调整（会保存进修订历史，至少 8 个字）
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder="例如：训练阶段比预想难，先把数据审计做完再回来。"
            />
          </label>

          {error && <p className="error" role="alert">{error}</p>}

          <div className="negotiation-actions">
            <button type="button" onClick={generate}>
              生成提案
            </button>
          </div>
        </div>
      )}

      {draft && impact && (
        <div className="negotiation-preview">
          <p className="negotiation-callout">
            这是<strong>提案</strong>，路线图还没有任何改变。确认接受后才会生成新的计划版本。
          </p>
          <ul className="negotiation-changes">
            {draft.proposal.changes.map((change, index) => (
              <li key={index}>{change.summary}</li>
            ))}
          </ul>

          <div className="negotiation-impact">
            <p>
              <strong>对总进度的影响：</strong>
              {impact.progressBefore}% → {impact.progressAfter}%
              {delta !== null && delta !== 0 && (
                <span className={delta < 0 ? "status status-fail" : "status status-pass"}>
                  {delta > 0 ? "+" : ""}
                  {delta} 个百分点
                </span>
              )}
            </p>
            {impact.milestoneNotes.length > 0 && (
              <ul>
                {impact.milestoneNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            )}
            <p className="muted">{impact.evidenceNote}</p>
            <p className="muted">{draft.proposal.note}</p>
          </div>

          <div className="negotiation-actions">
            <button type="button" onClick={accept}>
              接受修改，生成计划版本 {roadmap.revision + 1}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              放弃这次修改
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
