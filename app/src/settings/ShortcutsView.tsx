import {useState} from 'react';
import {Link} from 'react-router';
import {usePreferences} from './context';
import {commands,DEFAULT_BINDS,parseBinding,serializeBinding,commandChord,chordLabel,validateChord,eventChord,resolveBindings,type Chord,type Command,type Scope} from '@/navigation/shortcuts';

const scopeNames:Record<Scope,string>={global:'全局',reader:'阅读页',writer:'写作页'};

export function ShortcutsView(){
 const {preferences,update,error}=usePreferences();
 const [query,setQuery]=useState('');
 const [scope,setScope]=useState('');
 const [recording,setRecording]=useState<string|null>(null);
 const [message,setMessage]=useState('');
 const mac=/Mac|iPhone|iPad/.test(navigator.platform);
 const bindings=resolveBindings(preferences.bindings);
 const without=(command:Command)=>bindings.filter(line=>parseBinding(line)?.command.id!==command.id);
 const save=(command:Command,chord:Chord)=>{
  const next=without(command);
  const invalid=validateChord(chord,next);
  if(invalid){setMessage(invalid);return;}
  update({bindings:[...next,serializeBinding(command,chord)]});
  setRecording(null);
  setMessage('快捷键已保存并立即生效。');
 };
 const reset=(command:Command)=>{
  const next=without(command);
  const fallback=DEFAULT_BINDS.find(line=>parseBinding(line)?.command.id===command.id);
  if(!fallback){update({bindings:next});setMessage('已恢复默认：此命令默认不绑定快捷键。');return;}
  const invalid=validateChord(parseBinding(fallback)!.chord,next);
  if(invalid){setMessage(`默认组合${invalid}`);return;}
  update({bindings:[...next,fallback]});
  setMessage('已恢复默认快捷键。');
 };
 const visible=commands.filter(item=>(!scope||item.scope===scope)&&item.label.includes(query));
 return <div className="h-full overflow-auto p-7"><div className="mx-auto max-w-3xl">
  <Link className="text-xs text-primary" to="/settings/global/general">← 返回通用设置</Link>
  <h1 className="mt-4 text-xl font-semibold">快捷键</h1>
  <p className="mt-2 text-xs text-muted-foreground">本机浏览器个人偏好。Mod 同时匹配 Ctrl 与 macOS ⌘；修饰键分层：Mod+Shift 切换页面，Mod+Alt 触发当前页面内动作。页面内命令只在对应页面生效。修改保存键后，默认 Ctrl/⌘S 将不再触发保存。保存命令写入当前项目全部未保存文件，不编译。</p>
  <div className="my-5 flex gap-3">
   <input aria-label="搜索快捷键" placeholder="搜索命令…" value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 flex-1 rounded border border-input bg-card p-2 text-xs" />
   <select aria-label="快捷键范围" value={scope} onChange={e=>setScope(e.target.value)} className="rounded border border-input bg-card p-2 text-xs">
    <option value="">全部范围</option>
    {(Object.keys(scopeNames) as Scope[]).map(name=><option key={name} value={name}>{scopeNames[name]}</option>)}
   </select>
   <button className="text-xs text-primary" onClick={()=>{update({bindings:[]});setRecording(null);setMessage('全部快捷键已恢复默认。');}}>全部重置</button>
  </div>
  <p role="status" className="mb-3 text-xs text-warning">{error||message}</p>
  <div className="rounded-xl border border-border bg-card px-5">
   {visible.map(item=>{
    const chord=commandChord(item.id,bindings);
    return <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4 last:border-0">
     <div><h2 className="text-sm">{item.label}</h2><p className="mt-1 text-xs text-muted-foreground">{scopeNames[item.scope]} · {item.action}</p></div>
     <div className="flex items-center gap-3">
      {recording===item.id
       ?<input data-shortcut-recorder autoFocus readOnly aria-label={`录入${item.label}快捷键`} placeholder="按新组合 · Esc 取消" className="w-52 rounded border border-primary bg-background p-2 text-xs" onKeyDown={event=>{
         event.preventDefault();event.stopPropagation();
         if(event.key==='Escape'){setRecording(null);return;}
         if(['Control','Meta','Shift','Alt'].includes(event.key))return;
         const next=eventChord(event);
         if(next)save(item,next);
        }} />
       :<button className="rounded border border-border px-3 py-2 text-xs" aria-label={`修改${item.label}快捷键`} onClick={()=>{setMessage('');setRecording(item.id);}}><kbd>{chord?chordLabel(chord,mac):'未绑定'}</kbd></button>}
      <button className="text-xs text-muted-foreground" onClick={()=>reset(item)}>重置</button>
     </div>
    </div>;
   })}
  </div>
 </div></div>;
}
