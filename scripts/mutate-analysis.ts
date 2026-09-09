import ts from 'typescript';

export type Mutant = {
  start: number;
  end: number;
  replacement: string;
  operator: string;
  line: number;
  original: string;
};

/** Operator swaps. Each pair is a mistake a person actually makes. */
const BINARY: Record<string, string[]> = {
  '===': ['!=='],
  '!==': ['==='],
  '==': ['!='],
  '!=': ['=='],
  '<': ['<=', '>='],
  '<=': ['<'],
  '>': ['>=', '<='],
  '>=': ['>'],
  '&&': ['||'],
  '||': ['&&'],
  '+': ['-'],
  '-': ['+'],
};

const PREDICATE_CALLS = new Set([
  'includes', 'some', 'every', 'startsWith', 'endsWith', 'test', 'has', 'match',
]);

/** Enumerate behavior-changing operator, literal, guard, and predicate mutants. */
export function mutantsFor(source: ts.SourceFile): Mutant[] {
  const text = source.getFullText();
  const found: Mutant[] = [];

  const at = (start: number, end: number, replacement: string, operator: string) => {
    found.push({
      start,
      end,
      replacement,
      operator,
      line: source.getLineAndCharacterOfPosition(start).line + 1,
      original: text.slice(start, end),
    });
  };

  const visit = (node: ts.Node): void => {
    // Types are erased before anything runs, so a mutant inside one cannot
    // change behaviour and no test can kill it.
    if (ts.isTypeNode(node)) return;

    if (ts.isBinaryExpression(node)) {
      const token = node.operatorToken;
      const swaps = BINARY[text.slice(token.getStart(source), token.getEnd())];
      if (swaps) {
        for (const swap of swaps) at(token.getStart(source), token.getEnd(), swap, 'binary');
      }
    }

    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      at(node.getStart(source), node.operand.getStart(source), '', 'negation');
    }

    if (node.kind === ts.SyntaxKind.TrueKeyword) {
      at(node.getStart(source), node.getEnd(), 'false', 'boolean');
    }
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
      at(node.getStart(source), node.getEnd(), 'true', 'boolean');
    }

    if (ts.isNumericLiteral(node)) {
      const value = Number(node.text);
      if (Number.isFinite(value)) {
        at(node.getStart(source), node.getEnd(), String(value + 1), 'number');
      }
    }

    if (ts.isIfStatement(node)) {
      const condition = node.expression;
      const kind = condition.kind;
      if (kind !== ts.SyntaxKind.TrueKeyword && kind !== ts.SyntaxKind.FalseKeyword) {
        at(condition.getStart(source), condition.getEnd(), 'true', 'guard');
        at(condition.getStart(source), condition.getEnd(), 'false', 'guard');
      }
    }

    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && PREDICATE_CALLS.has(node.expression.name.text)
    ) {
      at(node.getStart(source), node.getEnd(), 'true', 'predicate');
      at(node.getStart(source), node.getEnd(), 'false', 'predicate');
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return found.sort((a, b) => b.start - a.start);
}
