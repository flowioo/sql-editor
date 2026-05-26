import "../styles/schema-tree.css";

interface TableStructureProps {
  readonly table: {
    readonly name: string;
    readonly columns: readonly {
      readonly name: string;
      readonly data_type: string;
      readonly nullable: boolean;
      readonly is_primary_key: boolean;
      readonly default_value?: string | null;
    }[];
  };
  readonly description?: string;
  readonly onClose: () => void;
}

export function TableStructure({ table, onClose }: TableStructureProps) {
  const pkColumns = table.columns.filter((c) => c.is_primary_key);
  const normalColumns = table.columns.filter((c) => !c.is_primary_key);
  const orderedColumns = [...pkColumns, ...normalColumns];

  return (
    <div className="table-structure-panel">
      <div className="table-structure-header">
        <span className="table-structure-title">
          <span className="schema-table-icon">⊞</span>
          {table.name}
        </span>
        <span className="table-structure-meta">
          {table.columns.length} 列 · {pkColumns.length} 主键
        </span>
        <button className="table-structure-close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="table-structure-grid">
        <div className="table-structure-row header">
          <span className="col-flag">标志</span>
          <span className="col-name">列名</span>
          <span className="col-type">类型</span>
          <span className="col-null">可空</span>
          <span className="col-default">默认值</span>
        </div>
        {orderedColumns.map((col) => (
          <div key={col.name} className={`table-structure-row ${col.is_primary_key ? "pk-row" : ""}`}>
            <span className="col-flag">
              {col.is_primary_key && <span className="flag-pk">PK</span>}
            </span>
            <span className="col-name">{col.name}</span>
            <span className="col-type">
              <span className={`schema-type-badge ${col.is_primary_key ? "pk" : ""}`}>
                {col.data_type}
              </span>
            </span>
            <span className="col-null">
              {col.nullable ? (
                <span className="nullable-yes">YES</span>
              ) : (
                <span className="nullable-no">NO</span>
              )}
            </span>
            <span className="col-default">
              {col.default_value ? (
                <span className="default-value">{col.default_value}</span>
              ) : (
                <span className="no-default">—</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
