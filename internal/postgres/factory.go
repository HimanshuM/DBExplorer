package postgres

import (
	"context"
	"fmt"

	"dbx/internal/domain"
	"dbx/internal/driver"
	"github.com/jackc/pgx/v5"
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
	_ = secret

	cfg, err := buildConnConfig(profile, profile.Database)
	if err != nil {
		return domain.ConnectionTestResult{}, err
	}

	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return domain.ConnectionTestResult{OK: false, Message: fmt.Sprintf("connect failed: %v", err)}, nil
	}
	defer conn.Close(ctx)

	if err := conn.QueryRow(ctx, "select 1").Scan(new(int)); err != nil {
		return domain.ConnectionTestResult{OK: false, Message: fmt.Sprintf("test query failed: %v", err)}, nil
	}

	return domain.ConnectionTestResult{OK: true, Message: "ok"}, nil
}
