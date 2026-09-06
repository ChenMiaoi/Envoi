import {build} from 'esbuild';import assert from 'node:assert/strict';
await build({entryPoints:['src/lib/paperMetadata.ts','src/lib/paperLibrary.ts'],bundle:true,platform:'node',format:'esm',outdir:'tmp/compile-check',outExtension:{'.js':'.mjs'}});
const meta=await import('../tmp/compile-check/paperMetadata.mjs'),lib=await import('../tmp/compile-check/paperLibrary.mjs');
// Identifier extraction: trailing punctuation stripped, arXiv explicit and bare forms
assert.equal(meta.extractIdentifiers('doi.org/10.1145/3442388.3449879.').doi,'10.1145/3442388.3449879');
assert.equal(meta.extractIdentifiers('arXiv:2103.12345v2').arxiv,'2103.12345');
assert.equal(meta.extractIdentifiers('see 1706.03762 for details').arxiv,'1706.03762');
assert.equal(meta.extractIdentifiers('doi.org/10.1038/s41586-\n021-03819-2 (Nature)').doi,'10.1038/s41586-021-03819-2'); // line-break hyphenation
assert.deepEqual(meta.extractIdentifiers('no identifiers here'),{doi:undefined,arxiv:undefined});
// XMP/Info mapping: publisher-embedded fields win, DOI surfaced
assert.deepEqual(meta.xmpToPaper({'dc:title':'XMP Title','dc:creator':['A B','C D'],'prism:coverDate':'2021-08-26','prism:publicationName':'Nature','prism:doi':'10.1/x'},{Title:'Info T'}),{fields:{title:'XMP Title',author:'A B; C D',year:'2021',venue:'Nature'},doi:'10.1/x'});
assert.equal(meta.xmpToPaper({},{Title:'Info Title',Author:'A B'}).fields.title,'Info Title');
// Layout hint: largest-font lines join; noise and tiny guards rejected
assert.equal(meta.pickTitleHint([{text:'Journal of X',fontSize:14},{text:'Attention Is All',fontSize:20},{text:'You Need',fontSize:20},{text:'A. Author',fontSize:12}]),'Attention Is All You Need');
assert.equal(meta.pickTitleHint([{text:'x',fontSize:9},{text:'© 2021',fontSize:12}]),'');
// Relevance guard: normalized exact equality; near-identical different papers must NOT match
assert(meta.titleMatches('Attention Is All You Need','Attention is all you Need'))===true;
assert(meta.titleMatches('Attention Is All You Need','Recurrent Neural Networks for Speech')===false);
assert(meta.titleMatches('Attention Is All You Need','Is Attention All You Need?')===false);
// DataCite mapping
assert.deepEqual(meta.dataciteToPaper({titles:[{title:'T'}],creators:[{name:'A B'}],published:2017,publisher:'arXiv'}),{title:'T',author:'A B',year:'2017',venue:'arXiv'});
assert.equal(meta.dataciteToPaper({titles:[]}),null);
// Citation keys and BibTeX synthesis
assert.equal(meta.citationKeyFor({author:'Donald Knuth; Leslie Lamport',year:'1984',title:'The TeXbook'}),'knuth1984texbook');
assert.throws(()=>meta.citationKeyFor({author:'',year:'',title:''}));
const bib=meta.synthesizeBib({title:'T',author:'A B; C D',year:'2020',venue:'V'},'ab2020t');
assert(bib.startsWith('@article{ab2020t,')&&bib.includes('author = {A B and C D}')&&bib.includes('journal = {V}'));
assert(meta.synthesizeBib({title:'T',author:'',year:'2020',venue:''},'k').startsWith('@misc{k,'));
// Export: keeps imported bib verbatim, synthesizes the rest, skips empty/duplicate keys
const exp=meta.exportBibliography([{bib:'@article{x,}',citationKey:'x'},{title:'T',author:'A',year:'2020',venue:'',citationKey:'a2020t'},{title:'',author:'',year:'',venue:''},{title:'T2',author:'A',year:'2020',venue:'',citationKey:'a2020t'}]);
assert(exp.text.includes('@article{x,}')&&exp.text.includes('@misc{a2020t,'));assert.equal(exp.skipped,2);
// Dedupe by citationKey and content hash
assert.deepEqual(lib.dedupeImported([{citationKey:'x'},{contentHash:'h1'}],[{id:'1',citationKey:'x'},{id:'2',contentHash:'h1'},{id:'3',citationKey:'y'}]).added.map(p=>p.id),['3']);
// Sort orders
const rows=[{title:'b',year:'2020',created:2},{title:'a',year:'2021',created:1}].map(p=>({author:'',venue:'',tags:[],collection:'',status:'待读',notes:'',id:p.title,...p}));
assert.deepEqual(lib.filterLibrary(rows,'','','','','title').map(p=>p.title),['a','b']);
assert.deepEqual(lib.filterLibrary(rows,'','','','','year').map(p=>p.year),['2021','2020']);
assert.deepEqual(lib.filterLibrary(rows,'','','','','created').map(p=>p.created),[2,1]);
console.log('PASS library metadata: identifiers, Crossref/arXiv mapping, bib synthesis, export, dedupe, sort');
