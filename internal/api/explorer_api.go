package api

import (
	"context"

	"dbx/internal/domain"
	"dbx/internal/service"
)

type ExplorerAPI struct {
	service *service.ExplorerService
}

func NewExplorerAPI(service *service.ExplorerService) *ExplorerAPI {
	return &ExplorerAPI{service: service}
}

func (a *ExplorerAPI) ListDatabases(profileID domain.ConnProfileID) ([]domain.ExplorerDatabase, error) {
	return a.service.ListDatabases(context.Background(), profileID)
}

func (a *ExplorerAPI) ListSchemas(profileID domain.ConnProfileID, database string) ([]domain.ExplorerSchema, error) {
	return a.service.ListSchemas(context.Background(), profileID, database)
}

func (a *ExplorerAPI) ListSchemaObjects(profileID domain.ConnProfileID, database string, schema string) ([]domain.ExplorerObject, error) {
	return a.service.ListSchemaObjects(context.Background(), profileID, database, schema)
}

func (a *ExplorerAPI) GetTableInfo(profileID domain.ConnProfileID, database string, schema string, table string) (domain.TableInfo, error) {
	return a.service.GetTableInfo(context.Background(), profileID, database, schema, table)
}

func (a *ExplorerAPI) GetObjectInfo(profileID domain.ConnProfileID, database string, schema string, name string, kind domain.ExplorerObjectKind) (domain.ObjectInfo, error) {
	return a.service.GetObjectInfo(context.Background(), profileID, database, schema, name, kind)
}
