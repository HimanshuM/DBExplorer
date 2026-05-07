import type { editor } from 'monaco-editor';
import { type SQLExecutionTarget } from './types';

export function getSQLExecutionTarget(
  mountedEditor: editor.IStandaloneCodeEditor | null,
  fallbackSQL: string,
): SQLExecutionTarget {
  const model = mountedEditor?.getModel();
  if (!mountedEditor || !model) {
    return {
      sql: fallbackSQL.trim(),
      mode: 'statement',
      startOffset: 0,
      endOffset: fallbackSQL.length,
    };
  }

  const selection = mountedEditor.getSelection();
  if (selection && !selection.isEmpty()) {
    const rawSelection = model.getValueInRange(selection);
    const leadingWhitespace = rawSelection.length - rawSelection.trimStart().length;
    const trailingWhitespace = rawSelection.length - rawSelection.trimEnd().length;
    const startOffset = model.getOffsetAt(selection.getStartPosition()) + leadingWhitespace;
    const endOffset = model.getOffsetAt(selection.getEndPosition()) - trailingWhitespace;

    return {
      sql: rawSelection.trim(),
      mode: 'selection',
      startOffset,
      endOffset,
    };
  }

  const position = mountedEditor.getPosition() ?? model.getPositionAt(0);
  return findStatementAtOffset(model.getValue(), model.getOffsetAt(position));
}

export function getSQLStatementAtCursor(
  mountedEditor: editor.ICodeEditor,
): SQLExecutionTarget {
  const model = mountedEditor.getModel();
  if (!model) {
    return {
      sql: '',
      mode: 'statement',
      startOffset: 0,
      endOffset: 0,
    };
  }

  const position = mountedEditor.getPosition() ?? model.getPositionAt(0);
  return findStatementAtOffset(model.getValue(), model.getOffsetAt(position));
}

function findStatementAtOffset(source: string, cursorOffset: number): SQLExecutionTarget {
  const statements = splitSQLStatements(source);
  const containingStatement = statements.find(
    (statement) =>
      cursorOffset >= statement.startOffset &&
      cursorOffset <= (statement.cursorEndOffset ?? statement.endOffset),
  );
  const nextStatement = statements.find((statement) => statement.startOffset >= cursorOffset);
  const previousStatement = [...statements]
    .reverse()
    .find((statement) => statement.endOffset <= cursorOffset);
  const statement = containingStatement ?? nextStatement ?? previousStatement;

  if (!statement) {
    return {
      sql: '',
      mode: 'statement',
      startOffset: cursorOffset,
      endOffset: cursorOffset,
    };
  }

  return statement;
}

function splitSQLStatements(source: string): SQLExecutionTarget[] {
  const statements: SQLExecutionTarget[] = [];
  let statementStart = 0;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "'") {
      index = skipSingleQuotedString(source, index + 1);
      continue;
    }
    if (char === '"') {
      index = skipDoubleQuotedIdentifier(source, index + 1);
      continue;
    }
    if (char === '-' && next === '-') {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (char === '$') {
      const dollarQuoteEnd = skipDollarQuotedString(source, index);
      if (dollarQuoteEnd !== index) {
        index = dollarQuoteEnd;
        continue;
      }
    }
    if (char === ';') {
      const statementAdded = pushStatement(statements, source, statementStart, index, index + 1);
      if (!statementAdded) {
        extendPreviousStatementCursorBoundary(statements, index + 1);
      }
      statementStart = index + 1;
    }

    index += 1;
  }

  pushStatement(statements, source, statementStart, source.length, source.length);
  return statements;
}

function pushStatement(
  statements: SQLExecutionTarget[],
  source: string,
  rawStartOffset: number,
  rawEndOffset: number,
  cursorEndOffset: number,
): boolean {
  const raw = source.slice(rawStartOffset, rawEndOffset);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const trailingWhitespace = raw.length - raw.trimEnd().length;
  const startOffset = rawStartOffset + leadingWhitespace;
  const endOffset = rawEndOffset - trailingWhitespace;
  const sql = source.slice(startOffset, endOffset);

  if (sql.trim()) {
    statements.push({ sql, mode: 'statement', startOffset, endOffset, cursorEndOffset });
    return true;
  }
  return false;
}

function extendPreviousStatementCursorBoundary(
  statements: SQLExecutionTarget[],
  cursorEndOffset: number,
) {
  const previousStatement = statements[statements.length - 1];
  if (previousStatement) {
    previousStatement.cursorEndOffset = Math.max(
      previousStatement.cursorEndOffset ?? previousStatement.endOffset,
      cursorEndOffset,
    );
  }
}

function skipSingleQuotedString(source: string, index: number) {
  while (index < source.length) {
    if (source[index] === "'" && source[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (source[index] === "'") {
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function skipDoubleQuotedIdentifier(source: string, index: number) {
  while (index < source.length) {
    if (source[index] === '"' && source[index + 1] === '"') {
      index += 2;
      continue;
    }
    if (source[index] === '"') {
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function skipLineComment(source: string, index: number) {
  while (index < source.length && source[index] !== '\n') {
    index += 1;
  }
  return index;
}

function skipBlockComment(source: string, index: number) {
  while (index < source.length) {
    if (source[index] === '*' && source[index + 1] === '/') {
      return index + 2;
    }
    index += 1;
  }
  return index;
}

function skipDollarQuotedString(source: string, index: number) {
  const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
  if (!match) {
    return index;
  }

  const tag = match[0];
  const closingIndex = source.indexOf(tag, index + tag.length);
  if (closingIndex === -1) {
    return source.length;
  }
  return closingIndex + tag.length;
}
