import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Mic, Plus, RotateCcw, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentChat, agentNewSession, agentStatus, type AgentStatus, type ChatEvent } from '@/lib/agentClient';

interface ToolRun { name: string; isError?: boolean; done?: boolean }
interface Message { id: number; role: 'user' | 'assistant'; text: string; thinking?: string; tools: ToolRun[]; status?: string }

export interface ChatContext { label: string; text: string }

export function ChatPanel({ compact = false, inputOnly = false, context }: { compact?: boolean; inputOnly?: boolean; context?: ChatContext }) {
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { let active = true; agentStatus().then(s => { if (active) setAgent(s); }).catch(() => { if (active) setAgent({ available: false, error: '本地 agent 服务未连接。', token: '' }); }); return () => { active = false; }; }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  const available = !!agent?.available;
  const patchLast = (patch: (message: Message) => Message) => setMessages(list => list.map((m, i) => i === list.length - 1 ? patch(m) : m));

  async function send() {
    const text = input.trim();
    if (!text || busy || !available) return;
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages(list => [...list, { id: nextId.current++, role: 'user', text, tools: [] }, { id: nextId.current++, role: 'assistant', text: '', tools: [] }]);
    try {
      const prompt = context?.text ? `【当前上下文:${context.label}】\n${context.text.slice(-6000)}\n【上下文结束】\n\n${text}` : text;
      for await (const event of agentChat(prompt, { signal: controller.signal })) apply(event);
    } catch (error) {
      if (!controller.signal.aborted) patchLast(m => ({ ...m, status: (error as Error).message }));
    } finally { setBusy(false); abortRef.current = null; }
  }

  function apply(event: ChatEvent) {
    if (event.type === 'delta') patchLast(m => ({ ...m, text: m.text + event.text }));
    else if (event.type === 'thinking') patchLast(m => ({ ...m, thinking: (m.thinking ?? '') + event.text }));
    else if (event.type === 'status') patchLast(m => ({ ...m, status: event.text }));
    else if (event.type === 'tool') patchLast(m => ({ ...m, tools: event.phase === 'start' ? [...m.tools, { name: event.name }] : m.tools.map((t, i) => i === m.tools.length - 1 ? { ...t, done: true, isError: event.isError } : t) }));
    else if (event.type === 'error') patchLast(m => ({ ...m, status: event.message }));
  }

  function stop() { abortRef.current?.abort(); }

  async function reset() {
    if (busy) return;
    await agentNewSession().catch(() => {});
    setMessages([]);
  }

  const showTranscript = !inputOnly || messages.length > 0;
  return (
    <div className={cn('flex flex-col', inputOnly ? 'bg-transparent' : 'h-full bg-card')}>
      {!inputOnly && (
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
          <span className="text-xs font-medium">科研助手{available ? ' · pi' : ''}</span>
          {available && <button type="button" aria-label="新会话" title="新会话" onClick={reset} className="text-muted-foreground transition-colors hover:text-foreground"><RotateCcw className="h-3.5 w-3.5" /></button>}
        </div>
      )}
      {!available && !inputOnly && (
        <div className="flex flex-1 flex-col justify-center gap-2 px-5 text-sm text-muted-foreground">
          <h2 className="font-medium text-foreground">科研助手未接入</h2>
          <p className="text-xs leading-relaxed">{agent?.error ?? '正在检测本地 agent 服务…'}</p>
        </div>
      )}
      {available && showTranscript && (
        <div ref={scrollRef} className={cn('flex flex-col gap-3 overflow-y-auto px-3 py-3', inputOnly ? 'max-h-56 border-b border-border' : 'min-h-0 flex-1')}>
          {messages.length === 0 && !inputOnly && <p className="px-2 text-xs text-muted-foreground">向科研助手提问。它会结合当前论文上下文回答;涉及文件操作时会在此展示执行过程。</p>}
          {messages.map(m => (
            <div key={m.id} className={cn('flex flex-col gap-1', m.role === 'user' ? 'items-end' : 'items-start')}>
              <div className={cn('max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
                {m.text || (m.role === 'assistant' && !m.status ? <span className="text-muted-foreground">…</span> : null)}
              </div>
              {m.tools.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.tools.map((t, i) => <span key={i} className={cn('rounded-full border border-border px-2 py-0.5 text-[10px]', t.isError ? 'text-destructive' : 'text-muted-foreground')}>{t.name}{t.done ? '' : '…'}</span>)}
                </div>
              )}
              {m.status && <p className="text-[11px] text-muted-foreground">{m.status}</p>}
            </div>
          ))}
        </div>
      )}
      <div className={cn('px-3 py-3', !available && !inputOnly && 'mt-auto')}>
        <div className="rounded-[26px] border border-border bg-background px-3 py-2.5">
          <div className="flex items-center gap-2">
            <textarea
              disabled={!available || busy}
              aria-label="询问科研助手"
              rows={compact || inputOnly ? 1 : 2}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
              placeholder={available ? 'Ask anything' : 'AI 服务未接入'}
              className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
            <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
              <button type="button" disabled aria-label="添加附件" className="rounded-full p-1.5 transition-opacity disabled:pointer-events-none disabled:opacity-40"><Plus className="h-4 w-4" /></button>
              <button type="button" disabled aria-label="选择模型" className="flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-opacity disabled:pointer-events-none disabled:opacity-40">{available ? 'pi' : '未接入'} <ChevronDown className="h-3 w-3" /></button>
              <button type="button" disabled aria-label="语音输入" className="rounded-full p-1.5 transition-opacity disabled:pointer-events-none disabled:opacity-40"><Mic className="h-4 w-4" /></button>
              {busy
                ? <button type="button" onClick={stop} aria-label="停止" className="rounded-full bg-foreground p-1.5 text-primary-foreground transition-opacity hover:opacity-90"><Square className="h-4 w-4" /></button>
                : <button type="button" onClick={() => void send()} disabled={!available || !input.trim()} aria-label="发送" className="rounded-full bg-foreground p-1.5 text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
