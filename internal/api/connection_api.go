package api

import (
	"context"

	"dbx/internal/domain"
	"dbx/internal/service"
)

type ConnectionAPI struct {
	service *service.ConnectionService
}

func NewConnectionAPI(service *service.ConnectionService) *ConnectionAPI {
	return &ConnectionAPI{service: service}
}

func (a *ConnectionAPI) ListProfiles() ([]domain.ConnProfile, error) {
	return a.service.ListProfiles(context.Background())
}

func (a *ConnectionAPI) GetProfile(id domain.ConnProfileID) (domain.ConnProfile, error) {
	return a.service.GetProfile(context.Background(), id)
}

func (a *ConnectionAPI) SaveProfile(profile domain.ConnProfile) error {
	return a.service.SaveProfile(context.Background(), profile)
}

func (a *ConnectionAPI) DeleteProfile(id domain.ConnProfileID) error {
	return a.service.DeleteProfile(context.Background(), id)
}

func (a *ConnectionAPI) TestConnection(profileID domain.ConnProfileID) (domain.ConnectionTestResult, error) {
	return a.service.TestConnection(context.Background(), profileID)
}

func (a *ConnectionAPI) TestConnectionProfile(profile domain.ConnProfile) (domain.ConnectionTestResult, error) {
	return a.service.TestConnectionProfile(context.Background(), profile)
}
