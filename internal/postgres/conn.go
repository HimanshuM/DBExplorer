package postgres

import (
	"dbx/internal/domain"
	"dbx/internal/driver"
)

type Conn struct {
	profile        domain.ConnProfile
	sessionManager *SessionManager
	queryRunner    *QueryRunner
}

func NewConn(profile domain.ConnProfile) *Conn {
	sm := NewSessionManager(profile)
	qr := NewQueryRunner(profile, sm)
	return &Conn{profile: profile, sessionManager: sm, queryRunner: qr}
}

func (c *Conn) Kind() domain.ConnectionKind {
	return domain.ConnectionKindPostgres
}

func (c *Conn) Capabilities() driver.Capabilities {
	return NewFactory().Capabilities()
}

func (c *Conn) Close() error {
	return nil
}

func (c *Conn) SessionManager() driver.SessionManager {
	return c.sessionManager
}

func (c *Conn) QueryRunner() driver.QueryRunner {
	return c.queryRunner
}
