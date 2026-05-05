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
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed frontend/src/icons/app.svg
var appIcon []byte

func main() {
	app := NewApp()
	connectionAPI, queryAPI, explorerAPI, scriptAPI := buildAPIs(app)

	err := wails.Run(&options.App{
		Title:     "DB Explorer",
		Width:     1280,
		Height:    820,
		Frameless: true,
		BackgroundColour: options.NewRGB(
			16,
			19,
			24,
		),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Linux: &linux.Options{
			Icon: appIcon,
		},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
			connectionAPI,
			queryAPI,
			explorerAPI,
			scriptAPI,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

func buildAPIs(app *App) (*api.ConnectionAPI, *api.QueryAPI, *api.ExplorerAPI, *api.ScriptAPI) {
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
	explorerService := service.NewExplorerService(registry, profiles)
	scriptStore := service.NewScriptStore(scriptWorkspacePath(), scriptDefaultDir())

	return api.NewConnectionAPI(connectionService), api.NewQueryAPI(queryService), api.NewExplorerAPI(explorerService), api.NewScriptAPI(scriptStore, app.context)
}

func profileStorePath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		return filepath.Join(".", "profiles.json")
	}
	return filepath.Join(configDir, "db-explorer", "profiles.json")
}

func scriptWorkspacePath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		return filepath.Join(".", "workspace.json")
	}
	return filepath.Join(configDir, "db-explorer", "workspace.json")
}

func scriptDefaultDir() string {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		return filepath.Join(".", "scripts")
	}
	return filepath.Join(configDir, "db-explorer", "scripts")
}
