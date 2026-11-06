// Pass 1: resolve the top-level constant table + top-level base91 string table. Parse/transform only.
const fs = require('fs');

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const [,, inPath, outPath] = process.argv;
const src = fs.readFileSync(inPath, 'utf8');
const ast = parser.parse(src, { sourceType: 'script', allowReturnOutsideFunction: true });

function b91(alpha, s) {
  const out = []; let b = 0, n = 0, v = -1;
  for (const ch of s) {
    const p = alpha.indexOf(ch); if (p === -1) continue;
    if (v < 0) v = p; else {
      v += p * 91; b |= v << n; n += (v & 8191) > 88 ? 13 : 14;
      do { out.push(b & 255); b >>= 8; n -= 8; } while (n > 7);
      v = -1;
    }
  }
  if (v > -1) out.push((b | v << n) & 255);
  return Buffer.from(out).toString('utf8');
}
const ALPHA = 'YAnJV09^HI;7KEGmsqB+o$PzhLudcF.3N:%DO"@/RgalUr_84!fk5]1*WeZv?)&i`Qp=TCbMSj2ty(|w<~,{x6#}>X[';

// --- gather top-level tables
let CONSTS = null, STRS = null;
for (const s of ast.program.body) {
  if (s.type === 'VariableDeclaration' && s.declarations[0].id.name === 'YqIx7K') CONSTS = s.declarations[0].init.elements;
  if (s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' && s.expression.left.name === 'vAkBIr' && s.expression.right.type === 'CallExpression') {
    const [arr, cnt] = s.expression.right.arguments;
    STRS = arr.elements.map(e => e.value);
    const k = cnt.value; for (let i = 0; i < k; i++) STRS.push(STRS.shift());
  }
}
console.log('consts:', CONSTS.length, 'strings:', STRS.length);
const DEC = STRS.map(s => b91(ALPHA, s));
fs.writeFileSync(outPath + '.toplevel-strings.txt', DEC.map((s, i) => `${i}\t${JSON.stringify(s)}`).join('\n'));

const prog = ast.program;
let progScope;
traverse(ast, { Program(p) { progScope = p.scope; p.stop(); } });
const isTop = (p, name) => { const b = p.scope.getBinding(name); return b && b.scope === progScope; };
const numVal = n => t.isNumericLiteral(n) ? n.value : (t.isUnaryExpression(n) && n.operator === '-' && t.isNumericLiteral(n.argument) ? -n.argument.value : null);

let c1 = 0, c2 = 0, c3 = 0, c4 = 0;
// constants
traverse(ast, {
  MemberExpression(p) {
    const { object, property, computed } = p.node;
    if (!computed || !t.isIdentifier(object, { name: 'YqIx7K' }) || !isTop(p, 'YqIx7K')) return;
    const i = numVal(property); if (i === null || !CONSTS[i]) return;
    if (p.parentPath.isAssignmentExpression({ left: p.node })) return;
    p.replaceWith(t.cloneNode(CONSTS[i])); c1++;
  }
});
// string decoder calls
traverse(ast, {
  CallExpression(p) {
    const { callee, arguments: a } = p.node;
    if (!t.isIdentifier(callee, { name: 'LchUxE' }) || a.length !== 1 || !isTop(p, 'LchUxE')) return;
    const i = numVal(a[0]); if (i === null || DEC[i] === undefined) return;
    p.replaceWith(t.stringLiteral(DEC[i])); c2++;
  }
});
// folding: "a"+"b", L1jCzhR["d3BBRqq"] -> require, x["id"] -> x.id
const valid = s => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
traverse(ast, {
  BinaryExpression: { exit(p) {
    const { left, right, operator } = p.node;
    if (operator === '+' && t.isStringLiteral(left) && t.isStringLiteral(right)) { p.replaceWith(t.stringLiteral(left.value + right.value)); c3++; }
  } },
  MemberExpression: { exit(p) {
    const { object, property, computed } = p.node;
    if (computed && t.isIdentifier(object, { name: 'L1jCzhR' }) && t.isStringLiteral(property)) {
      const m = { d3BBRqq: 'require', EuGHvf: 'module', y6f6_tx: 'window', umPTwQn: 'x' }[property.value];
      if (m) { p.replaceWith(t.identifier(m)); return; }
    }
    if (computed && t.isStringLiteral(property) && valid(property.value)) { p.node.property = t.identifier(property.value); p.node.computed = false; c4++; }
  } }
});
console.log({ constRefs: c1, strCalls: c2, concats: c3, dotted: c4 });
fs.writeFileSync(outPath, generate(ast, { compact: false, comments: false, jsescOption: { minimal: true } }).code);
