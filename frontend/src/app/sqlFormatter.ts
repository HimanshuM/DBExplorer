type SQLTokenKind =
  | 'word'
  | 'number'
  | 'string'
  | 'comment'
  | 'operator'
  | 'comma'
  | 'dot'
  | 'openParen'
  | 'closeParen'
  | 'semicolon'
  | 'other';

type SQLToken = {
  kind: SQLTokenKind;
  value: string;
  upper: string;
};

type FormatterOptions = {
  indentSize: number;
  multilineListThreshold: number;
  longListThreshold: number;
};

const DEFAULT_OPTIONS: FormatterOptions = {
  indentSize: 4,
  multilineListThreshold: 5,
  longListThreshold: 5,
};

const CLAUSE_KEYWORDS = new Set([
  'FROM',
  'WHERE',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'RETURNING',
]);

const JOIN_PREFIXES = new Set([
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
]);

const RESERVED_WORDS = new Set([
  'SELECT',
  'DISTINCT',
  'FROM',
  'WHERE',
  'GROUP',
  'BY',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
  'OUTER',
  'ON',
  'AND',
  'OR',
  'IN',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'AS',
  'IS',
  'NULL',
  'NOT',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'ASC',
  'DESC',
  'UNION',
  'ALL',
]);

function tokenizeSQL(sql: string): SQLToken[] {
  const tokens: SQLToken[] = [];
  let index = 0;

  const push = (kind: SQLTokenKind, value: string) => {
    tokens.push({ kind, value, upper: value.toUpperCase() });
  };

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '-' && next === '-') {
      let end = index + 2;
      while (end < sql.length && sql[end] !== '\n') {
        end += 1;
      }
      push('comment', sql.slice(index, end));
      index = end;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      const commentEnd = end >= 0 ? end + 2 : sql.length;
      push('comment', sql.slice(index, commentEnd));
      index = commentEnd;
      continue;
    }

    if (char === "'") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (sql[end] === "'") {
          end += 1;
          break;
        }
        end += 1;
      }
      push('string', sql.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"') {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === '"' && sql[end + 1] === '"') {
          end += 2;
          continue;
        }
        if (sql[end] === '"') {
          end += 1;
          break;
        }
        end += 1;
      }
      push('string', sql.slice(index, end));
      index = end;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) {
        end += 1;
      }
      push('word', sql.slice(index, end));
      index = end;
      continue;
    }

    if (/[0-9]/.test(char)) {
      let end = index + 1;
      while (end < sql.length && /[0-9.]/.test(sql[end])) {
        end += 1;
      }
      push('number', sql.slice(index, end));
      index = end;
      continue;
    }

    if (char === ',') {
      push('comma', char);
    } else if (char === '.') {
      push('dot', char);
    } else if (char === '(') {
      push('openParen', char);
    } else if (char === ')') {
      push('closeParen', char);
    } else if (char === ';') {
      push('semicolon', char);
    } else if ('=<>+-*/%'.includes(char)) {
      const twoCharOperator = `${char}${next ?? ''}`;
      if (['>=', '<=', '<>', '!=', '||'].includes(twoCharOperator)) {
        push('operator', twoCharOperator);
        index += 2;
        continue;
      }
      push('operator', char);
    } else {
      push('other', char);
    }
    index += 1;
  }

  return tokens;
}

function upperToken(token: SQLToken) {
  return token.kind === 'word' && RESERVED_WORDS.has(token.upper) ? token.upper : token.value;
}

function indent(level: number, options: FormatterOptions) {
  return ' '.repeat(Math.max(0, level) * options.indentSize);
}

function isJoinStart(tokens: SQLToken[], index: number) {
  if (!JOIN_PREFIXES.has(tokens[index]?.upper)) {
    return false;
  }
  return tokens[index].upper === 'JOIN' || tokens.slice(index + 1, index + 3).some((token) => token.upper === 'JOIN');
}

function findMatchingParen(tokens: SQLToken[], openIndex: number) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].kind === 'openParen') {
      depth += 1;
    } else if (tokens[index].kind === 'closeParen') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevelCommaItems(tokens: SQLToken[]) {
  const items: SQLToken[][] = [];
  let current: SQLToken[] = [];
  let depth = 0;

  tokens.forEach((token) => {
    if (token.kind === 'openParen') {
      depth += 1;
    } else if (token.kind === 'closeParen') {
      depth -= 1;
    }

    if (token.kind === 'comma' && depth === 0) {
      items.push(current);
      current = [];
      return;
    }
    current.push(token);
  });

  if (current.length > 0 || items.length > 0) {
    items.push(current);
  }
  return items;
}

