import { useMemo } from 'react';
import {
  ColumnType,
  Grid,
  themeDark,
  type ReactColDef,
} from '@agility-workbench/react-grid';
import { domain } from '../wailsjs/go/models';
import { formatDuration } from './format';

const ROW_ID_KEY = '__dbExplorerRowId';

const resultGridTheme = themeDark.withParams({
  accentColor: '#5e7ce2',
  backgroundColor: '#101318',
  headerBackgroundColor: '#1a2029',
  textColor: '#d7dde8',
  mutedTextColor: '#8b96a8',
  borderColor: '#272d37',
  rowHoverColor: '#1c232d',
  rowAltBackgroundColor: '#131820',
  selectedBackgroundColor: '#202b43',
  focusRingColor: '#7fa7ff',
  scrollbarThumbColor: '#3b4554',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 12,
  headerFontWeight: 600,
  rowHeight: 29,
  cellHorizontalPadding: 8,
  cellVerticalPadding: 0,
});

export function ResultTable({
  schema,
  rows,
}: {
  schema: domain.ResultSchema;
  rows: domain.GetRowsResponse;
}) {
  const columnDefs = useMemo<ReactColDef[]>(() => (
    schema.columns.map((column, columnIndex) => ({
      colId: `result-column-${columnIndex}`,
      key: columnKey(columnIndex),
      label: column.name,
      type: gridColumnType(column.type.category),
      headerTooltip: column.type.dbTypeName
        ? `${column.name} (${column.type.dbTypeName})`
        : column.name,
      valueFormatter: ({ value }) => formatCell(value),
    }))
  ), [schema.columns]);

  const rowData = useMemo(() => (
    rows.rows.map((row, rowIndex) => {
      const absoluteRowIndex = rows.start + rowIndex;
      const gridRow: Record<string, unknown> = {
        [ROW_ID_KEY]: rows.rowKeys?.[rowIndex] || String(absoluteRowIndex),
      };

      schema.columns.forEach((_, columnIndex) => {
        gridRow[columnKey(columnIndex)] = row[columnIndex];
      });

      return gridRow;
    })
  ), [rows.rowKeys, rows.rows, rows.start, schema.columns]);

  if (schema.columns.length === 0) {
    return <div className="result-placeholder">Query completed without tabular results</div>;
  }

  return (
    <Grid
      ariaLabel="Query results"
      className="result-grid"
      rowData={rowData}
      columnDefs={columnDefs}
      rowIdKey={ROW_ID_KEY}
      rowNumbers
      rowSelection
      zebraRows
      autosizeColumnsOnDataChange
      maxColumnWidth={420}
      noRowsMessage="Query returned no rows"
      theme={resultGridTheme}
      toolbar={{ quickFilter: true, export: true }}
      columnPanel={{ trigger: 'toolbar' }}
      defaultColDef={{
        sortable: true,
        filter: true,
        resizable: true,
        movable: true,
        groupable: false,
        aggregatable: false,
        minWidth: 100,
      }}
    />
  );
}

export function resultLabel(rows: domain.GetRowsResponse, job?: domain.JobSummary | null) {
  const duration = formatDuration(job?.startedAt, job?.endedAt);
  const durationSuffix = duration ? ` in ${duration}` : '';
  if (rows.rowCountKnown) {
    return `Results: ${rows.rowCount} rows${durationSuffix}`;
  }
  return `Results: ${rows.rows.length} loaded${durationSuffix}`;
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

function columnKey(columnIndex: number) {
  return `column_${columnIndex}`;
}

function gridColumnType(category: string) {
  switch (category) {
    case 'number':
      return ColumnType.NUMBER;
    case 'bool':
      return ColumnType.BOOLEAN;
    case 'datetime':
      return ColumnType.DATE;
    default:
      return ColumnType.STRING;
  }
}
