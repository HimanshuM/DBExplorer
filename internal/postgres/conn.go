package postgres

import (
	"fmt"

	"dbx/internal/domain"
	"dbx/internal/driver"
	"github.com/jackc/pgx/v5"
)

type Conn struct {
	profile        domain.ConnProfile
	sessionManager *SessionManager
	queryRunner    *QueryRunner
}

func NewConn(profile domain.ConnProfile) *Conn {
	return NewConnWithJobEventEmitter(profile, nil)
}

func NewConnWithJobEventEmitter(profile domain.ConnProfile, emitter JobEventEmitter) *Conn {
	sm := NewSessionManager(profile)
	qr := NewQueryRunner(profile, sm, WithJobEventEmitter(emitter))
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

func buildConnConfig(profile domain.ConnProfile, database string) (*pgx.ConnConfig, error) {
	targetDB := profile.Database
	if database != "" {
		targetDB = database
	}

	if targetDB == "" {
		return nil, fmt.Errorf("database cannot be empty")
	}

	connString := fmt.Sprintf(
		"host=%s port=%d user=%s dbname=%s sslmode=%s",
		profile.Host,
		profile.Port,
		profile.User,
		targetDB,
		profile.SSLMode,
	)

	cfg, err := pgx.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("parse postgres connection config: %w", err)
	}

	if password := profile.Options["password"]; password != "" {
		cfg.Password = password
	}

	// TODO: Password should come from secret storage/keyring, not profile options.
	return cfg, nil
}
