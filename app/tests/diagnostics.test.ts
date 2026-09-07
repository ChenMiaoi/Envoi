import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDiagnostics,diagnosticLocation,safeDiagnosticText} from '../src/lib/diagnostics';
const files=[{id:'main.tex',path:'main.tex',kind:'latex' as const,text:'first\nsecond\nthird'}, {id:'chapters/method.tex',path:'chapters/method.tex',kind:'latex' as const,text:'one\ntwo\nthree'}];
test('Windows wrapped paths preserve distinct diagnostics at the same line number',()=>{
 const log='[pdflatex]\n(C:/Users/test/Temp/envoi-tex-abc/project/main.te\r\r\nx\r\r\nClass acmart Warning: A possible image without description on input line 2.\r\r\n(C:/Users/test/Temp/envoi-tex-abc/project/chapters/method.te\r\r\nx\r\r\nClass acmart Warning: A possible image without description on input line 2.\r\r\n))';
 const items=parseDiagnostics(log,files);
 assert.deepEqual(items.map(item=>[item.path,item.line]),[['main.tex',2],['chapters/method.tex',2]]);
});
test('diagnostics use final TeX pass and map trusted snapshot paths to source line',()=>{
 const log='\n[pdflatex]\nLaTeX Warning: Reference `resolved` undefined.\n[pdflatex]\n(./main.tex\n(./chapters/method.tex\nLaTeX Warning: Reference `missing` undefined on input line 2.\n/private/tmp/envoi-tex-abc/project/chapters/method.tex:3: Undefined control sequence.\n))';
 const items=parseDiagnostics(log,files,true);assert.equal(items.length,2);assert.equal(items[0].severity,'warning');assert.equal(items[0].path,'chapters/method.tex');assert.equal(items[0].line,2);assert.equal(items[1].line,3);
 assert.deepEqual(diagnosticLocation(items[0],files),{fileId:'chapters/method.tex',path:'chapters/method.tex',start:4,end:7,severity:'warning'});
});
test('outside paths and unreliable positions do not become editor targets',()=>{
 const items=parseDiagnostics('/usr/local/share/system.sty:7: Broken package\n! Global failure',files,true);
 assert.equal(items[0].path,undefined);assert.equal(diagnosticLocation(items[0],files),undefined);assert(!safeDiagnosticText('/private/tmp/envoi-tex-abc/project/main.tex').includes('/private'));
});
test('BibTeX warnings are retained alongside final TeX diagnostics',()=>{
 const items=parseDiagnostics('\n[pdflatex]\ninitial\n[bibtex]\nWarning--I did not find a database entry for "missing"\n[pdflatex]\nfinal',files);
 assert.equal(items.length,1);assert.equal(items[0].severity,'warning');assert.equal(items[0].line,undefined);
});

test('wrapped engine paths resolve chapters without falling back to main',()=>{
 const log='\n[pdflatex]\n(./main.tex\n(/private/tmp/envoi-tex-abc/\nproject/chapters/method.tex\nLaTeX Warning: Something on input line 2.\n)\n/private/tmp/envoi-tex-abc/p\nroject/chapters/method.tex:3: Broken command.';
 const items=parseDiagnostics(log,files,true);assert(items.every(item=>item.path==='chapters/method.tex'));assert.deepEqual(items.map(i=>i.line),[2,3]);
});
