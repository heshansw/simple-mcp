import * as ts from "typescript";

type FunctionNesting = {
  startLine: number;
  endLine: number;
  maxNestingDepth: number;
};

export function computeNestingDepths(
  source: string,
  fileName: string,
): FunctionNesting[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const results: FunctionNesting[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const endLine =
        sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const maxDepth = computeMaxNesting(node, 0);
      results.push({ startLine, endLine, maxNestingDepth: maxDepth });
    }

    ts.forEachChild(node, visit);
  }

  function computeMaxNesting(node: ts.Node, currentDepth: number): number {
    let maxDepth = currentDepth;

    function walkNesting(n: ts.Node, depth: number): void {
      let newDepth = depth;

      if (
        ts.isIfStatement(n) ||
        ts.isForStatement(n) ||
        ts.isForInStatement(n) ||
        ts.isForOfStatement(n) ||
        ts.isWhileStatement(n) ||
        ts.isDoStatement(n) ||
        ts.isSwitchStatement(n) ||
        ts.isTryStatement(n) ||
        ts.isConditionalExpression(n)
      ) {
        newDepth = depth + 1;
        if (newDepth > maxDepth) {
          maxDepth = newDepth;
        }
      }

      // Don't descend into nested function declarations (they have their own scope)
      if (
        n !== node &&
        (ts.isFunctionDeclaration(n) ||
          ts.isFunctionExpression(n) ||
          ts.isArrowFunction(n) ||
          ts.isMethodDeclaration(n))
      ) {
        return;
      }

      ts.forEachChild(n, (child: ts.Node) => walkNesting(child, newDepth));
    }

    // Start walking from the function body
    const body = (node as ts.FunctionLikeDeclaration).body;
    if (body) {
      ts.forEachChild(body, (child: ts.Node) => walkNesting(child, currentDepth));
    }

    return maxDepth;
  }

  visit(sourceFile);
  return results;
}
