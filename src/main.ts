// Un solo codice per due pagine:
// - index.html   → vetrina in SOLA LETTURA (tutti i gestori), app Dropbox con soli permessi di lettura;
// - gestore.html → app del GESTORE (chi aggiorna i dati), app Dropbox con il permesso di scrittura,
//                  pulsante "Registra" e importazione dell'Excel.
// Flusso: login Dropbox -> trova la cartella condivisa -> legge _app/dati.json -> calcola e mostra.
// Senza connessione mostra l'ultima copia dei dati salvata sul dispositivo.
// Navigazione: #/ (home), #/contratti, #/contratto/<id>, #/scadenze, #/pannelli.

import './style.css';
import { CONFIG } from './config';
import { datiValidi, VERSIONE_DATI, type Dati } from './modello';
import { icona } from './icone';
import { esc, meseDi, oggi } from './formato';
import * as viste from './viste';
import * as dbx from './dropbox';
import * as gestore from './gestore';

const GESTORE = document.documentElement.dataset.modalita === 'gestore';
const DEMO = new URLSearchParams(location.search).has('demo');
const K_CACHE = GESTORE ? 'gg.dati' : 'gi.dati';
const app = document.getElementById('app')!;
// Modulo e messaggi stanno FUORI da #app: ridisegnare la pagina non cancella ciò che si sta scrivendo.
const boxModulo = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'modulo' }));
const boxNotifica = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'avviso-fluttuante' }));
boxNotifica.setAttribute('role', 'status');

if (GESTORE) dbx.configura({ appKey: CONFIG.dropboxAppKeyGestore, scopes: CONFIG.scopesGestore, prefisso: 'gg' });

type Stato = { tipo: 'online' } | { tipo: 'offline' } | { tipo: 'caricamento' } | { tipo: 'salvataggio' } | { tipo: 'errore'; msg: string };

let dati: Dati | null = null;
/** Versione del file su Dropbox letta per ultima (per non sovrascrivere modifiche fatte altrove). */
let revDati: string | null = null;
let stato: Stato = { tipo: 'caricamento' };
let meseScelto = meseDi(oggi());
let menuAperto = false;

// ---------- memoria locale ----------

function leggiCache(): Dati | null {
  try {
    const d = JSON.parse(localStorage.getItem(K_CACHE) || 'null');
    return datiValidi(d) ? d : null;
  } catch {
    return null;
  }
}
function salvaCache(d: Dati) {
  try {
    localStorage.setItem(K_CACHE, JSON.stringify(d));
    // Insieme ai dati si ricorda di che versione sono (serve se si riparte senza connessione).
    if (GESTORE) localStorage.setItem(K_CACHE + '.rev', JSON.stringify(revDati));
  } catch {
    /* memoria non disponibile: si va avanti lo stesso */
  }
}
function leggiRevCache(): string | null {
  try {
    return JSON.parse(localStorage.getItem(K_CACHE + '.rev') || 'null');
  } catch {
    return null;
  }
}

/**
 * Caricamenti e salvataggi uno alla volta, nell'ordine in cui sono chiesti:
 * così un ricaricamento non può mai sovrapporsi a un salvataggio e annullarlo.
 */
let catena: Promise<unknown> = Promise.resolve();
function inSerie<T>(fn: () => Promise<T>): Promise<T> {
  const p = catena.then(fn, fn);
  catena = p.catch(() => undefined);
  return p;
}

// ---------- modifiche in attesa (fatte senza connessione, solo gestore) ----------

