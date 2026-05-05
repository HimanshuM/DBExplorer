package api

import (
	"context"
	"path/filepath"

	"dbx/internal/domain"
	"dbx/internal/service"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type ScriptAPI struct {
	service *service.ScriptStore
	ctx     func() context.Context
}

func NewScriptAPI(service *service.ScriptStore, ctx func() context.Context) *ScriptAPI {
	return &ScriptAPI{service: service, ctx: ctx}
}

func (a *ScriptAPI) LoadWorkspace() (domain.ScriptWorkspace, error) {
	return a.service.LoadWorkspace(context.Background())
}

func (a *ScriptAPI) SaveWorkspace(workspace domain.ScriptWorkspace) error {
	return a.service.SaveWorkspace(context.Background(), workspace)
}

func (a *ScriptAPI) SaveScript(req domain.SaveScriptRequest) (domain.SaveScriptResponse, error) {
	path := req.Path
	if req.ChooseLocation {
		selectedPath, err := runtime.SaveFileDialog(a.ctx(), runtime.SaveDialogOptions{
			DefaultDirectory: a.service.DefaultDir(),
			DefaultFilename:  req.DefaultFilename,
			Title:            "Save SQL script",
			Filters: []runtime.FileFilter{
				{DisplayName: "SQL files (*.sql)", Pattern: "*.sql"},
				{DisplayName: "All files (*.*)", Pattern: "*.*"},
			},
		})
		if err != nil {
			return domain.SaveScriptResponse{}, err
		}
		if selectedPath == "" {
			return domain.SaveScriptResponse{}, nil
		}
		path = selectedPath
	}

	if req.ChooseLocation && filepath.Ext(path) == "" {
		path += ".sql"
	}
	return a.service.SaveScript(context.Background(), req, path)
}
