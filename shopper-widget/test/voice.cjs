// Preguntas por voz con el reconocimiento del navegador: soporte, idioma, frase final, errores, cancelar y reintento al arrancar.
globalThis.window = globalThis.window || {};
require('./load.cjs');
const assert = require('node:assert/strict');
const { speechRecognition, recognitionLang, listen } = require('../src/voice.ts');

// Reconocimiento simulado: guarda las instancias para disparar sus eventos desde el test.
class FakeRecognition {
  static instances = [];
  static failStarts = 0;
  constructor() { this.starts = 0; this.aborted = 0; FakeRecognition.instances.push(this); }
  start() { this.starts++; if (FakeRecognition.failStarts > 0) { FakeRecognition.failStarts--; throw new Error('InvalidStateError'); } }
  abort() { this.aborted++; }
}
const last = () => FakeRecognition.instances.at(-1);
const result = (transcript) => ({ results: [[{ transcript }]] });

// Escucha y junta lo que entrega: textos y cómo terminó.
function session() {
  const out = { texts: [], ends: [] };
  out.control = listen({ lang: 'es-UY', onText: (text) => out.texts.push(text), onEnd: (error) => out.ends.push(error) });
  return out;
}

(async () => {
  // Sin reconocimiento en el navegador (Firefox) no hay voz
  globalThis.window = {};
  assert.equal(speechRecognition(), null);
  assert.throws(() => listen({ lang: 'es-ES', onText: () => {}, onEnd: () => {} }), /VOICE_UNSUPPORTED/);

  // Usa el estándar o el prefijo de Chrome y Safari
  globalThis.window = { webkitSpeechRecognition: FakeRecognition };
  assert.equal(speechRecognition(), FakeRecognition);
  globalThis.window = { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: class {} };
  assert.equal(speechRecognition(), FakeRecognition);

  // Idioma: la región del navegador si es del idioma del chat; si no, la de por defecto
  assert.equal(recognitionLang('es', 'es-UY'), 'es-UY');
  assert.equal(recognitionLang('es', 'en-US'), 'es-ES');
  assert.equal(recognitionLang('pt', ''), 'pt-BR');
  assert.equal(recognitionLang('en', 'EN-gb'), 'EN-gb');
  assert.equal(recognitionLang('fr', 'fr-FR'), 'fr-FR');
  assert.equal(recognitionLang('it', 'es-AR'), 'es-ES', 'un idioma sin región por defecto usa español');

  // Configura una sola frase, solo el resultado final y una alternativa
  const ok = session();
  const rec = last();
  assert.deepEqual([rec.lang, rec.interimResults, rec.maxAlternatives, rec.continuous, rec.starts], ['es-UY', false, 1, false, 1]);

  // Con la frase final apaga el micrófono, avisa que terminó y entrega el texto sin espacios
  rec.onresult(result('  championes negros  '));
  assert.deepEqual(ok.texts, ['championes negros']);
  assert.deepEqual(ok.ends, [undefined]);
  assert.equal(rec.aborted, 1);
  assert.equal(rec.onresult, null, 'desconecta los eventos');
  ok.control.cancel();
  assert.deepEqual(ok.ends, [undefined], 'avisa una sola vez');

  // Una frase vacía termina sin texto
  const empty = session();
  last().onresult(result('   '));
  assert.deepEqual([empty.texts, empty.ends], [[], [undefined]]);

  // Sin voz, con error del navegador o cancelado: termina con su motivo y sin texto
  const silent = session();
  last().onend();
  assert.deepEqual(silent.ends, ['no-speech']);
  const denied = session();
  last().onerror({ error: 'not-allowed' });
  assert.deepEqual(denied.ends, ['not-allowed']);
  const cancelled = session();
  cancelled.control.cancel();
  assert.deepEqual([cancelled.texts, cancelled.ends, last().aborted], [[], ['aborted'], 1]);

  // Si apagar el micrófono falla igual termina
  const stubborn = session();
  last().abort = () => { throw new Error('already stopped'); };
  last().onend();
  assert.deepEqual(stubborn.ends, ['no-speech']);

  // Si el navegador rechaza el arranque, reintenta una vez a los 250 ms; si vuelve a fallar, termina
  const realTimeout = globalThis.setTimeout;
  const pending = [];
  globalThis.setTimeout = (fn, ms) => { pending.push({ fn, ms }); return 0; };
  FakeRecognition.failStarts = 1;
  const retried = session();
  assert.deepEqual([last().starts, pending[0].ms], [1, 250]);
  pending.shift().fn();
  assert.deepEqual([last().starts, retried.ends], [2, []], 'el segundo intento arranca');
  FakeRecognition.failStarts = 2;
  const broken = session();
  pending.shift().fn();
  assert.deepEqual(broken.ends, ['start-failed']);
  globalThis.setTimeout = realTimeout;

  console.log('Voice: all assertions passed');
})().catch((error) => { console.error(error); process.exit(1); });
