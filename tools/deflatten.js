// Pass 2: undo js-confuser control-flow flattening by concrete walking of each state machine.
// Pure static transform: parses + rewrites the AST; never evaluates sample code
// (the only "evaluation" is the tiny arithmetic interpreter `ev` below).
const fs = require('fs');

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const [,, inPath, outPath] = process.argv;
const src = fs.readFileSync(inPath, 'utf8');
const ast = parser.parse(src, { sourceType: 'script', allowReturnOutsideFunction: true });

const UNKNOWN = Symbol('unknown');
const stats = { gens: 0, noEntry: 0, blocks: 0, unknownCase: 0, nestedTransition: 0, nestedBreak: 0, capped: 0, noCase: 0 };
const warn = [];

// ---- top-level constant table (YqIx7K) for the evaluator
let CONSTS = null, progScope = null;
traverse(ast, { Program(p) { progScope = p.scope; p.stop(); } });
for (const s of ast.program.body) {
  if (s.type === 'VariableDeclaration' && s.declarations[0].id.name === 'YqIx7K') CONSTS = s.declarations[0].init.elements;
}
{
  const b = progScope.getBinding('YqIx7K');
  for (const r of b.referencePaths) r.node._K = true;
}
function litVal(n) {
  if (!n) return UNKNOWN;
  if (t.isNumericLiteral(n) || t.isStringLiteral(n) || t.isBooleanLiteral(n)) return n.value;
  if (t.isNullLiteral(n)) return null;
  if (t.isIdentifier(n, { name: 'undefined' })) return undefined;
  if (t.isUnaryExpression(n) && n.operator === '-' && t.isNumericLiteral(n.argument)) return -n.argument.value;
  return UNKNOWN;
}

// ---- discover flattened generators
const gens = [];
const genByProp = new Map();
function addEntry(g, st, preds) {
  const key = st.join(',') + '|' + Object.keys(preds).sort().map(p => p + '=' + preds[p]).join(',');
  if (!g.entryKeys) g.entryKeys = new Set();
  if (g.entryKeys.has(key)) return;
  g.entryKeys.add(key); g.entries.push({ st: st.slice(), preds: { ...preds } });
}
function propName(m) {
  if (!t.isMemberExpression(m)) return null;
  if (!m.computed && t.isIdentifier(m.property)) return m.property.name;
  if (m.computed && t.isStringLiteral(m.property)) return m.property.value;
  return null;
}
traverse(ast, {
  Function: { exit(path) {
    const n = path.node;
    if (!n.generator) return;
    const ps = n.params;
    const k = ps.findIndex(p => t.isAssignmentPattern(p));
    if (k < 1) return;
    if (!ps.slice(0, k).every(p => t.isIdentifier(p))) return;
    const ctxP = ps[k];
    if (!t.isIdentifier(ctxP.left) || !t.isObjectExpression(ctxP.right)) return;
    const body = n.body.body;
    if (body.length !== 1 || !t.isWhileStatement(body[0])) return;
    const wh = body[0];
    if (!t.isBinaryExpression(wh.test) || wh.test.operator !== '!==') return;
    if (!t.isBlockStatement(wh.body) || wh.body.body.length !== 1 || !t.isWithStatement(wh.body.body[0])) return;
    const wi = wh.body.body[0];
    const sw = t.isBlockStatement(wi.body) ? wi.body.body[0] : wi.body;
    if (!t.isSwitchStatement(sw)) return;
    const g = { id: gens.length, node: n, k, stateNames: ps.slice(0, k).map(p => p.name), ctxName: ctxP.left.name, sw, endNode: wh.test.right, entries: [], predNames: new Set(), scopeNames: new Set() };
    // mark state param references/assignments
    g.stateNames.forEach((nm, j) => {
      const b = path.scope.getOwnBinding(nm);
      if (!b || b.kind !== 'param') { warn.push(`g${g.id}: state binding ${nm} kind=${b && b.kind}`); return; }
      for (const r of b.referencePaths) r.node._st = [g.id, j];
      for (const cv of b.constantViolations) {
        if (cv.isAssignmentExpression() && t.isIdentifier(cv.node.left)) cv.node.left._st = [g.id, j];
        else if (cv.isUpdateExpression() && t.isIdentifier(cv.node.argument)) cv.node.argument._st = [g.id, j];
        else warn.push(`g${g.id}: odd violation ${cv.type} for ${nm}`);
      }
    });
    const cb = path.scope.getOwnBinding(g.ctxName);
    for (const r of cb.referencePaths) {
      r.node._ctx = g.id;
      const pn = r.parentPath.isMemberExpression() && r.parentPath.node.object === r.node ? propName(r.parentPath.node) : null;
      if (pn) g.scopeNames.add(pn);
    }
    // the with() selector property is not a scope object
    if (t.isLogicalExpression(wi.object) && propName(wi.object.left)) { g.withProp = propName(wi.object.left); g.scopeNames.delete(g.withProp); }
    // call sites => entry states
    let nb = null;
    if (path.isFunctionDeclaration()) nb = path.parentPath.scope.getBinding(n.id.name);
    else {
      const pp = path.parentPath;
      if (pp.isAssignmentExpression() && pp.node.right === n && t.isIdentifier(pp.node.left)) nb = pp.scope.getBinding(pp.node.left.name);
      else if (pp.isVariableDeclarator() && t.isIdentifier(pp.node.id)) nb = pp.scope.getBinding(pp.node.id.name);
    }
    if (nb) {
      for (const r of nb.referencePaths) {
        if (r.parentPath.isCallExpression() && r.parentPath.node.callee === r.node) {
          r.node._gref = g.id;
          if (r.findParent(p => p.node === n)) { r.node._gself = true; continue; }   // self reference: resolved while walking (needs preds)
          const vals = r.parentPath.node.arguments.slice(0, k).map(litVal);
          if (vals.length === k && vals.every(v => typeof v === 'number')) addEntry(g, vals, {});
        }
      }
    }
    {
      const pp = path.parentPath;
      if (pp.isAssignmentExpression() && pp.node.right === n && propName(pp.node.left)) { g.prop = propName(pp.node.left); genByProp.set(g.prop, g); }
      // named function expression: self references through its own name
      if (path.isFunctionExpression() && n.id && !g.stateNames.includes(n.id.name) && n.id.name !== g.ctxName) {
        const sb = path.scope.getOwnBinding(n.id.name);
        if (sb && sb.kind === 'local') for (const r of sb.referencePaths) {
          if (r.parentPath.isCallExpression() && r.parentPath.node.callee === r.node) { r.node._gref = g.id; r.node._gself = true; }
        }
      }
    }
    g.line = n.loc.start.line; g.endLine = n.loc.end.line;
    gens.push(g);
  } }
});

