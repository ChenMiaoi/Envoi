import {useEffect,useState} from 'react';
import {FolderOpen,ChevronDown} from 'lucide-react';
import {useProject} from './context';
import {nativeGet} from '@/lib/localData';
import {Tooltip,TooltipTrigger,TooltipContent} from '@/components/ui/tooltip';
export function ProjectIdentity(){
 const {project}=useProject(),[location,setLocation]=useState<{id:string;path:string}|null>(null);
 const empty=project.id==='empty',name=empty?'未打开项目':project.name,path=location?.id===project.id?location.path:'';
 useEffect(()=>{let live=true;const read=()=>{void nativeGet<Record<string,string>>('bindings').then(result=>{const value=result?.value[project.id];if(live)setLocation({id:project.id,path:typeof value==='string'&&value.startsWith('/')?value:''});}).catch(()=>{});};if(!empty)read();window.addEventListener('envoi:connection-updated',read);return()=>{live=false;window.removeEventListener('envoi:connection-updated',read);};},[project.id,empty]);
 return <Tooltip><TooltipTrigger asChild><button aria-label={`项目：${name}，打开项目管理`} onClick={()=>window.dispatchEvent(new Event(empty?'envoi:open-project':'envoi:manage-projects'))} className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground"/><span className="truncate">{name}</span><ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground"/></button></TooltipTrigger><TooltipContent side="bottom" className="max-w-lg break-all"><span>{name}</span>{path&&<span className="mt-1 block font-mono text-[11px]">{path}</span>}</TooltipContent></Tooltip>;
}
