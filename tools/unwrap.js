// Static unwrap of the js-confuser "pack" wrapper: Function("<arg>", "<code>")({...}).
// Only parses; never evaluates sample code.
const fs = require('fs');
const parser = require('@babel/parser');
const [,, inPath, outPath] = process.argv;
const src = fs.readFileSync(inPath, 'utf8');
const ast = parser.parse(src, { sourceType: 'script' });
const stmt = ast.program.body;
console.log('top-level statements:', stmt.length, stmt.map(s => s.type));
const call = stmt[0].expression;               // Function(...)( {...} )
const inner = call.callee;                     // Function("L1jCzhR", "code")
console.log('callee:', inner.callee.name, 'args:', inner.arguments.map(a => a.type + ':' + (a.value.length)));
const code = inner.arguments[1].value;
fs.writeFileSync(outPath, code);
console.log('inner code bytes:', code.length);
const obj = call.arguments[0];
console.log('wrapper object keys:', obj.properties.map(p => `${p.kind} ${p.key.value}`));
console.log(src.slice(obj.start, obj.end));
