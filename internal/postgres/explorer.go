package postgres

import (
	"context"
	"fmt"
	"strings"

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

  union all

  select t.typname as name, 'type' as kind
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  left join pg_class c on c.oid = t.typrelid
  where n.nspname = $1
    and t.typcategory <> 'A'
    and (
      t.typtype in ('b', 'd', 'e', 'm', 'r')
      or (t.typtype = 'c' and c.relkind = 'c')
    )
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

	foreignKeys, err := e.loadTableForeignKeys(ctx, conn, oid)
	if err != nil {
		return domain.TableInfo{}, err
	}

	referencedBy, err := e.loadTableReferences(ctx, conn, oid)
	if err != nil {
		return domain.TableInfo{}, err
	}

	primaryKeyColumns := primaryKeyColumnSet(indexes)
	for i := range columns {
		columns[i].PrimaryKey = primaryKeyColumns[columns[i].Name]
	}

	info := domain.TableInfo{
		Database:     resolvedDatabase,
		Schema:       schema,
		Name:         table,
		Kind:         postgresRelKindToExplorerKind(relkind),
		Columns:      columns,
		Indexes:      indexes,
		ForeignKeys:  foreignKeys,
		ReferencedBy: referencedBy,
	}
	info.Editability = decideTableEditability(info)
	info.DDL, err = e.buildRelationDDL(ctx, conn, oid, info)
	if err != nil {
		return domain.TableInfo{}, err
	}
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
	case domain.ExplorerObjectKindType:
		return e.getTypeInfo(ctx, database, schema, name)
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
	info.DDL = sequenceDDL(info)
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
       p.proretset,
       pg_get_functiondef(p.oid)
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
		var ddl string
		if err := rows.Scan(
			&resolvedDatabase,
			&fn.Name,
			&fn.Arguments,
			&fn.ResultType,
			&fn.Language,
			&fn.Volatility,
			&fn.ReturnsSet,
			&ddl,
		); err != nil {
			return domain.ObjectInfo{}, fmt.Errorf("scan postgres function info: %w", err)
		}
		info.Database = resolvedDatabase
		info.Functions = append(info.Functions, fn)
		if strings.TrimSpace(ddl) != "" {
			if info.DDL != "" {
				info.DDL += "\n\n"
			}
			info.DDL += strings.TrimSpace(ddl)
		}
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

func (e *Explorer) getTypeInfo(ctx context.Context, database string, schema string, name string) (domain.ObjectInfo, error) {
	if schema == "" {
		return domain.ObjectInfo{}, fmt.Errorf("schema cannot be empty")
	}
	if name == "" {
		return domain.ObjectInfo{}, fmt.Errorf("type cannot be empty")
	}

	conn, err := e.open(ctx, database)
	if err != nil {
		return domain.ObjectInfo{}, err
	}
	defer conn.Close(ctx)

	var oid uint32
	var typrelid uint32
	var typtype string
	var resolvedDatabase string
	var rangeType string
	if err := conn.QueryRow(ctx, `
select t.oid,
       t.typrelid,
       t.typtype::text,
       current_database(),
       coalesce(range_type.typname, '')
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
left join pg_range multirange on multirange.rngmultitypid = t.oid
left join pg_type range_type on range_type.oid = multirange.rngtypid
where n.nspname = $1
  and t.typname = $2`, schema, name).Scan(&oid, &typrelid, &typtype, &resolvedDatabase, &rangeType); err != nil {
		if err == pgx.ErrNoRows {
			return domain.ObjectInfo{}, fmt.Errorf("type %q.%q not found", schema, name)
		}
		return domain.ObjectInfo{}, fmt.Errorf("lookup postgres type info: %w", err)
	}

	info := domain.ObjectInfo{
		Database: resolvedDatabase,
		Schema:   schema,
		Name:     name,
		Kind:     domain.ExplorerObjectKindType,
	}

	switch typtype {
	case "e":
		labels, err := e.loadEnumLabels(ctx, conn, oid)
		if err != nil {
			return domain.ObjectInfo{}, err
		}
		info.Type = domain.TypeInfo{Category: "Enum", Labels: labels}
		info.DDL = enumTypeDDL(info)
	case "d":
		typeInfo, err := e.loadDomainInfo(ctx, conn, oid)
		if err != nil {
			return domain.ObjectInfo{}, err
		}
		info.Type = typeInfo
		info.DDL = domainTypeDDL(info)
	case "c":
		attributes, err := e.loadCompositeTypeAttributes(ctx, conn, typrelid)
		if err != nil {
			return domain.ObjectInfo{}, err
		}
		info.Type = domain.TypeInfo{Category: "Composite", Attributes: attributes}
		info.DDL = compositeTypeDDL(info)
	case "r":
		typeInfo, err := e.loadRangeTypeInfo(ctx, conn, oid)
		if err != nil {
			return domain.ObjectInfo{}, err
		}
		info.Type = typeInfo
		info.DDL = rangeTypeDDL(info)
	case "m":
		info.Type = domain.TypeInfo{Category: "Multirange", Subtype: rangeType}
		info.DDL = multirangeTypeDDL(info)
	default:
		typeInfo, err := e.loadBaseTypeInfo(ctx, conn, oid)
		if err != nil {
			return domain.ObjectInfo{}, err
		}
		info.Type = typeInfo
		info.DDL = baseTypeDDL(info)
	}

	usages, err := e.loadTypeUsages(ctx, conn, oid)
	if err != nil {
		return domain.ObjectInfo{}, err
	}
	info.Type.Usages = usages
	info.Details = typeDetails(info)
	return info, nil
}

func (e *Explorer) loadTypeUsages(ctx context.Context, conn *pgx.Conn, oid uint32) ([]domain.TypeUsageInfo, error) {
	rows, err := conn.Query(ctx, `
select n.nspname,
       c.relname,
       case c.relkind
         when 'r' then 'table'
         when 'p' then 'table'
         when 'v' then 'view'
         when 'm' then 'materialized_view'
       end as kind,
       a.attname,
       format_type(a.atttypid, a.atttypmod),
       not a.attnotnull as nullable,
       coalesce(pg_get_expr(ad.adbin, ad.adrelid), '') as default_expr,
       coalesce(d.description, '') as comment
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_type t on t.oid = a.atttypid
left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
left join pg_description d on d.objoid = a.attrelid and d.objsubid = a.attnum
where a.attnum > 0
  and not a.attisdropped
  and c.relkind in ('r', 'p', 'v', 'm')
  and (a.atttypid = $1 or t.typelem = $1)
order by n.nspname, c.relname, a.attnum`, oid)
	if err != nil {
		return nil, fmt.Errorf("list postgres type usages: %w", err)
	}
	defer rows.Close()

	var usages []domain.TypeUsageInfo
	for rows.Next() {
		var usage domain.TypeUsageInfo
		if err := rows.Scan(
			&usage.Schema,
			&usage.Object,
			&usage.Kind,
			&usage.Column,
			&usage.DataType,
			&usage.Nullable,
			&usage.Default,
			&usage.Comment,
		); err != nil {
			return nil, fmt.Errorf("scan postgres type usage: %w", err)
		}
		usages = append(usages, usage)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres type usages: %w", err)
	}
	return usages, nil
}

func (e *Explorer) loadEnumLabels(ctx context.Context, conn *pgx.Conn, oid uint32) ([]string, error) {
	rows, err := conn.Query(ctx, `
select enumlabel
from pg_enum
where enumtypid = $1
order by enumsortorder`, oid)
	if err != nil {
		return nil, fmt.Errorf("list postgres enum labels: %w", err)
	}
	defer rows.Close()

	var labels []string
	for rows.Next() {
		var label string
		if err := rows.Scan(&label); err != nil {
			return nil, fmt.Errorf("scan postgres enum label: %w", err)
		}
		labels = append(labels, label)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres enum labels: %w", err)
	}
	return labels, nil
}

func (e *Explorer) loadDomainInfo(ctx context.Context, conn *pgx.Conn, oid uint32) (domain.TypeInfo, error) {
	var info domain.TypeInfo
	info.Category = "Domain"
	if err := conn.QueryRow(ctx, `
select format_type(t.typbasetype, t.typtypmod),
       t.typnotnull,
       coalesce(t.typdefault, ''),
       coalesce(string_agg(pg_get_constraintdef(c.oid, true), E'\n' order by c.conname), '')
from pg_type t
left join pg_constraint c on c.contypid = t.oid and c.contype = 'c'
where t.oid = $1
group by t.typbasetype, t.typtypmod, t.typnotnull, t.typdefault`, oid).Scan(&info.BaseType, &info.NotNull, &info.Default, &info.Check); err != nil {
		return domain.TypeInfo{}, fmt.Errorf("load postgres domain info: %w", err)
	}
	return info, nil
}

func (e *Explorer) loadCompositeTypeAttributes(ctx context.Context, conn *pgx.Conn, typrelid uint32) ([]domain.TableColumnInfo, error) {
	rows, err := conn.Query(ctx, `
select a.attnum,
       a.attname,
       format_type(a.atttypid, a.atttypmod),
       tn.nspname,
       t.typname,
       not a.attnotnull as nullable,
       coalesce(d.description, '') as comment
from pg_attribute a
join pg_type t on t.oid = a.atttypid
join pg_namespace tn on tn.oid = t.typnamespace
left join pg_description d on d.objoid = a.attrelid and d.objsubid = a.attnum
where a.attrelid = $1
  and a.attnum > 0
  and not a.attisdropped
order by a.attnum`, typrelid)
	if err != nil {
		return nil, fmt.Errorf("list postgres composite type attributes: %w", err)
	}
	defer rows.Close()

	var attributes []domain.TableColumnInfo
	for rows.Next() {
		var attribute domain.TableColumnInfo
		if err := rows.Scan(&attribute.Position, &attribute.Name, &attribute.DataType, &attribute.TypeSchema, &attribute.TypeName, &attribute.Nullable, &attribute.Comment); err != nil {
			return nil, fmt.Errorf("scan postgres composite type attribute: %w", err)
		}
		attributes = append(attributes, attribute)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres composite type attributes: %w", err)
	}
	return attributes, nil
}

func (e *Explorer) loadRangeTypeInfo(ctx context.Context, conn *pgx.Conn, oid uint32) (domain.TypeInfo, error) {
	var info domain.TypeInfo
	info.Category = "Range"
	if err := conn.QueryRow(ctx, `
select format_type(r.rngsubtype, null),
       coalesce(nullif(r.rngcanonical::regproc::text, '-'), ''),
       coalesce(nullif(r.rngsubdiff::regproc::text, '-'), '')
from pg_range r
where r.rngtypid = $1`, oid).Scan(&info.Subtype, &info.Canonical, &info.SubtypeDiff); err != nil {
		return domain.TypeInfo{}, fmt.Errorf("load postgres range type info: %w", err)
	}
	return info, nil
}

func (e *Explorer) loadBaseTypeInfo(ctx context.Context, conn *pgx.Conn, oid uint32) (domain.TypeInfo, error) {
	var info domain.TypeInfo
	info.Category = "Base"
	if err := conn.QueryRow(ctx, `
select t.typinput::regproc::text,
       t.typoutput::regproc::text,
       coalesce(nullif(format_type(t.typelem, null), '-'), '')
from pg_type t
where t.oid = $1`, oid).Scan(&info.InputType, &info.BaseType, &info.ElementType); err != nil {
		return domain.TypeInfo{}, fmt.Errorf("load postgres base type info: %w", err)
	}
	return info, nil
}

func sequenceDDL(info domain.ObjectInfo) string {
	parts := []string{
		"CREATE SEQUENCE " + quoteQualifiedIdentifier(info.Schema, info.Name),
		"AS " + info.Sequence.DataType,
		"INCREMENT BY " + info.Sequence.IncrementBy,
		"MINVALUE " + info.Sequence.MinValue,
		"MAXVALUE " + info.Sequence.MaxValue,
		"START WITH " + info.Sequence.StartValue,
		"CACHE " + info.Sequence.CacheSize,
	}
	if info.Sequence.Cycle {
		parts = append(parts, "CYCLE")
	} else {
		parts = append(parts, "NO CYCLE")
	}
	return strings.Join(parts, "\n") + ";"
}

func enumTypeDDL(info domain.ObjectInfo) string {
	labels := make([]string, 0, len(info.Type.Labels))
	for _, label := range info.Type.Labels {
		labels = append(labels, quotePostgresLiteral(label))
	}
	return fmt.Sprintf("CREATE TYPE %s AS ENUM (%s);", quoteQualifiedIdentifier(info.Schema, info.Name), strings.Join(labels, ", "))
}

func domainTypeDDL(info domain.ObjectInfo) string {
	parts := []string{
		"CREATE DOMAIN " + quoteQualifiedIdentifier(info.Schema, info.Name),
		"AS " + info.Type.BaseType,
	}
	if info.Type.Default != "" {
		parts = append(parts, "DEFAULT "+info.Type.Default)
	}
	if info.Type.NotNull {
		parts = append(parts, "NOT NULL")
	}
	if info.Type.Check != "" {
		for _, check := range strings.Split(info.Type.Check, "\n") {
			parts = append(parts, check)
		}
	}
	return strings.Join(parts, "\n") + ";"
}

func compositeTypeDDL(info domain.ObjectInfo) string {
	lines := make([]string, 0, len(info.Type.Attributes))
	for _, attribute := range info.Type.Attributes {
		lines = append(lines, fmt.Sprintf("  %s %s", quotePostgresIdentifier(attribute.Name), attribute.DataType))
	}
	return fmt.Sprintf("CREATE TYPE %s AS (\n%s\n);", quoteQualifiedIdentifier(info.Schema, info.Name), strings.Join(lines, ",\n"))
}

func rangeTypeDDL(info domain.ObjectInfo) string {
	parts := []string{"SUBTYPE = " + info.Type.Subtype}
	if info.Type.Canonical != "" {
		parts = append(parts, "CANONICAL = "+info.Type.Canonical)
	}
	if info.Type.SubtypeDiff != "" {
		parts = append(parts, "SUBTYPE_DIFF = "+info.Type.SubtypeDiff)
	}
	return fmt.Sprintf("CREATE TYPE %s AS RANGE (\n  %s\n);", quoteQualifiedIdentifier(info.Schema, info.Name), strings.Join(parts, ",\n  "))
}

func multirangeTypeDDL(info domain.ObjectInfo) string {
	if info.Type.Subtype == "" {
		return ""
	}
	return fmt.Sprintf("CREATE TYPE %s AS MULTIRANGE (\n  RANGE = %s\n);", quoteQualifiedIdentifier(info.Schema, info.Name), quotePostgresIdentifier(info.Type.Subtype))
}

func baseTypeDDL(info domain.ObjectInfo) string {
	if info.Type.InputType == "" || info.Type.BaseType == "" {
		return ""
	}
	parts := []string{
		"INPUT = " + info.Type.InputType,
		"OUTPUT = " + info.Type.BaseType,
	}
	if info.Type.ElementType != "" {
		parts = append(parts, "ELEMENT = "+info.Type.ElementType)
	}
	return fmt.Sprintf("CREATE TYPE %s (\n  %s\n);", quoteQualifiedIdentifier(info.Schema, info.Name), strings.Join(parts, ",\n  "))
}

func typeDetails(info domain.ObjectInfo) []domain.ObjectDetail {
	details := []domain.ObjectDetail{
		{Name: "Kind", Value: "Type"},
		{Name: "Category", Value: info.Type.Category},
	}
	switch info.Type.Category {
	case "Enum":
		details = append(details, domain.ObjectDetail{Name: "Labels", Value: fmt.Sprintf("%d", len(info.Type.Labels))})
	case "Domain":
		details = append(details,
			domain.ObjectDetail{Name: "Base type", Value: info.Type.BaseType},
			domain.ObjectDetail{Name: "Not null", Value: formatBool(info.Type.NotNull)},
		)
	case "Composite":
		details = append(details, domain.ObjectDetail{Name: "Attributes", Value: fmt.Sprintf("%d", len(info.Type.Attributes))})
	case "Range":
		details = append(details, domain.ObjectDetail{Name: "Subtype", Value: info.Type.Subtype})
	case "Multirange":
		details = append(details, domain.ObjectDetail{Name: "Range", Value: info.Type.Subtype})
	case "Base":
		details = append(details,
			domain.ObjectDetail{Name: "Input", Value: info.Type.InputType},
			domain.ObjectDetail{Name: "Output", Value: info.Type.BaseType},
		)
	}
	details = append(details, domain.ObjectDetail{Name: "Used by", Value: fmt.Sprintf("%d", len(info.Type.Usages))})
	return details
}

func (e *Explorer) loadTableColumns(ctx context.Context, conn *pgx.Conn, oid uint32) ([]domain.TableColumnInfo, error) {
	rows, err := conn.Query(ctx, `
select a.attnum,
       a.attname,
       format_type(a.atttypid, a.atttypmod),
       tn.nspname,
       t.typname,
       not a.attnotnull as nullable,
       coalesce(pg_get_expr(ad.adbin, ad.adrelid), '') as default_expr,
       coalesce(d.description, '') as comment,
       a.attidentity::text,
       a.attgenerated::text
from pg_attribute a
join pg_type t on t.oid = a.atttypid
join pg_namespace tn on tn.oid = t.typnamespace
left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
left join pg_description d on d.objoid = a.attrelid and d.objsubid = a.attnum
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
			&column.TypeSchema,
			&column.TypeName,
			&column.Nullable,
			&column.Default,
			&column.Comment,
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
       pg_get_indexdef(i.oid),
       coalesce(array_agg(a.attname order by key_column.ordinality) filter (where a.attname is not null), '{}') as columns
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
left join unnest(ix.indkey) with ordinality as key_column(attnum, ordinality) on true
left join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = key_column.attnum
where ix.indrelid = $1
group by i.oid, i.relname, ix.indisprimary, ix.indisunique, ix.indpred, ix.indisvalid, ix.indkey
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
			&index.Definition,
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

func (e *Explorer) loadTableForeignKeys(ctx context.Context, conn *pgx.Conn, oid uint32) ([]domain.TableForeignKeyInfo, error) {
	rows, err := conn.Query(ctx, `
select c.conname,
       coalesce(array_agg(src.attname order by source_column.ordinality), '{}') as columns,
       target_namespace.nspname,
       target_table.relname,
       coalesce(array_agg(target.attname order by target_column.ordinality), '{}') as referenced_columns,
       case c.confupdtype
         when 'a' then 'no action'
         when 'r' then 'restrict'
         when 'c' then 'cascade'
         when 'n' then 'set null'
         when 'd' then 'set default'
       end as update_action,
       case c.confdeltype
         when 'a' then 'no action'
         when 'r' then 'restrict'
         when 'c' then 'cascade'
         when 'n' then 'set null'
         when 'd' then 'set default'
       end as delete_action,
       case c.confmatchtype
         when 'f' then 'full'
         when 'p' then 'partial'
         when 's' then 'simple'
       end as match_type,
       c.condeferrable,
       c.condeferred,
       pg_get_constraintdef(c.oid, true)
from pg_constraint c
join pg_class target_table on target_table.oid = c.confrelid
join pg_namespace target_namespace on target_namespace.oid = target_table.relnamespace
left join unnest(c.conkey) with ordinality as source_column(attnum, ordinality) on true
left join unnest(c.confkey) with ordinality as target_column(attnum, ordinality) on target_column.ordinality = source_column.ordinality
left join pg_attribute src on src.attrelid = c.conrelid and src.attnum = source_column.attnum
left join pg_attribute target on target.attrelid = c.confrelid and target.attnum = target_column.attnum
where c.conrelid = $1
  and c.contype = 'f'
group by c.oid, c.conname, target_namespace.nspname, target_table.relname, c.confupdtype, c.confdeltype, c.confmatchtype, c.condeferrable, c.condeferred
order by c.conname`, oid)
	if err != nil {
		return nil, fmt.Errorf("list postgres table foreign keys: %w", err)
	}
	defer rows.Close()

	var foreignKeys []domain.TableForeignKeyInfo
	for rows.Next() {
		var foreignKey domain.TableForeignKeyInfo
		if err := rows.Scan(
			&foreignKey.Name,
			&foreignKey.Columns,
			&foreignKey.ReferencedSchema,
			&foreignKey.ReferencedTable,
			&foreignKey.ReferencedColumns,
			&foreignKey.UpdateAction,
			&foreignKey.DeleteAction,
			&foreignKey.MatchType,
			&foreignKey.Deferrable,
			&foreignKey.InitiallyDeferred,
			&foreignKey.Definition,
		); err != nil {
			return nil, fmt.Errorf("scan postgres table foreign key: %w", err)
		}
		foreignKeys = append(foreignKeys, foreignKey)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres table foreign keys: %w", err)
	}
	return foreignKeys, nil
}

func (e *Explorer) loadTableReferences(ctx context.Context, conn *pgx.Conn, oid uint32) ([]domain.TableReferenceInfo, error) {
	rows, err := conn.Query(ctx, `
select c.conname,
       source_namespace.nspname,
       source_table.relname,
       coalesce(array_agg(src.attname order by source_column.ordinality), '{}') as columns,
       coalesce(array_agg(target.attname order by target_column.ordinality), '{}') as referenced_columns,
       case c.confupdtype
         when 'a' then 'no action'
         when 'r' then 'restrict'
         when 'c' then 'cascade'
         when 'n' then 'set null'
         when 'd' then 'set default'
       end as update_action,
       case c.confdeltype
         when 'a' then 'no action'
         when 'r' then 'restrict'
         when 'c' then 'cascade'
         when 'n' then 'set null'
         when 'd' then 'set default'
       end as delete_action,
       case c.confmatchtype
         when 'f' then 'full'
         when 'p' then 'partial'
         when 's' then 'simple'
       end as match_type,
       c.condeferrable,
       c.condeferred,
       pg_get_constraintdef(c.oid, true)
from pg_constraint c
join pg_class source_table on source_table.oid = c.conrelid
join pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
left join unnest(c.conkey) with ordinality as source_column(attnum, ordinality) on true
left join unnest(c.confkey) with ordinality as target_column(attnum, ordinality) on target_column.ordinality = source_column.ordinality
left join pg_attribute src on src.attrelid = c.conrelid and src.attnum = source_column.attnum
left join pg_attribute target on target.attrelid = c.confrelid and target.attnum = target_column.attnum
where c.confrelid = $1
  and c.contype = 'f'
group by c.oid, c.conname, source_namespace.nspname, source_table.relname, c.confupdtype, c.confdeltype, c.confmatchtype, c.condeferrable, c.condeferred
order by source_namespace.nspname, source_table.relname, c.conname`, oid)
	if err != nil {
		return nil, fmt.Errorf("list postgres table references: %w", err)
	}
	defer rows.Close()

	var references []domain.TableReferenceInfo
	for rows.Next() {
		var reference domain.TableReferenceInfo
		if err := rows.Scan(
			&reference.Name,
			&reference.Schema,
			&reference.Table,
			&reference.Columns,
			&reference.ReferencedColumns,
			&reference.UpdateAction,
			&reference.DeleteAction,
			&reference.MatchType,
			&reference.Deferrable,
			&reference.InitiallyDeferred,
			&reference.Definition,
		); err != nil {
			return nil, fmt.Errorf("scan postgres table reference: %w", err)
		}
		references = append(references, reference)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres table references: %w", err)
	}
	return references, nil
}

func (e *Explorer) buildRelationDDL(ctx context.Context, conn *pgx.Conn, oid uint32, info domain.TableInfo) (string, error) {
	qualifiedName := quoteQualifiedIdentifier(info.Schema, info.Name)

	switch info.Kind {
	case domain.ExplorerObjectKindView, domain.ExplorerObjectKindMaterializedView:
		var viewDefinition string
		if err := conn.QueryRow(ctx, `select pg_get_viewdef($1::oid, true)`, oid).Scan(&viewDefinition); err != nil {
			return "", fmt.Errorf("load postgres view ddl: %w", err)
		}
		statement := "CREATE VIEW"
		if info.Kind == domain.ExplorerObjectKindMaterializedView {
			statement = "CREATE MATERIALIZED VIEW"
		}
		return fmt.Sprintf("%s %s AS\n%s;", statement, qualifiedName, strings.TrimSpace(viewDefinition)), nil
	default:
		var lines []string
		for _, column := range info.Columns {
			lines = append(lines, "  "+columnDDL(column))
		}
		for _, index := range info.Indexes {
			if index.Primary {
				lines = append(lines, fmt.Sprintf("  CONSTRAINT %s PRIMARY KEY (%s)", quotePostgresIdentifier(index.Name), quotePostgresIdentifiers(index.Columns)))
				break
			}
		}
		for _, foreignKey := range info.ForeignKeys {
			lines = append(lines, fmt.Sprintf("  CONSTRAINT %s %s", quotePostgresIdentifier(foreignKey.Name), foreignKey.Definition))
		}

		var builder strings.Builder
		builder.WriteString("CREATE TABLE ")
		builder.WriteString(qualifiedName)
		builder.WriteString(" (\n")
		builder.WriteString(strings.Join(lines, ",\n"))
		builder.WriteString("\n);")

		for _, index := range info.Indexes {
			if index.Primary || index.Definition == "" {
				continue
			}
			builder.WriteString("\n\n")
			builder.WriteString(index.Definition)
			builder.WriteString(";")
		}
		return builder.String(), nil
	}
}

func columnDDL(column domain.TableColumnInfo) string {
	parts := []string{quotePostgresIdentifier(column.Name), column.DataType}
	if column.Identity != "" {
		identityKind := "BY DEFAULT"
		if column.Identity == "a" {
			identityKind = "ALWAYS"
		}
		parts = append(parts, "GENERATED", identityKind, "AS IDENTITY")
	} else if column.Generated != "" && column.Default != "" {
		parts = append(parts, "GENERATED ALWAYS AS ("+column.Default+") STORED")
	} else if column.Default != "" {
		parts = append(parts, "DEFAULT", column.Default)
	}
	if !column.Nullable {
		parts = append(parts, "NOT NULL")
	}
	return strings.Join(parts, " ")
}

func quoteQualifiedIdentifier(schema string, name string) string {
	if schema == "" {
		return quotePostgresIdentifier(name)
	}
	return quotePostgresIdentifier(schema) + "." + quotePostgresIdentifier(name)
}

func quotePostgresIdentifiers(values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, quotePostgresIdentifier(value))
	}
	return strings.Join(quoted, ", ")
}

func quotePostgresIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func quotePostgresLiteral(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `''`) + `'`
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
		{Name: "Foreign keys", Value: fmt.Sprintf("%d", len(tableInfo.ForeignKeys))},
		{Name: "References", Value: fmt.Sprintf("%d", len(tableInfo.ReferencedBy))},
		{Name: "Editable", Value: formatBool(tableInfo.Editability.Editable)},
	}
	if tableInfo.Editability.Reason != "" {
		details = append(details, domain.ObjectDetail{Name: "Editability", Value: tableInfo.Editability.Reason})
	}

	return domain.ObjectInfo{
		Database:     tableInfo.Database,
		Schema:       tableInfo.Schema,
		Name:         tableInfo.Name,
		Kind:         tableInfo.Kind,
		DDL:          tableInfo.DDL,
		Details:      details,
		Columns:      tableInfo.Columns,
		Indexes:      tableInfo.Indexes,
		ForeignKeys:  tableInfo.ForeignKeys,
		ReferencedBy: tableInfo.ReferencedBy,
		Editability:  tableInfo.Editability,
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
