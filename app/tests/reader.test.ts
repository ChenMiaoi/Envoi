import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseDelimited,editDelimitedCell} from '../src/lib/delimited';
import {markdownDocument,editMarkdownChanges,resolveProjectLink} from '../src/lib/markdownEditing';
import {fileKind} from '../src/lib/projectFiles';import {matchShortcut} from '../src/navigation/shortcuts';
test('CSV/TSV preserve quotes, empty rows/cells, BOM, CRLF and exact numeric strings on one-cell edit',()=>{
 const source='\ufeffname,value,note\r\n"a,b",90071992547409931234,"line1\r\nline2 ""quote"""\r\n\r\nx,,\r\n';
 const rows=parseDelimited(source);assert.equal(rows.length,4);assert.equal(rows[1][0].value,'a,b');assert.equal(rows[1][1].value,'90071992547409931234');assert.equal(rows[1][2].value,'line1\r\nline2 "quote"');assert.deepEqual(rows[3].map(c=>c.value),['x','','']);
 const next=editDelimitedCell(source,rows[1][0],'changed, name');assert.equal(next,source.replace('"a,b"','"changed, name"'));assert.equal(editDelimitedCell(source,rows[1][2],rows[1][2].value),source);
 for(const original of ['',',','\n','a,','""\r\n','a\tb\n"x\ty"\t\n']){const delimiter=original.includes('\t')?'\t':',';for(const row of parseDelimited(original,delimiter))for(const cell of row)assert.equal(editDelimitedCell(original,cell,cell.value,delimiter),original);}
 assert.throws(()=>parseDelimited('"unterminated'));assert.throws(()=>parseDelimited('a"b,c'));assert.throws(()=>parseDelimited('"ok"extra,c'));
});
test('continuous Markdown transactions preserve untouched syntax and mixed line endings',()=>{
 const source='# Head\r\n\r\nA **bold** [ref][id].\n\n[id]: https://example.org\r\n';
 const document=markdownDocument(source),from=document.indexOf('bold');const next=editMarkdownChanges(source,[{from,to:from+4,insert:'new'}]);assert.equal(next,source.replace('bold','new'));
 assert.equal(editMarkdownChanges(source,[{from:document.length,to:document.length,insert:'\nend'}]),source+'\r\nend');
 assert.equal(resolveProjectLink('notes/a.md','../assets/plot.png'),'assets/plot.png');assert.equal(resolveProjectLink('a.md','../../secret'),null);assert.equal(resolveProjectLink('a.md','javascript:alert(1)'),null);
});
test('file routing recognizes only tex as writer source and keeps binary files distinct',()=>{
 assert.equal(fileKind('chapters/a.tex'),'latex');assert.equal(fileKind('a.txt'),'text');assert.equal(fileKind('a.csv'),'csv');assert.equal(fileKind('a.tsv'),'tsv');assert.equal(fileKind('a.md'),'markdown');assert.equal(fileKind('a.docx'),'binary');assert.equal(fileKind('a.avif'),'image');
});
test('one shortcut registry recognizes Ctrl and Cmd save without swallowing unrelated keys',()=>{
 const key={key:'s',code:'KeyS',ctrlKey:true,metaKey:false,shiftKey:false,altKey:false};assert.equal(matchShortcut(key)?.id,'save');assert.equal(matchShortcut({...key,ctrlKey:false,metaKey:true})?.id,'save');assert.equal(matchShortcut({...key,shiftKey:true}),undefined);assert.equal(matchShortcut({...key,key:'!',code:'Digit1',shiftKey:true})?.id,'reader');
});
test('custom key bindings survive normalization and reject collisions/system/editing combinations',async()=>{
 const {normalizeShortcuts,validateBinding}=await import('../src/navigation/shortcuts');const {resolvePage}=await import('../src/navigation/routes');
 const bindings={save:{key:'k',alt:false,shift:false},commands:{key:'k',alt:true,shift:false}};assert.deepEqual(normalizeShortcuts(bindings),bindings);
 const event={key:'k',code:'KeyK',ctrlKey:true,metaKey:false,shiftKey:false,altKey:false};assert.equal(matchShortcut(event,bindings)?.id,'save');assert.match(validateBinding('writer',{key:'k',alt:false,shift:false},bindings),/冲突/);assert.match(validateBinding('save',{key:'w',shift:false,alt:false}),/保留/);assert.match(validateBinding('save',{key:'z',shift:false,alt:false}),/保留/);
 assert.equal(resolvePage('/settings/global/shortcuts').view,'settings');assert.deepEqual(resolvePage('/settings/project/shortcuts'),{});
});
