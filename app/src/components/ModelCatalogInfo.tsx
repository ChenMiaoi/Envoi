import {useState,type ReactNode} from 'react';
import {RefreshCw} from 'lucide-react';
import {agentRequest,type ModelCatalog} from '@/lib/agentClient';
export function ModelCatalogInfo({provider,catalog,onRefresh,children}:{provider?:string;catalog?:ModelCatalog;onRefresh:()=>Promise<void>;children?:ReactNode}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const supported=provider&&catalog&&!['unsupported','manual','unconfigured'].includes(catalog.state);
 return <div className="mt-1 border-t border-border/50 pt-1 text-[10px] leading-relaxed text-muted-foreground"><div className="flex items-center justify-end gap-1">{supported&&<button type="button" aria-label="刷新模型目录" title="向服务商重新获取模型目录" disabled={busy} className="shrink-0 rounded-md p-1.5 hover:bg-accent disabled:opacity-40" onClick={()=>{setBusy(true);setError('');void agentRequest('models/refresh',{provider}).then(()=>onRefresh()).catch(error=>setError(error.message)).finally(()=>setBusy(false));}}><RefreshCw className={'h-3.5 w-3.5'+(busy?' animate-spin':'')}/></button>}{children}</div>
 {(error||catalog?.error)&&<p role="status" className="break-words">{error||catalog?.error}</p>}

 </div>;
}
