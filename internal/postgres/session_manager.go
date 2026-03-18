package postgres

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"dbx/internal/domain"
	"dbx/internal/driver"
	"github.com/jackc/pgx/v5"
)

type SessionManager struct {
	profile  domain.ConnProfile
	counter  uint64
	mu       sync.RWMutex
	sessions map[domain.SessionID]*sessionHandle
}

type sessionHandle struct {
	info driver.SessionInfo
	sm   *SessionManager
	conn *pgx.Conn
}

func NewSessionManager(profile domain.ConnProfile) *SessionManager {
	return &SessionManager{profile: profile, sessions: make(map[domain.SessionID]*sessionHandle)}
}

func (sm *SessionManager) AcquireDedicatedSession(ctx context.Context, database string) (driver.SessionHandle, error) {
	next := atomic.AddUint64(&sm.counter, 1)
	sessionID := domain.SessionID(fmt.Sprintf("sess_%d", next))

	cfg, err := buildConnConfig(sm.profile, database)
	if err != nil {
		return nil, err
	}

	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open dedicated postgres session: %w", err)
	}

	var backendPID int
	if err := conn.QueryRow(ctx, "select pg_backend_pid()").Scan(&backendPID); err != nil {
		_ = conn.Close(ctx)
		return nil, fmt.Errorf("fetch backend pid: %w", err)
	}

	h := &sessionHandle{
		info: driver.SessionInfo{ID: sessionID, ProfileID: sm.profile.ID, Database: cfg.Database, BackendPID: backendPID},
		sm:   sm,
		conn: conn,
	}

	sm.mu.Lock()
	sm.sessions[sessionID] = h
	sm.mu.Unlock()

	return h, nil
}

func (sm *SessionManager) ReleaseDedicatedSession(ctx context.Context, sessionID domain.SessionID) error {
	sm.mu.Lock()
	h, ok := sm.sessions[sessionID]
	if ok {
		delete(sm.sessions, sessionID)
	}
	sm.mu.Unlock()

	if !ok {
		return nil
	}

	return h.conn.Close(ctx)
}

func (h *sessionHandle) Info() driver.SessionInfo {
	return h.info
}

func (h *sessionHandle) Close() error {
	return h.sm.ReleaseDedicatedSession(context.Background(), h.info.ID)
}
