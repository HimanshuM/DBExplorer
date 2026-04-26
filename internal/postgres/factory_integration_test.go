//go:build integration

package postgres

import (
	"context"
	"testing"

	"dbx/internal/domain"
)

func TestFactoryTestConnectionSucceeds(t *testing.T) {
	env := startTestPostgres(t)
	factory := NewFactory()

	result, err := factory.TestConnection(context.Background(), env.Profile, domain.SecretRef{})
	if err != nil {
		t.Fatalf("TestConnection returned error: %v", err)
	}
	if !result.OK {
		t.Fatalf("expected successful connection test, got %+v", result)
	}
	if result.Message != "ok" {
		t.Fatalf("expected success message %q, got %q", "ok", result.Message)
	}
}

func TestFactoryTestConnectionFailsWithWrongPassword(t *testing.T) {
	env := startTestPostgres(t)
	factory := NewFactory()
	profile := cloneProfile(env.Profile)
	profile.Options["password"] = "wrong-password"

	result, err := factory.TestConnection(context.Background(), profile, domain.SecretRef{})
	if err != nil {
		t.Fatalf("TestConnection returned unexpected error: %v", err)
	}
	if result.OK {
		t.Fatalf("expected connection test to fail, got %+v", result)
	}
	requireContains(t, result.Message, "connect failed")
}
