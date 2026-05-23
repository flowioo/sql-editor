import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { DatabaseSchema } from "../hooks/useSchema";

interface SchemaEntry {
  readonly label: string;
  readonly type: "table" | "column" | "keyword" | "function";
  readonly detail: string;
  readonly info?: string;
  readonly apply?: string;
}

let cachedSchema: DatabaseSchema | null = null;

const SQL_KEYWORDS: readonly string[] = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "EXISTS",
  "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN",
  "ON", "AS", "IS", "NULL", "LIKE", "BETWEEN",
  "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
  "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW",
  "DISTINCT", "UNION", "ALL", "ASC", "DESC",
  "CASE", "WHEN", "THEN", "ELSE", "END",
  "TRUE", "FALSE", "CAST", "DEFAULT",
];

const SQL_FUNCTIONS: readonly string[] = [
  "COUNT", "SUM", "AVG", "MAX", "MIN",
  "COALESCE", "NULLIF",
  "UPPER", "LOWER", "LENGTH", "TRIM", "SUBSTRING",
  "CONCAT", "REPLACE", "POSITION",
  "ROUND", "FLOOR", "CEIL", "ABS",
  "NOW", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP",
  "EXTRACT", "DATE_TRUNC",
  "ROW_NUMBER", "RANK", "DENSE_RANK",
  "STRING_AGG", "ARRAY_AGG",
  "TYPEOF",
];

export function setSchema(schema: DatabaseSchema | null): void {
  cachedSchema = schema;
}

export function schemaCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/[\w.]+/);
  if (!word || (word.from === word.to && !context.explicit)) {
    return null;
  }

  const text = word.text;
  const beforeText = context.state.doc.sliceString(
    Math.max(0, context.pos - 200),
    context.pos,
  );
  const beforeTextUpper = beforeText.toUpperCase().trimEnd();

  const options: SchemaEntry[] = [];

  // Dot notation: table.column
  if (text.includes(".")) {
    const dotIdx = text.indexOf(".");
    const tableName = text.substring(0, dotIdx);
    const colPrefix = text.substring(dotIdx + 1).toLowerCase();

    const table = cachedSchema?.tables.find(
      (t) => t.name.toLowerCase() === tableName.toLowerCase(),
    );

    if (table) {
      for (const col of table.columns) {
        if (col.name.toLowerCase().startsWith(colPrefix)) {
          options.push({
            label: `${tableName}.${col.name}`,
            type: "column",
            detail: col.data_type || "unknown",
            apply: col.name,
          });
        }
      }
    }

    if (options.length > 0) {
      return {
        from: word.from,
        options,
        filter: false,
      };
    }
  }

  const prefix = text.toLowerCase();

  // Context-aware: after FROM / JOIN -> suggest tables
  if (isAfterTableContext(beforeTextUpper)) {
    fillTableOptions(options, prefix);
  }
  // After SELECT / WHERE / ORDER BY / GROUP BY -> suggest columns + tables
  else if (isAfterColumnContext(beforeTextUpper)) {
    fillColumnOptions(options, prefix);
    fillTableOptions(options, prefix);
    fillKeywordOptions(options, prefix);
    fillFunctionOptions(options, prefix);
  } else {
    // Default: keywords + functions + tables + columns
    fillKeywordOptions(options, prefix);
    fillFunctionOptions(options, prefix);
    fillTableOptions(options, prefix);
    fillColumnOptions(options, prefix);
  }

  if (options.length === 0) {
    return null;
  }

  return {
    from: word.from,
    options,
  };
}

function isAfterTableContext(text: string): boolean {
  const patterns = [
    /\bFROM\s*$/i,
    /\bJOIN\s*$/i,
    /\bINNER\s+JOIN\s*$/i,
    /\bLEFT\s+JOIN\s*$/i,
    /\bRIGHT\s+JOIN\s*$/i,
    /\bFULL\s+JOIN\s*$/i,
    /\bCROSS\s+JOIN\s*$/i,
    /\bINTO\s*$/i,
    /\bUPDATE\s*$/i,
    /\bTABLE\s*$/i,
  ];
  return patterns.some((p) => p.test(text));
}

function isAfterColumnContext(text: string): boolean {
  const patterns = [
    /\bSELECT\s*$/i,
    /\bWHERE\s*$/i,
    /\bAND\s*$/i,
    /\bOR\s*$/i,
    /\bORDER\s+BY\s*$/i,
    /\bGROUP\s+BY\s*$/i,
    /\bHAVING\s*$/i,
    /\bSET\s*$/i,
    /\bON\s*$/i,
    /\bCASE\s+WHEN\s*$/i,
    /\bWHEN\s*$/i,
    /\bTHEN\s*$/i,
    /\bELSE\s*$/i,
  ];
  return patterns.some((p) => p.test(text));
}

function fillTableOptions(
  options: SchemaEntry[],
  prefix: string,
): void {
  if (!cachedSchema) return;
  for (const table of cachedSchema.tables) {
    if (table.name.toLowerCase().startsWith(prefix)) {
      options.push({
        label: table.name,
        type: "table",
        detail: `${table.columns.length} 列`,
      });
    }
  }
}

function fillColumnOptions(
  options: SchemaEntry[],
  prefix: string,
): void {
  if (!cachedSchema) return;
  for (const table of cachedSchema.tables) {
    for (const col of table.columns) {
      if (col.name.toLowerCase().startsWith(prefix)) {
        options.push({
          label: col.name,
          type: "column",
          detail: `${table.name}.${col.data_type || "unknown"}`,
          info: col.data_type,
        });
      }
    }
  }
}

function fillKeywordOptions(
  options: SchemaEntry[],
  prefix: string,
): void {
  for (const kw of SQL_KEYWORDS) {
    if (kw.toLowerCase().startsWith(prefix)) {
      options.push({
        label: kw,
        type: "keyword",
        detail: "关键字",
      });
    }
  }
}

function fillFunctionOptions(
  options: SchemaEntry[],
  prefix: string,
): void {
  for (const fn of SQL_FUNCTIONS) {
    if (fn.toLowerCase().startsWith(prefix)) {
      options.push({
        label: fn,
        type: "function",
        detail: "函数",
        apply: `${fn}()`,
      });
    }
  }
}