function joinInline(tokens: SQLToken[], options: FormatterOptions, baseIndentLevel = 0): string {
  let output = '';

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    const value = upperToken(token);

    if (token.kind === 'openParen') {
      const closeIndex = findMatchingParen(tokens, index);
      const previousUpper = previous?.upper ?? '';
      if (closeIndex > index && (previousUpper === 'IN' || closeIndex - index > options.longListThreshold * 2)) {
        const innerTokens = tokens.slice(index + 1, closeIndex);
        const innerItems = splitTopLevelCommaItems(innerTokens);
        if (innerItems.length > options.longListThreshold) {
          const currentLineIndent = output.match(/(?:^|\n)([^\n]*)$/)?.[1].match(/^\s*/)?.[0] ?? '';
          const baseIndent = currentLineIndent || indent(baseIndentLevel, options);
          const itemIndent = `${baseIndent}${indent(1, options)}`;
          output += `${previousUpper === 'IN' ? ' ' : ''}(\n`;
          output += innerItems
            .map((item, itemIndex) => `${itemIndent}${joinInline(item, options, baseIndentLevel + 1)}${itemIndex < innerItems.length - 1 ? ',' : ''}`)
            .join('\n');
          output += `\n${baseIndent})`;
          index = closeIndex;
          continue;
        }
      }
      if (previousUpper === 'IN') {
        output += ' ';
      }
      output += '(';
      continue;
    }

    if (token.kind === 'closeParen') {
      output = output.trimEnd();
      output += ')';
      continue;
    }

    if (token.kind === 'comma') {
      output = output.trimEnd();
      output += ', ';
      continue;
    }

    if (token.kind === 'dot') {
      output = output.trimEnd();
      output += '.';
      continue;
    }

    if (previous && previous.kind !== 'openParen' && previous.kind !== 'dot' && previous.kind !== 'comma') {
      output += ' ';
    }

    output += value;

    if (next?.kind === 'dot') {
      output = output.trimEnd();
    }
  }

  return output.trim();
}

function formatListClause(keyword: string, tokens: SQLToken[], baseIndent: number, options: FormatterOptions) {
  const items = splitTopLevelCommaItems(tokens);
  const label = keyword.toUpperCase();
  if (items.length <= options.multilineListThreshold) {
    return `${indent(baseIndent, options)}${label} ${joinInline(tokens, options)}`.trimEnd();
  }

  return items
    .map((item, index) => {
      const prefix = index === 0 ? `${indent(baseIndent, options)}${label} ` : indent(baseIndent + 1, options);
      return `${prefix}${joinInline(item, options)}${index < items.length - 1 ? ',' : ''}`;
    })
    .join('\n');
}

function formatConditionClause(keyword: string, tokens: SQLToken[], baseIndent: number, options: FormatterOptions) {
  const lines: string[] = [`${indent(baseIndent, options)}${keyword.toUpperCase()}`];
  const continuationIndent = keyword.toUpperCase() === 'ON' ? baseIndent : baseIndent + 1;
  let current: SQLToken[] = [];
  let depth = 0;

  const pushCurrent = () => {
    if (current.length > 0) {
      const lineIndentWidth = lines[lines.length - 1].match(/^\s*/)?.[0].length ?? 0;
      const lineIndentLevel = Math.floor(lineIndentWidth / options.indentSize);
      lines[lines.length - 1] += ` ${joinInline(current, options, lineIndentLevel)}`;
      current = [];
    }
  };

  for (const token of tokens) {
    if (token.kind === 'openParen') {
      depth += 1;
    } else if (token.kind === 'closeParen') {
      depth -= 1;
    }

    if ((token.upper === 'AND' || token.upper === 'OR') && depth === 0) {
      pushCurrent();
      if (token.upper === 'OR') {
        lines.push(`${indent(continuationIndent, options)}OR`);
        lines.push(indent(continuationIndent, options));
      } else {
        lines.push(`${indent(continuationIndent, options)}AND`);
      }
      continue;
    }

    current.push(token);
  }

  pushCurrent();
  return lines.join('\n');
}

