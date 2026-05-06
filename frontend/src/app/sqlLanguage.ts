import { type editor } from 'monaco-editor';
import { type ExplorerTreeNodeKind } from '../types';

export type SQLCompletionObject = {
  schema: string;
  name: string;
  kind: Extract<ExplorerTreeNodeKind, 'table' | 'view' | 'materialized_view' | 'sequence' | 'function' | 'type'>;
};

export type SQLCompletionData = {
  profileID: string;
  database: string;
  objects: SQLCompletionObject[];
  schemas: string[];
};

export type SQLCompletionColumn = {
  table: string;
  schema: string;
  name: string;
  dataType: string;
};

export type SQLReferencedRelation = {
  schema: string;
  name: string;
  alias: string;
};

export const SQL_KEYWORDS = new Set([
  'add',
  'all',
  'alter',
  'and',
  'any',
  'as',
  'asc',
  'between',
  'by',
  'case',
  'cast',
  'check',
  'column',
  'constraint',
  'create',
  'cross',
  'current_date',
  'current_time',
  'current_timestamp',
  'database',
  'default',
  'delete',
  'desc',
  'distinct',
  'drop',
  'else',
  'end',
  'except',
  'exists',
  'false',
  'for',
  'foreign',
  'from',
  'full',
  'group',
  'having',
  'in',
  'index',
  'inner',
  'insert',
  'intersect',
  'into',
  'is',
  'join',
  'key',
  'left',
  'like',
  'limit',
  'not',
  'null',
  'offset',
  'on',
  'or',
  'order',
  'outer',
  'primary',
  'references',
  'returning',
  'right',
  'select',
  'set',
  'table',
  'then',
  'true',
  'truncate',
  'union',
  'unique',
  'update',
  'using',
  'values',
  'when',
  'where',
  'with',
]);

export const SQL_FUNCTIONS = [
  'abs',
  'avg',
  'coalesce',
  'concat',
  'count',
  'date_trunc',
  'extract',
  'greatest',
  'json_agg',
  'json_build_object',
  'least',
  'lower',
  'max',
  'min',
  'now',
  'nullif',
  'round',
  'substring',
  'sum',
  'to_char',
  'trim',
  'upper',
];

const SQL_OBJECT_CONTEXT_KEYWORDS = new Set([
  'from',
  'join',
  'into',
  'update',
  'references',
  'table',
]);

const SQL_CLAUSE_KEYWORDS = new Set([
  'select',
  'from',
  'join',
  'where',
  'on',
  'having',
  'group',
  'order',
  'limit',
  'offset',
  'returning',
  'set',
  'values',
  'union',
  'except',
  'intersect',
]);

const SQL_RELATION_OBJECT_KINDS = new Set(['table', 'view', 'materialized_view']);
const SQL_SEMANTIC_TOKEN_TYPES = ['sqlSchema', 'sqlTable', 'sqlColumn'] as const;

type SQLSemanticTokenType = typeof SQL_SEMANTIC_TOKEN_TYPES[number];

type SQLIdentifierToken = {
  value: string;
  lineNumber: number;
  startColumn: number;
  length: number;
};

type SQLParsedToken = SQLIdentifierToken & {
  kind: 'identifier' | 'dot' | 'comma' | 'keyword' | 'openParen';
};

type SQLClassifiedToken = SQLIdentifierToken & {
  tokenType: SQLSemanticTokenType;
};

export function isSQLKeywordDelimiter(value: string) {
  return /[\s(),;]/.test(value);
}

function isSQLWordCharacter(value: string) {
  return /[A-Za-z_]/.test(value);
}

function isSQLIdentifierStart(value: string) {
  return /[A-Za-z_]/.test(value);
}

function isSQLIdentifierPart(value: string) {
  return /[A-Za-z0-9_$]/.test(value);
}

function isInsideSimpleSQLStringOrLineComment(line: string, column: number) {
  const prefix = line.slice(0, column - 1);
  const lineCommentIndex = prefix.indexOf('--');
  let inSingleQuotedString = false;

  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== "'") {
      continue;
    }

    if (inSingleQuotedString && prefix[index + 1] === "'") {
      index += 1;
      continue;
    }

    inSingleQuotedString = !inSingleQuotedString;
  }

  return inSingleQuotedString || lineCommentIndex >= 0;
}

