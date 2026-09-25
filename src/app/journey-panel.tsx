"use client";

import { JourneyEvent, JourneyEventKind } from "@/lib/progress";

const kindLabel: Record<JourneyEventKind, string> = {
  CONTRACT_ACCEPTED: "确认任务",
  EVIDENCE_RECORDED: "提交材料",
  REVIEW_ADOPTED: "采用检查结果",
  REVIEW_OVERRIDDEN: "手动修改结果",
  FAILURE_RECORDED: "记录问题",
  CRITERION_PASSED: "完成标准通过",
  INCUBATED: "拆出下一步",
  BOSS_CLEAR: "这一步完成",
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
        <p className="muted">还没有记录。确认这一步并提交第一份材料后，你做过的事情会按时间显示在这里。</p>
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
