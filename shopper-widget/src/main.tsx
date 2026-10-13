import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { hostOrigin, send, validSession, type Config, type Product, type Session } from './bridge';
import { copy } from './copy';
import { MarkdownMessage } from './MarkdownMessage';
import './style.css';

type Message = UIMessage<{ status?: string }, { products: { products: Product[] }; status: { label: string } }>;
type Conversation = { id: string; messages: Message[]; running?: boolean; config: Config };

async function request(session: Session, path: string, body?: unknown): Promise<Conversation> {
  const res = await fetch(`${session.apiUrl}${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw Object.assign(new Error('Request failed'), { status: res.status });
  return res.json();
}

function ProductCard({ product, session, conversationId, messageId }: { product: Product; session: Session; conversationId: string; messageId: string }) {
  const ref = useRef<HTMLElement>(null);
  const t = copy[session.config.language] || copy.es;
  const event = (type: 'product_view' | 'product_click') => {
    if (session.preview) return;
    void fetch(`${session.apiUrl}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ eventId: crypto.randomUUID(), conversationId, messageId, productId: product.id, type }), keepalive: true }).catch(() => {});
    if (type === 'product_click') send('product-click', { productId: product.id });
  };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) timer = setTimeout(() => { event('product_view'); observer.disconnect(); }, 1000);
      else if (timer) clearTimeout(timer);
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [product.id, messageId]);
  let price = t.unknownPrice;
  if (product.price !== null) {
    try { price = product.currency ? new Intl.NumberFormat(session.config.language, { style: 'currency', currency: product.currency }).format(product.price) : new Intl.NumberFormat(session.config.language).format(product.price); }
    catch { price = String(product.price); }
  }
  return <article className="product" ref={ref}>
    <div className="product-image">{product.image ? <img src={product.image} alt="" loading="lazy" /> : <span aria-hidden="true">◇</span>}</div>
    <div className="product-details"><span className="brand">{product.brand}</span><h3>{product.name}</h3>
      <div className="product-foot"><strong className={product.price === null ? 'price price-unknown' : 'price'}>{price}</strong>
        <a href={product.url} target="_blank" rel="noopener noreferrer" onClick={() => event('product_click')}>{t.product} <span aria-hidden="true">↗</span></a></div></div>
  </article>;
}

