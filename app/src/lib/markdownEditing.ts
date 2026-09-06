export function replaceMarkdownBlock(source:string,start:number,end:number,text:string){
 if(start<0||end<start||end>source.length)throw Error('Markdown 编辑范围无效');
 return source.slice(0,start)+text+source.slice(end);
}
/** Project-relative assets only: never turn ../ into a filesystem read. */
export function resolveProjectLink(from:string,url:string){
 if(!url||/^(?:[a-z][a-z0-9+.-]*:|\/|\\|#)/i.test(url))return null;
 let decoded:string;try{decoded=decodeURIComponent(url.split(/[?#]/)[0]);}catch{return null;}
 if(decoded.includes('\\')||[...decoded].some(character=>character.charCodeAt(0)<32))return null;
 const parts=from.split('/').slice(0,-1);
 for(const part of decoded.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop();}else parts.push(part);}
 return parts.join('/');
}
export const markdownDocument=(source:string)=>source.replace(/\r\n|\r/g,'\n');
/** Map editor offsets back to original line endings; untouched syntax stays byte-for-byte. */
export function editMarkdownChanges(source:string,changes:{from:number;to:number;insert:string}[]){
 const offsets=[0];for(let i=0;i<source.length;i++){if(source[i]==='\r'&&source[i+1]==='\n')i++;offsets.push(i+1);}
 const ending=source.match(/\r\n|\r|\n/)?.[0]??'\n';let next=source;
 for(const change of [...changes].sort((a,b)=>b.from-a.from)){const from=offsets[change.from],to=offsets[change.to];if(from===undefined||to===undefined)throw Error('Markdown 编辑范围无效');next=next.slice(0,from)+change.insert.replace(/\r\n|\r|\n/g,ending)+next.slice(to);}
 return next;
}
