import type {LibraryPaper} from './paperLibrary';
// Pure metadata helpers: identifier extraction, API response mapping and BibTeX synthesis.
// Network/PDF plumbing lives in metadataLookup.ts so this module stays node-testable.
export function extractIdentifiers(text:string):{doi?:string;arxiv?:string}{
 // PDF text extraction keeps line-break hyphenation; join `- ` splits before matching.
 const doi=/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i.exec(text.replace(/-\s+/g,'-'))?.[0].replace(/[.,;:)\]}>’”-]+$/,'').replace(/[<([{’“]+$/,'');
 const arxiv=/(?:arxiv:\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(text)?.[1]??/\b(\d{4}\.\d{4,5})(?:v\d+)?\b/.exec(text)?.[1];
 return {doi,arxiv};
}
// Publisher-embedded PDF metadata: XMP packet values (pdf.js getMetadata().metadata.getAll()) plus the Info dictionary.
export function xmpToPaper(xmp:Record<string,unknown>,info:{Title?:string;Author?:string}):{fields:Partial<Pick<LibraryPaper,'title'|'author'|'year'|'venue'>>;doi?:string}{
 const text=(value:unknown)=>typeof value==='string'?value.trim():'';
 const creators=xmp['dc:creator'];
 const author=Array.isArray(creators)?creators.map(text).filter(Boolean).join('; '):text(creators);
 const year=/\d{4}/.exec(text(xmp['prism:coverDate'])||text(xmp['prism:publicationDate'])||text(xmp['dc:date']))?.[0]??'';
 return {fields:{title:text(xmp['dc:title'])||info.Title?.trim()||'',author:author||info.Author?.trim()||'',year,venue:text(xmp['prism:publicationName'])},doi:text(xmp['prism:doi'])||undefined};
}
// Layout heuristic: the title is usually the largest-font line(s) on page one. The result is only a Crossref query hint, never stored.
const TITLE_NOISE=/^(journal of|proceedings of|arxiv|volume |vol\.|no\.|issn|©|copyright|page )/i;
export function pickTitleHint(lines:{text:string;fontSize:number}[]):string{
 const usable=lines.filter(line=>line.text.trim().length>1&&!TITLE_NOISE.test(line.text.trim()));
 const max=Math.max(...usable.map(line=>line.fontSize),0);if(max<=0)return '';
 const top=usable.filter(line=>line.fontSize>=max-0.5);
 const joined=top.map(line=>line.text.trim()).join(' ').replace(/\s+/g,' ');
 return joined.length>=8&&joined.length<=300?joined:'';
}
// Relevance guard: a fuzzy Crossref hit counts only on exact title equality after normalization;
// near-identical but different titles (word swaps, subtitles) must NOT match.
export function titleMatches(hint:string,candidate:string):boolean{
 const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 return norm(hint)===norm(candidate)&&norm(hint).length>0;
}
// arXiv papers carry a DataCite DOI 10.48550/arxiv.<id>; DataCite's REST API allows CORS, unlike the arXiv API.
export function dataciteToPaper(data:{titles?:{title:string}[];creators?:{name?:string}[];publisher?:string;published?:number}|undefined):Pick<LibraryPaper,'title'|'author'|'year'|'venue'>|null{
 const title=data?.titles?.[0]?.title?.replace(/\s+/g,' ').trim();if(!title)return null;
 return {title,author:(data?.creators??[]).map(c=>c.name?.trim()??'').filter(Boolean).join('; '),year:String(data?.published??''),venue:data?.publisher??'arXiv'};
}
export function bibtexKey(bib:string){return /^\s*@\w+\{\s*([^\s,]+)/.exec(bib)?.[1];}
export interface CrossrefWork{title?:string[];author?:{given?:string;family?:string}[];issued?:{'date-parts'?:number[][]};'container-title'?:string[];DOI?:string}
export function crossrefToPaper(work:CrossrefWork):Pick<LibraryPaper,'title'|'author'|'year'|'venue'>{
 return {
  title:(work.title?.[0]??'').replace(/\s+/g,' ').trim(),
  author:(work.author??[]).map(a=>[a.given,a.family].filter(Boolean).join(' ')).filter(Boolean).join('; '),
  year:String(work.issued?.['date-parts']?.[0]?.[0]??''),
  venue:work['container-title']?.[0]??'',
 };
}

export function citationKeyFor(paper:Pick<LibraryPaper,'author'|'year'|'title'>):string{
 const last=paper.author.split(';')[0].trim().split(/\s+/).pop()??'';
 const word=paper.title.split(/\s+/).find(w=>/[a-zA-Z]{4,}/.test(w))??'';
 const key=`${last}${paper.year}${word}`.toLowerCase().replace(/[^a-z0-9]/g,'');
 if(!key)throw Error('条目缺少作者、年份与标题，无法生成引用键；请先补全资料。');
 return key;
}
const escapeBib=(value:string)=>value.replace(/[{}\\]/g,'');
export function synthesizeBib(paper:Pick<LibraryPaper,'title'|'author'|'year'|'venue'>,key:string):string{
 const fields=[['author',paper.author.replace(/;\s*/g,' and ')],['title',paper.title],['year',paper.year],['journal',paper.venue]].filter(([,v])=>v);
 return `@${paper.venue?'article':'misc'}{${key},\n${fields.map(([k,v])=>`  ${k} = {${escapeBib(v)}},`).join('\n')}\n}`;
}
export function exportBibliography(papers:LibraryPaper[]):{text:string;skipped:number}{
 const entries:string[]=[];let skipped=0;const seen=new Set<string>();
 for(const paper of papers){
  let bib=paper.bib,key=paper.citationKey;
  if(!bib){if(!paper.title&&!paper.author){skipped++;continue;}try{key??=citationKeyFor(paper);}catch{skipped++;continue;}bib=synthesizeBib(paper,key);}
  if(key&&seen.has(key)){skipped++;continue;}if(key)seen.add(key);
  entries.push(bib.trim());
 }
 return {text:entries.join('\n\n')+'\n',skipped};
}
