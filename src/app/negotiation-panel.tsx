"use client";

import { FormEvent, useState } from "react";
import { Ledger } from "@/lib/failure-ledger";
import {
  NEGOTIATION_CHAT_VERSION,
  NegotiationChatMessage,
  NegotiationChatReply,
} from "@/lib/negotiation-chat";
import {
  NegotiationProposal,
  ProposalInput,
  draftProposal,
  previewImpact,
} from "@/lib/negotiation";
import { RoadmapDerivation } from "@/lib/roadmap";

export interface NegotiationPanelProps {
  ledger: Ledger;
  roadmap: RoadmapDerivation;
  onApply: (proposal: NegotiationProposal, input: ProposalInput) => void | Promise<void>;
  onClose: () => void;
}
interface DisplayMessage extends NegotiationChatMessage {
  id: string;
}

const WELCOME: DisplayMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "你可以直接告诉我哪里不合理、想先做什么，或者最近时间和优先级发生了什么变化。我会先和你把意图聊清楚，再给出一份可预览的修改提案。",
};

/**
 * Free-form negotiation surface. Conversation is advice only. Once the AI
 * understands the request, it returns a validated structured input; the old
 * preview and explicit-accept boundary remains the only roadmap write path.
 */
export function NegotiationPanel({ ledger, roadmap, onApply, onClose }: NegotiationPanelProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([WELCOME]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState<{ proposal: NegotiationProposal; input: ProposalInput } | null>(
    null,
  );
  const [error, setError] = useState("");

  const context = {
    goal: roadmap.goal,
    revision: roadmap.revision,
    currentBossId: roadmap.currentBossId,
    milestones: roadmap.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      bosses: milestone.bossIds.map((id) => ({
        id,
        objective: ledger.contracts[id]?.objective ?? id,
      })),
      ...(ledger.project?.milestones.find((item) => item.id === milestone.id)?.steps
        ? {
            plannedSteps: ledger.project.milestones
              .find((item) => item.id === milestone.id)!
              .steps!.map((step) => ({ ...step })),
          }
        : {}),
    })),
  };

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = message.trim();
    if (!content || busy) return;

    const userMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
    };
    const history = messages.slice(-11).map(({ role, content: itemContent }) => ({
      role,
      content: itemContent,
    }));
    setMessages((current) => [...current, userMessage]);
    setMessage("");
    setDraft(null);
    setError("");
    setBusy(true);

    try {
      const response = await fetch("/api/negotiation/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: NEGOTIATION_CHAT_VERSION,
          message: content,
          history,
          context,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | NegotiationChatReply
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !body || !("reply" in body)) {
        const detail = body && "error" in body ? body.error?.message : undefined;
        throw new Error(detail || "Boss 暂时没有回复，请稍后再试。");
      }

      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: "assistant", content: body.reply },
      ]);
      if (body.state === "PROPOSAL" && body.proposalInput) {
        const proposal = draftProposal(
          body.proposalInput,
          content,
          ledger,
          `np-${Date.now()}`,
          new Date().toISOString(),
        );
        if ("error" in proposal) throw new Error(proposal.error);
        setDraft({ proposal, input: body.proposalInput });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Boss 暂时没有回复，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!draft || applying) return;
    setError("");
    setApplying(true);
    try {
      await onApply(draft.proposal, draft.input);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成下一步 Boss 失败，请稍后再试。");
    } finally {
      setApplying(false);
    }
  }

  const impact = draft ? previewImpact(ledger, draft.proposal, draft.input) : null;
  const delta = impact === null ? null : impact.progressAfter - impact.progressBefore;

  return (
    <section className="negotiation" aria-label="协商调整路线">
      <div className="negotiation-head">
        <div>
          <p className="eyebrow">Boss Negotiation</p>
          <h3>和 Boss 聊聊怎么调整计划</h3>
        </div>
        <button type="button" className="button-secondary" onClick={onClose}>关闭</button>
      </div>
      <p className="muted">
        不需要先理解任何选项，直接说你的情况和想法。聊天不会修改计划；只有你接受提案后才会生成新版本。
      </p>

      <div className="negotiation-chat" aria-live="polite">
        {messages.map((item) => (
          <div
            className={item.role === "user" ? "chat-row chat-row-user" : "chat-row chat-row-boss"}
            key={item.id}
          >
            <span className="chat-speaker">{item.role === "user" ? "你" : "Boss"}</span>
            <p>{item.content}</p>
          </div>
        ))}
        {busy && (
          <div className="chat-row chat-row-boss">
            <span className="chat-speaker">Boss</span>
            <p className="muted">正在理解你的调整意图…</p>
          </div>
        )}
      </div>

      <form className="negotiation-composer" onSubmit={(event) => void send(event)}>
        <label htmlFor="negotiation-message">你希望怎样调整？</label>
        <textarea
          id="negotiation-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={800}
          placeholder="例如：这周临时多了一门考试，我想先暂停模型训练，但保留已经做完的数据审计，下周再回来继续。"
          disabled={busy}
        />
        <div className="negotiation-actions">
          <button type="submit" disabled={busy || !message.trim()}>
            {busy ? "Boss 正在思考…" : "发送给 Boss"}
          </button>
          <span className="field-hint">{message.length}/800</span>
        </div>
      </form>

      {error && <p className="error" role="alert">{error} 计划没有发生变化。</p>}

      {draft && impact && (
        <div className="negotiation-preview">
          <p className="negotiation-callout">
            Boss 已经把对话整理成一份<strong>可执行提案</strong>。现在仍未修改路线，接受后才会生效。
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
                  {delta > 0 ? "+" : ""}{delta} 个百分点
                </span>
              )}
            </p>
            {impact.milestoneNotes.length > 0 && (
              <ul>{impact.milestoneNotes.map((note, index) => <li key={index}>{note}</li>)}</ul>
            )}
            <p className="muted">{impact.evidenceNote}</p>
            <p className="muted">{draft.proposal.note}</p>
          </div>

          <div className="negotiation-actions">
            <button type="button" onClick={() => void accept()} disabled={applying}>
              {applying
                ? "正在生成下一步 Boss…"
                : `接受提案，生成计划版本 ${roadmap.revision + 1}`}
            </button>
            <button type="button" className="button-secondary" disabled={applying} onClick={() => setDraft(null)}>
              先不接受，继续聊
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