function Chat({ session, conversation, restart }: { session: Session; conversation: Conversation; restart: () => void }) {
  const t = copy[session.config.language] || copy.es;
  const latest = useRef(session); latest.current = session;
  const [input, setInput] = useState(''); const [restoring, setRestoring] = useState(false);
  const [running, setRunning] = useState(!!conversation.running); const [notice, setNotice] = useState('');
  const [searching, setSearching] = useState(false); const end = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => new DefaultChatTransport<Message>({
    api: `${session.apiUrl}/conversations/${conversation.id}/messages`,
    headers: () => ({ Authorization: `Bearer ${latest.current.token}` }),
    prepareSendMessagesRequest: ({ messages }) => ({ body: {
      requestId: crypto.randomUUID(), message: messages.slice().reverse().find(m => m.role === 'user'),
      ...(latest.current.context ? { context: latest.current.context } : {}),
    } }),
  }), [session.apiUrl, conversation.id]);
  const { messages, setMessages, sendMessage, regenerate, status, error, stop, clearError } = useChat<Message>({
    id: conversation.id, messages: conversation.messages, transport,
    onData: part => { if (part.type === 'data-status') setSearching(true); },
    onFinish: () => setSearching(false),
  });
  const busy = status === 'submitted' || status === 'streaming';
  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => () => { void stopRef.current(); }, []);
  useEffect(() => { const pane = end.current?.parentElement; if (pane) pane.scrollTop = pane.scrollHeight; }, [messages, status]);
  async function recover() {
    setRestoring(true); setNotice('');
    try { const doc = await request(latest.current, `/conversations/${conversation.id}`); setMessages(doc.messages); setRunning(!!doc.running); clearError(); }
    catch { setNotice(t.unavailable); send('refresh'); }
    finally { setRestoring(false); }
  }
  async function retryLast() {
    setRestoring(true); setNotice('');
    try {
      const doc = await request(latest.current, `/conversations/${conversation.id}`);
      setMessages(doc.messages); setRunning(!!doc.running);
      if (doc.running) return;
      clearError(); await regenerate();
    } catch { setNotice(t.unavailable); }
    finally { setRestoring(false); }
  }
  const submit = async (text: string) => {
    if (!text.trim() || busy || running) return;
    setInput(''); setSearching(false); setNotice('');
    await sendMessage({ text: text.trim() });
  };
  return <main className="shopper" lang={session.config.language} style={{ '--shopper-brand': session.config.color } as React.CSSProperties}>
    <header className="chat-header"><div className="shopper-mark" aria-hidden="true">{(Array.from((session.config.name || '').trim())[0] || '').toUpperCase()}</div><div className="chat-title"><h1>{session.config.name}</h1><span className="header-caption">{session.preview && <span className="preview-tag">Preview</span>}Personal Shopper</span></div>
      <button className="icon-button" title={t.newChat} aria-label={t.newChat} onClick={() => { stop(); restart(); }} disabled={busy}><span aria-hidden="true">↻</span></button>
      {session.canClose && <button className="icon-button" title={t.close} aria-label={t.close} onClick={() => send('close')}><span aria-hidden="true">×</span></button>}</header>
    <section className="conversation" aria-label={session.config.name}>
      {messages.length === 0 && <div className="welcome"><h2>{session.config.welcome}</h2>{session.config.suggestions.length > 0 && <div className="suggestions" role="group" aria-labelledby="start"><span className="eyebrow" id="start">{t.start}</span>{session.config.suggestions.map(s => <button key={s} onClick={() => void submit(s)}>{s}<span aria-hidden="true">→</span></button>)}</div>}</div>}
      {messages.filter(m => m.role !== 'assistant' || m.parts.some(p => p.type === 'text' && p.text.trim() || p.type === 'data-products' && p.data.products.length)).map(message => <div key={message.id} className={`message ${message.role}`}>
        {message.parts.map((part, index) => {
          if (part.type === 'text') return message.role === 'assistant' ? <MarkdownMessage key={index} text={part.text} /> : <p key={index} className="message-text">{part.text}</p>;
          if (part.type === 'data-products' && part.data.products.length) return <div className="products" key={index}>{part.data.products.map(p => <ProductCard key={p.id} product={p} session={session} conversationId={conversation.id} messageId={message.id} />)}</div>;
          return null;
        })}
        {message.metadata?.status && message.metadata.status !== 'completed' && <small className="interrupted">{message.metadata.status === 'failed' ? t.failed : t.interrupted}</small>}
      </div>)}
      {busy && <p className="working" role="status"><span className="working-dot" aria-hidden="true" />{searching ? t.searching : t.responding}</p>}
      {(error || notice || running) && <div className={!notice && running ? 'error is-busy' : 'error'} role="alert"><p>{notice || (running ? t.busy : t.error)}</p>{error && !running && <button onClick={() => void retryLast()} disabled={restoring || busy}>{t.retry}</button>}<button onClick={() => void recover()} disabled={restoring || busy}>{t.recover}</button></div>}
      <div ref={end} />
    </section>
    <form className="composer" onSubmit={e => { e.preventDefault(); void submit(input); }}>
      <div className="composer-field">
        <label className="sr-only" htmlFor="question">{t.placeholder}</label>
        <textarea id="question" rows={2} maxLength={2000} value={input} placeholder={t.placeholder} disabled={busy || running}
          onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(input); } }} />
        {busy ? <button type="button" className="send stop" onClick={stop}>{t.stop}</button> : <button className="send" disabled={!input.trim() || running}>{t.send}<span aria-hidden="true">↑</span></button>}
      </div>
    </form>
  </main>;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [error, setError] = useState(false); const [nonce, setNonce] = useState(0);
  const activeId = useRef<string | undefined>(undefined); const loadedNonce = useRef(0);
  const ownerKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!hostOrigin || event.origin !== hostOrigin || event.source !== window.parent) return;
      if (event.data?.type === 'gp-shopper:initialize' && validSession(event.data.session)) {
        const incoming = event.data.session;
        const key = incoming.sessionKey || (incoming.preview ? incoming.token : incoming.apiUrl);
        if (ownerKey.current !== key) {
          ownerKey.current = key; activeId.current = undefined; setConversation(null);
        }
        setSession(incoming);
      }
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') send('close'); };
    window.addEventListener('message', receive); send('ready');
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true; setError(false);
    const newChat = nonce !== loadedNonce.current; loadedNonce.current = nonce;
    const load = async () => {
      let doc: Conversation;
      const existingId = !newChat && !session.preview && (session.conversationId || activeId.current);
      if (existingId) {
        try { doc = await request(session, `/conversations/${existingId}`); }
        catch (e) { if ((e as { status: number }).status !== 404) throw e; doc = await request(session, '/conversations', {}); }
      } else doc = await request(session, '/conversations', {});
      if (active) { activeId.current = doc.id; setConversation(doc); send('conversation', { id: doc.id }); }
    };
    void load().catch(() => { if (active) { setError(true); send('refresh'); } });
    return () => { active = false; };
  }, [session?.token, session?.sessionKey, nonce]);
  const t = copy[session?.config.language || 'es'];
  if (!session || !conversation || error) return <div className={error ? 'connection is-error' : 'connection'} role={error ? 'alert' : 'status'}><div className="connection-mark" aria-hidden="true" /><p className="connection-text">{error ? t.unavailable : session ? t.connect : t.waiting}</p>{error && <button onClick={() => setNonce(n => n + 1)}>{t.recover}</button>}</div>;
  return <Chat key={conversation.id} session={{ ...session, config: conversation.config }} conversation={conversation} restart={() => { setConversation(null); setNonce(n => n + 1); }} />;
}

createRoot(document.getElementById('root')!).render(<App />);
