import { useState } from "react";
import type { DatabaseSchema } from "../hooks/useSchema";
import "../styles/schema-tree.css";

interface SchemaTreeProps {
  readonly schema: DatabaseSchema | null;
  readonly descriptions: ReadonlyMap<string, string>;
  readonly onTableSelect?: (tableName: string) => void;
  readonly onTableStructure?: (tableName: string) => void;
}

export function SchemaTree({ schema, descriptions, onTableSelect, onTableStructure }: SchemaTreeProps) {
  const [filter, setFilter] = useState("");

  if (!schema) {
    return (
      <div className="sidebar-placeholder">
        连接数据库后查看结构
      </div>
    );
  }

  const tables = filter
    ? schema.tables.filter((t) =>
        t.name.toLowerCase().includes(filter.toLowerCase())
      )
    : schema.tables;

  return (
    <div className="schema-tree">
      <div className="schema-search">
        <input
          type="text"
          className="schema-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤表名..."
          spellCheck={false}
        />
        {filter && (
          <button className="schema-filter-clear" onClick={() => setFilter("")}>x</button>
        )}
      </div>

      <div className="schema-db-header">
        <span className="schema-db-icon">⛁</span>
        <span className="schema-db-name">{schema.database_name}</span>
        <span className="schema-table-count">
          {filter ? `${tables.length}/${schema.tables.length}` : `${schema.tables.length}`} 表
        </span>
      </div>
      {tables.map((table) => (
        <TableNode
          key={table.name}
          table={table}
          descriptions={descriptions}
          onTableSelect={onTableSelect}
          onTableStructure={onTableStructure}
        />
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
  readonly descriptions: ReadonlyMap<string, string>;
  readonly onTableSelect?: (tableName: string) => void;
  readonly onTableStructure?: (tableName: string) => void;
}

function TableNode({ table, descriptions, onTableSelect, onTableStructure }: TableNodeProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="schema-table">
      <button
        className="schema-table-header"
        onClick={() => setExpanded((prev) => !prev)}
        onDoubleClick={() => onTableSelect?.(table.name)}
        title="单击展开/收起，双击查询 SELECT * FROM"
      >
        <span className={`schema-arrow ${expanded ? "expanded" : ""}`}>
          ▸
        </span>
        <span className="schema-table-icon">⊞</span>
        <span className="schema-table-name">{table.name}</span>
        <span className="schema-column-count">
          {table.columns.length}
        </span>
        {onTableStructure && (
          <span
            className="schema-table-structure-btn"
            onClick={(e) => {
              e.stopPropagation();
              onTableStructure(table.name);
            }}
            title="查看表结构"
          >
            ℹ
          </span>
        )}
      </button>
      {expanded && (
        <div className="schema-columns">
          {table.columns.map((col) => {
            const desc = descriptions.get(`${table.name}.${col.name}`);
            return (
              <div key={col.name} className="schema-column">
                <span
                  className={`schema-type-badge ${col.is_primary_key ? "pk" : ""}`}
                >
                  {col.is_primary_key ? "PK" : col.data_type || "ANY"}
                </span>
                <span className="schema-column-name">{col.name}</span>
                {desc && (
                  <span className="schema-column-desc" title={desc}>
                    {desc}
                  </span>
                )}
                {col.nullable && (
                  <span className="schema-nullable">NULL</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
