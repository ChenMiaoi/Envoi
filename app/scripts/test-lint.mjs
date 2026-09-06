import {lintText,lintRuntime} from '../server/lint.mjs';import assert from 'node:assert/strict';
assert(lintRuntime().available);
const source='\\begin{document}\nHello world .\n\\end{document}';const result=await lintText({path:'chapters/check.tex',text:source});assert(result.items.some(item=>item.line===2&&item.column===12&&item.code==='26'));
const corrected=await lintText({path:'chapters/check.tex',text:source.replace('world .','world.')});assert.equal(corrected.items.length,0);
await assert.rejects(lintText({path:'../outside.tex',text:source}));
console.log('PASS installed ChkTeX detects unsaved snapshot punctuation at line/column; correction clears; traversal rejected');

assert.equal((await lintText({path:'chapters/check.tex',text:source,disabledRules:[26]})).items.length,0);await assert.rejects(lintText({path:'chapters/check.tex',text:source,disabledRules:['26; command']}));console.log('PASS configured rule suppression reaches ChkTeX; non-numeric rule injection rejected');
