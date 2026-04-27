package postgres

import (
	"context"
	"fmt"

	"dbx/internal/domain"
	"github.com/jackc/pgx/v5"
)

type Explorer struct {
	profile domain.ConnProfile
}

func NewExplorer(profile domain.ConnProfile) *Explorer {
	return &Explorer{profile: profile}
}

func (e *Explorer) ListDatabases(ctx context.Context) ([]domain.ExplorerDatabase, error) {
	conn, err := e.open(ctx, e.profile.Database)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
select datname
from pg_database
where datallowconn
  and not datistemplate
order by datname`)
	if err != nil {
		return nil, fmt.Errorf("list postgres databases: %w", err)
	}
	defer rows.Close()

	var databases []domain.ExplorerDatabase
	for rows.Next() {
		var database domain.ExplorerDatabase
		if err := rows.Scan(&database.Name); err != nil {
			return nil, fmt.Errorf("scan postgres database: %w", err)
		}
		databases = append(databases, database)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres databases: %w", err)
	}
	return databases, nil
}

func (e *Explorer) ListSchemas(ctx context.Context, database string) ([]domain.ExplorerSchema, error) {
	conn, err := e.open(ctx, database)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
select nspname
from pg_namespace
where nspname <> 'information_schema'
  and nspname !~ '^pg_'
  and nspname not like 'pg_toast%'
  and nspname not like 'pg_temp_%'
order by nspname`)
	if err != nil {
		return nil, fmt.Errorf("list postgres schemas: %w", err)
	}
	defer rows.Close()

	var schemas []domain.ExplorerSchema
	for rows.Next() {
		var schema domain.ExplorerSchema
		if err := rows.Scan(&schema.Name); err != nil {
			return nil, fmt.Errorf("scan postgres schema: %w", err)
		}
		schemas = append(schemas, schema)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres schemas: %w", err)
	}
	return schemas, nil
}

