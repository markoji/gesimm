// App del gestore: moduli "Registra" e salvataggio su Dropbox.
// Ogni salvataggio: 1) copia di sicurezza della versione attuale (ultime N),
// 2) caricamento con controllo di versione (se i dati su Dropbox sono cambiati nel frattempo, si ferma).

import { CONFIG } from './config';
import type { Dati, Pagamento, Richiesta, Spesa, VoceFotovoltaico } from './modello';
import { attesoMensile, contrattiAttivi, inquilinoDi, mesiArretrati, nomeContratto, pagatoNelMese } from './calcoli';
import { aggiungiAData, aggiungiMesi, data, esc, euro, leggiImporto, meseDi, meseEsteso, normalizzaMese, oggi } from './formato';
import { icona } from './icone';
import * as dbx from './dropbox';

// ---------- salvataggio ----------

const timbro = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Salva un file JSON tenendo le ultime copie di sicurezza in _app/backup. Restituisce la nuova versione. */
export async function salvaConCopia(cartella: string, fileRelativo: string, contenuto: unknown, revAttesa: string | null): Promise<string> {
  const percorso = cartella + '/' + fileRelativo;
  const nome = fileRelativo.split('/').pop()!;
  const base = nome.replace(/\.json$/, '');
  const cartellaBackup = cartella + '/_app/backup';
  if (revAttesa) {
    // Prima si controlla che su Dropbox ci sia ancora la versione attesa: in caso di conflitto
    // ci si ferma subito, senza consumare le copie di sicurezza buone.
    if ((await dbx.versioneFile(percorso)) !== revAttesa) throw new dbx.ConflittoVersione('I dati su Dropbox sono stati modificati nel frattempo.');
    await dbx.copiaFile(percorso, `${cartellaBackup}/${base}-${timbro()}.json`);
    const vecchie = (await dbx.elencaFile(cartellaBackup)).filter((f) => f.startsWith(base + '-')).sort();
    for (const f of vecchie.slice(0, Math.max(0, vecchie.length - CONFIG.copieDiSicurezza))) {
      await dbx.eliminaFile(cartellaBackup + '/' + f);
    }
  }
  return dbx.caricaJson(percorso, contenuto, revAttesa);
}

/** Cartella privata: accanto a quella condivisa ("…/Gestione Immobili - Privato"). */
export const cartellaPrivata = (root: string) => root.slice(0, root.lastIndexOf('/')) + '/' + CONFIG.nomeCartellaPrivata;

// ---------- moduli ----------

export type TipoModulo = 'pagamento' | 'spesa' | 'richiesta' | 'pannelli';

export const MENU_REGISTRA: { tipo: TipoModulo; titolo: string; icona: string }[] = [
  { tipo: 'pagamento', titolo: 'Pagamento ricevuto', icona: 'pagamenti' },
  { tipo: 'spesa', titolo: 'Spesa', icona: 'bilancio' },
  { tipo: 'richiesta', titolo: 'Richiesta inviata a un inquilino', icona: 'invia' },
  { tipo: 'pannelli', titolo: 'Dati pannelli / bonifico GSE', icona: 'solare' },
];

const CATEGORIE = ['Condominio / spese comuni', 'Autoclave', 'Acqua', 'TARI', 'IMU', 'Imposta di registro', 'Assicurazione', 'Manutenzione', 'Fotovoltaico', 'Tecnico / professionista', 'Altro'];

/** Primo mese da pagare per un contratto (dal mese di inizio monitoraggio). */
function primoMeseDaPagare(d: Dati, contrattoId: string): string {
  const c = d.contratti.find((x) => x.id === contrattoId);
  const oggiMese = meseDi(oggi());
  if (!c) return oggiMese;
  let m = d.impostazioni.inizioMonitoraggio;
  if (c.inizio && meseDi(c.inizio) > m) m = meseDi(c.inizio);
  for (let i = 0; m <= oggiMese && i < 600; i++, m = aggiungiMesi(m, 1)) {
    if (pagatoNelMese(d, c, m).totale < attesoMensile(c)) return m;
  }
  return oggiMese;
}

