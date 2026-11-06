// Pass 3: constant folding, constant table, multi-alphabet base91 string table, cosmetic cleanup.
// Static only: base91 is re-implemented here; nothing from the sample is evaluated.
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
  return Buffer.from(out);
}
function clean(buf) {
  if (!buf.length) return null;
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return null; }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) return null;
  return s;
}

let progScope; traverse(ast, { Program(p) { progScope = p.scope; p.stop(); } });
let CONSTS, TABLE;
for (const s of ast.program.body) {
  if (s.type === 'VariableDeclaration' && s.declarations[0].id.name === 'YqIx7K') CONSTS = s.declarations[0].init.elements;
  if (s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' && s.expression.left.name === 'vAkBIr' && s.expression.right.type === 'CallExpression') {
    const [arr, cnt] = s.expression.right.arguments;
    TABLE = arr.elements.map(e => e.value);
    for (let i = 0; i < cnt.value; i++) TABLE.push(TABLE.shift());
  }
}
const ALPHAS = [];
traverse(ast, { StringLiteral(p) { const v = p.node.value; if (v.length === 91 && new Set(v).size === 91 && !ALPHAS.includes(v)) ALPHAS.push(v); } });
console.log('table:', TABLE.length, 'alphabets:', ALPHAS.length);
// decode matrix lazily
const memo = new Map();
const dec = (ai, i) => { const k = ai * 100000 + i; if (!memo.has(k)) memo.set(k, clean(b91(ALPHAS[ai], TABLE[i]))); return memo.get(k); };

const numVal = n => t.isNumericLiteral(n) ? n.value : (t.isUnaryExpression(n) && n.operator === '-' && t.isNumericLiteral(n.argument) ? -n.argument.value : null);
const numNode = v => v < 0 ? t.unaryExpression('-', t.numericLiteral(-v)) : t.numericLiteral(v);
const isTop = (p, name) => { const b = p.scope.getBinding(name); return b && b.scope === progScope; };

