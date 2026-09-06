import {useEffect,useState} from 'react';
import {History,SquarePen} from 'lucide-react';
import {useAgent} from '@/agent/context';
import {agentRequest,type AgentRecord} from '@/lib/agentClient';
import {Popover,PopoverTrigger,PopoverContent} from './ui/popover';
export function ChatHistory(){
 const agent=useAgent(),[open,setOpen]=useState(false),[query,setQuery]=useState(''),[rows,setRows]=useState<AgentRecord[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const disabled=agent.busy||agent.navigating||!agent.ready;
 useEffect(()=>{if(!open)return;const controller=new AbortController();const timer=setTimeout(()=>{setLoading(true);setError('');void agentRequest<{sessions:AgentRecord[]}>('sessions',{projectId:agent.scope,query},controller.signal).then(result=>{if(!controller.signal.aborted)setRows(result.sessions);}).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},150);return()=>{clearTimeout(timer);controller.abort();};},[open,query,agent.scope]);
 return <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
 <button title={agent.busy?'生成结束后可新建对话':'新建对话'} aria-label="新建对话" disabled={disabled} onClick={()=>void agent.newSession()} className="rounded-full p-1.5 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"><SquarePen className="h-3.5 w-3.5"/></button>
 <Popover open={open} onOpenChange={value=>{if(value){setLoading(true);setError('');}setOpen(value);}}><PopoverTrigger asChild><button aria-label="对话历史" title="对话历史" className="rounded-full p-1.5 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><History className="h-3.5 w-3.5"/></button></PopoverTrigger><PopoverContent align="start" side="top" className="w-80 p-3">
 <p className="mb-2 text-xs text-muted-foreground">当前项目 · 本机对话历史</p><input aria-label="搜索当前项目对话" placeholder="搜索标题和已保存消息" value={query} onChange={event=>{setLoading(true);setQuery(event.target.value);}} className="mb-2 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none"/>
 <div className="max-h-64 overflow-y-auto">{error?<p role="alert" className="text-xs">{error}</p>:loading?<p className="text-xs text-muted-foreground">正在查找…</p>:rows.length?rows.map(row=><button key={row.id} disabled={disabled} aria-current={row.id===agent.record?.id?'true':undefined} onClick={()=>{void agent.select(row.id);setOpen(false);}} className="mb-1 block w-full rounded px-2 py-2 text-left hover:bg-muted aria-[current=true]:bg-muted disabled:opacity-50"><span className="block truncate text-sm">{row.name||'新会话'}</span><span className="text-xs text-muted-foreground">{row.created?new Date(row.created).toLocaleString():''} · {row.count??row.messages?.length??0} 条消息</span></button>):<p className="text-xs text-muted-foreground">{query?'没有匹配的对话':'暂无已保存对话'}</p>}</div>
 {agent.busy&&<p className="mt-2 text-xs text-muted-foreground">生成结束或停止后可切换对话。</p>}
 </PopoverContent></Popover>
 </div>;
}
