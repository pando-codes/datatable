/**
 * In-memory LinkProvider adapter.
 *
 * Stores links in plain maps keyed by "tableId:columnId" and rowId, with
 * target lookup delegated to a pluggable target resolver. This keeps the
 * adapter backend-free: tests can supply a synthetic roster of linkable
 * records without constructing a full DataSource for each target table.
 */

import type {
  ColumnRef,
  LinkColumnSchema,
  LinkProvider,
  LinkedRecord,
  Page,
  PageOpts,
  ResourceId,
} from "@pando-codes/datatable-contracts";

export interface LinkTargetResolver {
  /** Lookup a target by id. Returns null when the id is unknown. */
  get(id: ResourceId): LinkedRecord | null;
  /** Search targets by a free-text query. */
  search(query: string): LinkedRecord[];
  /** Schema metadata describing this target relation. */
  schema: LinkColumnSchema;
}

export interface MemoryLinkProviderOptions {
  /**
   * Resolver per link column, keyed by "tableId:columnId". Required for any
   * column that will be exercised; unregistered columns cause describe() to
   * return null.
   */
  targets: Record<string, LinkTargetResolver>;
}

export class MemoryLinkProvider implements LinkProvider {
  private readonly targets: Map<string, LinkTargetResolver>;
  private links = new Map<string, Map<ResourceId, Set<ResourceId>>>();

  constructor(opts: MemoryLinkProviderOptions) {
    this.targets = new Map(Object.entries(opts.targets));
  }

  async describe(column: ColumnRef): Promise<LinkColumnSchema | null> {
    const target = this.targets.get(keyOf(column));
    return target ? target.schema : null;
  }

  async fetchLinked(
    rowId: ResourceId,
    column: ColumnRef,
    opts?: PageOpts,
  ): Promise<Page<LinkedRecord>> {
    const target = this.getTarget(column);
    const ids = this.links.get(keyOf(column))?.get(rowId) ?? new Set<ResourceId>();
    const records: LinkedRecord[] = [];
    for (const id of ids) {
      const r = target.get(id);
      if (r) records.push(r);
    }
    const limit = opts?.limit ?? 50;
    const start = cursorToIndex(opts?.cursor) ?? 0;
    const page = records.slice(start, start + limit);
    const end = start + page.length;
    return {
      items: page,
      nextCursor: end < records.length ? String(end) : null,
      totalCount: records.length,
    };
  }

  async setLinks(
    rowId: ResourceId,
    column: ColumnRef,
    targetIds: ResourceId[],
  ): Promise<void> {
    const target = this.getTarget(column);
    if (target.schema.cardinality === "one" && targetIds.length > 1) {
      throw new Error(
        `setLinks: column ${column.columnId} has cardinality "one" but received ${targetIds.length} target ids`,
      );
    }
    if (!target.schema.mutable) {
      throw new Error(`setLinks: column ${column.columnId} is read-only`);
    }
    const key = keyOf(column);
    let byRow = this.links.get(key);
    if (!byRow) {
      byRow = new Map();
      this.links.set(key, byRow);
    }
    byRow.set(rowId, new Set(targetIds));
  }

  async searchLinkable(
    column: ColumnRef,
    query: string,
    opts?: PageOpts,
  ): Promise<Page<LinkedRecord>> {
    const target = this.getTarget(column);
    const matches = target.search(query);
    const limit = opts?.limit ?? 50;
    const start = cursorToIndex(opts?.cursor) ?? 0;
    const page = matches.slice(start, start + limit);
    const end = start + page.length;
    return {
      items: page,
      nextCursor: end < matches.length ? String(end) : null,
      totalCount: matches.length,
    };
  }

  async countLinksByRow(column: ColumnRef): Promise<Record<string, number>> {
    const byRow = this.links.get(keyOf(column));
    const counts: Record<string, number> = {};
    if (!byRow) return counts;
    for (const [rowId, targets] of byRow) {
      if (targets.size > 0) counts[rowId] = targets.size;
    }
    return counts;
  }

  async onColumnRemoved(column: ColumnRef): Promise<void> {
    this.links.delete(keyOf(column));
  }

  async onColumnAdded(): Promise<void> {
    // No-op: storage is lazy.
  }

  private getTarget(column: ColumnRef): LinkTargetResolver {
    const target = this.targets.get(keyOf(column));
    if (!target) {
      throw new Error(`No LinkTargetResolver registered for ${keyOf(column)}`);
    }
    return target;
  }
}

function keyOf(column: ColumnRef): string {
  return `${column.tableId}:${column.columnId}`;
}

function cursorToIndex(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const n = Number(cursor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convenience: build a LinkTargetResolver over a static array of linkable
 * records. Search is a case-insensitive substring match against the label.
 */
export function staticTargetResolver(
  schema: LinkColumnSchema,
  records: LinkedRecord[],
): LinkTargetResolver {
  const byId = new Map(records.map((r) => [r.id, r]));
  return {
    schema,
    get: (id) => byId.get(id) ?? null,
    search: (query) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return records;
      return records.filter((r) => r.label.toLowerCase().includes(needle));
    },
  };
}