export function uppercaseSQLKeywordBeforePosition(
  mountedEditor: editor.IStandaloneCodeEditor,
  position: { lineNumber: number; column: number },
) {
  const model = mountedEditor.getModel();
  if (!model) {
    return;
  }

  const line = model.getLineContent(position.lineNumber);
  let tokenEndIndex = position.column - 2;

  while (tokenEndIndex >= 0 && isSQLKeywordDelimiter(line[tokenEndIndex])) {
    tokenEndIndex -= 1;
  }

  if (tokenEndIndex < 0 || !isSQLWordCharacter(line[tokenEndIndex])) {
    return;
  }

  let tokenStartIndex = tokenEndIndex;
  while (tokenStartIndex > 0 && isSQLWordCharacter(line[tokenStartIndex - 1])) {
    tokenStartIndex -= 1;
  }

  const token = line.slice(tokenStartIndex, tokenEndIndex + 1);
  const upperToken = token.toUpperCase();
  if (token === upperToken || !SQL_KEYWORDS.has(token.toLowerCase())) {
    return;
  }

  const startColumn = tokenStartIndex + 1;
  if (isInsideSimpleSQLStringOrLineComment(line, startColumn)) {
    return;
  }

  mountedEditor.executeEdits('uppercase-sql-keyword', [
    {
      range: {
        startLineNumber: position.lineNumber,
        startColumn,
        endLineNumber: position.lineNumber,
        endColumn: tokenEndIndex + 2,
      },
      text: upperToken,
      forceMoveMarkers: true,
    },
  ]);
}

function tokenizeSQLForSemanticColors(value: string) {
  const tokens: SQLParsedToken[] = [];
  let inBlockComment = false;

  value.split('\n').forEach((line, lineIndex) => {
    let index = 0;
    const lineNumber = lineIndex + 1;

    while (index < line.length) {
      const char = line[index];
      const nextChar = line[index + 1];

      if (inBlockComment) {
        const blockCommentEnd = line.indexOf('*/', index);
        if (blockCommentEnd < 0) {
          break;
        }
        inBlockComment = false;
        index = blockCommentEnd + 2;
        continue;
      }

      if (char === '-' && nextChar === '-') {
        break;
      }

      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        index += 2;
        continue;
      }

      if (char === "'") {
        index += 1;
        while (index < line.length) {
          if (line[index] === "'" && line[index + 1] === "'") {
            index += 2;
            continue;
          }
          if (line[index] === "'") {
            index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }

      if (char === '"') {
        const start = index + 1;
        index += 1;
        while (index < line.length) {
          if (line[index] === '"' && line[index + 1] === '"') {
            index += 2;
            continue;
          }
          if (line[index] === '"') {
            break;
          }
          index += 1;
        }

        const end = index;
        if (end > start) {
          tokens.push({
            kind: 'identifier',
            value: line.slice(start, end),
            lineNumber,
            startColumn: start + 1,
            length: end - start,
          });
        }
        index = Math.min(index + 1, line.length);
        continue;
      }

      if (isSQLIdentifierStart(char)) {
        const start = index;
        index += 1;
        while (index < line.length && isSQLIdentifierPart(line[index])) {
          index += 1;
        }

        const word = line.slice(start, index);
        tokens.push({
          kind: SQL_KEYWORDS.has(word.toLowerCase()) ? 'keyword' : 'identifier',
          value: word,
          lineNumber,
          startColumn: start + 1,
          length: word.length,
        });
        continue;
      }

      if (char === '.') {
        tokens.push({ kind: 'dot', value: char, lineNumber, startColumn: index + 1, length: 1 });
      } else if (char === ',') {
        tokens.push({ kind: 'comma', value: char, lineNumber, startColumn: index + 1, length: 1 });
      } else if (char === '(') {
        tokens.push({ kind: 'openParen', value: char, lineNumber, startColumn: index + 1, length: 1 });
      }

      index += 1;
    }
  });

  return tokens;
}

function inferSQLCompletionContext(tokens: SQLParsedToken[]): 'keyword' | 'object' | 'function' | 'column' {
  const significantTokens = tokens.filter((token) => token.kind !== 'dot');
  const lastToken = significantTokens[significantTokens.length - 1];
  const lastValue = lastToken?.value.toLowerCase() ?? '';
  const previousToken = significantTokens[significantTokens.length - 2];
  const previousValue = previousToken?.value.toLowerCase() ?? '';
  const rawLastToken = tokens[tokens.length - 1];

  if (rawLastToken?.kind === 'dot') {
    return 'object';
  }

  if (lastToken?.kind === 'keyword' && SQL_OBJECT_CONTEXT_KEYWORDS.has(lastValue)) {
    return 'object';
  }

  if (
    lastToken?.kind === 'keyword' &&
    previousToken?.kind === 'keyword' &&
    ['full', 'inner', 'left', 'right', 'cross'].includes(previousValue) &&
    lastValue === 'join'
  ) {
    return 'object';
  }

  let clause: string | null = null;
  for (const token of significantTokens) {
    const value = token.value.toLowerCase();
    if (token.kind === 'keyword' && SQL_CLAUSE_KEYWORDS.has(value)) {
      clause = value;
    }
  }

  if (clause === 'from' || clause === 'join') {
    return lastToken?.kind === 'comma' ? 'object' : 'keyword';
  }

  if (clause === 'where' || clause === 'on' || clause === 'having' || clause === 'returning') {
    return 'column';
  }

  if (clause === 'select') {
    return 'function';
  }

  return 'keyword';
}

export function getSQLCompletionContext(
  model: editor.ITextModel,
  position: { lineNumber: number; column: number },
) {
  const line = model.getLineContent(position.lineNumber);
  const word = model.getWordUntilPosition(position);

  if (isInsideSimpleSQLStringOrLineComment(line, word.startColumn)) {
    return null;
  }

  const textBeforeWord = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: word.startColumn,
  });

  return inferSQLCompletionContext(tokenizeSQLForSemanticColors(textBeforeWord));
}

