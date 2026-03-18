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
		SQL:       "select 'hello from stub'",
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		log.Fatalf("failed to run stub query: %v", err)
	}

	job, err := queryAPI.GetJob(domain.ConnProfileID("local_pg"), runResp.JobID)
	if err != nil {
		log.Fatalf("failed to get stub job: %v", err)
	}

	fmt.Printf("dbx backend skeleton started: profiles=%d, lastJob=%s, status=%s\n", len(listedProfiles), job.JobID, job.Status)
}
