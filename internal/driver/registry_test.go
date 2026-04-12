package driver

import (
	"context"
	"testing"

	"dbx/internal/domain"
)

type stubFactory struct {
	kind    domain.ConnectionKind
	openFn  func(context.Context, domain.ConnProfile, domain.SecretRef) (DriverConn, error)
	testFn  func(context.Context, domain.ConnProfile, domain.SecretRef) (domain.ConnectionTestResult, error)
	caps    Capabilities
	display string
}

func (f *stubFactory) Kind() domain.ConnectionKind {
	return f.kind
}

func (f *stubFactory) DisplayName() string {
	if f.display != "" {
		return f.display
	}
	return string(f.kind)
}

func (f *stubFactory) Capabilities() Capabilities {
	return f.caps
}

func (f *stubFactory) Open(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (DriverConn, error) {
	if f.openFn != nil {
		return f.openFn(ctx, profile, secret)
	}
	return nil, nil
}

func (f *stubFactory) TestConnection(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (domain.ConnectionTestResult, error) {
	if f.testFn != nil {
		return f.testFn(ctx, profile, secret)
	}
	return domain.ConnectionTestResult{}, nil
}

func TestRegistryRegisterRejectsInvalidFactories(t *testing.T) {
	registry := NewRegistry()

	if err := registry.Register(nil); err == nil {
		t.Fatal("expected nil factory registration to fail")
	}

	if err := registry.Register(&stubFactory{}); err == nil {
		t.Fatal("expected empty kind registration to fail")
	}
}

func TestRegistryRegisterGetAndList(t *testing.T) {
	registry := NewRegistry()
	postgresFactory := &stubFactory{kind: domain.ConnectionKind("postgres"), display: "Postgres"}
	mysqlFactory := &stubFactory{kind: domain.ConnectionKind("mysql"), display: "MySQL"}

	if err := registry.Register(postgresFactory); err != nil {
		t.Fatalf("register postgres: %v", err)
	}
	if err := registry.Register(mysqlFactory); err != nil {
		t.Fatalf("register mysql: %v", err)
	}

	got, ok := registry.Get(postgresFactory.kind)
	if !ok {
		t.Fatal("expected registered factory to be returned")
	}
	if got != postgresFactory {
		t.Fatal("Get returned the wrong factory")
	}

	listed := registry.List()
	if len(listed) != 2 {
		t.Fatalf("expected 2 factories, got %d", len(listed))
	}
	if listed[0] != mysqlFactory || listed[1] != postgresFactory {
		t.Fatalf("expected sorted list order [mysql postgres], got [%s %s]", listed[0].Kind(), listed[1].Kind())
	}
}

func TestRegistryRegisterRejectsDuplicateKind(t *testing.T) {
	registry := NewRegistry()
	factory := &stubFactory{kind: domain.ConnectionKind("postgres")}

	if err := registry.Register(factory); err != nil {
		t.Fatalf("initial register failed: %v", err)
	}
	if err := registry.Register(&stubFactory{kind: factory.kind}); err == nil {
		t.Fatal("expected duplicate registration to fail")
	}
}

func TestRegistryMustGet(t *testing.T) {
	registry := NewRegistry()
	factory := &stubFactory{kind: domain.ConnectionKind("postgres")}
	if err := registry.Register(factory); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	if got := registry.MustGet(factory.kind); got != factory {
		t.Fatal("MustGet returned the wrong factory")
	}

	defer func() {
		if recover() == nil {
			t.Fatal("expected MustGet to panic for missing factory")
		}
	}()

	_ = registry.MustGet(domain.ConnectionKind("missing"))
}