func (e *Explorer) ListSchemaObjects(ctx context.Context, database string, schema string) ([]domain.ExplorerObject, error) {
	if schema == "" {
		return nil, fmt.Errorf("schema cannot be empty")
	}

	conn, err := e.open(ctx, database)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
select name, kind
from (
  select c.relname as name,
    case c.relkind
      when 'r' then 'table'
      when 'p' then 'table'
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      when 'S' then 'sequence'
    end as kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1
    and c.relkind in ('r', 'p', 'v', 'm', 'S')

  union all

  select p.proname as name, 'function' as kind
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = $1
) objects
where kind is not null
order by kind, name`, schema)
	if err != nil {
		return nil, fmt.Errorf("list postgres schema objects: %w", err)
	}
	defer rows.Close()

	var objects []domain.ExplorerObject
	for rows.Next() {
		var object domain.ExplorerObject
		object.Schema = schema
		if err := rows.Scan(&object.Name, &object.Kind); err != nil {
			return nil, fmt.Errorf("scan postgres schema object: %w", err)
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres schema objects: %w", err)
	}
	return objects, nil
}

func (e *Explorer) GetTableInfo(ctx context.Context, database string, schema string, table string) (domain.TableInfo, error) {
	if schema == "" {
		return domain.TableInfo{}, fmt.Errorf("schema cannot be empty")
	}
	if table == "" {
		return domain.TableInfo{}, fmt.Errorf("table cannot be empty")
	}

	conn, err := e.open(ctx, database)
	if err != nil {
		return domain.TableInfo{}, err
	}
	defer conn.Close(ctx)

	var oid uint32
	var relkind string
	var resolvedDatabase string
	if err := conn.QueryRow(ctx, `
select c.oid, c.relkind::text, current_database()
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = $1
  and c.relname = $2
  and c.relkind in ('r', 'p', 'v', 'm')`, schema, table).Scan(&oid, &relkind, &resolvedDatabase); err != nil {
		if err == pgx.ErrNoRows {
			return domain.TableInfo{}, fmt.Errorf("table or view %q.%q not found", schema, table)
		}
		return domain.TableInfo{}, fmt.Errorf("lookup postgres table info: %w", err)
	}

	columns, err := e.loadTableColumns(ctx, conn, oid)
	if err != nil {
		return domain.TableInfo{}, err
	}

	indexes, err := e.loadTableIndexes(ctx, conn, oid)
	if err != nil {
		return domain.TableInfo{}, err
	}

	primaryKeyColumns := primaryKeyColumnSet(indexes)
	for i := range columns {
		columns[i].PrimaryKey = primaryKeyColumns[columns[i].Name]
	}

	info := domain.TableInfo{
		Database: resolvedDatabase,
		Schema:   schema,
		Name:     table,
		Kind:     postgresRelKindToExplorerKind(relkind),
		Columns:  columns,
		Indexes:  indexes,
	}
	info.Editability = decideTableEditability(info)
	return info, nil
}

func (e *Explorer) GetObjectInfo(ctx context.Context, database string, schema string, name string, kind domain.ExplorerObjectKind) (domain.ObjectInfo, error) {
	switch kind {
	case domain.ExplorerObjectKindTable, domain.ExplorerObjectKindView, domain.ExplorerObjectKindMaterializedView:
		tableInfo, err := e.GetTableInfo(ctx, database, schema, name)
		if err != nil {
			return domain.ObjectInfo{}, err
		}
		return objectInfoFromTableInfo(tableInfo), nil
	case domain.ExplorerObjectKindSequence:
		return e.getSequenceInfo(ctx, database, schema, name)
	case domain.ExplorerObjectKindFunction:
		return e.getFunctionInfo(ctx, database, schema, name)
	default:
		return domain.ObjectInfo{}, fmt.Errorf("unsupported object kind %q", kind)
	}
}

func (e *Explorer) getSequenceInfo(ctx context.Context, database string, schema string, sequence string) (domain.ObjectInfo, error) {
	if schema == "" {
		return domain.ObjectInfo{}, fmt.Errorf("schema cannot be empty")
	}
	if sequence == "" {
		return domain.ObjectInfo{}, fmt.Errorf("sequence cannot be empty")
	}

	conn, err := e.open(ctx, database)
	if err != nil {
		return domain.ObjectInfo{}, err
	}
	defer conn.Close(ctx)

	var resolvedDatabase string
	info := domain.ObjectInfo{
		Schema: schema,
		Name:   sequence,
		Kind:   domain.ExplorerObjectKindSequence,
	}
	if err := conn.QueryRow(ctx, `
select current_database(),
       s.data_type,
       s.start_value::text,
       s.min_value::text,
       s.max_value::text,
       s.increment_by::text,
       s.cycle,
       s.cache_size::text,
       coalesce(s.last_value::text, '')
from pg_sequences s
where s.schemaname = $1
  and s.sequencename = $2`, schema, sequence).Scan(
		&resolvedDatabase,
		&info.Sequence.DataType,
		&info.Sequence.StartValue,
		&info.Sequence.MinValue,
		&info.Sequence.MaxValue,
		&info.Sequence.IncrementBy,
		&info.Sequence.Cycle,
		&info.Sequence.CacheSize,
		&info.Sequence.LastValue,
	); err != nil {
		if err == pgx.ErrNoRows {
			return domain.ObjectInfo{}, fmt.Errorf("sequence %q.%q not found", schema, sequence)
		}
		return domain.ObjectInfo{}, fmt.Errorf("lookup postgres sequence info: %w", err)
	}

	info.Database = resolvedDatabase
	info.Details = []domain.ObjectDetail{
		{Name: "Kind", Value: "Sequence"},
		{Name: "Data type", Value: info.Sequence.DataType},
		{Name: "Start", Value: info.Sequence.StartValue},
		{Name: "Minimum", Value: info.Sequence.MinValue},
		{Name: "Maximum", Value: info.Sequence.MaxValue},
		{Name: "Increment", Value: info.Sequence.IncrementBy},
		{Name: "Cycle", Value: formatBool(info.Sequence.Cycle)},
		{Name: "Cache", Value: info.Sequence.CacheSize},
		{Name: "Last value", Value: emptyFallback(info.Sequence.LastValue, "Unavailable")},
	}
	return info, nil
}

func (e *Explorer) getFunctionInfo(ctx context.Context, database string, schema string, function string) (domain.ObjectInfo, error) {
	if schema == "" {
		return domain.ObjectInfo{}, fmt.Errorf("schema cannot be empty")
	}
	if function == "" {
		return domain.ObjectInfo{}, fmt.Errorf("function cannot be empty")
	}

	conn, err := e.open(ctx, database)
	if err != nil {
		return domain.ObjectInfo{}, err
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
select current_database(),
       p.proname,
       pg_get_function_identity_arguments(p.oid),
       pg_get_function_result(p.oid),
       l.lanname,
       case p.provolatile
         when 'i' then 'immutable'
         when 's' then 'stable'
         when 'v' then 'volatile'
       end,
       p.proretset
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = $1
  and p.proname = $2
order by p.proname, pg_get_function_identity_arguments(p.oid)`, schema, function)
	if err != nil {
		return domain.ObjectInfo{}, fmt.Errorf("lookup postgres function info: %w", err)
	}
	defer rows.Close()

	info := domain.ObjectInfo{
		Schema: schema,
		Name:   function,
		Kind:   domain.ExplorerObjectKindFunction,
	}
	for rows.Next() {
		var resolvedDatabase string
		var fn domain.FunctionInfo
		if err := rows.Scan(
			&resolvedDatabase,
			&fn.Name,
			&fn.Arguments,
			&fn.ResultType,
			&fn.Language,
			&fn.Volatility,
			&fn.ReturnsSet,
		); err != nil {
			return domain.ObjectInfo{}, fmt.Errorf("scan postgres function info: %w", err)
		}
		info.Database = resolvedDatabase
		info.Functions = append(info.Functions, fn)
	}
	if err := rows.Err(); err != nil {
		return domain.ObjectInfo{}, fmt.Errorf("iterate postgres function info: %w", err)
	}
	if len(info.Functions) == 0 {
		return domain.ObjectInfo{}, fmt.Errorf("function %q.%q not found", schema, function)
	}

	info.Details = []domain.ObjectDetail{
		{Name: "Kind", Value: "Function"},
		{Name: "Overloads", Value: fmt.Sprintf("%d", len(info.Functions))},
	}
	return info, nil
}

