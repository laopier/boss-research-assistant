"use client";

import {
  Ledger,
  LedgerStorage,
  browserStorage,
  emptyLedger,
  loadLedger,
  saveLedger,
} from "./failure-ledger";

/**
 * A tiny external store for the ledger.
 *
 * Why not `useState` plus `useEffect`: the ledger lives in `localStorage`, which
 * is an external system, and reading it in an effect means calling `setState`
 * during an effect — a cascading render that `react-hooks/set-state-in-effect`
 * (React 19) flags as an error. The documented pattern for an external store is
 * `useSyncExternalStore`, which also gives a clean SSR story: the server
 * snapshot is empty, the first client render matches it, and the hydrated value
 * arrives as a normal store update rather than a hydration mismatch.
 *
 * Persistence lives here rather than in the component so that every mutation
 * path writes through, and so the pure rules stay testable in
 * `src/lib/failure-ledger.ts` with no browser involved.
 */

/** Stable identity for the server snapshot and the pre-hydration client render. */
const SERVER_SNAPSHOT: Ledger = emptyLedger();

/**
 * One-time migration for browsers that loaded the bundled WACA tutorial before
 * the blank first-run experience shipped. The marker is written for every
 * browser on first hydration, so a demo the user explicitly loads afterwards
 * still persists normally.
 */
export const LEGACY_TUTORIAL_RESET_KEY =
  "boss-research-assistant.migration.legacy-tutorial-reset.v1";

const BUNDLED_TUTORIAL_BOSS_IDS = [
  "boss-literature-reading-demo",
  "boss-dataset-investigation-demo",
  "boss-waca-se-demo",
] as const;

let current: Ledger = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeLedger(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLedgerSnapshot(): Ledger {
  return current;
}

export function getLedgerServerSnapshot(): Ledger {
  return SERVER_SNAPSHOT;
}

/** True only for the exact three-Boss project bundled with the old tutorial. */
export function isBundledTutorial(ledger: Ledger): boolean {
  if (ledger.project?.goal !== "复现 WACA 论文") return false;
  const projectBossIds = ledger.project.milestones.flatMap((milestone) => milestone.bossIds);
  return (
    projectBossIds.length === BUNDLED_TUTORIAL_BOSS_IDS.length &&
    BUNDLED_TUTORIAL_BOSS_IDS.every(
      (id) => projectBossIds.includes(id) && ledger.contracts[id]?.recordKind === "DEMO_FIXTURE",
    )
  );
}

/**
 * Loads persisted state and performs the one-time tutorial cleanup.
 * Real projects are preserved; only the exact bundled fixture is discarded.
 */
export function loadLedgerForFirstRun(storage: LedgerStorage | null): Ledger {
  const loaded = loadLedger(storage);
  if (!storage) return loaded;

  try {
    if (storage.getItem(LEGACY_TUTORIAL_RESET_KEY) === "done") return loaded;
    storage.setItem(LEGACY_TUTORIAL_RESET_KEY, "done");
  } catch {
    return loaded;
  }

  if (!isBundledTutorial(loaded)) return loaded;
  const blank = emptyLedger();
  saveLedger(storage, blank);
  return blank;
}

/** Applies an immutable update and persists the result. */
export function updateLedger(update: (previous: Ledger) => Ledger): void {
  const next = update(current);
  if (next === current) return;
  current = next;
  emit();
  saveLedger(browserStorage(), next);
}

/**
 * Reads persisted state once, after mount. Storage is untrusted, so a failure
 * here degrades to an empty ledger rather than an error.
 */
export function hydrateLedger(): void {
  if (hydrated) return;
  hydrated = true;
  const loaded = loadLedgerForFirstRun(browserStorage());
  if (loaded === current) return;
  current = loaded;
  emit();
}

/** Clears the current project and its local evidence after explicit user action. */
export function clearLedgerStore(): void {
  current = emptyLedger();
  hydrated = true;
  emit();
  saveLedger(browserStorage(), current);
}

/** Restores the initial state. Used by tests and by a future "clear data" action. */
export function resetLedgerStore(): void {
  hydrated = false;
  current = SERVER_SNAPSHOT;
  emit();
}