const K_ATTESA = 'gg.inAttesa';
interface InAttesa {
  /** Dati con tutte le modifiche fatte senza rete. */
  dati: Dati;
  /** Versione del file su Dropbox da cui si era partiti. */
  revBase: string | null;
  quante: number;
}
function leggiAttesa(): InAttesa | null {
  if (!GESTORE) return null;
  try {
    const a = JSON.parse(localStorage.getItem(K_ATTESA) || 'null') as InAttesa | null;
    return a && datiValidi(a.dati) ? a : null;
  } catch {
    return null;
  }
}
function scriviAttesa(a: InAttesa | null) {
  try {
    if (a) localStorage.setItem(K_ATTESA, JSON.stringify(a));
    else localStorage.removeItem(K_ATTESA);
  } catch {
    /* ignora */
  }
}

/**
 * Invia a Dropbox le modifiche fatte senza connessione.
 * Restituisce false se l'utente preferisce non inviarle ora (restano in attesa, nulla si perde).
 */
async function inviaInAttesa(): Promise<boolean> {
  const a = leggiAttesa();
  if (!a || !navigator.onLine) return true;
  const root = await dbx.trovaCartellaCondivisa();
  const percorso = root + '/' + CONFIG.fileDati;
  const attuale = await dbx.versioneFile(percorso);
  let base = a.revBase;
  if (attuale !== a.revBase) {
    const ok = confirm(
      `Mentre eri senza connessione i dati su Dropbox sono stati cambiati da un'altra parte.\n\n` +
        `OK = invia le tue ${a.quante} modifiche (sostituiscono la versione su Dropbox, che resta comunque nelle copie di sicurezza)\n` +
        `Annulla = non inviare ora: le modifiche restano salvate sul PC e te lo richiedo più tardi`,
    );
    if (!ok) return false;
    base = attuale;
  }
  revDati = await gestore.salvaConCopia(root, CONFIG.fileDati, a.dati, base);
  // Si svuota la coda solo se nel frattempo non si sono aggiunte altre modifiche.
  const ora = leggiAttesa();
  if (ora && ora.quante === a.quante) scriviAttesa(null);
  else if (ora) scriviAttesa({ ...ora, revBase: revDati, quante: ora.quante - a.quante });
  salvaCache(a.dati);
  notifica(`${a.quante === 1 ? 'La modifica fatta' : `Le ${a.quante} modifiche fatte`} senza connessione ${a.quante === 1 ? 'è stata inviata' : 'sono state inviate'} a Dropbox`);
  return true;
}

// ---------- disegno ----------