function formatCaseBlocks(sql: string, options: FormatterOptions) {
  return sql
    .replace(/\bCASE\b/gi, 'CASE')
    .replace(/\s+\bWHEN\b/gi, `\n${indent(1, options)}WHEN`)
    .replace(/\s+\bELSE\b/gi, `\n${indent(1, options)}ELSE`)
    .replace(/\s+\bEND\b/gi, '\nEND');
}

function collectUntilClause(tokens: SQLToken[], startIndex: number) {
  let index = startIndex;
  let depth = 0;
  const collected: SQLToken[] = [];

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.kind === 'openParen') {
      depth += 1;
    } else if (token.kind === 'closeParen') {
      depth -= 1;
    }

    if (depth === 0) {
      if (token.kind === 'semicolon') {
        break;
      }
      if (token.upper === 'SELECT' && index !== startIndex) {
        break;
      }
      if (CLAUSE_KEYWORDS.has(token.upper) || token.upper === 'GROUP' || token.upper === 'ORDER' || isJoinStart(tokens, index)) {
        break;
      }
    }

    collected.push(token);
    index += 1;
  }

  return { tokens: collected, nextIndex: index };
}

function formatTokens(tokens: SQLToken[], options: FormatterOptions) {
  const lines: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];

    if (token.upper === 'SELECT') {
      const { tokens: selectTokens, nextIndex } = collectUntilClause(tokens, index + 1);
      lines.push(formatListClause('SELECT', selectTokens, 0, options));
      index = nextIndex;
      continue;
    }

    if (token.upper === 'FROM') {
      const { tokens: fromTokens, nextIndex } = collectUntilClause(tokens, index + 1);
      lines.push(`${indent(0, options)}FROM ${joinInline(fromTokens, options)}`.trimEnd());
      index = nextIndex;
      continue;
    }

    if (isJoinStart(tokens, index)) {
      const joinTokens: SQLToken[] = [];
      while (index < tokens.length && tokens[index].upper !== 'ON') {
        joinTokens.push(tokens[index]);
        index += 1;
      }
      lines.push(`${indent(0, options)}${joinInline(joinTokens, options)}`);
      if (tokens[index]?.upper === 'ON') {
        const { tokens: onTokens, nextIndex } = collectUntilClause(tokens, index + 1);
        lines.push(formatConditionClause('ON', onTokens, 1, options));
        index = nextIndex;
      }
      continue;
    }

    if (token.upper === 'WHERE') {
      const { tokens: whereTokens, nextIndex } = collectUntilClause(tokens, index + 1);
      lines.push(formatConditionClause('WHERE', whereTokens, 0, options));
      index = nextIndex;
      continue;
    }

    if (token.upper === 'GROUP' && tokens[index + 1]?.upper === 'BY') {
      const { tokens: groupTokens, nextIndex } = collectUntilClause(tokens, index + 2);
      lines.push(formatListClause('GROUP BY', groupTokens, 0, options));
      index = nextIndex;
      continue;
    }

    if (token.upper === 'ORDER' && tokens[index + 1]?.upper === 'BY') {
      const { tokens: orderTokens, nextIndex } = collectUntilClause(tokens, index + 2);
      lines.push(formatListClause('ORDER BY', orderTokens, 0, options));
      index = nextIndex;
      continue;
    }

    if (token.upper === 'OFFSET' || token.upper === 'LIMIT' || token.upper === 'HAVING') {
      const { tokens: clauseTokens, nextIndex } = collectUntilClause(tokens, index + 1);
      lines.push(`${indent(0, options)}${token.upper} ${joinInline(clauseTokens, options)}`.trimEnd());
      index = nextIndex;
      continue;
    }

    if (token.kind === 'semicolon') {
      if (lines.length === 0) {
        lines.push(';');
      } else {
        lines[lines.length - 1] = `${lines[lines.length - 1].trimEnd()};`;
      }
      if (tokens.slice(index + 1).some((remainingToken) => remainingToken.kind !== 'semicolon')) {
        lines.push('');
      }
      index += 1;
      continue;
    }

    lines.push(`${indent(0, options)}${joinInline([token], options)}`);
    index += 1;
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function formatSQL(sql: string, options: Partial<FormatterOptions> = {}) {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const formatted = formatTokens(tokenizeSQL(sql), mergedOptions);
  return formatCaseBlocks(formatted, mergedOptions);
}
