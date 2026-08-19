'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Send, Sparkles, RotateCcw,
  Bot, User, Loader2, ChevronRight
} from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
}

const SUGGESTED_QUESTIONS = [
  '目前有哪些逾期的行动项？',
  '最近一周开了哪些会议？',
  '各部门行动项完成情况如何？',
  '哪些行动项还没有分配责任人？',
];

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="text-sm leading-relaxed space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <h3 key={i} className="font-semibold text-slate-800 mt-2 mb-1">{line.slice(4)}</h3>;
        if (line.startsWith('## ')) return <h2 key={i} className="font-bold text-slate-800 mt-2 mb-1">{line.slice(3)}</h2>;
        if (line.startsWith('# ')) return <h1 key={i} className="font-bold text-slate-900 mt-2 mb-1 text-base">{line.slice(2)}</h1>;
        if (line.startsWith('- ') || line.startsWith('• ')) {
          return <div key={i} className="flex gap-1.5 items-start"><span className="text-blue-400 mt-1 flex-shrink-0 text-[8px]">●</span><span>{renderInline(line.slice(2))}</span></div>;
        }
        if (/^\d+\.\s/.test(line)) {
          const match = line.match(/^(\d+)\.\s(.*)/);
          if (match) return <div key={i} className="flex gap-1.5"><span className="text-slate-400 flex-shrink-0 w-4 text-xs">{match[1]}.</span><span>{renderInline(match[2])}</span></div>;
        }
        if (line.startsWith('> ')) return <blockquote key={i} className="border-l-2 border-blue-300 pl-2 text-slate-500 italic text-xs">{renderInline(line.slice(2))}</blockquote>;
        if (line === '') return <div key={i} className="h-1" />;
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="px-1 py-0.5 bg-slate-100 rounded text-xs font-mono text-slate-700">{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    return part;
  });
}

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const dragMoved = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const posInited = useRef(false);

  useEffect(() => {
    if (!posInited.current) {
      posInited.current = true;
      setPos({ x: window.innerWidth - 80, y: window.innerHeight - 80 });
    }
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved.current = true;
      const nx = Math.max(0, Math.min(window.innerWidth - 56, dragStart.current.px + dx));
      const ny = Math.max(0, Math.min(window.innerHeight - 56, dragStart.current.py + dy));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text.trim() };
    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', loading: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);

    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: ctrl.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
            if (delta) {
              accumulated += delta;
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: accumulated, loading: false } : m
              ));
            }
          } catch { /* skip */ }
        }
      }

      if (!accumulated) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: '抱歉，未获取到回复，请重试。', loading: false } : m
        ));
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: '请求出错，请检查网络后重试。', loading: false } : m
      ));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages, loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const clearChat = () => { abortRef.current?.abort(); setMessages([]); setLoading(false); };

  const toggle = () => setOpen(v => !v);

  const onBtnMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragMoved.current = false;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
  };

  const onBtnClick = () => {
    if (!dragMoved.current) toggle();
  };

  return (
    <>
      {/* ── 可拖动 AI Logo 按钮 ── */}
      <div className="fixed z-[60]" style={{ left: pos.x, top: pos.y }}>
        <button
          ref={btnRef}
          onMouseDown={onBtnMouseDown}
          onClick={onBtnClick}
          className={`
            relative group flex items-center justify-center cursor-grab active:cursor-grabbing
            w-14 h-14 rounded-2xl transition-shadow duration-300
            ${open 
              ? 'bg-slate-900 rotate-90 scale-90' 
              : 'bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 shadow-lg shadow-indigo-500/30 hover:shadow-2xl hover:shadow-indigo-500/50'
            }
          `}
          title={open ? '关闭 AI 助手' : '拖动移动 / 点击开启 AI 助手'}
        >
          {!open && (
            <div className="absolute inset-0 rounded-2xl bg-indigo-400 animate-ping opacity-20 scale-110 pointer-events-none" />
          )}
          
          {open ? (
            <X className="w-6 h-6 text-white" />
          ) : (
            <div className="relative">
              <Sparkles className="w-7 h-7 text-white animate-pulse" />
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full border-2 border-indigo-600 shadow-sm" />
            </div>
          )}
        </button>
      </div>

      {/* ── 半透明遮罩 ── */}
      <div
        className={`fixed inset-0 z-[55] bg-slate-900/10 backdrop-blur-[2px] transition-opacity duration-500 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={toggle}
      />

      {/* ── 侧边对话面板 (改造成高阶悬浮窗感) ── */}
      <div
        className={`
          fixed top-4 bottom-4 right-4 z-[56] w-[400px] 
          bg-white rounded-[32px] shadow-2xl border border-slate-200/60
          flex flex-col overflow-hidden transition-all duration-500 ease-in-out
          ${open ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-12 opacity-0 scale-95 pointer-events-none'}
        `}
      >
        {/* 顶部标题栏 - 升级质感 */}
        <div className="px-6 py-5 bg-gradient-to-br from-slate-900 to-slate-800 flex-shrink-0 relative overflow-hidden">
          {/* 背景装饰光晕 */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl -mr-16 -mt-16" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl -ml-12 -mb-12" />
          
          <div className="flex items-center gap-4 relative z-10">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 ring-1 ring-white/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-black text-white tracking-tight uppercase">AI Copilot</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Ready to assist</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-all"
                  title="清空对话"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={toggle}
                className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* 消息区 - 优化间距与气泡 */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6 bg-[#fcfdfe] custom-scrollbar">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center pt-10 gap-8 animate-in fade-in zoom-in-95 duration-700">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-2xl animate-pulse" />
                <div className="w-20 h-20 rounded-[28px] bg-gradient-to-br from-blue-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-2xl relative z-10">
                  <Sparkles className="w-10 h-10 text-white" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h4 className="text-lg font-black text-slate-800 tracking-tight">我是您的 AI 项目助理</h4>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">您可以询问有关会议内容、事项进度<br />或请求生成项目周报建议</p>
              </div>
              <div className="w-full space-y-3">
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest px-2">常用指令：</p>
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(q)}
                    className="w-full text-left text-[13px] px-5 py-4 bg-white hover:bg-slate-50 border border-slate-100 hover:border-blue-200 rounded-[20px] text-slate-600 hover:text-blue-600 transition-all shadow-sm hover:shadow-md group flex items-center justify-between"
                  >
                    <span className="font-bold">{q}</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                <div className={`w-9 h-9 rounded-2xl flex-shrink-0 flex items-center justify-center shadow-md ${
                  msg.role === 'user'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-100 text-indigo-600'
                }`}>
                  {msg.role === 'user' ? <User className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                </div>
                <div className={`max-w-[85%] rounded-[24px] px-5 py-3.5 shadow-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-none shadow-blue-200'
                    : 'bg-white border border-slate-100 rounded-tl-none text-slate-700'
                }`}>
                  {msg.loading ? (
                    <div className="flex items-center gap-1.5 py-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.3s]" />
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.15s]" />
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" />
                    </div>
                  ) : msg.role === 'user' ? (
                    <p className="text-[13px] font-bold">{msg.content}</p>
                  ) : (
                    <MarkdownText text={msg.content} />
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 - 悬浮卡片感 */}
        <div className="p-5 bg-white border-t border-slate-50">
          <div className="flex gap-3 items-end bg-slate-50/80 rounded-[24px] border border-slate-200/60 focus-within:border-blue-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50 transition-all px-5 py-4">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="问我任何关于项目的问题..."
              rows={1}
              className="flex-1 bg-transparent text-[13px] text-slate-800 placeholder:text-slate-400 resize-none outline-none min-h-[20px] max-h-[120px] leading-relaxed font-medium"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className={`
                w-10 h-10 rounded-2xl flex items-center justify-center transition-all flex-shrink-0 shadow-lg
                ${!input.trim() || loading
                  ? 'bg-slate-200 text-slate-400 shadow-none'
                  : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200 hover:-translate-y-0.5 active:scale-90'
                }
              `}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-4.5 h-4.5" />}
            </button>
          </div>
          <div className="flex items-center justify-center gap-2 mt-3">
            <div className="w-1 h-1 rounded-full bg-slate-200" />
            <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">AI generated · check facts</p>
            <div className="w-1 h-1 rounded-full bg-slate-200" />
          </div>
        </div>
      </div>
    </>
  );
}
