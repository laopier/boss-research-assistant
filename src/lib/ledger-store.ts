"use client";

import {
  Ledger,
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
  const loaded = loadLedger(browserStorage());
  if (loaded === current) return;
  current = loaded;
  emit();
}

/** Restores the initial state. Used by tests and by a future "clear data" action. */
export function resetLedgerStore(): void {
  hydrated = false;
  current = SERVER_SNAPSHOT;
  emit();
}
