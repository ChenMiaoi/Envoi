import {useEffect,useState,type ReactNode} from 'react';import {PreferencesContext} from './context';import {accents,textFonts,normalizePreferences,type Preferences} from './model';
const key='paperdesk.preferences.v1';
export function PreferencesProvider({children}:{children:ReactNode}){
 const [preferences,setPreferences]=useState(()=>{try{return normalizePreferences(JSON.parse(localStorage.getItem(key)??'null'));}catch{return normalizePreferences(null);}}),[error,setError]=useState('');
 useEffect(()=>{const color=accents[preferences.accent].hsl;for(const name of ['--primary','--ring','--sidebar-primary','--sidebar-ring'])document.documentElement.style.setProperty(name,color);},[preferences.accent]);
 useEffect(()=>{const style=document.documentElement.style;style.setProperty('--ui-font',textFonts[preferences.uiFontFamily].css);style.setProperty('--ui-font-size',`${preferences.uiFontSize}px`);style.setProperty('--ui-scale',String(preferences.uiFontSize/13));},[preferences.uiFontFamily,preferences.uiFontSize]);
 const update=(patch:Partial<Preferences>)=>{const next=normalizePreferences({...preferences,...patch});try{localStorage.setItem(key,JSON.stringify(next));setError('');}catch{setError('偏好已在当前窗口应用，但浏览器存储不可用；刷新可能丢失。');}setPreferences(next);};
 useEffect(()=>{const sync=(event:StorageEvent)=>{if(event.key===key){try{setPreferences(normalizePreferences(JSON.parse(event.newValue??'null')));}catch{/* Ignore malformed values from other tabs. */}}};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[]);
 return <PreferencesContext.Provider value={{preferences,update,error}}>{children}</PreferencesContext.Provider>;
}
