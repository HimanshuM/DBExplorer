package domain

type ScriptTabState struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	Path      string        `json:"path"`
	SQL       string        `json:"sql"`
	SavedSQL  string        `json:"savedSql"`
	ProfileID ConnProfileID `json:"profileId"`
	Database  string        `json:"database"`
}

type ScriptWorkspace struct {
	Tabs        []ScriptTabState `json:"tabs"`
	ActiveTabID string           `json:"activeTabId"`
}

type SaveScriptRequest struct {
	Path            string        `json:"path"`
	Title           string        `json:"title"`
	SQL             string        `json:"sql"`
	ProfileID       ConnProfileID `json:"profileId"`
	Database        string        `json:"database"`
	ChooseLocation  bool          `json:"chooseLocation"`
	DefaultFilename string        `json:"defaultFilename"`
}

type SaveScriptResponse struct {
	Path  string `json:"path"`
	Title string `json:"title"`
}