// --- 1) numeric folding + (literal, f)(x) -> f(x)
let folded = 0, seq = 0;
traverse(ast, {
  BinaryExpression: { exit(p) {
    const l = numVal(p.node.left), r = numVal(p.node.right);
    if (l === null || r === null) return;
    let v;
    switch (p.node.operator) { case '+': v = l + r; break; case '-': v = l - r; break; case '*': v = l * r; break; default: return; }
    if (!Number.isFinite(v)) return;
    p.replaceWith(numNode(v)); folded++;
  } },
  UnaryExpression: { exit(p) {
    if (p.node.operator === '-' && t.isUnaryExpression(p.node.argument) && p.node.argument.operator === '-' && t.isNumericLiteral(p.node.argument.argument)) { p.replaceWith(p.node.argument.argument); folded++; }
  } },
  SequenceExpression: { exit(p) {
    const ex = p.node.expressions;
    const keep = ex.filter((e, i) => i === ex.length - 1 || numVal(e) === null);
    if (keep.length === ex.length) return;
    seq++;
    if (keep.length === 1) {
      // (0, obj.fn)(...) would drop `this`; these wrappers are plain functions so this is cosmetic-safe for reading
      p.replaceWith(keep[0]);
    } else p.node.expressions = keep;
  } }
});
// --- 2) constant table
let c1 = 0;
traverse(ast, {
  MemberExpression(p) {
    const { object, property, computed } = p.node;
    if (!computed || !t.isIdentifier(object, { name: 'YqIx7K' }) || !isTop(p, 'YqIx7K')) return;
    const i = numVal(property); if (i === null || !CONSTS[i]) return;
    if (p.parentPath.isAssignmentExpression({ left: p.node })) return;
    p.replaceWith(t.cloneNode(CONSTS[i])); c1++;
  }
});
// --- 3) wrapper call sites: Identifier(intLiteral)
const GLOBALS = new Set(['Number', 'String', 'BigInt', 'Array', 'Boolean', 'Symbol', 'parseInt', 'parseFloat', 'Buffer', 'Object', 'isNaN', 'GOTO', 'require', 'Date', 'Error', 'Uint8Array', 'setTimeout', 'RegExp']);
const groups = new Map();   // key -> { name, calls: [path], idx: Set }
traverse(ast, {
  CallExpression(p) {
    const { callee, arguments: a } = p.node;
    if (!t.isIdentifier(callee) || a.length !== 1) return;
    const i = numVal(a[0]); if (i === null || !Number.isInteger(i) || i < 0 || i >= TABLE.length) return;
    if (GLOBALS.has(callee.name)) return;
    const b = p.scope.getBinding(callee.name);
    const key = b || callee.name;
    let g = groups.get(key); if (!g) groups.set(key, g = { name: callee.name, bound: !!b, binding: b, calls: [], idx: new Set() });
    g.calls.push(p); g.idx.add(i);
  }
});
// does a bound callee look like a cache wrapper (`table[param]` access inside its function)?
function bindingIsWrapper(b) {
  const fns = [];
  if (b.path.isFunctionDeclaration() || b.path.isFunctionExpression()) fns.push(b.path.node);
  if (b.path.isVariableDeclarator() && t.isFunction(b.path.node.init)) fns.push(b.path.node.init);
  for (const cv of b.constantViolations) if (cv.isAssignmentExpression() && t.isFunction(cv.node.right)) fns.push(cv.node.right);
  return fns.some(f => /vAkBIr\[/.test(src.slice(f.start, f.end)) && /nLj80u_\[/.test(src.slice(f.start, f.end)));
}
const indexAlpha = new Map(); // index -> alphabet id (for conflict detection)
let replaced = 0, conflicts = 0; const report = [];
for (const g of groups.values()) {
  const idx = [...g.idx];
  let best = -1, bestN = -1;
  for (let ai = 0; ai < ALPHAS.length; ai++) { let n = 0; for (const i of idx) if (dec(ai, i) !== null) n++; if (n > bestN) { bestN = n; best = ai; } }
  const ratio = bestN / idx.length;
  const exact = g.bound ? bindingIsWrapper(g.binding) : null;
  const accept = g.bound ? exact && ratio >= 0.9 : (ratio === 1 && idx.length >= 1 && /^[A-Za-z_$][\w$]{4,}$/.test(g.name));
  report.push({ name: g.name, bound: g.bound, exact, calls: g.calls.length, distinct: idx.length, best, ratio: +ratio.toFixed(3), accept });
  if (!accept) continue;
  for (const p of g.calls) {
    const i = numVal(p.node.arguments[0]);
    const s = dec(best, i);
    if (s === null) continue;
    if (indexAlpha.has(i) && indexAlpha.get(i) !== best) conflicts++;
    indexAlpha.set(i, best);
    p.replaceWith(t.stringLiteral(s)); replaced++;
  }
}
fs.writeFileSync(outPath + '.wrappers.json', JSON.stringify(report, null, 1));
console.log('wrapper groups:', report.length, 'accepted:', report.filter(r => r.accept).length, 'rejected:', report.filter(r => !r.accept).map(r => `${r.name}(${r.calls},r=${r.ratio},bound=${r.bound},exact=${r.exact})`).join(' '));
console.log({ folded, seq, constRefs: c1, replaced, conflicts, indicesDecoded: indexAlpha.size });
// dump every decoded table string that was used
fs.writeFileSync(outPath + '.strings.txt', [...indexAlpha.keys()].sort((a, b) => a - b).map(i => `${i}\t${JSON.stringify(dec(indexAlpha.get(i), i))}`).join('\n'));

// --- 4) folding strings + dotted access
const valid = s => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
let c3 = 0, c4 = 0;
traverse(ast, {
  BinaryExpression: { exit(p) {
    const { left, right, operator } = p.node;
    if (operator !== '+') return;
    if (t.isStringLiteral(left) && t.isStringLiteral(right)) { p.replaceWith(t.stringLiteral(left.value + right.value)); c3++; }
    // (x + "a") + "b" -> x + "ab"
    else if (t.isStringLiteral(right) && t.isBinaryExpression(left, { operator: '+' }) && t.isStringLiteral(left.right)) { p.replaceWith(t.binaryExpression('+', left.left, t.stringLiteral(left.right.value + right.value))); c3++; }
  } },
  MemberExpression: { exit(p) {
    const { property, computed } = p.node;
    if (computed && t.isStringLiteral(property) && valid(property.value)) { p.node.property = t.identifier(property.value); p.node.computed = false; c4++; }
  } },
  ObjectProperty: { exit(p) {
    if (p.node.computed && t.isStringLiteral(p.node.key) && valid(p.node.key.value)) { p.node.key = t.identifier(p.node.key.value); p.node.computed = false; }
  } },
  ObjectMethod: { exit(p) {
    if (p.node.computed && t.isStringLiteral(p.node.key) && valid(p.node.key.value)) { p.node.key = t.identifier(p.node.key.value); p.node.computed = false; }
  } }
});
console.log({ concats: c3, dotted: c4 });
fs.writeFileSync(outPath, generate(ast, { compact: false, comments: false, jsescOption: { minimal: true } }).code);
