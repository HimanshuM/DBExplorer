package domain

type ExplorerObjectKind string

const (
	ExplorerObjectKindTable            ExplorerObjectKind = "table"
	ExplorerObjectKindView             ExplorerObjectKind = "view"
	ExplorerObjectKindMaterializedView ExplorerObjectKind = "materialized_view"
	ExplorerObjectKindSequence         ExplorerObjectKind = "sequence"
	ExplorerObjectKindFunction         ExplorerObjectKind = "function"
)

type ExplorerDatabase struct {
	Name string `json:"name"`
}

type ExplorerSchema struct {
	Name string `json:"name"`
}

type ExplorerObject struct {
	Name   string             `json:"name"`
	Schema string             `json:"schema"`
	Kind   ExplorerObjectKind `json:"kind"`
}

type TableColumnInfo struct {
	Name       string `json:"name"`
	Position   int    `json:"position"`
	DataType   string `json:"dataType"`
	TypeName   string `json:"typeName"`
	Nullable   bool   `json:"nullable"`
	Default    string `json:"default"`
	Identity   string `json:"identity"`
	Generated  string `json:"generated"`
	PrimaryKey bool   `json:"primaryKey"`
}

type TableIndexInfo struct {
	Name          string   `json:"name"`
	Columns       []string `json:"columns"`
	Primary       bool     `json:"primary"`
	Unique        bool     `json:"unique"`
	Partial       bool     `json:"partial"`
	HasExpression bool     `json:"hasExpression"`
	Valid         bool     `json:"valid"`
}

type TableEditabilityInfo struct {
	Editable   bool     `json:"editable"`
	Strategy   string   `json:"strategy"`
	Reason     string   `json:"reason"`
	KeyColumns []string `json:"keyColumns"`
}

type TableInfo struct {
	Database    string               `json:"database"`
	Schema      string               `json:"schema"`
	Name        string               `json:"name"`
	Kind        ExplorerObjectKind   `json:"kind"`
	Columns     []TableColumnInfo    `json:"columns"`
	Indexes     []TableIndexInfo     `json:"indexes"`
	Editability TableEditabilityInfo `json:"editability"`
}

type ObjectDetail struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type SequenceInfo struct {
	DataType    string `json:"dataType"`
	StartValue  string `json:"startValue"`
	MinValue    string `json:"minValue"`
	MaxValue    string `json:"maxValue"`
	IncrementBy string `json:"incrementBy"`
	Cycle       bool   `json:"cycle"`
	CacheSize   string `json:"cacheSize"`
	LastValue   string `json:"lastValue"`
}

type FunctionInfo struct {
	Name       string `json:"name"`
	Arguments  string `json:"arguments"`
	ResultType string `json:"resultType"`
	Language   string `json:"language"`
	Volatility string `json:"volatility"`
	ReturnsSet bool   `json:"returnsSet"`
}

type ObjectInfo struct {
	Database    string               `json:"database"`
	Schema      string               `json:"schema"`
	Name        string               `json:"name"`
	Kind        ExplorerObjectKind   `json:"kind"`
	Details     []ObjectDetail       `json:"details"`
	Columns     []TableColumnInfo    `json:"columns"`
	Indexes     []TableIndexInfo     `json:"indexes"`
	Editability TableEditabilityInfo `json:"editability"`
	Sequence    SequenceInfo         `json:"sequence"`
	Functions   []FunctionInfo       `json:"functions"`
}
