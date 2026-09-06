// PaperDesk agent relay: spawns `pi --mode rpc` per project directory and bridges
// browser fetch streams to the agent's JSONL stdin/stdout protocol.
// Mirrors the compiler/git middleware guards: localhost same-origin only, bearer token on POST.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The package's exports map hides dist/cli.js; resolve the npm bin symlink instead, fall back to PATH.
function piCli() {
  const local = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'pi');
  try { if (existsSync(local)) return realpathSync(local); } catch { /* fall through */ }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, 'pi');
    try { if (existsSync(candidate)) return realpathSync(candidate); } catch { /* keep looking */ }
  }
  return null;
}
async function verifyBoundDirectory({ directory, proof }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof proof !== 'string' || !/^\w{64}$/.test(proof)) throw Error('Invalid directory binding');
  const root = await realpath(directory).catch(error => { if (error.code === 'ENOENT') throw Error('项目目录位置不存在或已移动。'); throw error; });
  const marker = path.join(root, '.paperdesk', 'git-proof');
  if (!(await lstat(marker)).isFile() || await realpath(marker) !== marker || await readFile(marker, 'utf8') !== proof) throw Error('目录授权证明不匹配。');
  return root;
}

// One pi RPC process per working directory. Strict LF-delimited JSONL framing:
// split on \n only (Node readline is not protocol-compliant).
class PiProcess {
  constructor(cwd, cli) {
    this.cwd = cwd;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.requestId = 0;
    this.buffer = '';
    this.exited = false;
    this.proc = spawn(process.execPath, [cli, '--mode', 'rpc', '-e', path.join(path.dirname(fileURLToPath(import.meta.url)), 'paperdesk-search.ts')], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.stderr = '';
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => this.onData(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4000); });
    this.proc.on('exit', () => {
      this.exited = true;
      const error = Error(`pi 进程已退出${this.stderr ? `：${this.stderr.trim().split('\n').pop()}` : ''}`);
      for (const { reject } of this.pending.values()) reject(error);
      for (const listener of this.eventListeners) listener({ type: 'process_exit' });
    });
  }
  onData(chunk) {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) return;
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.type === 'response') {
        const entry = this.pending.get(record.id);
        if (entry) { this.pending.delete(record.id); entry.resolve(record); }
      } else {
        for (const listener of this.eventListeners) listener(record);
      }
    }
  }
  request(command) {
    if (this.exited) return Promise.reject(Error('pi 进程不可用'));
    const id = `req-${++this.requestId}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ ...command, id }) + '\n');
    });
  }
  onEvent(listener) { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  kill() { this.proc.kill(); }
}

export function agentPlugin() {
  const token = randomBytes(32).toString('hex');
  const cli = piCli();
  const processes = new Map();
  const boundDirs = new Set();

  async function processFor(cwd) {
    let pi = processes.get(cwd);
    if (pi?.exited) { processes.delete(cwd); pi = null; }
    if (!pi) {
      if (!cli) throw Error('未安装 pi（@mariozechner/pi-coding-agent）。');
      await mkdir(cwd, { recursive: true });
      pi = new PiProcess(cwd, cli);
      processes.set(cwd, pi);
    }
    return pi;
  }
  const scratchDir = () => path.join(os.homedir(), '.paperdesk', 'agent-scratch');

  async function readBody(req, limit = 2 * 1024 * 1024) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > limit) throw Error('请求过大'); }
    return JSON.parse(body);
  }

  // Translate pi RPC events into the small NDJSON vocabulary the browser consumes.
  function translate(event) {
    if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent;
      if (delta?.type === 'text_delta') return { type: 'delta', text: delta.delta };
      if (delta?.type === 'thinking_delta') return { type: 'thinking', text: delta.delta };
    }
    if (event.type === 'tool_execution_start') return { type: 'tool', phase: 'start', name: event.toolName ?? event.tool ?? 'tool' };
    if (event.type === 'tool_execution_end') return { type: 'tool', phase: 'end', name: event.toolName ?? event.tool ?? 'tool', isError: !!event.isError };
    if (event.type === 'auto_retry_start') return { type: 'status', text: '服务暂时不可用，正在重试…' };
    if (event.type === 'compaction_start') return { type: 'status', text: '正在压缩对话上下文…' };
    if (event.type === 'extension_error') return { type: 'status', text: `扩展错误：${event.error ?? '未知'}` };
    if (event.type === 'agent_settled') return { type: 'done' };
    if (event.type === 'process_exit') return { type: 'error', message: 'pi 进程意外退出' };
    return null;
  }
  // Cached probe: pi installed AND at least one model configured. Spawns a short-lived RPC process once.
  let statusCache = null;

  return {
    name: 'paperdesk-agent',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/paperdesk/agent')) return next();
        const host = req.headers.host ?? '';
        const sameOrigin = req.headers.origin === `http://${host}` || (!req.headers.origin && req.headers['sec-fetch-site'] === 'same-origin');
        if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) || !sameOrigin) { res.statusCode = 403; res.end('Local same-origin requests only'); return; }
        res.setHeader('Cache-Control', 'no-store');

        if (req.method === 'GET' && req.url === '/api/paperdesk/agent') {
          res.setHeader('Content-Type', 'application/json');
          if (!cli) { res.end(JSON.stringify({ available: false, error: '未检测到 pi 运行时，请安装应用依赖后重启服务。', token })); return; }
          if (!statusCache) {
            statusCache = (async () => {
              const probe = await processFor(scratchDir());
              const response = await probe.request({ type: 'get_available_models' });
              const models = response.data?.models ?? [];
              return models.length > 0
                ? { available: true, engine: 'pi', models: models.map(m => `${m.provider}/${m.id}`) }
                : { available: false, error: 'pi 已安装但尚未配置模型：请在 pi 中登录（pi 命令行 /login）或设置 API key 环境变量后重启服务。' };
            })().catch(error => ({ available: false, error: `pi 启动失败:${error.message}` }));
          }
          res.end(JSON.stringify({ ...(await statusCache), token }));
          return;
        }
        if (req.method !== 'POST' || req.headers['x-paperdesk-token'] !== token) { res.statusCode = 403; res.end(JSON.stringify({ error: 'Invalid agent request' })); return; }

        try {
          if (req.url === '/api/paperdesk/agent/bind') {
            const root = await verifyBoundDirectory(await readBody(req, 8192));
            boundDirs.add(root);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, directory: root }));
            return;
          }

          if (req.url === '/api/paperdesk/agent/abort' || req.url === '/api/paperdesk/agent/new') {
            const body = await readBody(req, 8192);
            const cwd = typeof body.cwd === 'string' && boundDirs.has(body.cwd) ? body.cwd : scratchDir();
            const pi = processes.get(cwd);
            const command = req.url.endsWith('/abort') ? { type: 'abort' } : { type: 'new_session' };
            const response = pi && !pi.exited ? await pi.request(command) : { success: true };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: !!response.success }));
            return;
          }

          if (req.url !== '/api/paperdesk/agent/chat') { res.statusCode = 403; res.end(JSON.stringify({ error: 'Invalid agent request' })); return; }
          const body = await readBody(req);
          if (typeof body.message !== 'string' || !body.message.trim()) throw Error('消息为空');
          const cwd = typeof body.cwd === 'string' && boundDirs.has(body.cwd) ? body.cwd : scratchDir();
          const pi = await processFor(cwd);

          res.setHeader('Content-Type', 'application/x-ndjson');
          res.flushHeaders();
          const write = record => { if (!res.writableEnded) res.write(JSON.stringify(record) + '\n'); };
          let settled = false;
          const off = pi.onEvent(event => {
            const out = translate(event);
            if (!out) return;
            if (out.type === 'done') settled = true;
            write(out);
            if (settled) { off(); res.end(); }
          });
          res.on('close', () => {
            off();
            if (!settled && !pi.exited) void pi.request({ type: 'abort' }).catch(() => {});
          });
          const accepted = await pi.request({ type: 'prompt', message: body.message });
          if (!accepted.success) { write({ type: 'error', message: accepted.error ?? '消息被拒绝' }); settled = true; off(); res.end(); }
        } catch (error) {
          if (!res.headersSent) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); }
          res.end(res.headersSent ? JSON.stringify({ type: 'error', message: error.message }) + '\n' : JSON.stringify({ error: error.message }));
        }
      });
    },
  };
}
