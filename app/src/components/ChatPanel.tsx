import {cn} from '@/lib/utils';
export function ChatPanel({compact=false,inputOnly=false}:{compact?:boolean;inputOnly?:boolean}){
 return <div className={cn('flex flex-col',inputOnly?'bg-transparent':'h-full bg-card')}>
 {!inputOnly&&<div className="flex flex-1 flex-col justify-center gap-2 px-5 text-sm text-muted-foreground"><h2 className="font-medium text-foreground">科研助手未接入</h2><p className="text-xs leading-relaxed">尚无可用 AI 服务。当前不会发送文件、执行任务或生成回复。</p></div>}
 <div className="px-3 py-3"><div className="rounded-[26px] border border-border bg-background px-4 py-3"><textarea disabled aria-label="科研助手尚未接入" rows={compact||inputOnly?1:2} placeholder="AI 服务未接入" className="w-full resize-none bg-transparent text-xs text-muted-foreground outline-none" /><p className="text-[10px] text-muted-foreground">未配置可用后端</p></div></div>
 </div>;
}
