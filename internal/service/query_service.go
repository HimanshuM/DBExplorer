package service

import (
	"context"
	"fmt"
	"sync"

	"dbx/internal/domain"
	"dbx/internal/driver"
)

type QueryService struct {
	registry *driver.Registry
	profiles map[domain.ConnProfileID]domain.ConnProfile
	conns    map[domain.ConnProfileID]driver.DriverConn
	mu       sync.RWMutex
}

func NewQueryService(registry *driver.Registry, profiles map[domain.ConnProfileID]domain.ConnProfile) *QueryService {
	return &QueryService{registry: registry, profiles: profiles, conns: make(map[domain.ConnProfileID]driver.DriverConn)}
}

func (s *QueryService) getOrOpenConn(ctx context.Context, profileID domain.ConnProfileID) (driver.DriverConn, domain.ConnProfile, error) {
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

func (s *QueryService) RunQuery(ctx context.Context, req domain.RunQueryRequest) (domain.RunQueryResponse, error) {
	conn, _, err := s.getOrOpenConn(ctx, req.ProfileID)
	if err != nil {
		return domain.RunQueryResponse{}, err
	}

	handle, err := conn.QueryRunner().RunQuery(ctx, req)
	if err != nil {
		return domain.RunQueryResponse{}, fmt.Errorf("run query: %w", err)
	}

	return domain.RunQueryResponse{JobID: handle.ID()}, nil
}

func (s *QueryService) GetJob(ctx context.Context, profileID domain.ConnProfileID, jobID domain.JobID) (domain.JobSummary, error) {
	conn, _, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return domain.JobSummary{}, err
	}
	return conn.QueryRunner().GetJob(ctx, jobID)
}

func (s *QueryService) GetResultSchema(ctx context.Context, profileID domain.ConnProfileID, req domain.GetResultSchemaRequest) (domain.ResultSchema, error) {
	conn, _, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return domain.ResultSchema{}, err
	}
	return conn.QueryRunner().GetResultSchema(ctx, req)
}

func (s *QueryService) GetRows(ctx context.Context, profileID domain.ConnProfileID, req domain.GetRowsRequest) (domain.GetRowsResponse, error) {
	conn, _, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return domain.GetRowsResponse{}, err
	}
	return conn.QueryRunner().GetRows(ctx, req)
}

func (s *QueryService) CancelJob(ctx context.Context, profileID domain.ConnProfileID, jobID domain.JobID) error {
	conn, _, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return err
	}
	return conn.QueryRunner().CancelJob(ctx, jobID)
}

func (s *QueryService) DisposeJob(ctx context.Context, profileID domain.ConnProfileID, jobID domain.JobID) error {
	conn, _, err := s.getOrOpenConn(ctx, profileID)
	if err != nil {
		return err
	}
	return conn.QueryRunner().DisposeJob(ctx, jobID)
}
