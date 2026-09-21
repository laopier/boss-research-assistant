"use client";

import { JourneyEvent, JourneyEventKind } from "@/lib/progress";

const kindLabel: Record<JourneyEventKind, string> = {
  CONTRACT_ACCEPTED: "接受合同",
  EVIDENCE_RECORDED: "提交证据",
  REVIEW_ADOPTED: "采纳审核",
  REVIEW_OVERRIDDEN: "人工覆盖",
  FAILURE_RECORDED: "发现失败",
  CRITERION_PASSED: "验收通过",
  INCUBATED: "孵化新 Boss",
  BOSS_CLEAR: "Boss 完成",
};

const kindClass: Record<JourneyEventKind, string> = {
  CONTRACT_ACCEPTED: "journey-step journey-accepted",
  EVIDENCE_RECORDED: "journey-step journey-recorded",
  REVIEW_ADOPTED: "journey-step journey-adopted",
  REVIEW_OVERRIDDEN: "journey-step journey-overridden",
  FAILURE_RECORDED: "journey-step journey-failure",
  CRITERION_PASSED: "journey-step journey-passed",
  INCUBATED: "journey-step journey-incubated",
  BOSS_CLEAR: "journey-step journey-clear",
};

function formatMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface ResearchJourneyProps {
  events: JourneyEvent[];
}

/**
 * The research journey: every durable action in time order.
 *
 * A failure lowers completion but is not erased by a later pass, and a pass
 * does not delete the earlier failure event — the list accumulates, which is
 * the "打怪升级" accumulation issue #17 asks the page to make visible.
 */
export function ResearchJourney({ events }: ResearchJourneyProps) {
  if (events.length === 0) {
    return (
      <section className="journey" aria-label="科研历程">
        <h3>科研历程</h3>
        <p className="muted">还没有任何动作。接受合同并提交第一条证据后，这里会逐条记录你做过什么。</p>
      </section>
    );
  }

  return (
    <section className="journey" aria-label="科研历程">
      <h3>科研历程</h3>
      <ol className="journey-list">
        {events.map((event, index) => (
          <li className={kindClass[event.kind]} key={`${event.kind}-${event.at}-${index}`}>
            <span className="journey-kind">{kindLabel[event.kind]}</span>
            <span className="journey-text">{event.text}</span>
            <span className="journey-time">{formatMoment(event.at)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
