/**
 * In-memory adapter implementations for @pando-codes/datatable-contracts.
 *
 * Primary use cases:
 *   - Unit tests for code that depends on contracts, without mocks.
 *   - Storybook / playground / docs demos for the datatable UI.
 *   - A reference implementation that pressure-tests the contracts —
 *     if a backend-specific provider needs to do things these can't,
 *     the contract is probably leaking.
 */

export {
  MemoryDataSource,
  RowNotFound,
  RowVersionConflict,
  SchemaVersionConflict,
} from "./MemoryDataSource";
export type {
  MemoryDataSourceSeed,
  MemoryDataSourceOptions,
} from "./MemoryDataSource";

export { MemoryAutoSaveProvider, applyToDataSource } from "./MemoryAutoSaveProvider";
export type { MemoryAutoSaveProviderOptions } from "./MemoryAutoSaveProvider";

export { MemoryUserProvider } from "./MemoryUserProvider";
export type { MemoryUserProviderSeed } from "./MemoryUserProvider";

export {
  MemoryLinkProvider,
  staticTargetResolver,
} from "./MemoryLinkProvider";
export type {
  LinkTargetResolver,
  MemoryLinkProviderOptions,
} from "./MemoryLinkProvider";

export { MemoryCollaborationProvider } from "./MemoryCollaborationProvider";
export type {
  RoleActionMap,
  MemberSeed,
  MemoryCollaborationProviderOptions,
} from "./MemoryCollaborationProvider";

export { MemoryAttachmentProvider } from "./MemoryAttachmentProvider";
export type { MemoryAttachmentProviderOptions } from "./MemoryAttachmentProvider";

export { MemoryDraftProvider } from "./MemoryDraftProvider";

export { createCounterIdGenerator, uuidIdGenerator } from "./internals/id";
export type { IdGenerator } from "./internals/id";
