package domain

type ColumnType struct {
	DBTypeName string `json:"dbTypeName"`
	Category   string `json:"category"`
	IsArray    bool   `json:"isArray"`
	Nullable   bool   `json:"nullable"`
}

type ColumnDef struct {
	Name     string     `json:"name"`
	Type     ColumnType `json:"type"`
	Nullable bool       `json:"nullable"`
}

type ResultSchema struct {
	Columns []ColumnDef `json:"columns"`
}

type RowValue = any

type GetRowsResponse struct {
	Start         int      `json:"start"`
	Rows          [][]any  `json:"rows"`
	RowKeys       []string `json:"rowKeys"`
	RowCountKnown bool     `json:"rowCountKnown"`
	RowCount      int64    `json:"rowCount"`
}
