import {translate} from '@/i18n/runtime';
/** Lossless source spans: edits replace one field, never reserialize other cells. */
export interface DelimitedCell {start:number;end:number;value:string;quoted:boolean}
export function parseDelimited(source:string,delimiter=","):DelimitedCell[][] {
 if(!source)return [];
 const rows:DelimitedCell[][]=[];let row:DelimitedCell[]=[];let i=source.charCodeAt(0)===0xfeff?1:0;
 while(i<source.length){
  const start=i;let value='',quoted=false;
  if(source[i]==='"'){
   quoted=true;i++;let closed=false;
   while(i<source.length){if(source[i]==='"'){if(source[i+1]==='"'){value+='"';i+=2;}else{i++;closed=true;break;}}else value+=source[i++];}
   if(!closed)throw Error(translate('csv.unclosedQuote',{line:rows.length+1}));
   if(i<source.length&&source[i]!==delimiter&&source[i]!=='\r'&&source[i]!=='\n')throw Error(translate('csv.contentAfterQuote',{line:rows.length+1}));
  }else{
   while(i<source.length&&source[i]!==delimiter&&source[i]!=='\r'&&source[i]!=='\n'){if(source[i]==='"')throw Error(translate('csv.quoteInUnquoted',{line:rows.length+1}));value+=source[i++];}
  }
  row.push({start,end:i,value,quoted});
  if(source[i]===delimiter){i++;if(i===source.length)row.push({start:i,end:i,value:'',quoted:false});else continue;}
  else if(source[i]==='\r'||source[i]==='\n'){if(source[i]==='\r'&&source[i+1]==='\n')i++;i++;}
  rows.push(row);row=[];
 }
 return rows;
}
export function editDelimitedCell(source:string,cell:DelimitedCell,value:string,delimiter=','){
 if(value===cell.value)return source;
 const encoded=cell.quoted||value.includes(delimiter)||/["\r\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value;
 return source.slice(0,cell.start)+encoded+source.slice(cell.end);
}
