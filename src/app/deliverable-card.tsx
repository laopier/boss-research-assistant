"use client";

import { useState } from "react";
import { BossContract, Deliverable } from "@/lib/contracts";
import {
  DeliverableDerivation,
  EvidenceRecord,
  deriveCriterion,
  deriveDeliverable,
} from "@/lib/failure-ledger";
import {
  criterionStatusClass,
  criterionStatusText,
  criterionLabelOrId,
  deliverableLabel,
  deliverableStatusClass,
  deliverableStatusText,
  hasIndex,
  shortenedDescription,
} from "./labels";

export interface DeliverableCardProps {
  contract: BossContract;
  deliverable: Deliverable;
  /** Every ledger record of this contract; the derivation reads them all. */
  records: EvidenceRecord[];
  /** Evidence cannot be recorded before the contract is accepted (§10). */
  locked: boolean;
  /** True while this card's "submit" request has the form open elsewhere. */
  active: boolean;
  /**
   * Asks the page to open the submission form under the chosen criterion, with
   * this deliverable preselected. The form itself lives on the criterion card,
   * because that is where the review proposal and the adopt/override decision
   * already live; this card only points at it.
   */
  onSubmitFor: (criterionId: string, deliverableId: string) => void;
  /** A single contract-level artifact form owns the normal submission path. */
  unifiedSubmissionAvailable?: boolean;
}

/**
 * One deliverable, with the derived status issue #15 asks for.
 *
 * The contract's own `status` field is generation-time text and stays
 * untouched; what renders here is derived from the ledger on every render, so
 * it can be neither hand-edited nor stale. The "submit" entry point is a
 * pointer, not a second form: a deliverable has no evidence requirements of
 * its own to validate against, so submitting happens against a criterion.
 */
export function DeliverableCard({
  contract,
  deliverable,
  records,
  locked,
  active,
  onSubmitFor,
  unifiedSubmissionAvailable = false,
}: DeliverableCardProps) {
  const [criterionId, setCriterionId] = useState(contract.acceptanceCriteria[0]?.id ?? "");
  const derivation: DeliverableDerivation = deriveDeliverable(contract, deliverable.id, records);

  /**
   * The criterion's status is derived, not read off the contract: the frozen
   * `status` field is generation-time text (the generator cannot know what the
   * user will produce), so it says UNKNOWN long after the evidence has decided
   * otherwise. Found by walking the page in a browser, where the chip said
   * 待验证 next to a reason that said 已全部通过.
   */
  const statusOf = (id: string) => {
    const criterion = contract.acceptanceCriteria.find((item) => item.id === id);
    if (!criterion) return "UNKNOWN" as const;
    return deriveCriterion(criterion, records.filter((item) => item.criterionId === id)).status;
  };

  /**
   * issue #21: numbers come from the position in the contract's own lists, so
   * the deliverable card, the Evidence Map and the progress panel all call the
   * same task by the same number.
   */
  const deliverableIndex = contract.deliverables.findIndex((item) => item.id === deliverable.id) + 1;
  const criterionIndex = (id: string) =>
    contract.acceptanceCriteria.findIndex((item) => item.id === id) + 1;
  const criterionName = (id: string) => criterionLabelOrId(criterionIndex(id), id);

  return (
    <article>
      <div className="deliverable-head">
        <span className="task-title">
          <strong className="task-label">
            {hasIndex(deliverableIndex) ? deliverableLabel(deliverableIndex) : deliverable.id}
          </strong>
          <code className="internal-id">{deliverable.id}</code>
        </span>
        <span className={deliverableStatusClass[derivation.status]}>
          {deliverableStatusText[derivation.status]}
        </span>
      </div>
      <p className="task-desc">{deliverable.description}</p>

      <p className="deliverable-reason">
        {derivation.reason}
        {derivation.linkedEvidenceCount > 0 && (
          <span className="deliverable-links">
            {derivation.relatedCriteria.map((id) => (
              <a
                key={id}
                className={`deliverable-link ${criterionStatusClass[statusOf(id)]}`}
                href={`#criterion-${id}`}
              >
                {criterionName(id)} · {criterionStatusText[statusOf(id)]}
              </a>
            ))}
          </span>
        )}
      </p>

      {unifiedSubmissionAvailable ? (
        <p className="muted">在上方上传一次，Boss 会统一检查。</p>
      ) : active ? (
        <p className="deliverable-open-hint">
          上传入口已经在{" "}
          <a href={`#criterion-${criterionId}`}>{criterionName(criterionId)}</a>{" "}
          的卡片中打开，并选好了这项成果。
        </p>
      ) : locked ? (
        <p className="muted">确认这一步后，就可以提交成果。</p>
      ) : contract.acceptanceCriteria.length === 0 ? (
        <p className="muted">这一步还没有完成标准，暂时不能检查材料。</p>
      ) : (
        <div className="deliverable-submit">
          <label>
            选择要检查的完成标准
            <select value={criterionId} onChange={(event) => setCriterionId(event.target.value)}>
              {contract.acceptanceCriteria.map((item) => (
                <option key={item.id} value={item.id}>
                  {`${criterionName(item.id)} · ${item.required ? "必须" : "加分项"} · ${shortenedDescription(item.description, 14)}`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button-secondary"
            disabled={!criterionId}
            onClick={() => onSubmitFor(criterionId, deliverable.id)}
          >
            去上传材料
          </button>
        </div>
      )}
    </article>
  );
}
