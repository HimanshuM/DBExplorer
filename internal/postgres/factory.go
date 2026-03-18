package postgres

import (
	"context"

	"dbx/internal/domain"
	"dbx/internal/driver"
)

type Factory struct{}

func NewFactory() *Factory {
	return &Factory{}
}

func (f *Factory) Kind() domain.ConnectionKind {
	return domain.ConnectionKindPostgres
}

func (f *Factory) DisplayName() string {
	return "PostgreSQL"
}

func (f *Factory) Capabilities() driver.Capabilities {
	return driver.Capabilities{
		ParallelQueries:     true,
		CancelQuery:         true,
		SchemaExplorer:      true,
		TableEditor:         true,
		StreamingResults:    true,
		TransactionalEditor: true,
	}
}

func (f *Factory) Open(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (driver.DriverConn, error) {
	_ = ctx
	_ = secret
	return NewConn(profile), nil
}

func (f *Factory) TestConnection(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (domain.ConnectionTestResult, error) {
	_ = ctx
	_ = profile
	_ = secret
	return domain.ConnectionTestResult{OK: true, Message: "not implemented yet"}, nil
}