/** Importo che manca per quel mese. */
function mancante(d: Dati, contrattoId: string, mese: string): number {
  const c = d.contratti.find((x) => x.id === contrattoId);
  if (!c) return 0;
  return Math.max(0, attesoMensile(c) - pagatoNelMese(d, c, mese).totale);
}

const opzioniRiferimento = (d: Dati, scelto?: string) => {
  const immobili = [...new Set(d.unita.map((u) => u.immobile))];
  const voci = ['Tutti gli immobili', ...immobili.map((i) => `${i} (intero immobile)`), ...d.unita.map((u) => u.id)];
  return voci.map((v) => `<option ${v === scelto ? 'selected' : ''}>${esc(v)}</option>`).join('');
};

const opzioniContratti = (d: Dati, scelto?: string) =>
  contrattiAttivi(d)
    .map((c) => `<option value="${esc(c.id)}" ${c.id === scelto ? 'selected' : ''}>${esc(nomeContratto(d, c))} · ${esc(inquilinoDi(d, c)?.cognome ?? c.inquilino ?? '')}</option>`)
    .join('');

const segmenti = (nome: string, valori: string[], scelto: string) =>
  `<div class="seg">${valori
    .map((v) => `<label><input type="radio" name="${nome}" value="${esc(v)}" ${v === scelto ? 'checked' : ''}><span>${esc(v)}</span></label>`)
    .join('')}</div>`;

export type ListaMovimenti = 'pagamenti' | 'spese' | 'richieste' | 'fotovoltaico';
export const TIPO_DI_LISTA: Record<ListaMovimenti, TipoModulo> = { pagamenti: 'pagamento', spese: 'spesa', richieste: 'richiesta', fotovoltaico: 'pannelli' };

/** Contratto che corrisponde a un movimento (stessa unità, preferibilmente stesso inquilino). */
function contrattoDi(d: Dati, unita?: string, inquilino?: string): string {
  const c = d.contratti.filter((x) => x.unita === unita || x.pertinenza === unita);
  return (c.find((x) => x.inquilino === inquilino) ?? c[0])?.id ?? '';
}

/** Valori con cui compilare il modulo per modificare un movimento già registrato. */
export function valoriPerModifica(d: Dati, lista: ListaMovimenti, indice: number): Record<string, string> {
  const s = (x: unknown) => (x === undefined || x === null ? '' : String(x));
  if (lista === 'pagamenti') {
    const p = d.pagamenti[indice];
    return { contratto: contrattoDi(d, p.unita, p.inquilino), mese: p.mese, importo: s(p.importo), modalita: s(p.modalita), data: s(p.data), voce: s(p.voce), note: s(p.note) };
  }
  if (lista === 'spese') {
    const x = d.spese[indice];
    return { data: s(x.data), riferimento: s(x.riferimento), categoria: s(x.categoria), descrizione: s(x.descrizione), importo: s(x.importo), note: s(x.note) };
  }
  if (lista === 'richieste') {
    const r = d.richieste[indice];
    return { contratto: contrattoDi(d, r.unita, r.inquilino), descrizione: s(r.descrizione), importo: s(r.importo), data: r.dataInvio, giorni: s(r.giorni) };
  }
  const v = d.fotovoltaico[indice];
  return { mese: v.mese, riferimento: s(v.riferimento), prodotta: s(v.prodottaKwh), ceduta: s(v.cedutaKwh), prezzo: s(v.prezzoMedio), gse: s(v.bonificoGse), accredito: s(v.dataAccredito), bilancio: s(v.dataBilancio) };
}

