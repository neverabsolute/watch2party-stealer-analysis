// Pass 4: resolve the global-object getter and the function dispatcher call convention. Static only.
const fs = require('fs');

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const [,, inPath, outPath] = process.argv;
const src = fs.readFileSync(inPath, 'utf8');
const ast = parser.parse(src, { sourceType: 'script', allowReturnOutsideFunction: true });
let progScope; traverse(ast, { Program(p) { progScope = p.scope; p.stop(); } });
const isTop = (p, name) => { const b = p.scope.getBinding(name); return b && b.scope === progScope; };

// 1) global getter map: case "K": return <obj>.NAME;
const GMAP = {};
traverse(ast, {
  FunctionDeclaration(p) {
    if (p.node.id.name !== 'lnNSwE1' || p.parentPath.node !== ast.program) return;
    p.traverse({ SwitchCase(c) {
      const tst = c.node.test, st = c.node.consequent[0];
      if (t.isStringLiteral(tst) && t.isReturnStatement(st) && t.isMemberExpression(st.argument) && t.isIdentifier(st.argument.property) && !st.argument.computed) GMAP[tst.value] = st.argument.property.name;
    } });
    p.skip();
  }
});
console.log('global map entries:', Object.keys(GMAP).length);
let g1 = 0, gMiss = new Set();
traverse(ast, {
  CallExpression(p) {
    const { callee, arguments: a } = p.node;
    if (!t.isIdentifier(callee, { name: 'lnNSwE1' }) || a.length !== 1 || !t.isStringLiteral(a[0]) || !isTop(p, 'lnNSwE1')) return;
    const nm = GMAP[a[0].value];
    if (!nm) { gMiss.add(a[0].value); return; }
    p.replaceWith(t.identifier(nm)); g1++;
  }
});
console.log('global refs replaced:', g1, 'unmapped:', [...gMiss].join(','));

// 2) dispatcher
const isDisp = (n, p) => (t.isCallExpression(n) || t.isNewExpression(n)) && t.isIdentifier(n.callee, { name: 'vjXktF' }) && n.arguments.length >= 1 && t.isStringLiteral(n.arguments[0]);
const fname = k => 'F_' + k.replace(/[^A-Za-z0-9_$]/g, '_');
let d1 = 0, d2 = 0, d3 = 0;
traverse(ast, {
  // unwrap `.AkcnBoJ8dJ`
  MemberExpression: { exit(p) {
    const { object, property, computed } = p.node;
    if (!computed && t.isIdentifier(property, { name: 'AkcnBoJ8dJ' })) {
      if (isDisp(object)) { object._unwrapped = true; p.replaceWith(object); }
      else if (t.isSequenceExpression(object) && isDisp(object.expressions[object.expressions.length - 1])) { object.expressions[object.expressions.length - 1]._unwrapped = true; p.replaceWith(object); }
    }
  } }
});
traverse(ast, {
  SequenceExpression: { exit(p) {
    const ex = p.node.expressions;
    if (ex.length !== 2) return;
    const [a, d] = ex;
    if (!t.isAssignmentExpression(a) || !t.isIdentifier(a.left, { name: 'TqlMGa' }) || !t.isArrayExpression(a.right) || !isDisp(d)) return;
    const flags = d.arguments.slice(1).map(x => x.value);
    const id = t.identifier(fname(d.arguments[0].value));
    if (flags.includes('I7UchUSfxK')) { p.replaceWith(t.callExpression(t.memberExpression(id, t.identifier('bind_args')), a.right.elements)); d3++; return; }
    p.replaceWith(t.callExpression(id, a.right.elements)); d1++;
  } }
});
traverse(ast, {
  'CallExpression|NewExpression': { exit(p) {
    const n = p.node;
    if (!isDisp(n) || !isTop(p, 'vjXktF')) return;
    const flags = n.arguments.slice(1).map(x => x.value);
    const id = t.identifier(fname(n.arguments[0].value));
    if (flags.includes('I7UchUSfxK')) { p.replaceWith(id); d3++; return; }             // function reference
    if (flags.includes('M1s21EPrd9')) { p.replaceWith(t.callExpression(id, [])); d2++; return; }
    p.replaceWith(t.callExpression(id, [t.spreadElement(t.identifier('TqlMGa'))])); d2++;
  } }
});
console.log({ dispatchWithArgs: d1, dispatchNoArgs: d2, dispatchRefs: d3 });
fs.writeFileSync(outPath, generate(ast, { compact: false, comments: false, jsescOption: { minimal: true } }).code);
