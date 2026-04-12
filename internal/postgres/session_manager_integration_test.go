//go:build integration

package postgres

import (
	"context"
	"testing"
)

func TestSessionManagerAcquireAndReleaseDedicatedSession(t *testing.T) {
	env := startTestPostgres(t)
	sm := NewSessionManager(env.Profile)

	handle, err := sm.AcquireDedicatedSession(context.Background(), env.Profile.Database)
	if err != nil {
		t.Fatalf("AcquireDedicatedSession returned error: %v", err)
	}

	info := handle.Info()
	if info.ProfileID != env.Profile.ID {
		t.Fatalf("expected profile ID %q, got %q", env.Profile.ID, info.ProfileID)
	}
	if info.Database != env.Profile.Database {
		t.Fatalf("expected database %q, got %q", env.Profile.Database, info.Database)
	}
	if info.BackendPID <= 0 {
		t.Fatalf("expected positive backend PID, got %d", info.BackendPID)
	}

	sm.mu.RLock()
	_, ok := sm.sessions[info.ID]
	sm.mu.RUnlock()
	if !ok {
		t.Fatalf("expected session %q to be tracked", info.ID)
	}

	if err := sm.ReleaseDedicatedSession(context.Background(), info.ID); err != nil {
		t.Fatalf("ReleaseDedicatedSession returned error: %v", err)
	}

	sm.mu.RLock()
	_, ok = sm.sessions[info.ID]
	sm.mu.RUnlock()
	if ok {
		t.Fatalf("expected session %q to be removed after release", info.ID)
	}
}

func TestSessionHandleCloseReleasesTrackedSession(t *testing.T) {
	env := startTestPostgres(t)
	sm := NewSessionManager(env.Profile)

	handle, err := sm.AcquireDedicatedSession(context.Background(), env.Profile.Database)
	if err != nil {
		t.Fatalf("AcquireDedicatedSession returned error: %v", err)
	}

	sessionID := handle.Info().ID
	if err := handle.Close(); err != nil {
		t.Fatalf("session handle Close returned error: %v", err)
	}

	sm.mu.RLock()
	_, ok := sm.sessions[sessionID]
	sm.mu.RUnlock()
	if ok {
		t.Fatalf("expected session %q to be removed after handle close", sessionID)
	}
}