/** Compila i campi del modulo con dei valori (usato per "Modifica"). */
export function compilaModulo(form: HTMLFormElement, valori: Record<string, string>) {
  for (const [nome, valore] of Object.entries(valori)) {
    const radio = form.querySelector<HTMLInputElement>(`input[type=radio][name="${nome}"][value="${CSS.escape(valore)}"]`);
    if (radio) {
      radio.checked = true;
      continue;
    }
    const el = form.elements.namedItem(nome) as HTMLInputElement | HTMLSelectElement | null;
    if (!el || !('value' in el)) continue;
    if (el instanceof HTMLSelectElement && valore && ![...el.options].some((o) => o.value === valore)) {
      el.add(new Option(valore, valore)); // es. un valore dell'Excel non presente nell'elenco
    }
    el.value = valore;
  }
}

/** Elimina un movimento (copia dei dati). */
export function eliminaMovimento(d: Dati, lista: ListaMovimenti, indice: number): Dati {
  const nuovo: Dati = structuredClone(d);
  (nuovo[lista] as unknown[]).splice(indice, 1);
  return nuovo;
}

/** HTML del modulo (dentro un pannello a comparsa). `pre` = valori già compilati; `modifica` = movimento da correggere. */
export function modulo(d: Dati, tipo: TipoModulo, pre: { contratto?: string; mese?: string } = {}, modifica?: { indice: number }): string {
  const MODIFICA: Record<TipoModulo, string> = { pagamento: 'Modifica pagamento', spesa: 'Modifica spesa', richiesta: 'Modifica richiesta', pannelli: 'Modifica dati pannelli' };
  const titolo = modifica ? MODIFICA[tipo] : MENU_REGISTRA.find((m) => m.tipo === tipo)!.titolo;
  let campi = '';
  if (tipo === 'pagamento') {
    const contratto = pre.contratto ?? contrattiAttivi(d).find((c) => attesoMensile(c) > 0)?.id ?? '';
    const mese = pre.mese ?? primoMeseDaPagare(d, contratto);
    const c = d.contratti.find((x) => x.id === contratto);
    campi = `
      <label class="f">Contratto<select name="contratto" data-aggiorna-pagamento required>${opzioniContratti(d, contratto)}</select></label>
      <label class="f">Mese di riferimento<input type="month" name="mese" value="${esc(mese)}" placeholder="aaaa-mm" data-aggiorna-pagamento required></label>
      <p class="hint">Proposto: il primo mese non ancora pagato</p>
      <label class="f">Importo (€)<input type="text" name="importo" inputmode="decimal" autocomplete="off" placeholder="Es. 350.00" value="${mancante(d, contratto, mese) || ''}" required></label>
      <p class="hint" id="hint-importo">${c ? 'Canone: ' + euro(attesoMensile(c)) : ''}</p>
      <div class="f">Modalità${segmenti('modalita', ['Bonifico', 'Contanti', 'Altro'], c?.modalita ?? 'Bonifico')}</div>
      <label class="f">Data incasso<input type="date" name="data" value="${oggi()}" required></label>
      <label class="f">Voce<select name="voce">${['Canone', 'Spese condominiali', 'Quota autoclave', 'Rimborso utenze', 'Deposito cauzionale', 'Altro'].map((v) => `<option>${v}</option>`).join('')}</select></label>
      <label class="f">Note<input type="text" name="note" placeholder="Facoltative"></label>`;
  } else if (tipo === 'spesa') {
    campi = `
      <label class="f">Data<input type="date" name="data" value="${oggi()}" required></label>
      <label class="f">Riferita a<select name="riferimento">${opzioniRiferimento(d)}</select></label>
      <label class="f">Categoria<select name="categoria">${CATEGORIE.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label class="f">Descrizione<input type="text" name="descrizione" placeholder="Es. bolletta autoclave lug–set" required></label>
      <label class="f">Importo (€)<input type="text" name="importo" inputmode="decimal" autocomplete="off" placeholder="Es. 350.00" required></label>
      <label class="f">Note<input type="text" name="note" placeholder="Facoltative"></label>`;
  } else if (tipo === 'richiesta') {
    campi = `
      <label class="f">A chi<select name="contratto" required>${opzioniContratti(d, pre.contratto)}</select></label>
      <label class="f">Cosa hai chiesto<input type="text" name="descrizione" placeholder="Es. quota autoclave lug–set" required></label>
      <label class="f">Importo (€)<input type="text" name="importo" inputmode="decimal" autocomplete="off" placeholder="Es. 350.00"></label>
      <label class="f">Data invio<input type="date" name="data" value="${oggi()}" required></label>
      <label class="f">Avvisami se non pagata entro (giorni)<input type="number" name="giorni" min="1" value="${esc(d.impostazioni.giorniRitardoRichiesta)}" required></label>`;
  } else {
    campi = `
      <label class="f">Mese<input type="month" name="mese" value="${meseDi(oggi())}" required></label>
      <label class="f">Appartamento<select name="riferimento">${opzioniRiferimento(d)}</select></label>
      <div class="f2">
        <label class="f">Energia prodotta (kWh)<input type="number" name="prodotta" min="0" inputmode="numeric"></label>
        <label class="f">Energia ceduta (kWh)<input type="number" name="ceduta" min="0" inputmode="numeric"></label>
      </div>
      <label class="f">Prezzo medio energia (€/kWh)<input type="text" name="prezzo" inputmode="decimal" autocomplete="off" placeholder="Es. 0.28"></label>
      <div class="f2">
        <label class="f">Bonifico GSE (€)<input type="text" name="gse" inputmode="decimal" autocomplete="off"></label>
        <label class="f">Data accredito<input type="date" name="accredito"></label>
      </div>
      <label class="f">Bilancio GSE fatto il<input type="date" name="bilancio"></label>`;
  }
  return `
    <div class="velo" data-chiudi-modulo></div>
    <form class="foglio" data-tipo="${tipo}" ${modifica ? `data-indice="${modifica.indice}"` : ''} novalidate>
      <div class="foglio-hd"><h2>${esc(titolo)}</h2><button type="button" class="icona-btn" data-chiudi-modulo aria-label="Chiudi">${icona('chiudi')}</button></div>
      ${campi}
      <p class="errore-form" role="alert"></p>
      <button type="submit" class="primario largo">${icona('spunta')} ${modifica ? 'Salva le modifiche' : 'Salva'}</button>
    </form>`;
}

