package api

import (
	"context"

	"dbx/internal/domain"
	"dbx/internal/service"
)

type QueryAPI struct {
	service *service.QueryService
}

func NewQueryAPI(service *service.QueryService) *QueryAPI {
	return &QueryAPI{service: service}
}

func (a *QueryAPI) RunQuery(req domain.RunQueryRequest) (domain.RunQueryResponse, error) {
	return a.service.RunQuery(context.Background(), req)
}

func (a *QueryAPI) GetJob(profileID domain.ConnProfileID, jobID domain.JobID) (domain.JobSummary, error) {
	return a.service.GetJob(context.Background(), profileID, jobID)
}

func (a *QueryAPI) GetResultSchema(profileID domain.ConnProfileID, req domain.GetResultSchemaRequest) (domain.ResultSchema, error) {
	return a.service.GetResultSchema(context.Background(), profileID, req)
}

func (a *QueryAPI) GetRows(profileID domain.ConnProfileID, req domain.GetRowsRequest) (domain.GetRowsResponse, error) {
	return a.service.GetRows(context.Background(), profileID, req)
}

func (a *QueryAPI) CancelJob(profileID domain.ConnProfileID, jobID domain.JobID) error {
	return a.service.CancelJob(context.Background(), profileID, jobID)
}

func (a *QueryAPI) DisposeJob(profileID domain.ConnProfileID, jobID domain.JobID) error {
	return a.service.DisposeJob(context.Background(), profileID, jobID)
}