func (e *Explorer) loadTableColumns(ctx context.Context, conn *pgx.Conn, oid uint32) ([]domain.TableColumnInfo, error) {
	rows, err := conn.Query(ctx, `
select a.attnum,
       a.attname,
       format_type(a.atttypid, a.atttypmod),
       t.typname,
       not a.attnotnull as nullable,
       coalesce(pg_get_expr(ad.adbin, ad.adrelid), '') as default_expr,
       a.attidentity::text,
       a.attgenerated::text
from pg_attribute a
join pg_type t on t.oid = a.atttypid
left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
where a.attrelid = $1
  and a.attnum > 0
  and not a.attisdropped
order by a.attnum`, oid)
	if err != nil {
		return nil, fmt.Errorf("list postgres table columns: %w", err)
	}
	defer rows.Close()

	var columns []domain.TableColumnInfo
	for rows.Next() {
		var column domain.TableColumnInfo
		if err := rows.Scan(
			&column.Position,
			&column.Name,
			&column.DataType,
			&column.TypeName,
			&column.Nullable,
			&column.Default,
			&column.Identity,
			&column.Generated,
		); err != nil {
			return nil, fmt.Errorf("scan postgres table column: %w", err)
		}
		columns = append(columns, column)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres table columns: %w", err)
	}
	return columns, nil
}

func (e *Explorer) loadTableIndexes(ctx context.Context, conn *pgx.Conn, oid uint32) ([]domain.TableIndexInfo, error) {
	rows, err := conn.Query(ctx, `
select i.relname,
       ix.indisprimary,
       ix.indisunique,
       ix.indpred is not null as partial,
       exists (
         select 1
         from unnest(ix.indkey) key_attnum
         where key_attnum = 0
       ) as has_expression,
       ix.indisvalid,
       coalesce(array_agg(a.attname order by key_column.ordinality) filter (where a.attname is not null), '{}') as columns
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
left join unnest(ix.indkey) with ordinality as key_column(attnum, ordinality) on true
left join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = key_column.attnum
where ix.indrelid = $1
group by i.relname, ix.indisprimary, ix.indisunique, ix.indpred, ix.indisvalid, ix.indkey
order by ix.indisprimary desc, ix.indisunique desc, i.relname`, oid)
	if err != nil {
		return nil, fmt.Errorf("list postgres table indexes: %w", err)
	}
	defer rows.Close()

	var indexes []domain.TableIndexInfo
	for rows.Next() {
		var index domain.TableIndexInfo
		if err := rows.Scan(
			&index.Name,
			&index.Primary,
			&index.Unique,
			&index.Partial,
			&index.HasExpression,
			&index.Valid,
			&index.Columns,
		); err != nil {
			return nil, fmt.Errorf("scan postgres table index: %w", err)
		}
		indexes = append(indexes, index)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres table indexes: %w", err)
	}
	return indexes, nil
}

