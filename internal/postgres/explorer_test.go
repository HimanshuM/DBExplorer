package postgres

import (
	"reflect"
	"testing"

	"dbx/internal/domain"
)

func TestDecideTableEditabilityPrefersPrimaryKey(t *testing.T) {
	info := domain.TableInfo{
		Kind: domain.ExplorerObjectKindTable,
		Columns: []domain.TableColumnInfo{
			{Name: "id", Nullable: false},
			{Name: "email", Nullable: false},
		},
		Indexes: []domain.TableIndexInfo{
			{Name: "users_email_key", Columns: []string{"email"}, Unique: true, Valid: true},
			{Name: "users_pkey", Columns: []string{"id"}, Primary: true, Unique: true, Valid: true},
		},
	}

	editability := decideTableEditability(info)
	if !editability.Editable || editability.Strategy != "primary_key" {
		t.Fatalf("expected primary-key editability, got %+v", editability)
	}
	if !reflect.DeepEqual(editability.KeyColumns, []string{"id"}) {
		t.Fatalf("unexpected key columns: %+v", editability.KeyColumns)
	}
}

func TestDecideTableEditabilityAllowsUniqueNotNullIndex(t *testing.T) {
	info := domain.TableInfo{
		Kind: domain.ExplorerObjectKindTable,
		Columns: []domain.TableColumnInfo{
			{Name: "tenant_id", Nullable: false},
			{Name: "external_id", Nullable: false},
		},
		Indexes: []domain.TableIndexInfo{
			{Name: "users_identity_key", Columns: []string{"tenant_id", "external_id"}, Unique: true, Valid: true},
		},
	}

	editability := decideTableEditability(info)
	if !editability.Editable || editability.Strategy != "unique_not_null_index" {
		t.Fatalf("expected unique-index editability, got %+v", editability)
	}
	if !reflect.DeepEqual(editability.KeyColumns, []string{"tenant_id", "external_id"}) {
		t.Fatalf("unexpected key columns: %+v", editability.KeyColumns)
	}
}

func TestDecideTableEditabilityRejectsNullableUniqueIndex(t *testing.T) {
	info := domain.TableInfo{
		Kind: domain.ExplorerObjectKindTable,
		Columns: []domain.TableColumnInfo{
			{Name: "email", Nullable: true},
		},
		Indexes: []domain.TableIndexInfo{
			{Name: "users_email_key", Columns: []string{"email"}, Unique: true, Valid: true},
		},
	}

	editability := decideTableEditability(info)
	if editability.Editable || editability.Strategy != "no_stable_row_identifier" {
		t.Fatalf("expected table to be non-editable, got %+v", editability)
	}
}

func TestDecideTableEditabilityRejectsViews(t *testing.T) {
	editability := decideTableEditability(domain.TableInfo{Kind: domain.ExplorerObjectKindView})
	if editability.Editable || editability.Strategy != "read_only_object" {
		t.Fatalf("expected view to be non-editable, got %+v", editability)
	}
}
