export interface Binding {key:string;shift:boolean;alt:boolean}
export const shortcuts=[
 {id:'save',key:'s',label:'保存全部修改',category:'文件',event:'paperdesk:save'},
 {id:'commands',key:'k',label:'命令面板',category:'导航'},
 {id:'reader',key:'1',shift:true,label:'阅读页',category:'导航'},
 {id:'writer',key:'2',shift:true,label:'写作页',category:'导航'},
 {id:'open',key:'o',alt:true,label:'打开项目',category:'文件',event:'paperdesk:open-project'},
 {id:'compile',key:'Enter',alt:true,label:'编译当前论文',category:'编译',event:'paperdesk:compile'},
] as const;
export type CommandId=typeof shortcuts[number]['id'];export type ShortcutOverrides=Partial<Record<CommandId,Binding>>;
export function commandBinding(id:CommandId,overrides:ShortcutOverrides={}):Binding{const command=shortcuts.find(command=>command.id===id)!;return overrides[id]??{key:command.key,shift:'shift' in command,alt:'alt' in command};}
export function bindingText(binding:Binding){return ['Mod',binding.alt?'Alt':'',binding.shift?'Shift':'',binding.key.length===1?binding.key.toUpperCase():binding.key].filter(Boolean).join('+');}
function fingerprint(binding:Binding){return bindingText(binding).toLowerCase();}
export function validateBinding(id:CommandId,binding:Binding,overrides:ShortcutOverrides={}){
 if(!/^(?:[a-z0-9]|Enter|F[1-9]|F1[0-2])$/i.test(binding.key))return '请选择字母、数字、Enter 或功能键，且包含 Ctrl / ⌘。';
 if(['F4','F5','F11','F12'].includes(binding.key.toUpperCase())||(!binding.alt&&['w','t','n','r','l','q','p','j','h','u','f','a','c','v','x','z','y','0'].includes(binding.key.toLowerCase())))return '此组合保留给系统、浏览器或编辑器，不能覆盖。';
 const conflict=shortcuts.find(command=>command.id!==id&&fingerprint(commandBinding(command.id,overrides))===fingerprint(binding));return conflict?`与“${conflict.label}”冲突，请选择其他组合。`:'';
}
export function normalizeShortcuts(raw:unknown):ShortcutOverrides{
 const result:ShortcutOverrides={};if(!raw||typeof raw!=='object')return result;
 const candidates=raw as Record<string,Partial<Binding>>;
 for(const command of shortcuts){const candidate=candidates[command.id];if(candidate&&typeof candidate.key==='string'&&typeof candidate.alt==='boolean'&&typeof candidate.shift==='boolean')result[command.id]=candidate as Binding;}
 let changed=true;while(changed){changed=false;for(const command of shortcuts){const binding=result[command.id];if(binding&&validateBinding(command.id,binding,result)){delete result[command.id];changed=true;}}}
 return result;
}
export function matchShortcut(event:Pick<KeyboardEvent,'key'|'code'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'>,overrides:ShortcutOverrides={}){return shortcuts.find(item=>{const binding=commandBinding(item.id,overrides);return (event.ctrlKey||event.metaKey)&&event.shiftKey===binding.shift&&event.altKey===binding.alt&&(event.key.toLowerCase()===binding.key.toLowerCase()||event.code===`Key${binding.key.toUpperCase()}`||event.code===`Digit${binding.key}`);});}
export function shortcutLabel(display:string,mac:boolean){return display.replace('Mod',mac?'⌘ / Ctrl':'Ctrl').replaceAll('Shift',mac?'⇧':'Shift').replaceAll('Alt',mac?'⌥':'Alt');}
