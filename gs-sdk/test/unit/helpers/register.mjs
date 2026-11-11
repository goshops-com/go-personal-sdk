// Preload de los tests unitarios (node --import): registra el resolve hook y
// deja un DOM de jsdom como globals, asi los modulos de src/ se importan igual
// que en el navegador.
import { register } from 'node:module';
import { installDom } from './env.mjs';

register('./hooks.mjs', import.meta.url);
installDom();
