import { useState } from "react";
import type { DatabaseSchema } from "../hooks/useSchema";
import "../styles/schema-tree.css";

interface SchemaTreeProps {
  readonly schema: DatabaseSchema | null;
}

export function SchemaTree({ schema }: SchemaTreeProps) {
  if (!schema) {
    return (
      <div className="sidebar-placeholder">
        连接数据库后查看结构
      </div>
    );
  }

  return (
    <div className="schema-tree">
      <div className="schema-db-header">
        <span className="schema-db-icon">⛁</span>
        <span className="schema-db-name">{schema.database_name}</span>
        <span className="schema-table-count">
          {schema.tables.length} 表
        </span>
      </div>
      {schema.tables.map((table) => (
        <TableNode key={table.name} table={table} />
      ))}
    </div>
  );
}

interface TableNodeProps {
  readonly table: {
    readonly name: string;
    readonly columns: readonly {
      readonly name: string;
      readonly data_type: string;
      readonly nullable: boolean;
      readonly is_primary_key: boolean;
    }[];
  };
}

function TableNode({ table }: TableNodeProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="schema-table">
      <button
        className="schema-table-header"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className={`schema-arrow ${expanded ? "expanded" : ""}`}>
          ▸
        </span>
        <span className="schema-table-icon">⊞</span>
        <span className="schema-table-name">{table.name}</span>
        <span className="schema-column-count">
          {table.columns.length}
        </span>
      </button>
      {expanded && (
        <div className="schema-columns">
          {table.columns.map((col) => (
            <div key={col.name} className="schema-column">
              <span
                className={`schema-type-badge ${col.is_primary_key ? "pk" : ""}`}
              >
                {col.is_primary_key ? "PK" : col.data_type || "ANY"}
              </span>
              <span className="schema-column-name">{col.name}</span>
              {col.nullable && (
                <span className="schema-nullable">NULL</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
