// Dump string literals of the deobfuscated script for IOC triage (parse-only).
const fs = require('fs');

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const src = fs.readFileSync(process.argv[2], 'utf8');
const ast = parser.parse(src, { sourceType: 'script', allowReturnOutsideFunction: true });
const seen = new Map();
traverse(ast, {
  StringLiteral(p) { const v = p.node.value; if (v.length >= 3) { if (!seen.has(v)) seen.set(v, p.node.loc.start.line); } },
  TemplateElement(p) { const v = p.node.value.cooked || ''; if (v.length >= 3 && !seen.has(v)) seen.set(v, p.node.loc.start.line); }
});
const out = [...seen.entries()].map(([v, l]) => `${l}\t${JSON.stringify(v)}`);
fs.writeFileSync(process.argv[3], out.join('\n'));
console.log('unique strings:', out.length);
