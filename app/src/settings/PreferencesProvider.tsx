import {nativeMigrate,nativePut,nativeGet} from "@/lib/localData";
import {useEffect,useState,useRef,type ReactNode} from 'react';import {PreferencesContext} from './context';import {accents,textFonts,normalizePreferences,type Preferences} from './model';
const key='paperdesk.preferences.v1';
export function PreferencesProvider({children}:{children:ReactNode}){
 const edits=useRef(0);const revision=useRef<number|undefined>(undefined),writes=useRef(Promise.resolve());
 const [preferences,setPreferences]=useState(()=>{try{return normalizePreferences(JSON.parse(localStorage.getItem(key)??'null'));}catch{return normalizePreferences(null);}}),[error,setError]=useState('');
 const initialPreferences=useRef(preferences);
 useEffect(()=>{let active=true;const version=edits.current;writes.current=nativeMigrate('preferences',initialPreferences.current).then(result=>{if(active){revision.current=result.revision;if(edits.current===version)setPreferences(normalizePreferences(result.value));}}).catch(()=>{if(active)setError('本机偏好服务未连接；浏览器备份仍保留，稍后修改时可重试保存。');});return()=>{active=false;};},[]);
 useEffect(()=>{const color=accents[preferences.accent].hsl;for(const name of ['--primary','--ring','--sidebar-primary','--sidebar-ring'])document.documentElement.style.setProperty(name,color);},[preferences.accent]);
 useEffect(()=>{const style=document.documentElement.style;style.setProperty('--ui-font',textFonts[preferences.uiFontFamily].css);style.setProperty('--ui-font-size',`${preferences.uiFontSize}px`);style.setProperty('--ui-scale',String(preferences.uiFontSize/13));},[preferences.uiFontFamily,preferences.uiFontSize]);
 const update=(patch:Partial<Preferences>)=>{edits.current++;const next=normalizePreferences({...preferences,...patch});try{localStorage.setItem(key,JSON.stringify(next));setError('');}catch{setError('偏好已在当前窗口应用，但浏览器存储不可用；刷新可能丢失。');}setPreferences(next);writes.current=writes.current.catch(()=>{}).then(async()=>{try{if(revision.current===undefined)revision.current=(await nativeGet('preferences'))?.revision??0;const result=await nativePut('preferences',next,'default',{expectedRevision:revision.current});revision.current=result.revision;setError('');}catch(error){setError('偏好仅保留浏览器备份，本机保存失败：'+(error as Error).message);}});};
 useEffect(()=>{const sync=(event:StorageEvent)=>{if(event.key===key){void nativeGet('preferences').then(result=>{if(result){revision.current=result.revision;setPreferences(normalizePreferences(result.value));}}).catch(()=>setError('另一窗口已修改偏好，本机同步暂不可用。'));}};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[]);
 return <PreferencesContext.Provider value={{preferences,update,error}}>{children}</PreferencesContext.Provider>;
}
