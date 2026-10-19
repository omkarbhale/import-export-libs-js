import { getMessage } from "./messages.js";

/** Why a reference was removed: the engine's `RemovedRefReason` (`RRR_Type`, `RRR_Relationship`, `RRR_Item`). */
export type RemovedRefReason = "type" | "relationship" | "item";

const REASON_MESSAGES: Readonly<Record<RemovedRefReason, string>> = {
  type: "RemovedReferenceTypeReason",
  relationship: "RemovedReferenceRelationshipReason",
  item: "RemovedReferenceItemReason",
};

/**
 * A reference that was taken out of an exported item because it points at an unknown package: where it was, what it pointed at,
 * and why. The log writes its `reason` text (EXP-613).
 *
 * @spec EXP-611 EXP-613
 */
export class RemovedReference {
  readonly from: string;
  readonly to: string;
  private readonly kind: RemovedRefReason;

  constructor(from: string, to: string, kind: RemovedRefReason) {
    this.from = from;
    this.to = to;
    this.kind = kind;
  }

  /** The text of the reason, from the engine's message catalogue. */
  get reason(): string {
    return getMessage(REASON_MESSAGES[this.kind]);
  }
}