func (e *Explorer) open(ctx context.Context, database string) (*pgx.Conn, error) {
	cfg, err := buildConnConfig(e.profile, database)
	if err != nil {
		return nil, err
	}

	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open postgres explorer connection: %w", err)
	}
	return conn, nil
}

func postgresRelKindToExplorerKind(relkind string) domain.ExplorerObjectKind {
	switch relkind {
	case "v":
		return domain.ExplorerObjectKindView
	case "m":
		return domain.ExplorerObjectKindMaterializedView
	default:
		return domain.ExplorerObjectKindTable
	}
}

func primaryKeyColumnSet(indexes []domain.TableIndexInfo) map[string]bool {
	columns := make(map[string]bool)
	for _, index := range indexes {
		if !index.Primary {
			continue
		}
		for _, column := range index.Columns {
			columns[column] = true
		}
		return columns
	}
	return columns
}

func decideTableEditability(info domain.TableInfo) domain.TableEditabilityInfo {
	if info.Kind != domain.ExplorerObjectKindTable {
		return domain.TableEditabilityInfo{
			Editable: false,
			Strategy: "read_only_object",
			Reason:   "Only base tables and partitioned tables are editable.",
		}
	}

	columnNullable := make(map[string]bool, len(info.Columns))
	for _, column := range info.Columns {
		columnNullable[column.Name] = column.Nullable
	}

	for _, index := range info.Indexes {
		if index.Primary && index.Valid && len(index.Columns) > 0 {
			return domain.TableEditabilityInfo{
				Editable:   true,
				Strategy:   "primary_key",
				Reason:     "Rows can be identified by the primary key.",
				KeyColumns: index.Columns,
			}
		}
	}

	for _, index := range info.Indexes {
		if !index.Unique || !index.Valid || index.Primary || index.Partial || index.HasExpression || len(index.Columns) == 0 {
			continue
		}

		allNotNull := true
		for _, column := range index.Columns {
			if columnNullable[column] {
				allNotNull = false
				break
			}
		}
		if !allNotNull {
			continue
		}

		return domain.TableEditabilityInfo{
			Editable:   true,
			Strategy:   "unique_not_null_index",
			Reason:     "Rows can be identified by a unique index whose columns are all NOT NULL.",
			KeyColumns: index.Columns,
		}
	}

	return domain.TableEditabilityInfo{
		Editable: false,
		Strategy: "no_stable_row_identifier",
		Reason:   "No primary key or non-partial unique NOT NULL index was found.",
	}
}

func objectInfoFromTableInfo(tableInfo domain.TableInfo) domain.ObjectInfo {
	kindLabel := "Table"
	switch tableInfo.Kind {
	case domain.ExplorerObjectKindView:
		kindLabel = "View"
	case domain.ExplorerObjectKindMaterializedView:
		kindLabel = "Materialized view"
	}

	details := []domain.ObjectDetail{
		{Name: "Kind", Value: kindLabel},
		{Name: "Columns", Value: fmt.Sprintf("%d", len(tableInfo.Columns))},
		{Name: "Indexes", Value: fmt.Sprintf("%d", len(tableInfo.Indexes))},
		{Name: "Editable", Value: formatBool(tableInfo.Editability.Editable)},
	}
	if tableInfo.Editability.Reason != "" {
		details = append(details, domain.ObjectDetail{Name: "Editability", Value: tableInfo.Editability.Reason})
	}

	return domain.ObjectInfo{
		Database:    tableInfo.Database,
		Schema:      tableInfo.Schema,
		Name:        tableInfo.Name,
		Kind:        tableInfo.Kind,
		Details:     details,
		Columns:     tableInfo.Columns,
		Indexes:     tableInfo.Indexes,
		Editability: tableInfo.Editability,
	}
}

func formatBool(value bool) string {
	if value {
		return "Yes"
	}
	return "No"
}

func emptyFallback(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
