import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

/**
 * Regole di sicurezza del sito (Content Security Policy), aggiunte solo nella versione pubblicata:
 * la pagina può eseguire solo il proprio codice e può parlare solo con Dropbox.
 * Anche se un giorno un testo malevolo finisse nei dati, non potrebbe caricare script esterni
 * né mandare dati altrove.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://api.dropboxapi.com https://content.dropboxapi.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const sicurezza = (): Plugin => ({
  name: 'regole-sicurezza',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`),
});

export default defineConfig({
  // Percorsi relativi: il sito funziona sia in locale sia su https://<utente>.github.io/<repository>/
  base: './',
  plugins: [sicurezza()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    rollupOptions: {
      // Due pagine: la vetrina (sola lettura) e l'app del gestore.
      input: {
        vetrina: resolve(import.meta.dirname, 'index.html'),
        gestore: resolve(import.meta.dirname, 'gestore.html'),
      },
    },
  },
});