function fmtDataOra(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function barraStato(): string {
  const quando = dati ? fmtDataOra(dati.aggiornatoIl) : '';
  const attesa = leggiAttesa();
  if (attesa && stato.tipo !== 'salvataggio')
    return `<div class="stato blu">${icona('nuvolaNo')}<span>${attesa.quante} ${attesa.quante === 1 ? 'modifica salvata' : 'modifiche salvate'} sul PC: ${
      attesa.quante === 1 ? 'verrà inviata' : 'verranno inviate'
    } a Dropbox appena torna la rete</span></div>`;
  switch (stato.tipo) {
    case 'online':
      return `<div class="stato ok">${icona('nuvolaOk')}<span>Dati aggiornati al ${quando}</span></div>`;
    case 'caricamento':
      return `<div class="stato">${icona('nuvolaOk')}<span>Aggiornamento in corso…</span></div>`;
    case 'salvataggio':
      return `<div class="stato blu">${icona('nuvolaOk')}<span>Salvataggio su Dropbox…</span></div>`;
    case 'offline':
      return `<div class="stato off">${icona('nuvolaNo')}<span>Senza connessione: dati del ${quando}</span><small>${GESTORE ? 'per salvare serve la rete' : 'i documenti si aprono quando torna la rete'}</small></div>`;
    case 'errore':
      return `<div class="stato off">${icona('nuvolaNo')}<span>${esc(stato.msg)}</span>${quando ? `<small>dati del ${quando}</small>` : ''}</div>`;
  }
}

function disegna() {
  const rotta = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [sezione, ...resto] = rotta.split('/');
  const id = resto.join('/');

  let titolo = 'Gestione immobili';
  let corpo = '';
  if (!dati) {
    corpo = `<p class="vuoto">${stato.tipo === 'caricamento' ? 'Sto leggendo i dati da Dropbox…' : 'Nessun dato disponibile.'}</p>`;
  } else if (sezione === 'contratti') {
    titolo = 'Contratti';
    corpo = viste.elencoContratti(dati);
  } else if (sezione === 'contratto') {
    const c = dati.contratti.find((x) => x.id === id);
    titolo = c ? c.unita.split(' - ').slice(1).join(' - ') || c.unita : 'Contratto';
    corpo = viste.schedaContratto(dati, id);
  } else if (sezione === 'scadenze') {
    titolo = 'Scadenze';
    corpo = viste.elencoScadenze(dati);
  } else if (sezione === 'pannelli') {
    titolo = 'Pannelli solari';
    corpo = viste.pannelli(dati);
  } else if (sezione === 'movimenti') {
    titolo = 'Movimenti';
    const sotto = (['pagamenti', 'spese', 'richieste', 'fotovoltaico'] as const).find((x) => x === id) ?? 'pagamenti';
    corpo = viste.movimenti(dati, GESTORE, sotto);
  } else {
    corpo = viste.home(dati, meseScelto, GESTORE);
  }

  const inHome = !sezione;
  const badge = DEMO ? 'Dimostrazione' : GESTORE ? 'Modalità gestore' : 'Sola lettura';
  app.innerHTML = `
    ${viste.intestazione(titolo, !inHome, badge)}
    ${inHome || stato.tipo === 'salvataggio' ? barraStato() : ''}
    <main>${corpo}</main>
    <footer>
      <span id="msg" role="status"></span>
      ${DEMO ? '<a href="./">Esci dalla dimostrazione</a>' : '<button class="link-btn" id="esci">Esci da Dropbox</button>'}
    </footer>
    ${GESTORE && dati ? gestore.pulsanteRegistra(menuAperto) : ''}`;
  document.body.classList.toggle('con-fab', GESTORE && !!dati);
  if (!inHome) window.scrollTo(0, 0);
}

function messaggio(t: string) {
  const m = document.getElementById('msg');
  if (m) m.textContent = t;
}

/** Messaggio che compare in basso per qualche secondo ("Salvato su Dropbox"). */
let timerNotifica = 0;
function notifica(t: string, tipo: 'ok' | 'errore' = 'ok') {
  boxNotifica.textContent = t;
  boxNotifica.className = 'visibile ' + tipo;
  clearTimeout(timerNotifica);
  timerNotifica = window.setTimeout(() => (boxNotifica.className = ''), tipo === 'ok' ? 3200 : 6000);
}

// ---------- azioni (un solo ascoltatore per tutta la pagina) ----------

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(
    '[data-mese],[data-copia],[data-cartella],#esci,[data-registra],[data-apri-modulo],[data-registra-pagamento],[data-chiudi-modulo],[data-richiesta-pagata],[data-modifica],[data-elimina]',
  );
  if (!el) return;
  const ds = el.dataset;
  if (ds.mese) {
    meseScelto = ds.mese;
    disegna();
  } else if (ds.copia !== undefined) {
    void copia(ds.copia, el);
  } else if (ds.cartella !== undefined) {
    void apriCartella(ds.cartella, ds.riserva);
  } else if (el.id === 'esci') {
    const attesa = leggiAttesa();
    if (attesa && !confirm(`Hai ${attesa.quante} modifiche non ancora inviate a Dropbox: uscendo le perdi. Vuoi uscire lo stesso?`)) return;
    dbx.esci();
    // Uscendo si cancellano anche i dati salvati su questo dispositivo (riservatezza).
    try {
      localStorage.removeItem(K_CACHE);
      localStorage.removeItem(K_ATTESA);
    } catch {
      /* ignora */
    }
    dati = null;
    schermataLogin();
  } else if (ds.modifica && dati) {
    const [lista, i] = ds.modifica.split(':') as [gestore.ListaMovimenti, string];
    apriModulo(gestore.TIPO_DI_LISTA[lista], {}, { lista, indice: Number(i) });
  } else if (ds.elimina && dati) {
    const [lista, i] = ds.elimina.split(':') as [gestore.ListaMovimenti, string];
    if (confirm('Eliminare questo movimento? (Resta comunque nelle copie di sicurezza su Dropbox.)')) {
      void salva(gestore.eliminaMovimento(dati, lista, Number(i)), 'Movimento eliminato');
    }
  } else if (ds.registra !== undefined) {
    menuAperto = !menuAperto;
    disegna();
  } else if (ds.apriModulo) {
    menuAperto = false;
    disegna();
    apriModulo(ds.apriModulo as gestore.TipoModulo);
  } else if (ds.registraPagamento) {
    apriModulo('pagamento', { contratto: ds.registraPagamento, mese: ds.mesePagamento });
  } else if (ds.chiudiModulo !== undefined) {
    chiudiModulo();
  } else if (ds.richiestaPagata !== undefined && dati) {
    void salva(gestore.richiestaPagata(dati, Number(ds.richiestaPagata)), 'Richiesta segnata come pagata');
  }
});

