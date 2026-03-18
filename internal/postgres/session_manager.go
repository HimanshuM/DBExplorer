package postgres

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"dbx/internal/domain"
	"dbx/internal/driver"
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
}

func NewSessionManager(profile domain.ConnProfile) *SessionManager {
	return &SessionManager{profile: profile, sessions: make(map[domain.SessionID]*sessionHandle)}
}

func (sm *SessionManager) AcquireDedicatedSession(ctx context.Context, database string) (driver.SessionHandle, error) {
	_ = ctx

	next := atomic.AddUint64(&sm.counter, 1)
	sessionID := domain.SessionID(fmt.Sprintf("sess_%d", next))

	h := &sessionHandle{info: driver.SessionInfo{ID: sessionID, ProfileID: sm.profile.ID, Database: database, BackendPID: 0}, sm: sm}

	sm.mu.Lock()
	sm.sessions[sessionID] = h
	sm.mu.Unlock()

	return h, nil
}

func (sm *SessionManager) ReleaseDedicatedSession(ctx context.Context, sessionID domain.SessionID) error {
	_ = ctx
	sm.mu.Lock()
	delete(sm.sessions, sessionID)
	sm.mu.Unlock()
	return nil
}

func (h *sessionHandle) Info() driver.SessionInfo {
	return h.info
}

func (h *sessionHandle) Close() error {
	return h.sm.ReleaseDedicatedSession(context.Background(), h.info.ID)
}
