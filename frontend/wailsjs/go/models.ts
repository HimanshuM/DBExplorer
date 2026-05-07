export namespace domain {
	
	export class ColumnType {
	    dbTypeName: string;
	    category: string;
	    isArray: boolean;
	    nullable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ColumnType(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dbTypeName = source["dbTypeName"];
	        this.category = source["category"];
	        this.isArray = source["isArray"];
	        this.nullable = source["nullable"];
	    }
	}
	export class ColumnDef {
	    name: string;
	    type: ColumnType;
	    nullable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ColumnDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = this.convertValues(source["type"], ColumnType);
	        this.nullable = source["nullable"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ConnProfile {
	    id: string;
	    name: string;
	    folder?: string;
	    kind: string;
	    host: string;
	    port: number;
	    user: string;
	    database: string;
	    sslMode: string;
	    options: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new ConnProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.folder = source["folder"];
	        this.kind = source["kind"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.database = source["database"];
	        this.sslMode = source["sslMode"];
	        this.options = source["options"];
	    }
	}
	export class ConnectionTestResult {
	    ok: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionTestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.message = source["message"];
	    }
	}
	export class ExplorerDatabase {
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ExplorerDatabase(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	    }
	}
	export class ExplorerObject {
	    name: string;
	    schema: string;
	    kind: string;
	
	    static createFrom(source: any = {}) {
	        return new ExplorerObject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.schema = source["schema"];
	        this.kind = source["kind"];
	    }
	}
	export class ExplorerSchema {
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ExplorerSchema(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	    }
	}
	export class FunctionInfo {
	    name: string;
	    arguments: string;
	    resultType: string;
	    language: string;
	    volatility: string;
	    returnsSet: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FunctionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.arguments = source["arguments"];
	        this.resultType = source["resultType"];
	        this.language = source["language"];
	        this.volatility = source["volatility"];
	        this.returnsSet = source["returnsSet"];
	    }
	}
	export class GetResultSchemaRequest {
	    jobId: string;
	    resultSetId: string;
	
	    static createFrom(source: any = {}) {
	        return new GetResultSchemaRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	        this.resultSetId = source["resultSetId"];
	    }
	}
	export class GetRowsRequest {
	    jobId: string;
	    resultSetId: string;
	    start: number;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new GetRowsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	        this.resultSetId = source["resultSetId"];
	        this.start = source["start"];
	        this.count = source["count"];
	    }
	}
	export class GetRowsResponse {
	    start: number;
	    rows: any[][];
	    rowKeys: string[];
	    rowCountKnown: boolean;
	    rowCount: number;
	
	    static createFrom(source: any = {}) {
	        return new GetRowsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.rows = source["rows"];
	        this.rowKeys = source["rowKeys"];
	        this.rowCountKnown = source["rowCountKnown"];
	        this.rowCount = source["rowCount"];
	    }
	}
	export class JobError {
	    code: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new JobError(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.message = source["message"];
	    }
	}
	export class ResultSetSummary {
	    resultSetId: string;
	    statementIndex: number;
	    commandTag: string;
	    rowsAffected: number;
	    rowCountKnown: boolean;
	    rowCount: number;
	
	    static createFrom(source: any = {}) {
	        return new ResultSetSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resultSetId = source["resultSetId"];
	        this.statementIndex = source["statementIndex"];
	        this.commandTag = source["commandTag"];
	        this.rowsAffected = source["rowsAffected"];
	        this.rowCountKnown = source["rowCountKnown"];
	        this.rowCount = source["rowCount"];
	    }
	}
	export class JobSummary {
	    jobId: string;
	    profileId: string;
	    database: string;
	    status: string;
	    startedAt: number;
	    endedAt: number;
	    error?: JobError;
	    resultSets: ResultSetSummary[];
	
	    static createFrom(source: any = {}) {
	        return new JobSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	        this.profileId = source["profileId"];
	        this.database = source["database"];
	        this.status = source["status"];
	        this.startedAt = source["startedAt"];
	        this.endedAt = source["endedAt"];
	        this.error = this.convertValues(source["error"], JobError);
	        this.resultSets = this.convertValues(source["resultSets"], ResultSetSummary);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ObjectDetail {
	    name: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new ObjectDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	    }
	}
	export class TypeUsageInfo {
	    schema: string;
	    object: string;
	    kind: string;
	    column: string;
	    dataType: string;
	    nullable: boolean;
	    default: string;
	    comment: string;
	
	    static createFrom(source: any = {}) {
	        return new TypeUsageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.object = source["object"];
	        this.kind = source["kind"];
	        this.column = source["column"];
	        this.dataType = source["dataType"];
	        this.nullable = source["nullable"];
	        this.default = source["default"];
	        this.comment = source["comment"];
	    }
	}
	export class TypeInfo {
	    category: string;
	    baseType: string;
	    inputType: string;
	    notNull: boolean;
	    default: string;
	    check: string;
	    labels: string[];
	    attributes: TableColumnInfo[];
	    elementType: string;
	    subtype: string;
	    canonical: string;
	    subtypeDiff: string;
	    usages: TypeUsageInfo[];
	
	    static createFrom(source: any = {}) {
	        return new TypeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.category = source["category"];
	        this.baseType = source["baseType"];
	        this.inputType = source["inputType"];
	        this.notNull = source["notNull"];
	        this.default = source["default"];
	        this.check = source["check"];
	        this.labels = source["labels"];
	        this.attributes = this.convertValues(source["attributes"], TableColumnInfo);
	        this.elementType = source["elementType"];
	        this.subtype = source["subtype"];
	        this.canonical = source["canonical"];
	        this.subtypeDiff = source["subtypeDiff"];
	        this.usages = this.convertValues(source["usages"], TypeUsageInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SequenceInfo {
	    dataType: string;
	    startValue: string;
	    minValue: string;
	    maxValue: string;
	    incrementBy: string;
	    cycle: boolean;
	    cacheSize: string;
	    lastValue: string;
	
	    static createFrom(source: any = {}) {
	        return new SequenceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dataType = source["dataType"];
	        this.startValue = source["startValue"];
	        this.minValue = source["minValue"];
	        this.maxValue = source["maxValue"];
	        this.incrementBy = source["incrementBy"];
	        this.cycle = source["cycle"];
	        this.cacheSize = source["cacheSize"];
	        this.lastValue = source["lastValue"];
	    }
	}
	export class TableEditabilityInfo {
	    editable: boolean;
	    strategy: string;
	    reason: string;
	    keyColumns: string[];
	
	    static createFrom(source: any = {}) {
	        return new TableEditabilityInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.editable = source["editable"];
	        this.strategy = source["strategy"];
	        this.reason = source["reason"];
	        this.keyColumns = source["keyColumns"];
	    }
	}
	export class TableReferenceInfo {
	    name: string;
	    schema: string;
	    table: string;
	    columns: string[];
	    referencedColumns: string[];
	    updateAction: string;
	    deleteAction: string;
	    matchType: string;
	    deferrable: boolean;
	    initiallyDeferred: boolean;
	    definition: string;
	
	    static createFrom(source: any = {}) {
	        return new TableReferenceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.schema = source["schema"];
	        this.table = source["table"];
	        this.columns = source["columns"];
	        this.referencedColumns = source["referencedColumns"];
	        this.updateAction = source["updateAction"];
	        this.deleteAction = source["deleteAction"];
	        this.matchType = source["matchType"];
	        this.deferrable = source["deferrable"];
	        this.initiallyDeferred = source["initiallyDeferred"];
	        this.definition = source["definition"];
	    }
	}
	export class TableForeignKeyInfo {
	    name: string;
	    columns: string[];
	    referencedSchema: string;
	    referencedTable: string;
	    referencedColumns: string[];
	    updateAction: string;
	    deleteAction: string;
	    matchType: string;
	    deferrable: boolean;
	    initiallyDeferred: boolean;
	    definition: string;
	
	    static createFrom(source: any = {}) {
	        return new TableForeignKeyInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.columns = source["columns"];
	        this.referencedSchema = source["referencedSchema"];
	        this.referencedTable = source["referencedTable"];
	        this.referencedColumns = source["referencedColumns"];
	        this.updateAction = source["updateAction"];
	        this.deleteAction = source["deleteAction"];
	        this.matchType = source["matchType"];
	        this.deferrable = source["deferrable"];
	        this.initiallyDeferred = source["initiallyDeferred"];
	        this.definition = source["definition"];
	    }
	}
	export class TableIndexInfo {
	    name: string;
	    columns: string[];
	    primary: boolean;
	    unique: boolean;
	    partial: boolean;
	    hasExpression: boolean;
	    valid: boolean;
	    definition: string;
	
	    static createFrom(source: any = {}) {
	        return new TableIndexInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.columns = source["columns"];
	        this.primary = source["primary"];
	        this.unique = source["unique"];
	        this.partial = source["partial"];
	        this.hasExpression = source["hasExpression"];
	        this.valid = source["valid"];
	        this.definition = source["definition"];
	    }
	}
	export class TableColumnInfo {
	    name: string;
	    position: number;
	    dataType: string;
	    typeSchema: string;
	    typeName: string;
	    nullable: boolean;
	    default: string;
	    comment: string;
	    identity: string;
	    generated: string;
	    primaryKey: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TableColumnInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.position = source["position"];
	        this.dataType = source["dataType"];
	        this.typeSchema = source["typeSchema"];
	        this.typeName = source["typeName"];
	        this.nullable = source["nullable"];
	        this.default = source["default"];
	        this.comment = source["comment"];
	        this.identity = source["identity"];
	        this.generated = source["generated"];
	        this.primaryKey = source["primaryKey"];
	    }
	}
	export class ObjectInfo {
	    database: string;
	    schema: string;
	    name: string;
	    kind: string;
	    ddl: string;
	    details: ObjectDetail[];
	    columns: TableColumnInfo[];
	    indexes: TableIndexInfo[];
	    foreignKeys: TableForeignKeyInfo[];
	    referencedBy: TableReferenceInfo[];
	    editability: TableEditabilityInfo;
	    sequence: SequenceInfo;
	    functions: FunctionInfo[];
	    type: TypeInfo;
	
	    static createFrom(source: any = {}) {
	        return new ObjectInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.database = source["database"];
	        this.schema = source["schema"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.ddl = source["ddl"];
	        this.details = this.convertValues(source["details"], ObjectDetail);
	        this.columns = this.convertValues(source["columns"], TableColumnInfo);
	        this.indexes = this.convertValues(source["indexes"], TableIndexInfo);
	        this.foreignKeys = this.convertValues(source["foreignKeys"], TableForeignKeyInfo);
	        this.referencedBy = this.convertValues(source["referencedBy"], TableReferenceInfo);
	        this.editability = this.convertValues(source["editability"], TableEditabilityInfo);
	        this.sequence = this.convertValues(source["sequence"], SequenceInfo);
	        this.functions = this.convertValues(source["functions"], FunctionInfo);
	        this.type = this.convertValues(source["type"], TypeInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ResultSchema {
	    columns: ColumnDef[];
	
	    static createFrom(source: any = {}) {
	        return new ResultSchema(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = this.convertValues(source["columns"], ColumnDef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class StatementRange {
	    startOffset: number;
	    endOffset: number;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new StatementRange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startOffset = source["startOffset"];
	        this.endOffset = source["endOffset"];
	        this.text = source["text"];
	    }
	}
	export class RunQueryRequest {
	    profileId: string;
	    database: string;
	    sql: string;
	    statements: StatementRange[];
	    mode: string;
	    limit?: number;
	    readOnly: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RunQueryRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.database = source["database"];
	        this.sql = source["sql"];
	        this.statements = this.convertValues(source["statements"], StatementRange);
	        this.mode = source["mode"];
	        this.limit = source["limit"];
	        this.readOnly = source["readOnly"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RunQueryResponse {
	    jobId: string;
	    sessionId: string;
	    backendPid: number;
	
	    static createFrom(source: any = {}) {
	        return new RunQueryResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	        this.sessionId = source["sessionId"];
	        this.backendPid = source["backendPid"];
	    }
	}
	export class SaveScriptRequest {
	    path: string;
	    title: string;
	    sql: string;
	    profileId: string;
	    database: string;
	    chooseLocation: boolean;
	    defaultFilename: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveScriptRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.title = source["title"];
	        this.sql = source["sql"];
	        this.profileId = source["profileId"];
	        this.database = source["database"];
	        this.chooseLocation = source["chooseLocation"];
	        this.defaultFilename = source["defaultFilename"];
	    }
	}
	export class SaveScriptResponse {
	    path: string;
	    title: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveScriptResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.title = source["title"];
	    }
	}
	export class ScriptTabState {
	    id: string;
	    title: string;
	    path: string;
	    sql: string;
	    savedSql: string;
	    profileId: string;
	    database: string;
	
	    static createFrom(source: any = {}) {
	        return new ScriptTabState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.path = source["path"];
	        this.sql = source["sql"];
	        this.savedSql = source["savedSql"];
	        this.profileId = source["profileId"];
	        this.database = source["database"];
	    }
	}
	export class ScriptWorkspace {
	    tabs: ScriptTabState[];
	    activeTabId: string;
	
	    static createFrom(source: any = {}) {
	        return new ScriptWorkspace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tabs = this.convertValues(source["tabs"], ScriptTabState);
	        this.activeTabId = source["activeTabId"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	
	export class TableInfo {
	    database: string;
	    schema: string;
	    name: string;
	    kind: string;
	    ddl: string;
	    columns: TableColumnInfo[];
	    indexes: TableIndexInfo[];
	    foreignKeys: TableForeignKeyInfo[];
	    referencedBy: TableReferenceInfo[];
	    editability: TableEditabilityInfo;
	
	    static createFrom(source: any = {}) {
	        return new TableInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.database = source["database"];
	        this.schema = source["schema"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.ddl = source["ddl"];
	        this.columns = this.convertValues(source["columns"], TableColumnInfo);
	        this.indexes = this.convertValues(source["indexes"], TableIndexInfo);
	        this.foreignKeys = this.convertValues(source["foreignKeys"], TableForeignKeyInfo);
	        this.referencedBy = this.convertValues(source["referencedBy"], TableReferenceInfo);
	        this.editability = this.convertValues(source["editability"], TableEditabilityInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	

}

