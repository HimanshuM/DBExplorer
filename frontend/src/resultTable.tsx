import { domain } from '../wailsjs/go/models';

export function ResultTable({
  schema,
  rows,
}: {
  schema: domain.ResultSchema;
  rows: domain.GetRowsResponse;
}) {
  if (schema.columns.length === 0) {
    return <div className="result-placeholder">Query completed without tabular results</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            {schema.columns.map((column) => (
              <th key={column.name}>{column.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((row, rowIndex) => (
            <tr key={rows.start + rowIndex}>
              <td>{rows.start + rowIndex + 1}</td>
              {schema.columns.map((column, columnIndex) => (
                <td key={column.name}>{formatCell(row[columnIndex])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function resultLabel(rows: domain.GetRowsResponse) {
  if (rows.rowCountKnown) {
    return `Results: ${rows.rowCount} rows`;
  }
  return `Results: ${rows.rows.length} loaded`;
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (value instanceof Uint8Array) {
    return `<${value.byteLength} bytes>`;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
