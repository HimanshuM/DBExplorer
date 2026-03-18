package driver

import (
	"context"

	"dbx/internal/domain"
)

type Capabilities struct {
	ParallelQueries     bool `json:"parallelQueries"`
	CancelQuery         bool `json:"cancelQuery"`
	SchemaExplorer      bool `json:"schemaExplorer"`
	TableEditor         bool `json:"tableEditor"`
	StreamingResults    bool `json:"streamingResults"`
	TransactionalEditor bool `json:"transactionalEditor"`
}

type DriverFactory interface {
	Kind() domain.ConnectionKind
	DisplayName() string
	Capabilities() Capabilities
	Open(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (DriverConn, error)
	TestConnection(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (domain.ConnectionTestResult, error)
}

type DriverConn interface {
	Kind() domain.ConnectionKind
	Capabilities() Capabilities
	Close() error
	SessionManager() SessionManager
	QueryRunner() QueryRunner
}

type SessionInfo struct {
	ID         domain.SessionID     `json:"id"`
	ProfileID  domain.ConnProfileID `json:"profileId"`
	Database   string               `json:"database"`
	BackendPID int                  `json:"backendPid"`
}

type SessionManager interface {
	AcquireDedicatedSession(ctx context.Context, database string) (SessionHandle, error)
	ReleaseDedicatedSession(ctx context.Context, sessionID domain.SessionID) error
}

type SessionHandle interface {
	Info() SessionInfo
	Close() error
}

type QueryRunner interface {
	RunQuery(ctx context.Context, req domain.RunQueryRequest) (JobHandle, error)
	CancelJob(ctx context.Context, jobID domain.JobID) error
	GetJob(ctx context.Context, jobID domain.JobID) (domain.JobSummary, error)
	GetResultSchema(ctx context.Context, req domain.GetResultSchemaRequest) (domain.ResultSchema, error)
	GetRows(ctx context.Context, req domain.GetRowsRequest) (domain.GetRowsResponse, error)
	DisposeJob(ctx context.Context, jobID domain.JobID) error
}

type JobHandle interface {
	ID() domain.JobID
	SessionID() domain.SessionID
	BackendPID() int
}
