import { getTableName, type Table } from 'drizzle-orm';

/**
 * A tiny in-memory stand-in for the Drizzle client `sdk.db.getClient()`
 * returns, shared by every Wallet action test.
 *
 * It interprets the `eq()`/`and()` condition tree the tests mock in, so the
 * fake can genuinely *filter* rows — which is the whole point for a
 * tenant/owner-scoping sweep. A stub that always returned every row would
 * pass whether or not the scoping clauses were there at all.
 */
export type Row = Record<string, unknown>;

export type Condition =
  | { kind: 'eq'; key: string; value: unknown }
  | { kind: 'and'; conditions: Condition[] };

export function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

export function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.kind === 'eq') return row[condition.key] === condition.value;
  return condition.conditions.every((c) => matches(row, c));
}

/**
 * Note for callers: the `eq`/`and` replacements have to be written *inline*
 * inside each test file's `vi.mock('drizzle-orm', …)` factory. `vi.mock` is
 * hoisted above the imports, so a factory referencing anything imported from
 * this module — which itself imports `drizzle-orm` — dies with
 * "Cannot access '__vi_import_0__' before initialization".
 */

function project(rows: Row[], columns?: Record<string, unknown>): Row[] {
  if (!columns) return rows;
  return rows.map((row) => {
    const projected: Row = {};
    for (const key of Object.keys(columns)) projected[key] = row[key];
    return projected;
  });
}

function whereChain(rows: Row[], columns: Record<string, unknown> | undefined) {
  return {
    where: (condition?: Condition) => {
      const filtered = rows.filter((row) => matches(row, condition));
      const projected = project(filtered, columns);
      return Object.assign(Promise.resolve(projected), {
        limit: (_n: number) => Promise.resolve(projected),
        returning: (_cols: unknown) => Promise.resolve(projected),
        orderBy: (_order: unknown) => Promise.resolve(projected),
      });
    },
  };
}

/** Builds the fake client over a store the caller can reseed between tests. */
export function makeFakeDb(getStore: () => Record<string, Row[]>) {
  return {
    select(columns?: Record<string, unknown>) {
      return {
        from(table: Table) {
          const store = getStore();
          const rows = store[getTableName(table)] ?? [];
          const join = (joinTable: Table) => {
            const joinName = getTableName(joinTable);
            const joined = rows.map((row) => {
              const match = (store[joinName] ?? []).find((r) => r.itemId === row.id);
              return { ...match, ...row };
            });
            return whereChain(joined, columns);
          };
          return {
            ...whereChain(rows, columns),
            innerJoin: (joinTable: Table, _on: unknown) => join(joinTable),
            leftJoin: (joinTable: Table, _on: unknown) => join(joinTable),
          };
        },
      };
    },
    insert(table: Table) {
      const tableName = getTableName(table);
      return {
        values: async (row: Row) => {
          const store = getStore();
          (store[tableName] ??= []).push(row);
        },
      };
    },
    update(table: Table) {
      const tableName = getTableName(table);
      return {
        set: (patch: Row) => ({
          where: (condition?: Condition) => {
            const store = getStore();
            const matched = (store[tableName] ?? []).filter((row) => matches(row, condition));
            store[tableName] = (store[tableName] ?? []).map((row) =>
              matches(row, condition) ? { ...row, ...patch } : row,
            );
            return Object.assign(Promise.resolve(matched), {
              returning: (_cols: unknown) => Promise.resolve(matched),
            });
          },
        }),
      };
    },
    delete(table: Table) {
      const tableName = getTableName(table);
      return {
        where: async (condition?: Condition) => {
          const store = getStore();
          store[tableName] = (store[tableName] ?? []).filter((row) => !matches(row, condition));
        },
      };
    },
  };
}
