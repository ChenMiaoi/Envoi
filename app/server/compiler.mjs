import {realpathSync,accessSync,constants} from 'node:fs';
import {toolInfo,configureTools,detectTool} from './tool-config.mjs';
import {lintText} from './lint.mjs';
import {gitRuntime,initializeBoundGit,readBoundGitStatus,readBoundGitLog,readBoundGitShow,verifyProjectBinding} from './git.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
const LIMIT = 40 * 1024 * 1024;
function relative(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.split('/').some(p => !p || p === '..' || p === '.' || /[\\:\u0000-\u001f]/u.test(p))) throw Error('Invalid project-relative file path');
  return value;
}
export function validateSnapshot(input, trusted=false) {
  if (!input || !['pdflatex','xelatex'].includes(input.engine)) throw Error('Unsupported TeX engine');
  const main = relative(input.main);
  if (!/\.tex$/i.test(main) || !Array.isArray(input.files) || (!trusted && input.files.length > 1500)) throw Error('Invalid main file or file count');
  const seen = new Set(); let total = 0;
  for (const file of input.files) {
    relative(file.path);
    if (seen.has(file.path) || !trusted && !/\.(tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|csv|txt|dat|otf|ttf)$/i.test(file.path)) throw Error('Duplicate or unsupported input file');
    seen.add(file.path);
    if (typeof file.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) throw Error('Invalid file encoding');
    total += Buffer.byteLength(file.base64, 'base64');
  }
  if (!seen.has(main) || !trusted && total > LIMIT) throw Error('Main file missing or project exceeds 40MB');
  return input;
}
export function runtimeInfo({trusted=false}={}) {
  if (!trusted && process.platform !== 'darwin') return { available: false, error: '当前本地编译适配器需要 macOS sandbox-exec；未启用无隔离编译。' };
  try {
    const located=detectTool('kpsewhich');const bin=process.env.ENVOI_TEX_BIN??process.env.PAPERDESK_TEX_BIN??(located?path.dirname(located):'');if(!path.isAbsolute(bin))throw Error('TeX bin directory unavailable');
    const programs=['kpsewhich','pdflatex','pdftex','xelatex','xetex','bibtex','xdvipdfmx'];const executables=programs.map(name=>{const selected=path.join(bin,name);accessSync(selected,constants.X_OK);return realpathSync(selected);});
    const root=realpathSync(execFileSync(path.join(bin,'kpsewhich'),['-var-value=TEXMFROOT'],{encoding:'utf8',timeout:5000}).trim());
    const prefixes=[...new Set(executables.map(executable=>executable.match(/^(.*)\/Cellar\//)?.[1]).filter(Boolean))];
    return {available:true,root,bin,executables,libraryRoots:prefixes.flatMap(prefix=>['lib','opt','bin','Cellar'].map(name=>path.join(prefix,name))),engines:['pdflatex','xelatex']};
  } catch { return { available: false, error: '未找到本地 TeX Live，未自动下载安装。' }; }
}
export async function compileSnapshot(input, { signal, timeoutMs = 90000, trustedRoot, sourceRoot, onResource = () => {} } = {}) {
  if (sourceRoot) {
    if (!trustedRoot || !['pdflatex','xelatex'].includes(input.engine) || !/\.tex$/i.test(relative(input.main)) || !Array.isArray(input.drafts)) throw Error('Invalid native compile input');
    const seen = new Set();
    for (const draft of input.drafts) {relative(draft.path); if (seen.has(draft.path) || typeof draft.text !== 'string') throw Error('Invalid draft'); seen.add(draft.path);}
  } else validateSnapshot(input, !!trustedRoot);
  const runtime = runtimeInfo({trusted: !!trustedRoot}); if (!runtime.available) throw Error(runtime.error);
  const directory = await realpath(await mkdtemp(path.join(tmpdir(),'envoi-tex-')));
  onResource({directory, active:true});
  let log = '', child;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason ?? Error('编译已取消'));
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = trustedRoot ? undefined : setTimeout(() => controller.abort(Error('编译超过时间限制，已终止。')), timeoutMs);
  try {
    if (sourceRoot) {
      const copy = async (source, target) => {
        controller.signal.throwIfAborted();
        await mkdir(target, {recursive:true});
        for (const entry of await readdir(source, {withFileTypes:true})) {
          controller.signal.throwIfAborted();
          if (['.git','.envoi','.paperdesk','node_modules','build','output'].includes(entry.name) || entry.name.startsWith('.envoi-write-') || entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) await copy(path.join(source,entry.name),path.join(target,entry.name));
          else if (entry.isFile()) await copyFile(path.join(source,entry.name),path.join(target,entry.name));
        }
      };
      await copy(sourceRoot,path.join(directory,'project'));
      for (const draft of input.drafts) {controller.signal.throwIfAborted();const target=path.join(directory,'project',draft.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,draft.text);}
    }
    for (const file of input.files ?? []) { controller.signal.throwIfAborted(); const target = path.join(directory, 'project', file.path); await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,Buffer.from(file.base64,'base64')); }
    const cwd = path.dirname(path.join(directory,'project',input.main));
    await mkdir(path.join(directory,'home'),{recursive:true});
    const binaryRoots=[...new Set([runtime.bin,...runtime.executables.map(executable=>path.dirname(executable))])];
    const quote = value => JSON.stringify(value);
    const profile = `(version 1)
(deny default)
(allow process-fork)
(allow mach-lookup)
(allow file-map-executable)
(allow process-exec ${[...runtime.executables,...["pdflatex","pdftex","xelatex","xetex","bibtex","xdvipdfmx"].map(name=>path.join(runtime.bin,name))].map(executable=>`(literal ${quote(executable)})`).join(' ')})
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath ${quote(directory)}) (subpath ${quote(runtime.root)}) ${[...binaryRoots,...runtime.libraryRoots].map(directory=>`(subpath ${quote(directory)})`).join(' ')} (subpath "/usr/lib") (subpath "/System/Library") (subpath "/System/Volumes/Preboot/Cryptexes/OS") (subpath "/private/var/db/dyld") (subpath "/Library/Fonts") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (subpath "/private/etc/fonts"))
(allow file-write* (subpath ${quote(directory)}) (literal "/dev/null"))`;
    const env = { PATH: [runtime.bin,'/usr/bin','/bin'].join(path.delimiter), HOME: path.join(directory,'home'), TMPDIR: directory, LANG:'en_US.UTF-8', TEXMFHOME: path.join(directory,'home'), TEXMFCONFIG:path.join(directory,'home'), TEXMFVAR:path.join(directory,'home'), TEXMFCACHE:path.join(directory,'home'), openin_any:'p', openout_any:'p', shell_escape:'f', TEXINPUTS:`${path.join(directory,'project')}//:`, BIBINPUTS:`${path.join(directory,'project')}//:` };
    const executionEnv = trustedRoot ? {...process.env, PATH: [runtime.bin, process.env.PATH].filter(Boolean).join(path.delimiter), TEXINPUTS: `${path.join(directory,'project')}//${path.delimiter}${trustedRoot}//${path.delimiter}${process.env.TEXINPUTS ?? ''}`, BIBINPUTS: `${path.join(directory,'project')}//${path.delimiter}${trustedRoot}//${path.delimiter}${process.env.BIBINPUTS ?? ''}`} : env;
    async function run(program,args,workingDirectory = cwd) {
      if (controller.signal.aborted) throw controller.signal.reason;
      log += `\n[${program}]\n`;
      await new Promise((resolve,reject) => {
        child=spawn(trustedRoot?path.join(runtime.bin,program):'/usr/bin/sandbox-exec',trustedRoot?args:['-p',profile,path.join(runtime.bin,program),...args],{cwd:workingDirectory,env:executionEnv,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
        if(child.pid)onResource({pid:child.pid,active:true});
        const kill=()=>{ try { if(process.platform==='win32')child.kill();else process.kill(-child.pid,'SIGKILL'); } catch {} };
        const append=chunk=>{log+=chunk.toString();if(log.length>2_000_000)controller.abort(Error('编译日志过大，任务已终止。'));};
        controller.signal.addEventListener('abort',kill,{once:true});
        child.stdout.on('data',append);child.stderr.on('data',append);child.on('error',reject);
        child.on('close',(code,signal)=>{if(child.pid)onResource({pid:child.pid,active:false});controller.signal.removeEventListener('abort',kill); if(controller.signal.aborted)reject(controller.signal.reason);else if(code!==0)reject(Error(`${program} 编译失败（退出码 ${code}, ${signal ?? ""}）`));else resolve();});
      });
    }
    const buildDirectory = path.join(cwd, 'build');
    await mkdir(buildDirectory,{recursive:true});
    const main = './' + path.basename(input.main);
    const args=[trustedRoot?'-shell-escape':'-no-shell-escape','-interaction=nonstopmode','-halt-on-error','-file-line-error','-synctex=1','-jobname=envoi','-output-directory=build',...(input.engine==='xelatex'?['-no-pdf']:[]),main];
    await run(input.engine,args);
    const aux=await readFile(path.join(buildDirectory,'envoi.aux'),'utf8').catch(()=> '');
    if (/\\bibdata\{/.test(aux) && /\\citation\{/.test(aux)) await run('bibtex',['envoi'],buildDirectory);
    if (await readFile(path.join(buildDirectory,'envoi.bcf')).then(()=>true,()=>false)) {if(trustedRoot)await run('biber',['envoi'],buildDirectory);else throw Error('当前适配器尚不支持 Biber；请使用 BibTeX 或外部编译。');}
    await run(input.engine,args); await run(input.engine,args);
    if(input.engine==='xelatex')await run('xdvipdfmx',['-o','envoi.pdf','envoi.xdv'],buildDirectory);
    const pdf=await readFile(path.join(buildDirectory,'envoi.pdf'));
    if(!pdf.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('编译没有产生有效PDF');
    const synctex=await readFile(path.join(buildDirectory,'envoi.synctex.gz')).catch(()=>null);
    return { ok:true, pdf:pdf.toString('base64'), synctex:synctex?synctex.toString('base64'):null, log };
  } catch(error) { return {ok:false,error:error.message,log}; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); await rm(directory,{recursive:true,force:true}); onResource({directory,active:false}); }
}
export function compilerPlugin() {
  const token=randomBytes(32).toString('hex'); let running=false;
  return { name:'envoi-local-compiler', configureServer(server) {
    server.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/api/envoi/'))return next();
      if(req.url.startsWith('/api/envoi/agent'))return next();
      const host=req.headers.host ?? '';
      const sameOrigin=req.headers.origin===`http://${host}` || (!req.headers.origin && req.headers['sec-fetch-site']==='same-origin');
      if(!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)||!sameOrigin){res.statusCode=403;res.end('Local same-origin requests only');return;}
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method==='GET'&&req.url==='/api/envoi/tools'){res.end(JSON.stringify({...toolInfo(),latex:runtimeInfo(),token}));return;}
      if(req.method==='POST'&&req.url==='/api/envoi/tools'&&req.headers['x-envoi-token']===token){try{let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Request too large');}res.end(JSON.stringify({...await configureTools(JSON.parse(body)),latex:runtimeInfo(),token}));}catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}return;}
      if(req.method==='GET' && req.url==='/api/envoi/compiler'){res.end(JSON.stringify({...runtimeInfo(),token}));return;}
      if(req.method==='GET' && req.url==='/api/envoi/git'){res.end(JSON.stringify({...gitRuntime(),token}));return;}
      if(req.method==='POST' && req.headers['x-envoi-token']===token){
        const gitHandlers={'/api/envoi/git-init':initializeBoundGit,'/api/envoi/git-status':readBoundGitStatus,'/api/envoi/git-log':readBoundGitLog,'/api/envoi/git-show':readBoundGitShow,'/api/envoi/project-bind':verifyProjectBinding};
        const handler=gitHandlers[req.url];if(!handler){res.statusCode=403;res.end(JSON.stringify({error:'Invalid compile request'}));return;}
        try {let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Request too large');}res.end(JSON.stringify(await handler(JSON.parse(body))));}
        catch(error){res.statusCode=400;res.end(JSON.stringify({ok:false,error:error.message}));}return;
      }
      if(req.method==='POST'&&req.url==='/api/envoi/lint'&&req.headers['x-envoi-token']===token){
        const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        try{let body='';for await(const chunk of req){body+=chunk;if(body.length>800000)throw Error('检查文本过大');}res.end(JSON.stringify(await lintText(JSON.parse(body),{signal:controller.signal})));}catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}return;
      }
      if(req.method!=='POST'||req.url!=='/api/envoi/compile'||req.headers['x-envoi-token']!==token){res.statusCode=403;res.end(JSON.stringify({error:'Invalid compile request'}));return;}
      if(running){res.statusCode=409;res.end(JSON.stringify({error:'已有编译正在运行，请稍后再试。'}));return;}
      running=true;
      const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort(Error('编译已取消'));});
      try {
        let body='';for await(const chunk of req){body+=chunk;if(body.length>LIMIT*1.5)throw Error('项目请求过大');}
        const snapshot=validateSnapshot(JSON.parse(body));
        res.end(JSON.stringify(await compileSnapshot(snapshot,{signal:controller.signal})));
      } catch(error){res.statusCode=400;res.end(JSON.stringify({ok:false,error:error.message}));}
      finally{running=false;}
    });
  }};
}
