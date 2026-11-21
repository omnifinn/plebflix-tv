import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

test('all widget scripts and the player shim parse as ES5', async () => {
  execFileSync(process.execPath, ['tizen/build.mjs']);
  for (const file of ['dist/tizen/stage/bundle.js','dist/tizen/stage/snapshot.js','tizen/diagnostics.js','public/tv/yt-shim.js']) {
    const text = await readFile(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES5, true, ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length, 0, file);
    const errors=[];
    function visit(n) {
      if (ts.isArrowFunction(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isForOfStatement(n) || ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isSpreadElement(n) || ts.isSpreadAssignment(n) || n.questionDotToken || (ts.isCatchClause(n) && !n.variableDeclaration) || (ts.isVariableDeclarationList(n) && (n.flags & (ts.NodeFlags.Let|ts.NodeFlags.Const))) || (ts.isParameter(n) && (n.initializer || n.dotDotDotToken))) errors.push(ts.SyntaxKind[n.kind]);
      if (n.kind===ts.SyntaxKind.RegularExpressionLiteral && /\(\?<([=!])/.test(n.getText(source))) errors.push('regex lookbehind');
      ts.forEachChild(n, visit);
    }
    visit(source);
    assert.deepEqual(errors, [], file);
  }
});
