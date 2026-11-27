// Preguntas por voz con el reconocimiento del navegador (Web Speech API): escucha, corta solo al terminar la frase y devuelve el texto.

type RecognitionEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type RecognitionClass = new () => Recognition;

// Región por defecto de cada idioma del chat, si la del navegador no coincide.
const DEFAULT_LOCALES: Record<string, string> = { es: 'es-ES', en: 'en-US', pt: 'pt-BR' };

// Espera antes de reintentar el arranque si el navegador lo rechaza.
const RETRY_MS = 250;

// Devuelve el reconocimiento de voz del navegador, o null si no tiene (por ejemplo Firefox).
export function speechRecognition(): RecognitionClass | null {
  const browser = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return browser.SpeechRecognition || browser.webkitSpeechRecognition || null;
}

// Idioma del reconocimiento: el del navegador si es del idioma del chat (es-UY, es-AR…); si no, el de por defecto.
export function recognitionLang(language: string, browserLanguage = navigator.language || ''): string {
  if (browserLanguage.toLowerCase().startsWith(`${language}-`)) return browserLanguage;
  return DEFAULT_LOCALES[language] || DEFAULT_LOCALES.es;
}

type ListenOptions = { lang: string; onText: (text: string) => void; onEnd: (error?: string) => void };

// Escucha una frase y entrega su texto; al terminar (con texto, sin voz, con error o cancelado) avisa una sola vez.
export function listen({ lang, onText, onEnd }: ListenOptions): { cancel: () => void } {
  const Recognition = speechRecognition();
  if (!Recognition) throw new Error('VOICE_UNSUPPORTED');

  // Una sola frase, solo el resultado final y una alternativa
  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;
  let done = false;

  // Desconecta los eventos, apaga el micrófono y avisa que terminó
  function finish(error?: string) {
    if (done) return;
    done = true;
    recognition.onresult = recognition.onerror = recognition.onend = null;
    try { recognition.abort(); } catch { /* Ya estaba apagado. */ }
    onEnd(error);
  }

  // Al llegar la frase final cierra la sesión y entrega el texto
  recognition.onresult = event => {
    const text = (event.results[0]?.[0]?.transcript || '').trim();
    finish();
    if (text) onText(text);
  };
  recognition.onerror = event => finish(event.error);
  recognition.onend = () => finish('no-speech');

  // Arranca; si el navegador lo rechaza, reintenta una vez
  try {
    recognition.start();
  } catch {
    setTimeout(() => {
      try { recognition.start(); } catch { finish('start-failed'); }
    }, RETRY_MS);
  }

  return { cancel: () => finish('aborted') };
}