/** Quando nel modulo pagamento cambiano contratto o mese, aggiorna importo suggerito. */
export function aggiornaSuggerimentoPagamento(d: Dati, form: HTMLFormElement) {
  const contratto = (form.elements.namedItem('contratto') as HTMLSelectElement).value;
  const mese = normalizzaMese((form.elements.namedItem('mese') as HTMLInputElement).value) ?? '';
  const c = d.contratti.find((x) => x.id === contratto);
  (form.elements.namedItem('importo') as HTMLInputElement).value = String(mancante(d, contratto, mese) || '');
  const hint = form.querySelector('#hint-importo');
  if (hint) hint.textContent = c ? 'Canone: ' + euro(attesoMensile(c)) : '';
  if (c?.modalita) {
    const r = form.querySelector<HTMLInputElement>(`input[name="modalita"][value="${CSS.escape(c.modalita)}"]`);
    if (r) r.checked = true;
  }
}

/** Legge il modulo e restituisce i dati aggiornati (copia), oppure un messaggio d'errore. */
export function applicaModulo(d: Dati, form: HTMLFormElement): { dati: Dati; messaggio: string } | { errore: string } {
  const v = (n: string) => ((form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '').trim();
  // Numeri col PUNTO per i decimali: "350.50", "1'234.50". NaN = scritto male.
  const num = (n: string) => leggiImporto(v(n));
  const nonValido = (x: number | undefined) => x !== undefined && !Number.isFinite(x);
  for (const campo of ['importo', 'prodotta', 'ceduta', 'prezzo', 'gse', 'giorni']) {
    if (form.elements.namedItem(campo) && nonValido(num(campo))) return { errore: 'Controlla i numeri: usa solo cifre e il punto per i decimali (es. 350.50).' };
  }
  const mese = normalizzaMese(v('mese'));
  const nuovo: Dati = structuredClone(d);
  const tipo = form.dataset.tipo as TipoModulo;
  const indice = form.dataset.indice === undefined ? undefined : Number(form.dataset.indice);
  /** Aggiunge il movimento, oppure sostituisce quello che si sta modificando. */
  const metti = <T>(lista: T[], rec: T) => (indice === undefined ? lista.push(rec) : lista.splice(indice, 1, rec));
  const fatto = (t: string) => (indice === undefined ? t : 'Modifica salvata');

  if (tipo === 'pagamento') {
    const c = d.contratti.find((x) => x.id === v('contratto'));
    const importo = num('importo');
    if (!c) return { errore: 'Scegli il contratto.' };
    if (!mese) return { errore: 'Indica il mese di riferimento (es. 2026-11 oppure 11/2026).' };
    if (!importo || importo <= 0) return { errore: "Scrivi l'importo ricevuto." };
    const modalita = (form.querySelector<HTMLInputElement>('input[name="modalita"]:checked')?.value ?? 'Bonifico');
    const p: Pagamento = { origine: 'app', data: v('data') || oggi(), unita: c.unita, inquilino: c.inquilino, mese, voce: v('voce') || 'Canone', importo, modalita, note: v('note') || undefined };
    metti(nuovo.pagamenti, p);
    return { dati: nuovo, messaggio: fatto(`Pagamento di ${euro(importo)} registrato (${c.inquilino ?? nomeContratto(d, c)})`) };
  }
  if (tipo === 'spesa') {
    const importo = num('importo');
    if (!v('descrizione')) return { errore: 'Scrivi una breve descrizione.' };
    if (!importo || importo <= 0) return { errore: "Scrivi l'importo della spesa." };
    const s: Spesa = { origine: 'app', data: v('data') || oggi(), riferimento: v('riferimento'), categoria: v('categoria'), descrizione: v('descrizione'), importo, note: v('note') || undefined };
    metti(nuovo.spese, s);
    return { dati: nuovo, messaggio: fatto(`Spesa di ${euro(importo)} registrata`) };
  }
  if (tipo === 'richiesta') {
    const c = d.contratti.find((x) => x.id === v('contratto'));
    if (!c) return { errore: 'Scegli a chi hai mandato la richiesta.' };
    if (!v('descrizione')) return { errore: 'Scrivi cosa hai chiesto.' };
    const r: Richiesta = {
      origine: 'app',
      dataInvio: v('data') || oggi(),
      unita: c.unita,
      inquilino: c.inquilino,
      descrizione: v('descrizione'),
      importo: num('importo'),
      giorni: num('giorni'),
      // Correggendo una richiesta già pagata, resta pagata.
      pagataIl: indice === undefined ? undefined : d.richieste[indice]?.pagataIl,
    };
    metti(nuovo.richieste, r);
    return { dati: nuovo, messaggio: fatto(`Richiesta a ${c.inquilino ?? nomeContratto(d, c)} registrata: ti avviso se non arriva il pagamento`) };
  }
  // pannelli
  if (!mese) return { errore: 'Indica il mese (es. 2026-11 oppure 11/2026).' };
  const f: VoceFotovoltaico = {
    origine: 'app',
    mese,
    riferimento: v('riferimento'),
    prodottaKwh: num('prodotta'),
    cedutaKwh: num('ceduta'),
    prezzoMedio: num('prezzo'),
    bonificoGse: num('gse'),
    dataAccredito: v('accredito') || undefined,
    dataBilancio: v('bilancio') || undefined,
  };
  if ([f.prodottaKwh, f.cedutaKwh, f.bonificoGse, f.dataBilancio].every((x) => x === undefined)) return { errore: 'Compila almeno un dato.' };
  metti(nuovo.fotovoltaico, f);
  return { dati: nuovo, messaggio: fatto('Dati dei pannelli registrati') };
}

/** Segna una richiesta come pagata oggi. */
export function richiestaPagata(d: Dati, indice: number): Dati {
  const nuovo: Dati = structuredClone(d);
  if (nuovo.richieste[indice]) nuovo.richieste[indice].pagataIl = oggi();
  return nuovo;
}

/** Pulsante "Registra" con il menu (solo app del gestore). */
export function pulsanteRegistra(aperto: boolean): string {
  return `
    <div class="registra ${aperto ? 'aperto' : ''}">
      ${
        aperto
          ? `<div class="menu-registra">
              ${MENU_REGISTRA.map((m) => `<button data-apri-modulo="${m.tipo}">${icona(m.icona)}${esc(m.titolo)}</button>`).join('')}
              <label class="import-excel">${icona('excel')}Aggiorna i dati dall'Excel<input type="file" accept=".xlsx" data-import-excel hidden></label>
            </div>`
          : ''
      }
      <button class="fab" data-registra aria-expanded="${aperto}">${icona(aperto ? 'chiudi' : 'piu')}<span>${aperto ? 'Chiudi' : 'Registra'}</span></button>
    </div>`;
}

// ---------- impostazioni (soglie degli avvisi) ----------

/** Schermata Impostazioni: le soglie si cambiano qui, nessun valore è scritto nel codice. */
export function impostazioni(d: Dati, notifiche: 'attive' | 'spente' | 'bloccate' | 'non_disponibili'): string {
  const i = d.impostazioni;
  const riga = (nome: string, etichetta: string, valore: string | number, aiuto: string, tipo = 'number', extra = '') =>
    `<label class="f">${esc(etichetta)}<input type="${tipo}" name="${nome}" value="${esc(valore)}" ${extra} required><span class="aiuto">${esc(aiuto)}</span></label>`;
  const statoNotifiche = {
    attive: `<p class="hint">Attive: all'apertura dell'app ricevi una notifica di Windows se ci sono avvisi urgenti.</p>`,
    spente: `<button type="button" class="secondario largo" data-attiva-notifiche>Attiva le notifiche di Windows</button>`,
    bloccate: `<p class="aiuto">Bloccate dal browser: si riattivano dalle impostazioni del sito (lucchetto accanto all'indirizzo).</p>`,
    non_disponibili: `<p class="aiuto">Questo browser non supporta le notifiche.</p>`,
  }[notifiche];
  return `
    <form class="scheda impostazioni" novalidate>
      <h3>Avvisi sui pagamenti</h3>
      ${riga('soglia', 'Avvisa quando l’arretrato raggiunge (% del canone mensile)', i.sogliaArretratoPercentuale, 'Es. 50 = metà di un mese di canone.', 'number', 'min="1" max="1000"')}
      ${riga('giornoScadenza', 'Giorno del mese entro cui va pagato l’affitto', i.giornoScadenzaAffitto, 'Prima di questo giorno l’affitto del mese è grigio, dopo diventa rosso.', 'number', 'min="1" max="28"')}
      ${riga('giorniRichiesta', 'Avvisa se una richiesta non è pagata entro (giorni)', i.giorniRitardoRichiesta, 'Valore proposto quando registri una richiesta.', 'number', 'min="1" max="365"')}
      ${riga('inizio', 'Controlla i pagamenti a partire dal mese', i.inizioMonitoraggio, 'I mesi precedenti non generano arretrati (formato aaaa-mm).', 'text', 'pattern="\d{4}-\d{2}" placeholder="aaaa-mm"')}
      <h3>Scadenze</h3>
      ${riga('anticipo', 'Avvisa delle scadenze con (giorni di anticipo)', i.avvisoScadenzeGiorni, 'Vale per le scadenze che non hanno un anticipo proprio.', 'number', 'min="1" max="365"')}
      <p class="errore-form" role="alert"></p>
      <button type="submit" class="primario largo">${icona('spunta')} Salva le impostazioni</button>
      <h3>Notifiche</h3>
      ${statoNotifiche}
      <p class="aiuto">Le regole fiscali (cedolare, ISTAT, imposta di registro, date IMU) possono cambiare: le date si correggono nel foglio Scadenze dell’Excel.</p>
    </form>`;
}

export function applicaImpostazioni(d: Dati, form: HTMLFormElement): { dati: Dati } | { errore: string } {
  const v = (n: string) => ((form.elements.namedItem(n) as HTMLInputElement).value ?? '').trim();
  const intero = (n: string, min: number, max: number) => {
    const x = Number(v(n));
    return Number.isInteger(x) && x >= min && x <= max ? x : undefined;
  };
  const soglia = intero('soglia', 1, 1000);
  const giorno = intero('giornoScadenza', 1, 28);
  const giorniRichiesta = intero('giorniRichiesta', 1, 365);
  const anticipo = intero('anticipo', 1, 365);
  const inizio = normalizzaMese(v('inizio'));
  if (soglia === undefined) return { errore: 'La soglia deve essere un numero intero tra 1 e 1000.' };
  if (giorno === undefined) return { errore: 'Il giorno di scadenza deve essere tra 1 e 28.' };
  if (giorniRichiesta === undefined || anticipo === undefined) return { errore: 'I giorni devono essere numeri interi tra 1 e 365.' };
  if (!inizio) return { errore: 'Il mese di inizio controllo va scritto come aaaa-mm (es. 2026-11).' };
  const nuovo: Dati = structuredClone(d);
  Object.assign(nuovo.impostazioni, {
    sogliaArretratoPercentuale: soglia,
    giornoScadenzaAffitto: giorno,
    giorniRitardoRichiesta: giorniRichiesta,
    avvisoScadenzeGiorni: anticipo,
    inizioMonitoraggio: inizio,
  });
  return { dati: nuovo };
}

// ---------- bozza di sollecito ----------

/** Testo di sollecito pronto da copiare (da controllare e firmare prima dell'invio). */
export function testoSollecito(d: Dati, contrattoId: string): string {
  const c = d.contratti.find((x) => x.id === contrattoId);
  if (!c) return '';
  const inq = inquilinoDi(d, c);
  const nome = inq ? `${inq.nome ?? ''} ${inq.cognome}`.trim() : c.inquilino ?? '';
  const mesi = mesiArretrati(d, c);
  const totale = mesi.reduce((s, m) => s + m.mancante, 0);
  const elenco = mesi.map((m) => `- ${meseEsteso(m.mese).toLowerCase()}: ${euro(m.mancante)}`).join('\n');
  const entro = aggiungiAData(oggi(), 0, 0);
  const tra7 = new Date(Date.UTC(+entro.slice(0, 4), +entro.slice(5, 7) - 1, +entro.slice(8) + 7)).toISOString().slice(0, 10);
  return [
    `Gentile ${nome},`,
    '',
    `le scriviamo in merito al contratto per «${nomeContratto(d, c)}» (${c.unita.split(' - ')[0]}).`,
    `Dai nostri conti risulta ancora da versare un importo di ${euro(totale)}, relativo a:`,
    elenco,
    '',
    `La preghiamo di provvedere al pagamento entro il ${data(tra7)} oppure di contattarci per qualsiasi chiarimento.`,
    'Se ha già provveduto, la preghiamo di non considerare questo messaggio.',
    '',
    'Cordiali saluti',
  ].join('\n');
}
