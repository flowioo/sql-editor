/**
 * Demo dataset shared by E2E specs and README screenshot generation.
 *
 * Kept in one place so screenshots and tests exercise the same shapes the
 * Rust backend returns. When a command's response type changes, this file is
 * the single thing to update — a mismatch here means the mock has drifted
 * from the real IPC contract and the tests are lying.
 *
 * The data models a small e-commerce database because it makes joins, types
 * and NULLs look natural in screenshots without needing a real server.
 */

export interface DemoColumn {
  readonly name: string;
  readonly data_type: string;
  readonly nullable: boolean;
  readonly default_value: string | null;
  readonly is_primary_key: boolean;
}

const col = (
  name: string,
  data_type: string,
  opts: { pk?: boolean; nullable?: boolean; default?: string | null } = {},
): DemoColumn => ({
  name,
  data_type,
  nullable: opts.nullable ?? false,
  default_value: opts.default ?? null,
  is_primary_key: opts.pk ?? false,
});

export const DEMO_SCHEMA = {
  database_name: "shop.db",
  captured_at: "2026-08-18T09:12:00Z",
  tables: [
    {
      name: "users",
      columns: [
        col("id", "INTEGER", { pk: true }),
        col("email", "TEXT"),
        col("full_name", "TEXT", { nullable: true }),
        col("country", "TEXT", { nullable: true, default: "'CN'" }),
        col("is_active", "BOOLEAN", { default: "1" }),
        col("created_at", "DATETIME", { default: "CURRENT_TIMESTAMP" }),
      ],
    },
    {
      name: "orders",
      columns: [
        col("id", "INTEGER", { pk: true }),
        col("user_id", "INTEGER"),
        col("total_amount", "DECIMAL(10,2)"),
        col("status", "TEXT", { default: "'pending'" }),
        col("shipped_at", "DATETIME", { nullable: true }),
        col("created_at", "DATETIME", { default: "CURRENT_TIMESTAMP" }),
      ],
    },
    {
      name: "order_items",
      columns: [
        col("id", "INTEGER", { pk: true }),
        col("order_id", "INTEGER"),
        col("product_id", "INTEGER"),
        col("quantity", "INTEGER", { default: "1" }),
        col("unit_price", "DECIMAL(10,2)"),
      ],
    },
    {
      name: "products",
      columns: [
        col("id", "INTEGER", { pk: true }),
        col("sku", "TEXT"),
        col("name", "TEXT"),
        col("price", "DECIMAL(10,2)"),
        col("stock", "INTEGER", { default: "0" }),
        col("category", "TEXT", { nullable: true }),
      ],
    },
  ],
} as const;

/** Result for the flagship screenshot query (users ⨝ orders aggregate). */
export const DEMO_JOIN_RESULT = {
  sql: "SELECT u.id, u.email, u.country, COUNT(o.id) AS order_count, SUM(o.total_amount) AS lifetime_value\n  FROM users u\n  JOIN orders o ON o.user_id = u.id\n WHERE o.status = 'shipped'\n GROUP BY u.id\n ORDER BY lifetime_value DESC\n LIMIT 12;",
  columns: ["id", "email", "country", "order_count", "lifetime_value"],
  rows: [
    ["1042", "mei.chen@example.com", "CN", "27", "18432.50"],
    ["318", "j.harding@example.com", "US", "23", "15980.00"],
    ["2291", "sofia.rossi@example.com", "IT", "19", "14275.25"],
    ["77", "kenji.tanaka@example.com", "JP", "18", "13640.75"],
    ["1508", "amara.okafor@example.com", "NG", "16", "12115.00"],
    ["933", "lucas.silva@example.com", "BR", "15", "11890.40"],
    ["2604", "elena.petrova@example.com", "DE", "14", "10450.00"],
    ["145", "priya.nair@example.com", "IN", "13", "9875.60"],
    ["1877", "omar.haddad@example.com", "AE", "12", "9210.30"],
    ["452", "zhang.wei@example.com", "CN", "11", "8664.00"],
    ["3011", "marie.dubois@example.com", "FR", null, "8120.90"],
    ["689", "david.kim@example.com", "KR", "9", "7455.15"],
  ],
  affected_rows: 0,
  truncated: false,
  is_query: true,
  error: null,
} as const;

/** Multi-statement result: shows per-statement tabs + a DDL/DML mix. */
export const DEMO_MULTI_RESULT = {
  results: [
    DEMO_JOIN_RESULT,
    {
      sql: "UPDATE products SET stock = stock - 1 WHERE sku = 'KB-87-RED';",
      columns: [],
      rows: [],
      affected_rows: 1,
      truncated: false,
      is_query: false,
      error: null,
    },
  ],
  total_duration_ms: 12,
} as const;

export const DEMO_CONNECTION = {
  id: "demo-shop-sqlite",
  name: "shop.db (demo)",
  config: { type: "sqlite", path: "/Users/you/projects/shop/shop.db" },
} as const;
