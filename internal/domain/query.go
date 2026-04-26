package domain

type RunMode string

const (
	RunSelection RunMode = "selection"
	RunStatement RunMode = "statement"
	RunScript    RunMode = "script"
)

type StatementRange struct {
	StartOffset int    `json:"startOffset"`
	EndOffset   int    `json:"endOffset"`
	Text        string `json:"text"`
}

type RunQueryRequest struct {
	ProfileID  ConnProfileID    `json:"profileId"`
	Database   string           `json:"database"`
	SQL        string           `json:"sql"`
	Statements []StatementRange `json:"statements"`
	Mode       RunMode          `json:"mode"`
	Limit      *int             `json:"limit"`
	ReadOnly   bool             `json:"readOnly"`
}

type RunQueryResponse struct {
	JobID      JobID     `json:"jobId"`
	SessionID  SessionID `json:"sessionId"`
	BackendPID int       `json:"backendPid"`
}

type JobStatus string

const (
	JobQueued    JobStatus = "queued"
	JobRunning   JobStatus = "running"
	JobSucceeded JobStatus = "succeeded"
	JobFailed    JobStatus = "failed"
	JobCanceled  JobStatus = "canceled"
)

type JobError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ResultSetSummary struct {
	ResultSetID    ResultSetID `json:"resultSetId"`
	StatementIndex int         `json:"statementIndex"`
	CommandTag     string      `json:"commandTag"`
	RowsAffected   int64       `json:"rowsAffected"`
	RowCountKnown  bool        `json:"rowCountKnown"`
	RowCount       int64       `json:"rowCount"`
}

type JobSummary struct {
	JobID      JobID              `json:"jobId"`
	ProfileID  ConnProfileID      `json:"profileId"`
	Database   string             `json:"database"`
	Status     JobStatus          `json:"status"`
	StartedAt  int64              `json:"startedAt"`
	EndedAt    int64              `json:"endedAt"`
	Error      *JobError          `json:"error"`
	ResultSets []ResultSetSummary `json:"resultSets"`
}

type GetResultSchemaRequest struct {
	JobID       JobID       `json:"jobId"`
	ResultSetID ResultSetID `json:"resultSetId"`
}

type GetRowsRequest struct {
	JobID       JobID       `json:"jobId"`
	ResultSetID ResultSetID `json:"resultSetId"`
	Start       int         `json:"start"`
	Count       int         `json:"count"`
}
