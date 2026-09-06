// Browser client for the PaperDesk agent relay (app/server/agent.mjs).
// The relay owns the pi subprocess; this module is a thin NDJSON streaming wrapper.
export interface AgentStatus { available: boolean; engine?: string; error?: string; token: string }

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; phase: 'start' | 'end'; name: string; isError?: boolean }
  | { type: 'status'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export async function agentStatus(signal?: AbortSignal): Promise<AgentStatus> {
  const response = await fetch('/api/paperdesk/agent', { signal });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('本地 agent 服务不可用，请通过项目开发服务启动。');
  return response.json();
}

// Reuses the git bridge proof marker (.paperdesk/git-proof) as the directory authorization.
export async function bindAgentDirectory(directory: FileSystemDirectoryHandle, absolutePath: string, token: string): Promise<string> {
  const proof = crypto.getRandomValues(new Uint8Array(32)).reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '');
  const state = await directory.getDirectoryHandle('.paperdesk', { create: true });
  const handle = await state.getFileHandle('git-proof', { create: true });
  const stream = await handle.createWritable();
  await stream.write(proof);
  await stream.close();
  try {
    const response = await fetch('/api/paperdesk/agent/bind', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PaperDesk-Token': token }, body: JSON.stringify({ directory: absolutePath, proof }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error ?? '目录授权失败');
    return result.directory as string;
  } finally { await state.removeEntry('git-proof').catch(() => {}); }
}

export async function* agentChat(message: string, options: { cwd?: string; context?: string; signal?: AbortSignal } = {}): AsyncGenerator<ChatEvent> {
  const status = await agentStatus(options.signal);
  if (!status.available) throw new Error(status.error ?? 'agent 不可用');
  const body = { message: options.context ? `${options.context}\n\n${message}` : message, cwd: options.cwd };
  const response = await fetch('/api/paperdesk/agent/chat', { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', 'X-PaperDesk-Token': status.token }, body: JSON.stringify(body) });
  if (!response.ok || !response.body) { const error = await response.json().catch(() => ({})); throw new Error(error.error ?? `agent 服务返回 ${response.status}`); }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) yield JSON.parse(line) as ChatEvent;
    }
  }
}

export async function agentAbort(cwd?: string) {
  const status = await agentStatus();
  await fetch('/api/paperdesk/agent/abort', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PaperDesk-Token': status.token }, body: JSON.stringify({ cwd }) });
}

export async function agentNewSession(cwd?: string) {
  const status = await agentStatus();
  await fetch('/api/paperdesk/agent/new', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PaperDesk-Token': status.token }, body: JSON.stringify({ cwd }) });
}
