package service

import (
	"context"
	"reflect"
	"testing"

	"dbx/internal/domain"
	"dbx/internal/driver"
)

type fakeExplorer struct {
	listDatabasesFn     func(context.Context) ([]domain.ExplorerDatabase, error)
	listSchemasFn       func(context.Context, string) ([]domain.ExplorerSchema, error)
	listSchemaObjectsFn func(context.Context, string, string) ([]domain.ExplorerObject, error)
	getTableInfoFn      func(context.Context, string, string, string) (domain.TableInfo, error)
	getObjectInfoFn     func(context.Context, string, string, string, domain.ExplorerObjectKind) (domain.ObjectInfo, error)
}

func (e *fakeExplorer) ListDatabases(ctx context.Context) ([]domain.ExplorerDatabase, error) {
	return e.listDatabasesFn(ctx)
}

func (e *fakeExplorer) ListSchemas(ctx context.Context, database string) ([]domain.ExplorerSchema, error) {
	return e.listSchemasFn(ctx, database)
}

func (e *fakeExplorer) ListSchemaObjects(ctx context.Context, database string, schema string) ([]domain.ExplorerObject, error) {
	return e.listSchemaObjectsFn(ctx, database, schema)
}

func (e *fakeExplorer) GetTableInfo(ctx context.Context, database string, schema string, table string) (domain.TableInfo, error) {
	return e.getTableInfoFn(ctx, database, schema, table)
}

func (e *fakeExplorer) GetObjectInfo(ctx context.Context, database string, schema string, name string, kind domain.ExplorerObjectKind) (domain.ObjectInfo, error) {
	return e.getObjectInfoFn(ctx, database, schema, name, kind)
}

func TestExplorerServiceDelegatesToDriverExplorer(t *testing.T) {
	registry := driver.NewRegistry()
	profile := domain.ConnProfile{ID: "profile_1", Kind: domain.ConnectionKindPostgres, Database: "postgres"}
	expectedDatabases := []domain.ExplorerDatabase{{Name: "postgres"}}
	expectedSchemas := []domain.ExplorerSchema{{Name: "public"}}
	expectedObjects := []domain.ExplorerObject{{Schema: "public", Name: "users", Kind: domain.ExplorerObjectKindTable}}
	expectedTableInfo := domain.TableInfo{
		Database: "postgres",
		Schema:   "public",
		Name:     "users",
		Kind:     domain.ExplorerObjectKindTable,
		Columns:  []domain.TableColumnInfo{{Name: "id", Position: 1, DataType: "integer", PrimaryKey: true}},
		Editability: domain.TableEditabilityInfo{
			Editable:   true,
			Strategy:   "primary_key",
			KeyColumns: []string{"id"},
		},
	}
	expectedObjectInfo := domain.ObjectInfo{
		Database: "postgres",
		Schema:   "public",
		Name:     "users",
		Kind:     domain.ExplorerObjectKindTable,
		Details:  []domain.ObjectDetail{{Name: "Kind", Value: "Table"}},
	}

	explorer := &fakeExplorer{
		listDatabasesFn: func(context.Context) ([]domain.ExplorerDatabase, error) {
			return expectedDatabases, nil
		},
		listSchemasFn: func(_ context.Context, database string) ([]domain.ExplorerSchema, error) {
			if database != "postgres" {
				t.Fatalf("unexpected database for schemas: %q", database)
			}
			return expectedSchemas, nil
		},
		listSchemaObjectsFn: func(_ context.Context, database string, schema string) ([]domain.ExplorerObject, error) {
			if database != "postgres" || schema != "public" {
				t.Fatalf("unexpected schema object request: database=%q schema=%q", database, schema)
			}
			return expectedObjects, nil
		},
		getTableInfoFn: func(_ context.Context, database string, schema string, table string) (domain.TableInfo, error) {
			if database != "postgres" || schema != "public" || table != "users" {
				t.Fatalf("unexpected table info request: database=%q schema=%q table=%q", database, schema, table)
			}
			return expectedTableInfo, nil
		},
		getObjectInfoFn: func(_ context.Context, database string, schema string, name string, kind domain.ExplorerObjectKind) (domain.ObjectInfo, error) {
			if database != "postgres" || schema != "public" || name != "users" || kind != domain.ExplorerObjectKindTable {
				t.Fatalf("unexpected object info request: database=%q schema=%q name=%q kind=%q", database, schema, name, kind)
			}
			return expectedObjectInfo, nil
		},
	}

	if err := registry.Register(&fakeDriverFactory{
		kind: profile.Kind,
		openFn: func(context.Context, domain.ConnProfile, domain.SecretRef) (driver.DriverConn, error) {
			return &fakeDriverConn{explorer: explorer, runner: &fakeQueryRunner{}}, nil
		},
	}); err != nil {
		t.Fatalf("register factory: %v", err)
	}

	service := NewExplorerService(registry, map[domain.ConnProfileID]domain.ConnProfile{profile.ID: profile})

	databases, err := service.ListDatabases(context.Background(), profile.ID)
	if err != nil {
		t.Fatalf("ListDatabases returned error: %v", err)
	}
	if !reflect.DeepEqual(databases, expectedDatabases) {
		t.Fatalf("unexpected databases: %+v", databases)
	}

	schemas, err := service.ListSchemas(context.Background(), profile.ID, "")
	if err != nil {
		t.Fatalf("ListSchemas returned error: %v", err)
	}
	if !reflect.DeepEqual(schemas, expectedSchemas) {
		t.Fatalf("unexpected schemas: %+v", schemas)
	}

	objects, err := service.ListSchemaObjects(context.Background(), profile.ID, "", "public")
	if err != nil {
		t.Fatalf("ListSchemaObjects returned error: %v", err)
	}
	if !reflect.DeepEqual(objects, expectedObjects) {
		t.Fatalf("unexpected schema objects: %+v", objects)
	}

	tableInfo, err := service.GetTableInfo(context.Background(), profile.ID, "", "public", "users")
	if err != nil {
		t.Fatalf("GetTableInfo returned error: %v", err)
	}
	if !reflect.DeepEqual(tableInfo, expectedTableInfo) {
		t.Fatalf("unexpected table info: %+v", tableInfo)
	}

	objectInfo, err := service.GetObjectInfo(context.Background(), profile.ID, "", "public", "users", domain.ExplorerObjectKindTable)
	if err != nil {
		t.Fatalf("GetObjectInfo returned error: %v", err)
	}
	if !reflect.DeepEqual(objectInfo, expectedObjectInfo) {
		t.Fatalf("unexpected object info: %+v", objectInfo)
	}
}
