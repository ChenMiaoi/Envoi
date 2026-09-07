/** One raster job per viewer. Scroll events pause new jobs and PDF.js continuations. */
export class PdfRenderScheduler {
 private jobs:{controller:AbortController;run:(signal:AbortSignal)=>Promise<void>}[]=[];
 private current?:AbortController;
 private paused=false;
 private timer?:ReturnType<typeof setTimeout>;
 private waiting=new Set<()=>void>();
 pause(){this.paused=true;clearTimeout(this.timer);this.timer=setTimeout(()=>{this.paused=false;for(const resume of [...this.waiting])resume();this.pump();},140);}
 wait(signal:AbortSignal):Promise<void>{
  if(signal.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
  if(!this.paused)return Promise.resolve();
  return new Promise((resolve,reject)=>{const clean=()=>{this.waiting.delete(resume);signal.removeEventListener('abort',abort);};const resume=()=>{clean();resolve();};const abort=()=>{clean();reject(new DOMException('Cancelled','AbortError'));};this.waiting.add(resume);signal.addEventListener('abort',abort,{once:true});});
 }
 enqueue(run:(signal:AbortSignal)=>Promise<void>){const controller=new AbortController();this.jobs.push({controller,run});this.pump();return()=>{controller.abort();this.jobs=this.jobs.filter(job=>job.controller!==controller);};}
 private pump(){if(this.paused||this.current)return;const job=this.jobs.shift();if(!job)return;if(job.controller.signal.aborted){this.pump();return;}this.current=job.controller;void job.run(job.controller.signal).catch(()=>{/* The page reports rendering errors. */}).finally(()=>{this.current=undefined;this.pump();});}
 dispose(){clearTimeout(this.timer);this.paused=false;this.current?.abort();for(const job of this.jobs)job.controller.abort();this.jobs=[];}
}
