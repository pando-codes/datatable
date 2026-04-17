/**
 * Public surface of @pando/datatable-contracts.
 *
 * This module contains only type definitions and service interfaces.
 * No runtime code, no React, no backend clients. Implementations live
 * in the core, ui, and adapter packages.
 *
 * During Phase 1 this lives at frontend/src/datatable-contracts/ inside
 * listbeaver. In Phase 2 it moves unchanged to packages/contracts/ in
 * the pando-codes/datatable monorepo.
 */

export type {
  Unsubscribe,
  ResourceId,
  ResourceRef,
  ValidationResult,
  PageOpts,
  Page,
} from "./common";

export type {
  ColumnId,
  ColumnTypeId,
  ColumnRef,
  Column,
  TableSchema,
  SchemaPatch,
  ColumnOp,
} from "./schema";

export type {
  FilterValue,
  FilterOperator,
  FilterCondition,
  FilterGroup,
  SortDirection,
  SortConfig,
  GroupConfig,
  RowQuery,
  Row,
  DataSourceCapabilities,
} from "./query";

export type {
  PendingChange,
  PendingCellEdit,
  PendingRowCreate,
  PendingRowDelete,
  PendingSchemaPatch,
  FlushOutcome,
  ResolvedChange,
  FlushError,
  FlushResult,
  AutoSaveStatus,
  ConflictResolver,
  ConflictResolution,
  ChangeEvent,
  ChangeHandler,
} from "./change";

export type { User, Member, TableAction } from "./user";

export type {
  Attachment,
  UploadOpts,
  AttachmentConstraints,
} from "./attachment";

export type { LinkedRecord, LinkColumnSchema } from "./link";

export type {
  CellContext,
  CellRenderProps,
  CellEditorProps,
  AggregationFn,
  AggregationDef,
  ImportParser,
  ColumnTypeDef,
  ColumnTypeRegistry,
} from "./column-type";

export type {
  DataSource,
  LinkProvider,
  LinkColumnKey,
  AutoSaveProvider,
  UserProvider,
  CollaborationProvider,
  AttachmentProvider,
  DraftProvider,
} from "./services";
