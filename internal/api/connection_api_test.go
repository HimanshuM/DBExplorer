package api

import (
	"context"
	"testing"

	"dbx/internal/domain"
	"dbx/internal/driver"
	"dbx/internal/service"
)

type apiConnectionFactory struct {
	kind   domain.ConnectionKind
	testFn func(context.Context, domain.ConnProfile, domain.SecretRef) (domain.ConnectionTestResult, error)
}

func (f *apiConnectionFactory) Kind() domain.ConnectionKind {
	return f.kind
}

func (f *apiConnectionFactory) DisplayName() string {
	return string(f.kind)
}

func (f *apiConnectionFactory) Capabilities() driver.Capabilities {
	return driver.Capabilities{}
}

func (f *apiConnectionFactory) Open(context.Context, domain.ConnProfile, domain.SecretRef) (driver.DriverConn, error) {
	return nil, nil
}

func (f *apiConnectionFactory) TestConnection(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (domain.ConnectionTestResult, error) {
	if f.testFn != nil {
		return f.testFn(ctx, profile, secret)
	}
	return domain.ConnectionTestResult{}, nil
}

func TestConnectionAPIDelegatesToService(t *testing.T) {
	registry := driver.NewRegistry()
	profiles := map[domain.ConnProfileID]domain.ConnProfile{
		"b": {ID: "b", Kind: domain.ConnectionKindPostgres, Name: "Beta"},
		"a": {ID: "a", Kind: domain.ConnectionKindPostgres, Name: "Alpha"},
	}
	expectedTestResult := domain.ConnectionTestResult{OK: true, Message: "ok"}

	if err := registry.Register(&apiConnectionFactory{
		kind: domain.ConnectionKindPostgres,
		testFn: func(_ context.Context, profile domain.ConnProfile, secret domain.SecretRef) (domain.ConnectionTestResult, error) {
			if profile.ID != "a" {
				t.Fatalf("expected profile a, got %q", profile.ID)
			}
			if secret != (domain.SecretRef{}) {
				t.Fatalf("expected empty secret, got %+v", secret)
			}
			return expectedTestResult, nil
		},
	}); err != nil {
		t.Fatalf("register factory: %v", err)
	}

	api := NewConnectionAPI(service.NewConnectionService(registry, profiles))

	listed, err := api.ListProfiles()
	if err != nil {
		t.Fatalf("ListProfiles returned error: %v", err)
	}
	if len(listed) != 2 || listed[0].ID != "a" || listed[1].ID != "b" {
		t.Fatalf("unexpected profiles: %+v", listed)
	}

	profile, err := api.GetProfile("a")
	if err != nil {
		t.Fatalf("GetProfile returned error: %v", err)
	}
	if profile.Name != "Alpha" {
		t.Fatalf("unexpected profile: %+v", profile)
	}

	if err := api.SaveProfile(domain.ConnProfile{ID: "c", Kind: domain.ConnectionKindPostgres, Name: "Gamma"}); err != nil {
		t.Fatalf("SaveProfile returned error: %v", err)
	}
	saved, err := api.GetProfile("c")
	if err != nil {
		t.Fatalf("GetProfile for saved profile returned error: %v", err)
	}
	if saved.Name != "Gamma" {
		t.Fatalf("unexpected saved profile: %+v", saved)
	}

	testResult, err := api.TestConnection("a")
	if err != nil {
		t.Fatalf("TestConnection returned error: %v", err)
	}
	if testResult != expectedTestResult {
		t.Fatalf("unexpected test connection result: %+v", testResult)
	}
}