function tokenIsKeyword(token: SQLParsedToken | undefined, keyword: string) {
  return token?.kind === 'keyword' && token.value.toLowerCase() === keyword;
}

function tokenIsClauseBoundary(token: SQLParsedToken | undefined) {
  if (token?.kind !== 'keyword') {
    return false;
  }
  const value = token.value.toLowerCase();
  return SQL_CLAUSE_KEYWORDS.has(value) || ['as', 'inner', 'left', 'right', 'full', 'cross', 'outer'].includes(value);
}

function matchSQLCompletionObject(
  completionData: SQLCompletionData,
  parts: string[],
): SQLCompletionObject | null {
  if (parts.length === 0) {
    return null;
  }

  const name = parts[parts.length - 1];
  const schema = parts.length >= 2 ? parts[parts.length - 2] : '';
  const candidates = completionData.objects.filter((object) =>
    SQL_RELATION_OBJECT_KINDS.has(object.kind) &&
    object.name.toLowerCase() === name.toLowerCase() &&
    (!schema || object.schema.toLowerCase() === schema.toLowerCase()),
  );

  return (
    candidates.find((object) => object.schema === 'public') ??
    candidates[0] ??
    null
  );
}

function collectReferencedSQLRelations(
  tokens: SQLParsedToken[],
  completionData: SQLCompletionData,
): SQLReferencedRelation[] {
  const relations: SQLReferencedRelation[] = [];
  let relationListActive = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const value = token.value.toLowerCase();
    if (token.kind === 'keyword') {
      if (['from', 'join', 'update', 'into'].includes(value)) {
        relationListActive = true;
      } else if (SQL_CLAUSE_KEYWORDS.has(value) && value !== 'join') {
        relationListActive = false;
      }
    }
    const introducesRelation =
      (token.kind === 'keyword' && ['from', 'join', 'update', 'into'].includes(value)) ||
      (token.kind === 'comma' && relationListActive && relations.length > 0);

    if (!introducesRelation) {
      continue;
    }

    let partIndex = index + 1;
    while (tokenIsKeyword(tokens[partIndex], 'as')) {
      partIndex += 1;
    }
    if (tokens[partIndex]?.kind !== 'identifier') {
      continue;
    }

    const parts: string[] = [];
    while (tokens[partIndex]?.kind === 'identifier') {
      parts.push(tokens[partIndex].value);
      if (tokens[partIndex + 1]?.kind !== 'dot' || tokens[partIndex + 2]?.kind !== 'identifier') {
        break;
      }
      partIndex += 2;
    }

    const object = matchSQLCompletionObject(completionData, parts);
    if (!object) {
      continue;
    }

    let alias = '';
    const aliasCandidateIndex = partIndex + 1;
    if (tokenIsKeyword(tokens[aliasCandidateIndex], 'as') && tokens[aliasCandidateIndex + 1]?.kind === 'identifier') {
      alias = tokens[aliasCandidateIndex + 1].value;
    } else if (
      tokens[aliasCandidateIndex]?.kind === 'identifier' &&
      !tokenIsClauseBoundary(tokens[aliasCandidateIndex])
    ) {
      alias = tokens[aliasCandidateIndex].value;
    }

    relations.push({ schema: object.schema, name: object.name, alias });
    index = partIndex;
  }

  return relations;
}

export function getSQLReferencedRelations(
  model: editor.ITextModel,
  position: { lineNumber: number; column: number },
  completionData: SQLCompletionData,
) {
  const word = model.getWordUntilPosition(position);
  const textBeforeWord = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: word.startColumn,
  });

  return collectReferencedSQLRelations(tokenizeSQLForSemanticColors(textBeforeWord), completionData);
}

