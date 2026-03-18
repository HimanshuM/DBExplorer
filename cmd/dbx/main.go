package main

import (
	"fmt"
	"log"

	"dbx/internal/api"
	"dbx/internal/domain"
	"dbx/internal/driver"
	"dbx/internal/postgres"
	"dbx/internal/service"
)

const demoSQL = "select 1 as one, 'hello' as greeting"

func main() {
	registry := driver.NewRegistry()
	if err := registry.Register(postgres.NewFactory()); err != nil {
		log.Fatalf("failed to register postgres driver: %v", err)
	}

	profiles := map[domain.ConnProfileID]domain.ConnProfile{
		domain.ConnProfileID("local_pg"): {
			ID:       domain.ConnProfileID("local_pg"),
			Name:     "Local Postgres",
			Kind:     domain.ConnectionKindPostgres,
			Host:     "localhost",
			Port:     5432,
			User:     "postgres",
			Database: "postgres",
			SSLMode:  "disable",
			Options: map[string]string{
				"password": "<CHANGE_ME>",
			},
		},
	}

	connectionService := service.NewConnectionService(registry, profiles)
	queryService := service.NewQueryService(registry, profiles)

	connectionAPI := api.NewConnectionAPI(connectionService)
	queryAPI := api.NewQueryAPI(queryService)

	listedProfiles, err := connectionAPI.ListProfiles()
	if err != nil {
		log.Fatalf("failed to list profiles: %v", err)
	}

	runResp, err := queryAPI.RunQuery(domain.RunQueryRequest{
		ProfileID: domain.ConnProfileID("local_pg"),
		Database:  "postgres",
		SQL:       demoSQL,
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		log.Fatalf("failed to run query: %v\nTip: update local example password in cmd/dbx/main.go (Options[\"password\"]).", err)
	}

	job, err := queryAPI.GetJob(domain.ConnProfileID("local_pg"), runResp.JobID)
	if err != nil {
		log.Fatalf("failed to get job: %v", err)
	}

	schema, err := queryAPI.GetResultSchema(domain.ConnProfileID("local_pg"), domain.GetResultSchemaRequest{
		JobID:       runResp.JobID,
		ResultSetID: domain.ResultSetID("rs_1"),
	})
	if err != nil {
		log.Fatalf("failed to get result schema: %v", err)
	}

	rows, err := queryAPI.GetRows(domain.ConnProfileID("local_pg"), domain.GetRowsRequest{
		JobID:       runResp.JobID,
		ResultSetID: domain.ResultSetID("rs_1"),
		Start:       0,
		Count:       10,
	})
	if err != nil {
		log.Fatalf("failed to get rows: %v", err)
	}

	fmt.Printf(
		"dbx backend started: profiles=%d, job=%s, status=%s, columns=%d, rows=%d\n",
		len(listedProfiles),
		job.JobID,
		job.Status,
		len(schema.Columns),
		len(rows.Rows),
	)
}
