import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import './chat-markdown.css';
import {rehypeCallouts} from '@/lib/rehypeCallouts';
import {useT} from '@/i18n/useT';

export function ChatMarkdown({text}:{text:string}){
 const {t}=useT();
 return <div className="chat-markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[[rehypeKatex,{trust:false,throwOnError:false,strict:'ignore',maxExpand:1000}],rehypeCallouts,[rehypeHighlight,{detect:false}]]} urlTransform={url=>/^(https?:\/\/|mailto:)/i.test(url)?url:''} components={{
  a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
  img:({alt})=><span className="text-muted-foreground">[{t('common.image')}{alt?t('common.imageAlt',{alt}):''}]</span>,
  table:({children})=><div className="chat-table-scroll" tabIndex={0} role="region" aria-label={t('chat.tableScroll')}><table>{children}</table></div>,
  pre:({children})=><pre tabIndex={0}>{children}</pre>,
 }}>{text}</ReactMarkdown></div>;
}