// ---- helpers
function clonePlain(n) {
  if (Array.isArray(n)) return n.map(clonePlain);
  if (n && typeof n === 'object') {
    if (n instanceof RegExp) return n;
    const o = {};
    for (const key in n) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key === 'range' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      o[key] = clonePlain(n[key]);
    }
    return o;
  }
  return n;
}
const num = v => (typeof v === 'number' && (v < 0 || Object.is(v, -0))) ? t.unaryExpression('-', t.numericLiteral(-v)) : t.numericLiteral(v);
function valNode(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? num(v) : t.identifier(String(v));
  if (typeof v === 'string') return t.stringLiteral(v);
  if (typeof v === 'boolean') return t.booleanLiteral(v);
  if (v === null) return t.nullLiteral();
  return t.identifier('undefined');
}

function deflatten(g, commit) {
  if (commit) stats.gens++;
  const cases = g.sw.cases;
  const END = litVal(g.endNode);
  // pre-pass: predicate names = members assigned through array destructuring of numeric literals
  (function scan(n) {
    if (Array.isArray(n)) return n.forEach(scan);
    if (!n || typeof n !== 'object') return;
    if (t.isAssignmentExpression(n) && t.isArrayPattern(n.left) && t.isArrayExpression(n.right) &&
        n.left.elements.length === n.right.elements.length && n.left.elements.every(e => isCtx2(e)) &&
        n.right.elements.every(e => typeof litVal(e) === 'number')) {
      n.left.elements.forEach(e => g.predNames.add(propName(e)));
    }
    if (t.isFunction(n) && n !== g.node) return;
    for (const key in n) if (key !== 'loc' && key[0] !== '_') scan(n[key]);
  })(g.sw);

  function isCtx1(m) { return t.isMemberExpression(m) && t.isIdentifier(m.object) && m.object._ctx === g.id && propName(m) !== null; }
  function isCtx2(m) { return t.isMemberExpression(m) && isCtx1(m.object) && propName(m) !== null; }

  function ev(n, env) {
    if (!n) return UNKNOWN;
    switch (n.type) {
      case 'NumericLiteral': case 'StringLiteral': case 'BooleanLiteral': return n.value;
      case 'NullLiteral': return null;
      case 'ParenthesizedExpression': return ev(n.expression, env);
      case 'Identifier':
        if (n._st && n._st[0] === g.id) return env.st[n._st[1]];
        if (n.name === 'undefined') return undefined;
        if (n.name === 'NaN') return NaN;
        if (g.predNames.has(n.name)) return (n.name in env.preds) ? env.preds[n.name] : undefined;
        return UNKNOWN;
      case 'MemberExpression': {
        if (isCtx2(n)) {
          const p = propName(n);
          if (p in env.preds) return env.preds[p];
          if (g.predNames.has(p)) return undefined;
          return UNKNOWN;
        }
        if (n.computed && t.isIdentifier(n.object) && n.object._K) {
          const i = ev(n.property, env);
          if (typeof i !== 'number' || !CONSTS[i]) return UNKNOWN;
          return litVal(CONSTS[i]);
        }
        return UNKNOWN;
      }
      case 'UnaryExpression': {
        const a = ev(n.argument, env); if (a === UNKNOWN) return UNKNOWN;
        switch (n.operator) { case '-': return -a; case '+': return +a; case '!': return !a; case '~': return ~a; case 'void': return undefined; }
        return UNKNOWN;
      }
      case 'LogicalExpression': {
        const l = ev(n.left, env); if (l === UNKNOWN) return UNKNOWN;
        if (n.operator === '&&') return l ? ev(n.right, env) : l;
        if (n.operator === '||') return l ? l : ev(n.right, env);
        return UNKNOWN;
      }
      case 'ConditionalExpression': {
        const c = ev(n.test, env); if (c === UNKNOWN) return UNKNOWN;
        return ev(c ? n.consequent : n.alternate, env);
      }
      case 'BinaryExpression': {
        const l = ev(n.left, env), r = ev(n.right, env);
        if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
        switch (n.operator) {
          case '+': return l + r; case '-': return l - r; case '*': return l * r; case '/': return l / r; case '%': return l % r;
          case '|': return l | r; case '&': return l & r; case '^': return l ^ r; case '<<': return l << r; case '>>': return l >> r; case '>>>': return l >>> r;
          case '==': return l == r; case '!=': return l != r; case '===': return l === r; case '!==': return l !== r;
          case '<': return l < r; case '>': return l > r; case '<=': return l <= r; case '>=': return l >= r;
        }
        return UNKNOWN;
      }
    }
    return UNKNOWN;
  }

  const blocks = new Map(); const byId = []; const queue = [];
  function getBlock(st, preds) {
    const key = st.join(',') + '|' + Object.keys(preds).sort().map(p => p + '=' + preds[p]).join(',');
    let b = blocks.get(key);
    if (!b) {
      if (byId.length >= 6000) { if (commit) stats.capped++; return null; }
      b = { id: byId.length, st: st.slice(), preds: { ...preds }, out: null, entry: false };
      blocks.set(key, b); byId.push(b); queue.push(b);
    }
    return b;
  }
  function gotoNode(env) {
    const sum = env.st.reduce((a, b) => a + b, 0);
    if (sum === END) return t.returnStatement();
    const b = getBlock(env.st, env.preds);
    if (!b) return t.expressionStatement(t.identifier('GOTO_CAPPED'));
    const s = t.expressionStatement(t.callExpression(t.identifier('GOTO'), [t.identifier('B' + b.id)]));
    s._goto = b.id;
    return s;
  }

  // clone + substitute state/ctx references for the current env
  function emit(n, env, depth) {
    if (Array.isArray(n)) return n.map(x => emit(x, env, depth));
    if (!n || typeof n !== 'object') return n;
    if (n instanceof RegExp) return n;
    if (n.type === 'Identifier' && n._st && n._st[0] === g.id) return num(env.st[n._st[1]]);
    if (n.type === 'MemberExpression') {
      if (isCtx2(n)) {
        const p = propName(n);
        if (g.predNames.has(p)) return valNode(p in env.preds ? env.preds[p] : undefined);
        return t.identifier(p);
      }
      // bare scope object access through with(): SCOPE.name -> name
      if (t.isIdentifier(n.object) && !n.object._ctx && !n.object._st && g.scopeNames.has(n.object.name) && propName(n) !== null && /^[A-Za-z_$][\w$]*$/.test(propName(n))) {
        return t.identifier(propName(n));
      }
    }
    if (n.type === 'AssignmentExpression' && t.isIdentifier(n.left) && n.left._st && n.left._st[0] === g.id) stats.nestedTransition++;
    let d = depth;
    if (t.isFunction(n)) d = 100; // breaks inside nested functions are not ours
    else if (t.isLoop(n) || t.isSwitchStatement(n)) d = depth + 1;
    if (n.type === 'BreakStatement' && !n.label && d === 0) stats.nestedBreak++;
    if (n.type === 'ReturnStatement' && d < 100 && t.isSequenceExpression(n.argument) && n.argument.expressions.length === 2) {
      const [a, bx] = n.argument.expressions;
      if (t.isAssignmentExpression(a) && t.isIdentifier(a.left) && t.isBooleanLiteral(a.right, { value: true })) {
        return t.returnStatement(emit(bx, env, d));
      }
    }
    let selfEntry = -1;
    if (n.type === 'CallExpression') {
      let c = n.callee; if (t.isSequenceExpression(c)) c = c.expressions[c.expressions.length - 1];
      let target = null;
      if (t.isIdentifier(c) && c._gref !== undefined) target = gens[c._gref];
      else if (t.isMemberExpression(c) && propName(c) !== null && genByProp.has(propName(c))) target = genByProp.get(propName(c));
      else if (t.isIdentifier(c) && !c._st && genByProp.has(c.name)) target = genByProp.get(c.name);
      if (target) {
        const vals = n.arguments.slice(0, target.k).map(a => ev(a, env));
        if (vals.length === target.k && vals.every(v => typeof v === 'number')) {
          if (target === g) { const b = getBlock(vals, env.preds); if (b) { b.entry = true; selfEntry = b.id; } }
          else if (!c._gself) addEntry(target, vals, {});
        }
      }
    }
    const o = {};
    for (const key in n) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key === 'range' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      o[key] = emit(n[key], env, d);
    }
    if (selfEntry >= 0) o.arguments = [t.identifier('ENTRY_B' + selfEntry), ...o.arguments.slice(g.k)];
    return o;
  }

  function absorb(p, env) {
    if (!t.isAssignmentExpression(p)) return false;
    const L = p.left;
    if (t.isIdentifier(L) && L._st && L._st[0] === g.id) {
      const v = ev(p.right, env);
      if (typeof v !== 'number') { warn.push(`g${g.id}: non-const transition`); return false; }
      const j = L._st[1];
      if (p.operator === '+=') env.st[j] += v; else if (p.operator === '-=') env.st[j] -= v; else if (p.operator === '=') env.st[j] = v; else { warn.push(`g${g.id}: op ${p.operator}`); return false; }
      return true;
    }
    if (p.operator === '=' && isCtx1(L) && propName(L) === g.withProp) return true; // scope switch
    if (p.operator === '=' && t.isArrayPattern(L) && t.isArrayExpression(p.right) && L.elements.length === p.right.elements.length &&
        L.elements.every(e => isCtx2(e) && g.predNames.has(propName(e)))) {
      const vals = p.right.elements.map(e => ev(e, env));
      if (vals.every(v => typeof v === 'number')) { L.elements.forEach((e, i) => { env.preds[propName(e)] = vals[i]; }); return true; }
    }
    return false;
  }
  const stmtsOf = s => !s ? [] : (t.isBlockStatement(s) ? s.body : [s]);
  const cloneEnv = e => ({ st: e.st.slice(), preds: { ...e.preds } });
  const adopt = (env, e2) => { env.st = e2.st; env.preds = e2.preds; };

  function run(stmts, env) {
    const out = [];
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      if ((t.isBreakStatement(s) || t.isContinueStatement(s)) && !s.label) { out.push(gotoNode(env)); return { out, term: true }; }
      if (t.isReturnStatement(s) || t.isThrowStatement(s)) { out.push(emit(s, env, 0)); return { out, term: true }; }
      if (t.isEmptyStatement(s)) continue;
      if (t.isExpressionStatement(s)) {
        const parts = t.isSequenceExpression(s.expression) ? s.expression.expressions : [s.expression];
        for (const p of parts) if (!absorb(p, env)) out.push(t.expressionStatement(emit(p, env, 0)));
        continue;
      }
      if (t.isBlockStatement(s)) {
        const r = run(s.body, env); out.push(...r.out); if (r.term) return { out, term: true }; continue;
      }
      if (t.isIfStatement(s)) {
        const v = ev(s.test, env);
        if (v !== UNKNOWN) {
          const r = run(stmtsOf(v ? s.consequent : s.alternate), env);
          out.push(...r.out); if (r.term) return { out, term: true };
          continue;
        }
        const eA = cloneEnv(env), eB = cloneEnv(env);
        const test = emit(s.test, env, 0);
        const rA = run(stmtsOf(s.consequent), eA), rB = run(stmtsOf(s.alternate), eB);
        out.push(t.ifStatement(test, t.blockStatement(rA.out), rB.out.length ? t.blockStatement(rB.out) : null));
        if (rA.term && rB.term) return { out, term: true };
        if (rA.term) adopt(env, eB); else if (rB.term) adopt(env, eA);
        else { if (eA.st.join() !== eB.st.join()) warn.push(`g${g.id}: diverging non-terminating if`); adopt(env, eA); }
        continue;
      }
      if (t.isTryStatement(s)) {
        const eA = cloneEnv(env), eB = cloneEnv(env), eC = cloneEnv(env);
        const rA = run(s.block.body, eA);
        const rB = s.handler ? run(s.handler.body.body, eB) : null;
        const rC = s.finalizer ? run(s.finalizer.body, eC) : null;
        out.push(t.tryStatement(t.blockStatement(rA.out), s.handler ? t.catchClause(s.handler.param ? emit(s.handler.param, env, 0) : null, t.blockStatement(rB.out)) : null, rC ? t.blockStatement(rC.out) : null));
        const bT = rB ? rB.term : true;
        if (rA.term && bT) return { out, term: true };
        if (!rA.term) adopt(env, eA); else adopt(env, eB);
        continue;
      }
      if (t.isLabeledStatement(s) && t.isBlockStatement(s.body)) {
        const r = run(s.body.body, env);
        out.push(t.labeledStatement(clonePlain(s.label), t.blockStatement(r.out)));
        if (r.term) return { out, term: true };
        continue;
      }
      out.push(emit(s, env, 0));
    }
    return { out, term: false };
  }

  function build(b) {
    const env = { st: b.st.slice(), preds: { ...b.preds } };
    const disc = env.st.reduce((a, c) => a + c, 0);
    let idx = -1, def = -1;
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      if (!c.test) { def = i; continue; }
      const v = ev(c.test, env);
      if (v === UNKNOWN) { if (commit) stats.unknownCase++; continue; }
      if (v === disc) { idx = i; break; }
    }
    if (idx < 0) { idx = def; b.viaDefault = true; }
    b.caseIdx = idx;
    if (idx < 0) { stats.noCase++; b.out = [t.expressionStatement(t.identifier('NO_MATCHING_CASE'))]; return; }
    const list = [];
    for (let i = idx; i < cases.length; i++) list.push(...cases[i].consequent);
    const r = run(list, env);
    if (!r.term) r.out.push(gotoNode(env));
    b.out = r.out;
  }

  if (commit && !g.entries.length) { stats.noEntry++; warn.push(`g${g.id}: no entry call sites (line ${g.node.loc && g.node.loc.start.line}, prop=${g.prop})`); }
  for (const e of g.entries) { const b = getBlock(e.st, e.preds); if (b) b.entry = true; }
  while (queue.length) build(queue.shift());
  if (!commit) return;
  stats.blocks += byId.length;

  // ---- layout: inline single-reference blocks at their GOTO site
  const refs = new Array(byId.length).fill(0);
  (function count(n, top) {
    if (Array.isArray(n)) return n.forEach(x => count(x, false));
    if (!n || typeof n !== 'object') return;
    if (n._goto !== undefined) { refs[n._goto]++; return; }
    for (const key in n) if (key[0] !== '_') count(n[key], false);
  })(byId.map(b => b.out));
  function inlineInto(stmts) {
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      if (s._goto !== undefined) {
        const tb = byId[s._goto];
        if (refs[tb.id] === 1 && !tb.entry && !tb.inlined && !tb.busy) {
          tb.inlined = true; tb.busy = true; inlineInto(tb.out); tb.busy = false;
          stmts.splice(i, 1, ...tb.out); i += tb.out.length - 1;
        }
        continue;
      }
      if (t.isIfStatement(s)) { inlineInto(s.consequent.body); if (s.alternate) inlineInto(s.alternate.body); }
      else if (t.isTryStatement(s)) { inlineInto(s.block.body); if (s.handler) inlineInto(s.handler.body.body); if (s.finalizer) inlineInto(s.finalizer.body); }
      else if (t.isLabeledStatement(s) && t.isBlockStatement(s.body)) inlineInto(s.body.body);
    }
  }
  for (const b of byId) if (b.entry) { b.busy = true; inlineInto(b.out); b.busy = false; }
  for (const b of byId) if (!b.inlined && !b.entry) { b.busy = true; inlineInto(b.out); b.busy = false; }
  const live = byId.filter(b => !b.inlined);
  let bodyStmts;
  const hasGoto = live.some(b => JSON.stringify(b.out, (k, v) => (k === 'loc' ? undefined : v)).includes('"_goto"'));
  if (live.length === 1 && !hasGoto) bodyStmts = live[0].out;
  else bodyStmts = live.map(b => t.labeledStatement(t.identifier((b.entry ? 'ENTRY_B' : 'B') + b.id), t.blockStatement(b.out)));
  // rename goto targets that are entries, then strip markers
  (function fix(n) {
    if (Array.isArray(n)) return n.forEach(fix);
    if (!n || typeof n !== 'object') return;
    if (n._goto !== undefined) { if (byId[n._goto].entry) n.expression.arguments[0].name = 'ENTRY_B' + n._goto; delete n._goto; return; }
    for (const key in n) if (key[0] !== '_') fix(n[key]);
  })(bodyStmts);
  g.node.body = t.blockStatement(bodyStmts);
  g.nblocks = byId.length; g.nlive = live.length;
  if (process.env.DBGID && +process.env.DBGID === g.id) {
    console.log(`DBGID g${g.id} line ${g.node.loc.start.line} END=${END} entries=${JSON.stringify(g.entries)} preds=${[...g.predNames]}`);
    for (const b of byId.slice(0, 40)) console.log('   B' + b.id, b.st.join(','), 'sum=' + b.st.reduce((a, c) => a + c, 0), JSON.stringify(b.preds), 'case#' + b.caseIdx + (b.viaDefault ? ' (default)' : ''), 'line', cases[b.caseIdx] && cases[b.caseIdx].loc.start.line);
  }
  if (process.env.DBG && byId.length > 300) {
    const sts = new Set(byId.map(b => b.st.join(',')));
    const prs = new Set(byId.map(b => JSON.stringify(b.preds)));
    console.log(`DBG g${g.id} line ${g.node.loc && g.node.loc.start.line} blocks=${byId.length} distinctStates=${sts.size} distinctPreds=${prs.size} entries=${JSON.stringify(g.entries)} predNames=${[...g.predNames].join(',')} cases=${cases.length}`);
    for (const b of byId.slice(0, 8)) console.log('     ', b.id, b.st.join(','), JSON.stringify(b.preds));
  }
}

