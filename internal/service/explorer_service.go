package service

import (
	"context"
	"fmt"
	"sync"

	"dbx/internal/domain"
	"dbx/internal/driver"
)

type ExplorerService struct {
	registry *driver.Registry
	profiles map[domain.ConnProfileID]domain.ConnProfile
	conns    map[domain.ConnProfileID]driver.DriverConn
	mu       sync.RWMutex
}

func NewExplorerService(registry *driver.Registry, profiles map[domain.ConnProfileID]domain.ConnProfile) *ExplorerService {
	return &ExplorerService{registry: registry, profiles: profiles, conns: make(map[domain.ConnProfileID]driver.DriverConn)}
}

func (s *ExplorerService) getOrOpenConn(ctx context.Context, profileID domain.ConnProfileID) (driver.DriverConn, domain.ConnProfile, error) {
	s.mu.RLock()
	if conn, ok := s.conns[profileID]; ok {
		profile, okp := s.profiles[profileID]
		s.mu.RUnlock()
		if !okp {
			return nil, domain.ConnProfile{}, fmt.Errorf("profile %q not found", profileID)
		}
		return conn, profile, nil
	}
	profile, ok := s.profiles[profileID]
	s.mu.RUnlock()
	if !ok {
		return nil, domain.ConnProfile{}, fmt.Errorf("profile %q not found", profileID)
	}

	factory, ok := s.registry.Get(profile.Kind)
	if !ok {
		return nil, domain.ConnProfile{}, fmt.Errorf("no driver registered for kind %q", profile.Kind)
	}

	conn, err := factory.Open(ctx, profile, domain.SecretRef{})
	if err != nil {
		return nil, domain.ConnProfile{}, fmt.Errorf("open connection for profile %q: %w", profileID, err)
	}

	s.mu.Lock()
	if existing, exists := s.conns[profileID]; exists {
		s.mu.Unlock()
		_ = conn.Close()
		return existing, profile, nil
	}
	s.conns[profileID] = conn
	s.mu.Unlock()

	return conn, profile, nil
}

func (s *ExplorerService) ListDatabases(ctx context.Context, profileID domain.ConnProfileID) ([]domain.ExplorerDatabase, error) {
	conn, _, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return nil, err
	}
	return conn.Explorer().ListDatabases(ctx)
}

func (s *ExplorerService) ListSchemas(ctx context.Context, profileID domain.ConnProfileID, database string) ([]domain.ExplorerSchema, error) {
	conn, profile, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return nil, err
	}
	if database == "" {
		database = profile.Database
	}
	return conn.Explorer().ListSchemas(ctx, database)
}

func (s *ExplorerService) ListSchemaObjects(ctx context.Context, profileID domain.ConnProfileID, database string, schema string) ([]domain.ExplorerObject, error) {
	conn, profile, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return nil, err
	}
	if database == "" {
		database = profile.Database
	}
	return conn.Explorer().ListSchemaObjects(ctx, database, schema)
}

func (s *ExplorerService) GetTableInfo(ctx context.Context, profileID domain.ConnProfileID, database string, schema string, table string) (domain.TableInfo, error) {
	conn, profile, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return domain.TableInfo{}, err
	}
	if database == "" {
		database = profile.Database
	}
	return conn.Explorer().GetTableInfo(ctx, database, schema, table)
}

func (s *ExplorerService) GetObjectInfo(ctx context.Context, profileID domain.ConnProfileID, database string, schema string, name string, kind domain.ExplorerObjectKind) (domain.ObjectInfo, error) {
	conn, profile, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return domain.ObjectInfo{}, err
	}
	if database == "" {
		database = profile.Database
	}
	return conn.Explorer().GetObjectInfo(ctx, database, schema, name, kind)
}