document.addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  if (t.matches('[data-aggiorna-pagamento]') && dati) gestore.aggiornaSuggerimentoPagamento(dati, t.closest('form')!);
  if (t.matches('[data-import-excel]')) void importaExcel((t as HTMLInputElement).files?.[0]);
});

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if (!form.matches('.foglio[data-tipo]') || !dati) return;
  e.preventDefault();
  // Se si sta correggendo un movimento, controlliamo che sia ancora lo stesso (i dati potrebbero
  // essere stati ricaricati nel frattempo): così non si modifica mai la riga sbagliata.
  if (form.dataset.indice !== undefined) {
    const lista = form.dataset.lista as gestore.ListaMovimenti;
    if (JSON.stringify(dati[lista][Number(form.dataset.indice)]) !== form.dataset.originale) {
      form.querySelector('.errore-form')!.textContent = 'Nel frattempo i dati sono cambiati: chiudi e riapri il movimento da correggere.';
      return;
    }
  }
  const r = gestore.applicaModulo(dati, form);
  if ('errore' in r) {
    form.querySelector('.errore-form')!.textContent = r.errore;
    return;
  }
  chiudiModulo();
  void salva(r.dati, r.messaggio);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') chiudiModulo();
});

function apriModulo(tipo: gestore.TipoModulo, pre: { contratto?: string; mese?: string } = {}, modifica?: { lista: gestore.ListaMovimenti; indice: number }) {
  if (!dati) return;
  boxModulo.innerHTML = gestore.modulo(dati, tipo, pre, modifica);
  if (modifica) {
    const form = boxModulo.querySelector('form')!;
    form.dataset.lista = modifica.lista;
    form.dataset.originale = JSON.stringify(dati[modifica.lista][modifica.indice]);
    gestore.compilaModulo(form, gestore.valoriPerModifica(dati, modifica.lista, modifica.indice));
  }
  boxModulo.classList.add('aperto');
  boxModulo.querySelector<HTMLElement>('input:not([type=hidden]):not([type=radio]), select')?.focus();
}

function chiudiModulo() {
  boxModulo.innerHTML = '';
  boxModulo.classList.remove('aperto');
}

