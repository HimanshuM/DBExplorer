package main

import (
	"context"
	"embed"
	"log"
	"os"
	"path/filepath"

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
	connectionAPI, queryAPI := buildAPIs(app)

	err := wails.Run(&options.App{
		Title:     "DB Explorer",
		Width:     1280,
		Height:    820,
		Frameless: true,
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

func buildAPIs(app *App) (*api.ConnectionAPI, *api.QueryAPI) {
	registry := driver.NewRegistry()
	if err := registry.Register(postgres.NewFactory(
		postgres.WithFactoryJobEventEmitter(NewWailsJobEventEmitter(app)),
	)); err != nil {
		log.Fatal(err)
	}

	profileStore := service.NewFileProfileStore(profileStorePath())
	profiles, err := profileStore.LoadProfiles(context.Background())
	if err != nil {
		log.Printf("failed to load saved profiles: %v", err)
		profiles = make(map[domain.ConnProfileID]domain.ConnProfile)
	}

	connectionService := service.NewConnectionServiceWithStore(registry, profiles, profileStore)
	queryService := service.NewQueryService(registry, profiles)

	return api.NewConnectionAPI(connectionService), api.NewQueryAPI(queryService)
}

func profileStorePath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		return filepath.Join(".", "profiles.json")
	}
	return filepath.Join(configDir, "db-explorer", "profiles.json")
}