function tokenKey(token: SQLIdentifierToken) {
  return `${token.lineNumber}:${token.startColumn}`;
}

function nextNonDotToken(tokens: SQLParsedToken[], index: number) {
  return tokens.slice(index + 1).find((token) => token.kind !== 'dot');
}

function classifyQualifiedSQLName(
  tokens: SQLParsedToken[],
  startIndex: number,
  finalType: 'sqlTable' | 'sqlColumn',
  classifiedByKey: Map<string, SQLClassifiedToken>,
) {
  const parts: SQLParsedToken[] = [];
  let index = startIndex;

  while (tokens[index]?.kind === 'identifier') {
    parts.push(tokens[index]);
    if (tokens[index + 1]?.kind !== 'dot' || tokens[index + 2]?.kind !== 'identifier') {
      break;
    }
    index += 2;
  }

  if (parts.length === 0) {
    return startIndex;
  }

  const roleByPart = parts.map<SQLSemanticTokenType>((_, partIndex) => {
    if (finalType === 'sqlColumn') {
      if (parts.length >= 3 && partIndex === parts.length - 3) {
        return 'sqlSchema';
      }
      if (parts.length >= 2 && partIndex === parts.length - 2) {
        return 'sqlTable';
      }
      return 'sqlColumn';
    }

    if (parts.length >= 2 && partIndex === parts.length - 2) {
      return 'sqlSchema';
    }
    return partIndex === parts.length - 1 ? 'sqlTable' : 'sqlSchema';
  });

  parts.forEach((part, partIndex) => {
    classifiedByKey.set(tokenKey(part), {
      value: part.value,
      lineNumber: part.lineNumber,
      startColumn: part.startColumn,
      length: part.length,
      tokenType: roleByPart[partIndex],
    });
  });

  return index;
}

function buildSQLSemanticTokens(value: string) {
  const tokens = tokenizeSQLForSemanticColors(value);
  const classifiedByKey = new Map<string, SQLClassifiedToken>();
  let clause: 'select' | 'from' | 'column' | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lowerValue = token.value.toLowerCase();

    if (token.kind === 'keyword') {
      if (lowerValue === 'select') {
        clause = 'select';
      } else if (lowerValue === 'from') {
        clause = 'from';
        if (tokens[index + 1]?.kind === 'identifier') {
          index = classifyQualifiedSQLName(tokens, index + 1, 'sqlTable', classifiedByKey);
        }
      } else if (['join', 'update', 'references'].includes(lowerValue)) {
        if (tokens[index + 1]?.kind === 'identifier') {
          index = classifyQualifiedSQLName(tokens, index + 1, 'sqlTable', classifiedByKey);
        }
      } else if (lowerValue === 'into') {
        clause = 'from';
        if (tokens[index + 1]?.kind === 'identifier') {
          index = classifyQualifiedSQLName(tokens, index + 1, 'sqlTable', classifiedByKey);
        }
      } else if (lowerValue === 'table' && tokens[index + 1]?.kind === 'identifier') {
        index = classifyQualifiedSQLName(tokens, index + 1, 'sqlTable', classifiedByKey);
      } else if (['where', 'on', 'having', 'set', 'returning'].includes(lowerValue)) {
        clause = 'column';
      } else if (['order', 'group', 'by'].includes(lowerValue)) {
        clause = 'column';
      } else if (['limit', 'offset', 'values'].includes(lowerValue)) {
        clause = null;
      }
      continue;
    }

    if (token.kind === 'identifier') {
      if (clause === 'from' && tokens[index - 1]?.kind === 'comma') {
        index = classifyQualifiedSQLName(tokens, index, 'sqlTable', classifiedByKey);
        continue;
      }

      if ((clause === 'select' || clause === 'column') && nextNonDotToken(tokens, index)?.kind !== 'openParen') {
        index = classifyQualifiedSQLName(tokens, index, 'sqlColumn', classifiedByKey);
      }
    }
  }

  return Array.from(classifiedByKey.values()).sort(
    (left, right) => left.lineNumber - right.lineNumber || left.startColumn - right.startColumn,
  );
}

export function buildSQLIdentifierDecorations(value: string): editor.IModelDeltaDecoration[] {
  return buildSQLSemanticTokens(value).map((token) => ({
    range: {
      startLineNumber: token.lineNumber,
      startColumn: token.startColumn,
      endLineNumber: token.lineNumber,
      endColumn: token.startColumn + token.length,
    },
    options: {
      inlineClassName: `sql-token-${token.tokenType.replace('sql', '').toLowerCase()}`,
    },
  }));
}
