package domain

type ConnectionKind string

const ConnectionKindPostgres ConnectionKind = "postgres"

type ConnProfile struct {
	ID       ConnProfileID     `json:"id"`
	Name     string            `json:"name"`
	Kind     ConnectionKind    `json:"kind"`
	Host     string            `json:"host"`
	Port     int               `json:"port"`
	User     string            `json:"user"`
	Database string            `json:"database"`
	SSLMode  string            `json:"sslMode"`
	Options  map[string]string `json:"options"`
}

type ConnectionTestResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

type SecretRef struct {
	KeyringKey string `json:"keyringKey"`
}
