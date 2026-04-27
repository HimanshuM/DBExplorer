package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"dbx/internal/domain"
	"dbx/internal/driver"
)

type connectionTestFactory struct {
	kind   domain.ConnectionKind
	testFn func(context.Context, domain.ConnProfile, domain.SecretRef) (domain.ConnectionTestResult, error)
}

type recordingProfileStore struct {
	profiles []domain.ConnProfile
	err      error
}

func (s *recordingProfileStore) LoadProfiles(context.Context) (map[domain.ConnProfileID]domain.ConnProfile, error) {
	return nil, nil
}

func (s *recordingProfileStore) SaveProfiles(_ context.Context, profiles []domain.ConnProfile) error {
	s.profiles = append([]domain.ConnProfile(nil), profiles...)
	if s.err != nil {
		return s.err
	}
	return nil
}

func (f *connectionTestFactory) Kind() domain.ConnectionKind {
	return f.kind
}

func (f *connectionTestFactory) DisplayName() string {
	return string(f.kind)
}

func (f *connectionTestFactory) Capabilities() driver.Capabilities {
	return driver.Capabilities{}
}

func (f *connectionTestFactory) Open(context.Context, domain.ConnProfile, domain.SecretRef) (driver.DriverConn, error) {
	return nil, nil
}

func (f *connectionTestFactory) TestConnection(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (domain.ConnectionTestResult, error) {
	if f.testFn != nil {
		return f.testFn(ctx, profile, secret)
	}
	return domain.ConnectionTestResult{}, nil
}

func TestConnectionServiceListProfilesSortsByID(t *testing.T) {
	service := NewConnectionService(driver.NewRegistry(), map[domain.ConnProfileID]domain.ConnProfile{
		"z_profile": {ID: "z_profile", Name: "z"},
		"a_profile": {ID: "a_profile", Name: "a"},
	})

	profiles, err := service.ListProfiles(context.Background())
	if err != nil {
		t.Fatalf("ListProfiles returned error: %v", err)
	}

	if len(profiles) != 2 {
		t.Fatalf("expected 2 profiles, got %d", len(profiles))
	}
	if profiles[0].ID != "a_profile" || profiles[1].ID != "z_profile" {
		t.Fatalf("expected sorted profiles, got %q then %q", profiles[0].ID, profiles[1].ID)
	}
}

func TestConnectionServiceGetProfile(t *testing.T) {
	service := NewConnectionService(driver.NewRegistry(), map[domain.ConnProfileID]domain.ConnProfile{
		"profile_1": {ID: "profile_1", Name: "Primary"},
	})

	profile, err := service.GetProfile(context.Background(), "profile_1")
	if err != nil {
		t.Fatalf("GetProfile returned error: %v", err)
	}
	if profile.Name != "Primary" {
		t.Fatalf("unexpected profile name: %q", profile.Name)
	}

	if _, err := service.GetProfile(context.Background(), "missing"); err == nil {
		t.Fatal("expected missing profile lookup to fail")
	}
}

func TestConnectionServiceSaveProfileValidatesKindAndStoresProfile(t *testing.T) {
	service := NewConnectionService(driver.NewRegistry(), map[domain.ConnProfileID]domain.ConnProfile{})

	if err := service.SaveProfile(context.Background(), domain.ConnProfile{ID: "invalid"}); err == nil {
		t.Fatal("expected empty kind to be rejected")
	}

	profile := domain.ConnProfile{ID: "profile_1", Kind: domain.ConnectionKindPostgres, Name: "Primary"}
	if err := service.SaveProfile(context.Background(), profile); err != nil {
		t.Fatalf("SaveProfile returned error: %v", err)
	}

	stored, err := service.GetProfile(context.Background(), "profile_1")
	if err != nil {
		t.Fatalf("GetProfile after SaveProfile returned error: %v", err)
	}
	if !reflect.DeepEqual(stored, profile) {
		t.Fatalf("stored profile does not match saved profile: %+v", stored)
	}
}

func TestConnectionServiceSaveProfilePersistsSortedSnapshot(t *testing.T) {
	store := &recordingProfileStore{}
	service := NewConnectionServiceWithStore(driver.NewRegistry(), map[domain.ConnProfileID]domain.ConnProfile{
		"z_profile": {ID: "z_profile", Kind: domain.ConnectionKindPostgres},
	}, store)

	if err := service.SaveProfile(context.Background(), domain.ConnProfile{ID: "a_profile", Kind: domain.ConnectionKindPostgres}); err != nil {
		t.Fatalf("SaveProfile returned error: %v", err)
	}

	if len(store.profiles) != 2 {
		t.Fatalf("expected 2 persisted profiles, got %+v", store.profiles)
	}
	if store.profiles[0].ID != "a_profile" || store.profiles[1].ID != "z_profile" {
		t.Fatalf("expected sorted persisted profiles, got %+v", store.profiles)
	}
}

func TestConnectionServiceSaveProfileReturnsPersistenceError(t *testing.T) {
	persistErr := fmt.Errorf("persist failed")
	store := &recordingProfileStore{err: persistErr}
	service := NewConnectionServiceWithStore(driver.NewRegistry(), map[domain.ConnProfileID]domain.ConnProfile{}, store)

	err := service.SaveProfile(context.Background(), domain.ConnProfile{ID: "profile_1", Kind: domain.ConnectionKindPostgres})
	if !errors.Is(err, persistErr) {
		t.Fatalf("expected persistence error %v, got %v", persistErr, err)
	}
}

func TestConnectionServiceTestConnection(t *testing.T) {
	registry := driver.NewRegistry()
	profile := domain.ConnProfile{ID: "profile_1", Kind: domain.ConnectionKindPostgres}
	service := NewConnectionService(registry, map[domain.ConnProfileID]domain.ConnProfile{
		profile.ID: profile,
	})

	if _, err := service.TestConnection(context.Background(), "missing"); err == nil {
		t.Fatal("expected missing profile to fail")
	}

	if _, err := service.TestConnection(context.Background(), profile.ID); err == nil {
		t.Fatal("expected missing driver to fail")
	}

	expectedResult := domain.ConnectionTestResult{OK: true, Message: "ok"}
	expectedErr := errors.New("boom")
	calls := 0
	if err := registry.Register(&connectionTestFactory{
		kind: profile.Kind,
		testFn: func(_ context.Context, gotProfile domain.ConnProfile, secret domain.SecretRef) (domain.ConnectionTestResult, error) {
			calls++
			if gotProfile.ID != profile.ID {
				t.Fatalf("expected profile %q, got %q", profile.ID, gotProfile.ID)
			}
			if secret != (domain.SecretRef{}) {
				t.Fatalf("expected empty secret ref, got %+v", secret)
			}
			return expectedResult, expectedErr
		},
	}); err != nil {
		t.Fatalf("register factory: %v", err)
	}

	result, err := service.TestConnection(context.Background(), profile.ID)
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected error %v, got %v", expectedErr, err)
	}
	if result != expectedResult {
		t.Fatalf("unexpected test connection result: %+v", result)
	}
	if calls != 1 {
		t.Fatalf("expected 1 driver call, got %d", calls)
	}
}