async function copia(testo: string, bottone: HTMLElement) {
  try {
    await navigator.clipboard.writeText(testo);
  } catch {
    // Riserva per browser che non permettono la copia diretta
    const t = document.createElement('textarea');
    t.value = testo;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  bottone.classList.add('copiato');
  const prima = bottone.innerHTML;
  bottone.textContent = 'Copiato';
  setTimeout(() => {
    bottone.classList.remove('copiato');
    bottone.innerHTML = prima;
  }, 1400);
}

/** Apre una cartella sul sito di Dropbox (i file restano lì: da lì si vedono e si scaricano). */
async function apriCartella(relativa: string, riserva?: string) {
  if (DEMO) return messaggio(`Qui si aprirebbe Dropbox sulla cartella "${relativa || 'Gestione Immobili'}".`);
  if (!navigator.onLine) return messaggio('Serve la connessione per aprire Dropbox.');
  // Safari blocca le finestre aperte dopo un'attesa: la apriamo subito e la riempiamo dopo.
  const w = window.open('', '_blank');
  try {
    const root = await dbx.trovaCartellaCondivisa();
    let percorso = relativa ? root + '/' + relativa : root;
    if (riserva && !(await dbx.esistePercorso(percorso))) percorso = root + '/' + riserva;
    const url = dbx.urlCartellaWeb(percorso);
    if (w) w.location.href = url;
    else location.href = url;
  } catch (err) {
    w?.close();
    messaggio(err instanceof Error ? err.message : 'Impossibile aprire Dropbox.');
  }
}

// ---------- salvataggio (solo gestore) ----------

/** Mette le modifiche in attesa sul PC (senza rete): verranno inviate al ritorno della connessione. */
function mettiInAttesa(nuovi: Dati, testoOk: string) {
  const a = leggiAttesa();
  scriviAttesa({ dati: nuovi, revBase: a ? a.revBase : revDati, quante: (a?.quante ?? 0) + 1 });
  dati = nuovi;
  salvaCache(nuovi);
  stato = { tipo: 'offline' };
  disegna();
  notifica(testoOk + ' · salvato sul PC, lo invio a Dropbox appena torna la rete');
}

/** Salva su Dropbox (in fila con gli altri caricamenti/salvataggi). true = salvato o messo in attesa. */
function salva(nuovi: Dati, testoOk: string): Promise<boolean> {
  return inSerie(() => salvaOra(nuovi, testoOk));
}

async function salvaOra(nuovi: Dati, testoOk: string): Promise<boolean> {
  nuovi.aggiornatoIl = new Date().toISOString();
  if (DEMO) {
    dati = nuovi;
    disegna();
    notifica(testoOk + ' (dimostrazione: niente è stato salvato)');
    return true;
  }
  // Senza rete, o con altre modifiche già in coda: si accoda (l'ordine resta giusto).
  if (!navigator.onLine || leggiAttesa()) {
    mettiInAttesa(nuovi, testoOk);
    if (navigator.onLine) void aggiorna();
    return true;
  }
  const prima = dati;
  dati = nuovi; // si vede subito, poi si conferma
  stato = { tipo: 'salvataggio' };
  disegna();
  try {
    const root = await dbx.trovaCartellaCondivisa();
    // Se non sappiamo ancora la versione su Dropbox, la chiediamo: mai sovrascrivere "alla cieca".
    if (revDati === null) revDati = await dbx.versioneFile(root + '/' + CONFIG.fileDati);
    revDati = await gestore.salvaConCopia(root, CONFIG.fileDati, nuovi, revDati);
    salvaCache(nuovi);
    stato = { tipo: 'online' };
    disegna();
    notifica(testoOk + ' · salvato su Dropbox');
    return true;
  } catch (e) {
    if (e instanceof TypeError || !navigator.onLine) {
      // La rete è caduta durante il salvataggio: non si perde niente, si accoda.
      dati = prima;
      mettiInAttesa(nuovi, testoOk);
      return true;
    }
    dati = prima;
    stato = { tipo: 'online' };
    disegna();
    if (e instanceof dbx.ConflittoVersione) {
      notifica('I dati su Dropbox erano cambiati (forse da un\'altra finestra): li ho ricaricati, ripeti l\'operazione.', 'errore');
      void aggiorna();
    } else if (e instanceof dbx.ErroreDropbox && e.tipo === 'non_collegato') {
      // Accesso scaduto: la modifica non si perde, resta in attesa e parte dopo il nuovo accesso.
      mettiInAttesa(nuovi, testoOk);
      schermataLogin(e.message + ' Le modifiche sono salvate sul PC e partiranno dopo l\'accesso.');
      return true;
    } else {
      notifica('Salvataggio non riuscito: ' + (e instanceof Error ? e.message : String(e)), 'errore');
    }
    return false;
  }
}

async function importaExcel(file: File | undefined) {
  if (!file) return;
  menuAperto = false;
  disegna();
  notifica('Sto leggendo l\'Excel…');
  try {
    let modulo: typeof import('./importa');
    try {
      modulo = await import('./importa');
    } catch {
      // Succede se l'app è stata aggiornata mentre era aperta: basta ricaricare la pagina.
      notifica("L'app è stata aggiornata: la ricarico, poi riprova l'importazione.", 'errore');
      setTimeout(() => location.reload(), 2500);
      return;
    }
    const { leggiExcel, unisci } = modulo;
    const r = await leggiExcel(await file.arrayBuffer());
    const d = r.dati;
    const riepilogo = `${d.unita.length} unità, ${d.inquilini.length} inquilini, ${d.contratti.length} contratti, ${d.pagamenti.length} pagamenti, ${d.scadenze.length} scadenze, ${d.spese.length} spese`;
    const controlli = r.avvisi.length ? '\n\nDa controllare nell\'Excel:\n- ' + r.avvisi.join('\n- ') : '';
    const registrati = dati
      ? [dati.pagamenti, dati.spese, dati.richieste, dati.fotovoltaico].reduce((s, l) => s + l.filter((x) => x.origine === 'app').length, 0)
      : 0;
    const nota = registrati ? `\n\nI ${registrati} movimenti registrati nell'app restano.` : '';
    if (!confirm(`Ho letto l'Excel "${file.name}":\n${riepilogo}.${controlli}${nota}\n\nCarico questi dati su Dropbox?`)) return;

    const nuovi: Dati = {
      versione: VERSIONE_DATI,
      aggiornatoIl: new Date().toISOString(),
      impostazioni: dati?.impostazioni ?? {
        sogliaArretratoPercentuale: 50,
        giorniRitardoRichiesta: 14,
        giornoScadenzaAffitto: 5,
        inizioMonitoraggio: meseDi(oggi()),
        avvisoScadenzeGiorni: 30,
        cartellaContratti: '01 Contratti',
      },
      ...unisci(dati, d),
    };
    const ok = await salva(nuovi, 'Dati importati dall\'Excel');
    // Le note private vanno nella cartella privata (mai condivisa).
    if (ok && !DEMO && navigator.onLine && r.notePrivate.length) {
      const root = await dbx.trovaCartellaCondivisa();
      const priv = gestore.cartellaPrivata(root);
      const rev = await dbx.versioneFile(priv + '/' + CONFIG.filePrivato);
      await gestore.salvaConCopia(priv, CONFIG.filePrivato, { versione: 1, aggiornatoIl: new Date().toISOString(), notePrivate: r.notePrivate }, rev);
    }
  } catch (e) {
    notifica('Non riesco a leggere l\'Excel: ' + (e instanceof Error ? e.message : String(e)), 'errore');
  }
}

// ---------- login ----------

function schermataLogin(errore?: string) {
  app.innerHTML = `
    <main class="login">
      <div class="logo">${icona('edificio')}</div>
      <h1>Gestione immobili${GESTORE ? ' · gestore' : ''}</h1>
      <p class="sub">${GESTORE ? 'Accedi con il tuo account Dropbox per aggiornare i dati.' : "Accedi con il tuo account Dropbox per vedere l'andamento e i documenti."}</p>
      ${errore ? `<p class="errore">${esc(errore)}</p>` : ''}
      ${
        dbx.appConfigurata()
          ? `<button class="primario" id="accedi">Accedi con Dropbox</button>`
          : `<p class="errore">Manca la App key di Dropbox ${GESTORE ? 'del gestore ' : ''}in <code>src/config.ts</code>.</p>`
      }
      <a class="demo" href="?demo=1">Guarda una dimostrazione con dati di esempio</a>
      <p class="nota">${GESTORE ? 'Questa app può anche salvare su Dropbox.' : "L'app può solo leggere."} La password la inserisci sul sito di Dropbox, non qui.</p>
    </main>`;
  document.getElementById('accedi')?.addEventListener('click', () => void dbx.avviaLogin());
}

// ---------- caricamento dati ----------

/** Ricarica i dati da Dropbox (in fila con i salvataggi, mai sovrapposto a uno di essi). */
function aggiorna(): Promise<void> {
  return inSerie(() => aggiornaOra(true));
}

async function aggiornaOra(riprova: boolean): Promise<void> {
  const attesa = leggiAttesa();
  dati = attesa?.dati ?? dati ?? leggiCache();
  if (revDati === null && GESTORE) revDati = leggiRevCache();
  stato = { tipo: 'caricamento' };
  disegna();
  if (!navigator.onLine) {
    stato = { tipo: 'offline' };
    return disegna();
  }
  try {
    // Prima di tutto si inviano le modifiche fatte senza rete (se ci sono).
    if (attesa && !(await inviaInAttesa())) {
      // L'utente ha preferito non inviarle ora: si continua a lavorare sulla copia del PC.
      stato = { tipo: 'offline' };
      return disegna();
    }
    const root = await dbx.trovaCartellaCondivisa();
    const percorso = root + '/' + CONFIG.fileDati;
    if (GESTORE) revDati = await dbx.versioneFile(percorso);
    const nuovi = await dbx.scaricaJson<unknown>(percorso);
    if (!datiValidi(nuovi)) throw new Error('Il file dei dati non è nel formato atteso.');
    dati = nuovi;
    salvaCache(nuovi);
    stato = { tipo: 'online' };
    disegna();
  } catch (e) {
    if (e instanceof dbx.ErroreDropbox && e.tipo === 'non_collegato') return schermataLogin(e.message);
    if (e instanceof dbx.ErroreDropbox && e.tipo === 'non_trovato' && riprova) {
      dbx.dimenticaCartella(); // la cartella potrebbe essere stata spostata: la ricerchiamo una volta
      return aggiornaOra(false);
    }
    const offline = e instanceof TypeError || !navigator.onLine; // TypeError = rete assente
    stato = offline ? { tipo: 'offline' } : { tipo: 'errore', msg: e instanceof Error ? e.message : String(e) };
    disegna();
  }
}

async function avvio() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  window.addEventListener('hashchange', () => (dati ? disegna() : undefined));

  if (DEMO) {
    const r = await fetch('./demo-dati.json');
    dati = (await r.json()) as Dati;
    dati.aggiornatoIl = new Date().toISOString();
    stato = { tipo: 'online' };
    return disegna();
  }
  try {
    const errore = await dbx.completaLoginSePresente();
    if (errore) return schermataLogin(errore);
  } catch {
    return schermataLogin('Login non completato: controlla la connessione e riprova.');
  }
  if (!dbx.collegato()) return schermataLogin();
  await aggiorna();
  window.addEventListener('online', () => void aggiorna());
  window.addEventListener('offline', () => {
    stato = { tipo: 'offline' };
    disegna();
  });
  document.addEventListener('visibilitychange', () => {
    // Nel gestore non ricarichiamo se c'è un modulo aperto (si perderebbe ciò che si sta scrivendo).
    if (document.visibilityState === 'visible' && !document.querySelector('#modulo.aperto')) void aggiorna();
  });
}

void avvio();
