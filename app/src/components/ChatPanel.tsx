import {cn} from '@/lib/utils';
import {ArrowUp,ChevronDown,Mic,Plus} from 'lucide-react';

export function ChatPanel({compact=false,inputOnly=false}:{compact?:boolean;inputOnly?:boolean}){
 // AI 后端尚未接入：输入栏保持正常外观，仅禁用交互。
 const available=false;
 return <div className={cn('flex flex-col',inputOnly?'bg-transparent':'h-full bg-card')}>
 {!inputOnly&&<div className="flex flex-1 flex-col justify-center gap-2 px-5 text-sm text-muted-foreground"><h2 className="font-medium text-foreground">科研助手未接入</h2><p className="text-xs leading-relaxed">尚无可用 AI 服务。当前不会发送文件、执行任务或生成回复。</p></div>}
 <div className="px-3 py-3">
  <div className="flex items-center gap-3 rounded-[26px] border border-border bg-background px-4 py-2.5">
   <textarea disabled={!available} aria-label="询问科研助手" rows={compact||inputOnly?1:2} placeholder="Ask anything" className="w-full resize-none self-center bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed" />
   <div className="flex shrink-0 items-center gap-1.5">
    <button disabled={!available} aria-label="添加附件" className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"><Plus className="h-4 w-4" /></button>
    <button disabled={!available} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">{available?'选择模型':'未接入'}<ChevronDown className="h-3.5 w-3.5" /></button>
    <button disabled={!available} aria-label="语音输入" className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"><Mic className="h-4 w-4" /></button>
    <button disabled={!available} aria-label="发送" className="rounded-full bg-primary p-2 text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
   </div>
  </div>
 </div>
 </div>;
}
