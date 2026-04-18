/**
 * Public surface of @pando-codes/datatable-core.
 *
 * Headless data/state logic for the DataTable. No React, no rendering,
 * no backend. Composes over @pando-codes/datatable-contracts: adapters plug
 * into the contracts and the core orchestrates them.
 *
 * During Phase 1 this lives at frontend/src/datatable-core/ inside
 * listbeaver. In Phase 2 it moves to packages/core/ in the
 * pando-codes/datatable monorepo.
 */

export {
  evaluateFilterGroup,
  evaluateCondition,
  compareRows,
  matchesSearch,
} from "./engines";

export {
  AutoSaveQueue,
  defaultErrorClassifier,
} from "./autosave";
export type {
  AutoSaveQueueOptions,
  ApplyFn,
  ErrorClassifier,
} from "./autosave";
