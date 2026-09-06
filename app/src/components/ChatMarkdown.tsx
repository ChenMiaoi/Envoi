import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './chat-markdown.css';

export function ChatMarkdown({text}:{text:string}){
 return <div className="chat-markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[[rehypeKatex,{trust:false,throwOnError:false,strict:'ignore',maxExpand:1000}]]} urlTransform={url=>/^(https?:\/\/|mailto:)/i.test(url)?url:''} components={{
  a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
  img:({alt})=><span className="text-muted-foreground">[图片{alt?`：${alt}`:''}]</span>,
  table:({children})=><div className="chat-table-scroll" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table>{children}</table></div>,
  pre:({children})=><pre tabIndex={0}>{children}</pre>,
 }}>{text}</ReactMarkdown></div>;
}
