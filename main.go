package main

import (
	"embed"
	"log"

	"dbx/internal/api"
	"dbx/internal/domain"
	"dbx/internal/driver"
	"dbx/internal/postgres"
	"dbx/internal/service"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	connectionAPI, queryAPI := buildAPIs()

	err := wails.Run(&options.App{
		Title:  "DB Explorer",
		Width:  1280,
		Height: 820,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
			connectionAPI,
			queryAPI,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

func buildAPIs() (*api.ConnectionAPI, *api.QueryAPI) {
	registry := driver.NewRegistry()
	if err := registry.Register(postgres.NewFactory()); err != nil {
		log.Fatal(err)
	}

	profiles := make(map[domain.ConnProfileID]domain.ConnProfile)
	connectionService := service.NewConnectionService(registry, profiles)
	queryService := service.NewQueryService(registry, profiles)

	return api.NewConnectionAPI(connectionService), api.NewQueryAPI(queryService)
}
