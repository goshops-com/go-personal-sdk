import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { actionRequestOf, assistantActionsOf, capabilitiesOf, hostOrigin, productEvent, receiveActionResult, requestStoreAction, send, validConfig, validSession, type ActionRequest, type Config, type Product, type Session } from './bridge';
import { StoreAction, type ActionState } from './StoreAction';
import { appearanceOf, cartColors, type Appearance } from './appearance';
import { Logo } from './Logo';
import { ProductList, ShowcaseProducts, type ShowcaseView } from './ProductCards';
import { useCustomCss } from './customCss';
import { copy } from './copy';
import { MarkdownMessage } from './MarkdownMessage';
import './style.css';

type Message = UIMessage<{ status?: string }, { products: { products: Product[] }; status: { label: string }; action: ActionRequest }>;
type Conversation = { id: string; messages: Message[]; running?: boolean; config: Config };

async function request(session: Session, path: string, body?: unknown): Promise<Conversation> {
  const res = await fetch(`${session.apiUrl}${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw Object.assign(new Error('Request failed'), { status: res.status });
  return res.json();
}

function Chat({ session, conversation, restart, appearance }: { session: Session; conversation: Conversation; restart: () => void; appearance: Appearance }) {
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
      ...(assistantActionsOf(latest.current).length ? { capabilities: assistantActionsOf(latest.current) } : {}),
    } }),
  }), [session.apiUrl, conversation.id]);
  // Estado de cada acción en la tienda pedida en esta sesión del chat y la navegación que espera el fin de la respuesta
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const navigation = useRef<ActionRequest | null>(null);
  const messagesRef = useRef<Message[]>(conversation.messages);
  const track = (id: string, state: ActionState) => setActions(current => ({ ...current, [id]: state }));

  // Registra un evento de producto en el mensaje que pidió la acción, si se encuentra
  function actionEvent(request: ActionRequest, type: 'add_to_cart' | 'open_product', messageId?: string) {
    const owner = messageId || messagesRef.current.find(m => m.parts.some(p => p.type === 'data-action' && p.data.id === request.id))?.id;
    if (owner && request.product) productEvent(latest.current, { conversationId: conversation.id, messageId: owner, productId: request.product.id, type });
  }

  // Ejecuta en la tienda una acción del asistente, registra su evento y guarda cómo salió
  async function runAction(request: ActionRequest, messageId?: string) {
    track(request.id, { status: 'running' });

    // Abrir un producto se registra antes de pedirlo, porque la página se va
    if (request.action === 'open_product') actionEvent(request, 'open_product', messageId);
    const result = await requestStoreAction(request);
    track(request.id, { status: result.ok ? 'done' : 'failed', result });
    if (result.ok && request.action === 'add_to_cart') actionEvent(request, 'add_to_cart', messageId);
  }

  // Recibe una acción del asistente: agrega al carrito ya o pide confirmación, y deja las navegaciones para el final
  function receiveAction(data: unknown) {
    const request = actionRequestOf(data);
    if (!request) return;
    if (request.action === 'add_to_cart') {
      if (request.confirm) track(request.id, { status: 'confirm' });
      else void runAction(request);
      return;
    }

    // Solo se navega una vez por respuesta: una navegación nueva reemplaza a la anterior
    if (navigation.current) track(navigation.current.id, { status: 'cancelled' });
    navigation.current = request;
    track(request.id, { status: 'waiting' });
  }

  // Al terminar la respuesta navega si quedó una pendiente; si se cortó, no
  function finishTurn({ message, isAbort, isError, isDisconnect }: { message: Message; isAbort: boolean; isError: boolean; isDisconnect: boolean }) {
    setSearching(false);
    const pending = navigation.current;
    navigation.current = null;
    if (!pending) return;
    if (isAbort || isError || isDisconnect) track(pending.id, { status: 'cancelled' });
    else void runAction(pending, message.id);
  }

  // Agrega al carrito desde el botón de una tarjeta, si está prendido y el sitio puede, y registra el evento en su mensaje
  const canAddToCart = capabilitiesOf(session).includes('card_add_to_cart') && !session.preview;
  const addFromCard = (messageId: string) => async (product: Product) => {
    const result = await requestStoreAction({ id: `card-${crypto.randomUUID()}`, action: 'card_add_to_cart', product: { id: product.id, name: product.name, url: product.url, quantity: 1 } });
    if (result.ok) productEvent(latest.current, { conversationId: conversation.id, messageId, productId: product.id, type: 'add_to_cart' });
    return result;
  };

  const { messages, setMessages, sendMessage, regenerate, status, error, stop, clearError } = useChat<Message>({
    id: conversation.id, messages: conversation.messages, transport,
    onData: part => {
      if (part.type === 'data-status') setSearching(true);
      if (part.type === 'data-action') receiveAction(part.data);
    },
    onFinish: finishTurn,
  });
  messagesRef.current = messages;
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
  return <main className="shopper gps-chat" lang={session.config.language} style={{ '--shopper-brand': session.config.color, ...cartColors(appearance.cart) } as React.CSSProperties}>
    <header className="chat-header gps-header"><Logo name={session.config.name} logo={appearance.logo} /><div className="chat-title"><h1>{session.config.name}</h1><span className="header-caption">{session.preview && <span className="preview-tag">Preview</span>}Personal Shopper</span></div>
      <button className="icon-button" title={t.newChat} aria-label={t.newChat} onClick={() => { stop(); restart(); }} disabled={busy}><span aria-hidden="true">↻</span></button>
      {session.canClose && <button className="icon-button" title={t.close} aria-label={t.close} onClick={() => send('close')}><span aria-hidden="true">×</span></button>}</header>
    <section className="conversation" aria-label={session.config.name}>
      {messages.length === 0 && <div className="welcome"><h2>{session.config.welcome}</h2>{session.config.suggestions.length > 0 && <div className="suggestions" role="group" aria-labelledby="start"><span className="eyebrow" id="start">{t.start}</span>{session.config.suggestions.map(s => <button key={s} onClick={() => void submit(s)}>{s}<span aria-hidden="true">→</span></button>)}</div>}</div>}
      {messages.filter(m => m.role !== 'assistant' || m.parts.some(p => p.type === 'text' && p.text.trim() || p.type === 'data-products' && p.data.products.length || p.type === 'data-action')).map(message => <div key={message.id} className={`message ${message.role} gps-message-${message.role}`}>
        {message.parts.map((part, index) => {
          if (part.type === 'text') return message.role === 'assistant' ? <MarkdownMessage key={index} text={part.text} /> : <p key={index} className="message-text">{part.text}</p>;
          if (part.type === 'data-products' && part.data.products.length) return <ProductList key={index} products={part.data.products} session={session} conversationId={conversation.id} messageId={message.id} cards={appearance.cards} cartButton={appearance.cart.card} onAddToCart={canAddToCart ? addFromCard(message.id) : undefined} />;
          if (part.type === 'data-action') {
            const request = actionRequestOf(part.data);
            return request && <StoreAction key={index} request={request} state={actions[request.id]} t={t} confirm={appearance.cart.confirm}
              onConfirm={() => void runAction(request, message.id)} onCancel={() => track(request.id, { status: 'cancelled' })} />;
          }
          return null;
        })}
        {message.metadata?.status && message.metadata.status !== 'completed' && <small className="interrupted">{message.metadata.status === 'failed' ? t.failed : t.interrupted}</small>}
      </div>)}
      {busy && <p className="working" role="status"><span className="working-dot" aria-hidden="true" />{searching ? t.searching : t.responding}</p>}
      {(error || notice || running) && <div className={!notice && running ? 'error is-busy' : 'error'} role="alert"><p>{notice || (running ? t.busy : t.error)}</p>{error && !running && <button onClick={() => void retryLast()} disabled={restoring || busy}>{t.retry}</button>}<button onClick={() => void recover()} disabled={restoring || busy}>{t.recover}</button></div>}
      <div ref={end} />
    </section>
    <form className="composer gps-composer" onSubmit={e => { e.preventDefault(); void submit(input); }}>
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
  const [appearance, setAppearance] = useState<Appearance>(() => appearanceOf(undefined));
  const [preview, setPreview] = useState<Config | null>(null);
  const [previewView, setPreviewView] = useState<ShowcaseView>('cards');
  useCustomCss(appearance.customCss);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [error, setError] = useState(false); const [nonce, setNonce] = useState(0);
  const activeId = useRef<string | undefined>(undefined); const loadedNonce = useRef(0);
  const ownerKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!hostOrigin || event.origin !== hostOrigin || event.source !== window.parent) return;
      // Vista previa de las tarjetas que pide el admin, con la config y la apariencia del borrador
      if (event.data?.type === 'gp-shopper:showcase-products' && validConfig(event.data.config)) {
        setPreview(event.data.config); setAppearance(appearanceOf(event.data.appearance));
        setPreviewView(event.data.view === 'confirm' ? 'confirm' : 'cards');
        return;
      }
      // Resultado de una acción en la tienda que el chat le pidió al SDK
      if (event.data?.type === 'gp-shopper:action-result') { receiveActionResult(event.data); return; }
      // Apariencia nueva sin recargar la conversación: el admin la manda en vivo mientras se edita
      if (event.data?.type === 'gp-shopper:appearance') { setAppearance(appearanceOf(event.data.appearance)); return; }
      if (event.data?.type === 'gp-shopper:initialize' && validSession(event.data.session)) {
        const incoming = event.data.session;
        setAppearance(appearanceOf(incoming.appearance));
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
  if (preview) return <ShowcaseProducts config={preview} appearance={appearance} view={previewView} />;
  if (!session || !conversation || error) return <div className={error ? 'connection is-error' : 'connection'} role={error ? 'alert' : 'status'}><div className="connection-mark" aria-hidden="true" /><p className="connection-text">{error ? t.unavailable : session ? t.connect : t.waiting}</p>{error && <button onClick={() => setNonce(n => n + 1)}>{t.recover}</button>}</div>;
  return <Chat key={conversation.id} session={{ ...session, config: conversation.config }} conversation={conversation} appearance={appearance} restart={() => { setConversation(null); setNonce(n => n + 1); }} />;
}

createRoot(document.getElementById('root')!).render(<App />);
