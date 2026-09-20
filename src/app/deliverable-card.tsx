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
  deliverableStatusClass,
  deliverableStatusText,
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

  return (
    <article>
      <div className="deliverable-head">
        <strong>{deliverable.id}</strong>
        <span className={deliverableStatusClass[derivation.status]}>
          {deliverableStatusText[derivation.status]}
        </span>
      </div>
      <p>{deliverable.description}</p>

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
                {id} · {criterionStatusText[statusOf(id)]}
              </a>
            ))}
          </span>
        )}
      </p>

      {active ? (
        <p className="deliverable-open-hint">
          提交表单已在{" "}
          <a href={`#criterion-${criterionId}`}>{criterionId}</a>{" "}
          的卡片中打开，并预填了本交付物。
        </p>
      ) : locked ? (
        <p className="muted">接受合同后，可以为这个交付物提交材料。</p>
      ) : contract.acceptanceCriteria.length === 0 ? (
        <p className="muted">这份合同没有验收项，无法关联材料。</p>
      ) : (
        <div className="deliverable-submit">
          <label>
            为此交付物提交证据
            <select value={criterionId} onChange={(event) => setCriterionId(event.target.value)}>
              {contract.acceptanceCriteria.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} · {item.required ? "必需" : "可选"}
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
            去提交
          </button>
        </div>
      )}
    </article>
  );
}
