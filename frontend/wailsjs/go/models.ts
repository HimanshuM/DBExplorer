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

}

