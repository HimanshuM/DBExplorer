package domain

type ExplorerObjectKind string

const (
	ExplorerObjectKindTable            ExplorerObjectKind = "table"
	ExplorerObjectKindView             ExplorerObjectKind = "view"
	ExplorerObjectKindMaterializedView ExplorerObjectKind = "materialized_view"
	ExplorerObjectKindSequence         ExplorerObjectKind = "sequence"
	ExplorerObjectKindFunction         ExplorerObjectKind = "function"
	ExplorerObjectKindType             ExplorerObjectKind = "type"
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
	TypeSchema string `json:"typeSchema"`
	TypeName   string `json:"typeName"`
	Nullable   bool   `json:"nullable"`
	Default    string `json:"default"`
	Comment    string `json:"comment"`
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
	Definition    string   `json:"definition"`
}

type TableForeignKeyInfo struct {
	Name              string   `json:"name"`
	Columns           []string `json:"columns"`
	ReferencedSchema  string   `json:"referencedSchema"`
	ReferencedTable   string   `json:"referencedTable"`
	ReferencedColumns []string `json:"referencedColumns"`
	UpdateAction      string   `json:"updateAction"`
	DeleteAction      string   `json:"deleteAction"`
	MatchType         string   `json:"matchType"`
	Deferrable        bool     `json:"deferrable"`
	InitiallyDeferred bool     `json:"initiallyDeferred"`
	Definition        string   `json:"definition"`
}

type TableReferenceInfo struct {
	Name              string   `json:"name"`
	Schema            string   `json:"schema"`
	Table             string   `json:"table"`
	Columns           []string `json:"columns"`
	ReferencedColumns []string `json:"referencedColumns"`
	UpdateAction      string   `json:"updateAction"`
	DeleteAction      string   `json:"deleteAction"`
	MatchType         string   `json:"matchType"`
	Deferrable        bool     `json:"deferrable"`
	InitiallyDeferred bool     `json:"initiallyDeferred"`
	Definition        string   `json:"definition"`
}

type TableEditabilityInfo struct {
	Editable   bool     `json:"editable"`
	Strategy   string   `json:"strategy"`
	Reason     string   `json:"reason"`
	KeyColumns []string `json:"keyColumns"`
}

type TableInfo struct {
	Database     string                `json:"database"`
	Schema       string                `json:"schema"`
	Name         string                `json:"name"`
	Kind         ExplorerObjectKind    `json:"kind"`
	DDL          string                `json:"ddl"`
	Columns      []TableColumnInfo     `json:"columns"`
	Indexes      []TableIndexInfo      `json:"indexes"`
	ForeignKeys  []TableForeignKeyInfo `json:"foreignKeys"`
	ReferencedBy []TableReferenceInfo  `json:"referencedBy"`
	Editability  TableEditabilityInfo  `json:"editability"`
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

type TypeInfo struct {
	Category    string            `json:"category"`
	BaseType    string            `json:"baseType"`
	InputType   string            `json:"inputType"`
	NotNull     bool              `json:"notNull"`
	Default     string            `json:"default"`
	Check       string            `json:"check"`
	Labels      []string          `json:"labels"`
	Attributes  []TableColumnInfo `json:"attributes"`
	ElementType string            `json:"elementType"`
	Subtype     string            `json:"subtype"`
	Canonical   string            `json:"canonical"`
	SubtypeDiff string            `json:"subtypeDiff"`
	Usages      []TypeUsageInfo   `json:"usages"`
}

type TypeUsageInfo struct {
	Schema   string             `json:"schema"`
	Object   string             `json:"object"`
	Kind     ExplorerObjectKind `json:"kind"`
	Column   string             `json:"column"`
	DataType string             `json:"dataType"`
	Nullable bool               `json:"nullable"`
	Default  string             `json:"default"`
	Comment  string             `json:"comment"`
}

type ObjectInfo struct {
	Database     string                `json:"database"`
	Schema       string                `json:"schema"`
	Name         string                `json:"name"`
	Kind         ExplorerObjectKind    `json:"kind"`
	DDL          string                `json:"ddl"`
	Details      []ObjectDetail        `json:"details"`
	Columns      []TableColumnInfo     `json:"columns"`
	Indexes      []TableIndexInfo      `json:"indexes"`
	ForeignKeys  []TableForeignKeyInfo `json:"foreignKeys"`
	ReferencedBy []TableReferenceInfo  `json:"referencedBy"`
	Editability  TableEditabilityInfo  `json:"editability"`
	Sequence     SequenceInfo          `json:"sequence"`
	Functions    []FunctionInfo        `json:"functions"`
	Type         TypeInfo              `json:"type"`
}