// phase 1: outermost-first dry walks resolve entry states of nested generators
for (const g of gens.slice().reverse()) deflatten(g, false);
// phase 2: innermost-first commit
for (const g of gens) deflatten(g, true);

// strip custom marks + raw number text so literals print in decimal
(function strip(n) {
  if (Array.isArray(n)) return n.forEach(strip);
  if (!n || typeof n !== 'object') return;
  delete n._st; delete n._ctx; delete n._gref; delete n._K; delete n._gself;
  if (n.type === 'NumericLiteral' && n.extra) delete n.extra;
  for (const key in n) if (key !== 'loc') strip(n[key]);
})(ast.program);

const code = generate(ast, { compact: false, comments: false, jsescOption: { minimal: true } }).code;
fs.writeFileSync(outPath, code);
console.log(JSON.stringify(stats));
for (const g of gens) if (!g.entries.length) {
  const par = gens.filter(x => x !== g && x.line <= g.line && x.endLine >= g.endLine).sort((a, b) => b.line - a.line)[0];
  console.log(`noentry g${g.id} line ${g.line} prop=${g.prop} parent=${par ? 'g' + par.id + ' line ' + par.line + ' entries=' + par.entries.length + ' blocks=' + par.nblocks : 'none'}`);
}
console.log('warnings:', warn.length); for (const w of warn.slice(0, 30)) console.log('  ', w);
const big = gens.filter(g => g.nlive > 1).length;
console.log(`generators: ${gens.length}, fully linear: ${gens.length - big}, with residual gotos: ${big}`);
console.log('output lines:', code.split('\n').length);
