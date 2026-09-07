import {useEffect,useState} from 'react';
import {Link} from 'react-router';
import {ArrowUpRight,FilePlus2,FolderOpen,BookOpen,ArrowRight,X,Settings,Keyboard} from 'lucide-react';
import {BrandMark} from '@/components/BrandMark';
import {useT} from '@/i18n/useT';
import {recentProjects,forgetRecentProject,type RecentProject} from '@/lib/recentProjects';
import {useProject} from './context';

export function WelcomePage(){
 const {t}=useT(),{busy,saving,setMessage}=useProject();
 const [recent,setRecent]=useState<RecentProject[]>([]),[loading,setLoading]=useState(true),[removing,setRemoving]=useState<string>();
 useEffect(()=>{let live=true;const refresh=()=>{void recentProjects().then(rows=>{if(live)setRecent(rows);}).catch(error=>{if(live)setMessage(error.message);}).finally(()=>{if(live)setLoading(false);});};refresh();window.addEventListener('envoi:recent-updated',refresh);return()=>{live=false;window.removeEventListener('envoi:recent-updated',refresh);};},[setMessage]);
 const hasRecent=recent.length>0;
 const blocked=busy||saving||!!removing;
 const actions=[{event:'envoi:new-project',icon:FilePlus2,title:'welcome.new',description:'welcome.newHint'},{event:'envoi:open-project',icon:FolderOpen,title:'command.project-open',description:'welcome.openHint'},{event:'envoi:open-example',icon:BookOpen,title:'welcome.demo',description:'welcome.demoHint'}] as const;
 return <main data-testid="welcome-page" className="welcome-page h-full overflow-auto bg-background">
  <div className="welcome-panel mx-auto flex w-full max-w-2xl flex-col px-6 py-10 sm:px-10">
   <header className="welcome-heading mb-8 flex items-center gap-5">
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BrandMark className="h-12 w-12"/></div>
    <div><p className="mb-1 text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground">{t('welcome.eyebrow')}</p><h1 className="font-serif text-5xl italic tracking-tight">Envoi<span className="text-primary">.</span></h1><p className="mt-3 text-sm text-muted-foreground">{t('welcome.tagline')}</p></div>
   </header>
   <div className="flex flex-col gap-8">
    <section aria-labelledby="welcome-start" className={hasRecent?'order-2':undefined}><h2 id="welcome-start" className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">{t('welcome.start')}</h2>
     <div className={hasRecent?'flex flex-wrap gap-2':'space-y-2'}>{actions.map(action=><button key={action.event} aria-label={t(action.title)} disabled={blocked} onClick={()=>window.dispatchEvent(new Event(action.event))} className={`group flex items-center rounded-lg border border-border text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline focus-visible:outline-primary disabled:opacity-40 ${hasRecent?'gap-2 px-3 py-2':'w-full gap-4 bg-card p-4'}`}><action.icon className="h-5 w-5 shrink-0 text-primary"/><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t(action.title)}</span>{!hasRecent&&<span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t(action.description)}</span>}</span>{!hasRecent&&<ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary"/>}</button>)}</div>
    </section>
    {(loading||hasRecent)&&<section aria-labelledby="welcome-recent" className="order-1"><div className="mb-4 flex items-center justify-between"><h2 id="welcome-recent" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t('welcome.recent')}</h2>{recent.length>0&&<span className="text-xs text-muted-foreground">{recent.length}</span>}</div>
     {loading?<p className="py-5 text-sm text-muted-foreground">{t('project.processing')}</p>:recent.length?<div className="max-h-80 overflow-y-auto">{recent.map(entry=><div key={entry.id} className="group flex items-center rounded-lg hover:bg-secondary"><button disabled={blocked||!entry.path} onClick={()=>window.dispatchEvent(new CustomEvent('envoi:open-recent',{detail:entry.path}))} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left focus-visible:outline focus-visible:outline-primary disabled:opacity-40"><FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.name}</span><span title={entry.path} className="mt-1 block truncate text-xs text-muted-foreground">{entry.path??t('project.reopenToVerify')}</span></span><ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground"/></button><button disabled={blocked} aria-label={t('welcome.remove',{name:entry.name})} title={t('project.removeRecord')} onClick={async()=>{setRemoving(entry.id);try{await forgetRecentProject(entry.id);setRecent(rows=>rows.filter(row=>row.id!==entry.id));window.dispatchEvent(new Event('envoi:recent-updated'));}catch(error){setMessage((error as Error).message);}finally{setRemoving(undefined);}}} className="m-1 rounded p-2 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-primary disabled:opacity-40"><X className="h-3.5 w-3.5"/></button></div>)}</div>:null}
    </section>}
   </div>
   <footer className="welcome-footer pt-6"><div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs text-muted-foreground"><Link className="flex items-center gap-1.5 hover:text-primary" to="/settings/global/general"><Settings className="h-3.5 w-3.5"/>{t('view.settings')}</Link><Link className="flex items-center gap-1.5 hover:text-primary" to="/settings/global/shortcuts"><Keyboard className="h-3.5 w-3.5"/>{t('welcome.shortcuts')}</Link><a href="https://www.latex-project.org/help/documentation/" target="_blank" rel="noreferrer" className="hover:text-primary">{t('welcome.help')} ↗</a></div></footer>
  </div>
 </main>;
}
