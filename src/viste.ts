// Le schermate dell'app. Ogni funzione restituisce l'HTML di una schermata;
// i clic sono gestiti in main.ts tramite gli attributi data-*.

import type { Dati } from './modello';
import {
  affittiDelMese,
  anniConPagamenti,
  riepilogoAnnuale,
  arretrato,
  attesoMensile,
  avvisi,
  bilancioAnno,
  contrattiAttivi,
  cessato,
  fineInCorso,
  inquilinoDi,
  nomeContratto,
  pagatoNelMese,
  pannelliAnno,
  scadenze,
  unitaDi,
  type Livello,
} from './calcoli';
import { aggiungiMesi, data, esc, euro, meseDi, meseEsteso, numero, oggi } from './formato';
import { icona } from './icone';

const classe = (l: Livello) => ({ ok: 'v', attenzione: 'g', urgente: 'r' })[l];

export function intestazione(titolo: string, indietro: boolean, badge = 'Sola lettura'): string {
  return `
    <header>
      ${indietro ? `<a class="indietro" href="#/" aria-label="Indietro">${icona('indietro')}</a>` : `<span class="logo-s">${icona('edificio')}</span>`}
      <h1>${esc(titolo)}</h1>
      <span class="badge">${esc(badge)}</span>
    </header>`;
}

// ---------- home ----------

/** `gestore` = app di chi scrive: compaiono i pulsanti per registrare. */
export function home(d: Dati, mese: string, gestore = false): string {
  const lista = avvisi(d);
  const urgenti = lista.filter((a) => a.livello === 'urgente').length;
  const anno = oggi().slice(0, 4);
  const bil = bilancioAnno(d, anno);
  const sc = scadenze(d).elenco.filter((s) => s.giorni <= 60);
  const pan = pannelliAnno(d, anno);
  const attivi = contrattiAttivi(d);

  return `
    ${affitti(d, mese, gestore)}
    ${
      lista.length
        ? `<section class="avvisi">
            <h2>${icona('campanella')} Da tenere d'occhio ${urgenti ? `<span class="pill r">${urgenti} ${urgenti === 1 ? 'urgente' : 'urgenti'}</span>` : ''}</h2>
            ${lista
              .slice(0, 6)
              .map(
                (a) => `<div class="avviso-riga"><a class="avviso" ${a.link ? `href="${a.link}"` : ''}><span class="punto ${classe(a.livello)}"></span><span>${esc(a.testo)}</span>${
                  a.data ? `<time>${data(a.data)}</time>` : ''
                }</a>${
                  gestore && a.richiesta !== undefined
                    ? `<button class="mini-btn" data-richiesta-pagata="${a.richiesta}">${icona('spunta')} Pagata</button>`
                    : ''
                }</div>`,
              )
              .join('')}
            ${lista.length > 6 ? `<a class="altri" href="#/scadenze">e altri ${lista.length - 6}…</a>` : ''}
          </section>`
        : `<section class="avvisi vuoto-ok">${icona('nuvolaOk')} Nessun avviso: è tutto in ordine.</section>`
    }
    <section class="griglia">
      <a class="card" href="#/contratti">
        <div class="hd">${icona('contratti')}<span>Contratti</span></div>
        <div class="big">${attivi.length}</div>
        <div class="sm">attivi su ${d.unita.length} unità</div>
      </a>
      <a class="card" href="#/scadenze">
        <div class="hd">${icona('scadenze')}<span>Scadenze</span>${
          sc.some((s) => s.livello !== 'ok') ? `<span class="pill g">${sc.filter((s) => s.livello !== 'ok').length}</span>` : ''
        }</div>
        <div class="big">${sc.length}</div>
        <div class="sm">${sc[0] ? `prossima: ${esc(sc[0].titolo)} ${data(sc[0].data)}` : 'nei prossimi 60 giorni'}</div>
      </a>
      <a class="card" href="#/movimenti">
        <div class="hd">${icona('bilancio')}<span>Bilancio ${anno}</span></div>
        <div class="big">${bil.netto >= 0 ? '+' : ''}${euro(bil.netto)}</div>
        <div class="sm">incassi ${euro(bil.incassi)} · spese ${euro(bil.spese)}</div>
      </a>
      <button class="card link" data-cartella="">
        <div class="hd">${icona('documenti')}<span>Documenti</span><span class="freccia">${icona('esterno')}</span></div>
        <div class="big sm-big">Dropbox</div>
        <div class="sm">tutte le cartelle e i file</div>
      </button>
    </section>
    <a class="riga-pannelli" href="#/pannelli">${icona('solare')}<span>Pannelli solari</span><small>${
      pan.ultimoAggiornamento ? 'ultimo aggiornamento ' + data(pan.ultimoAggiornamento) : 'nessun dato ancora'
    }</small>${icona('avanti')}</a>${
      gestore ? `<a class="riga-pannelli" href="#/impostazioni">${icona('impostazioni')}<span>Impostazioni</span><small>soglie degli avvisi e notifiche</small>${icona('avanti')}</a>` : ''
    }`;
}

/** Riquadro "Affitti del mese": un cognome per contratto, quadratino verde/rosso. */
function affitti(d: Dati, mese: string, gestore: boolean): string {
  const righe = affittiDelMese(d, mese);
  const pagati = righe.filter((r) => r.stato === 'pagato').length;
  const atteso = righe.reduce((s, r) => s + r.atteso, 0);
  const incassato = righe.reduce((s, r) => s + Math.min(r.pagato, r.atteso), 0);
  const perc = atteso ? Math.round((incassato / atteso) * 100) : 0;
  const testoStato = (r: (typeof righe)[number]) =>
    r.stato === 'pagato'
      ? `pagato${r.dataPagamento ? ' il ' + data(r.dataPagamento).slice(0, 5) : ''}`
      : r.stato === 'parziale'
        ? `mancano ${euro(r.atteso - r.pagato)}`
        : r.stato === 'non_ancora_dovuto'
          ? `${euro(r.atteso)} · entro il ${esc(d.impostazioni.giornoScadenzaAffitto)}`
          : r.stato === 'non_controllato'
            ? 'non registrato'
            : `${euro(r.atteso)} da pagare`;
  const colore = (r: (typeof righe)[number]) =>
    r.stato === 'pagato' ? 'v' : r.stato === 'non_ancora_dovuto' || r.stato === 'non_controllato' ? 'n' : 'r';

  return `
    <section class="affitti">
      <div class="hd">${icona('pagamenti')}<span>Affitti del mese</span>
        <span class="mese">
          <button class="icona-btn" data-mese="${aggiungiMesi(mese, -1)}" aria-label="Mese precedente">${icona('indietro')}</button>
          <span>${meseEsteso(mese)}</span>
          <button class="icona-btn" data-mese="${aggiungiMesi(mese, 1)}" aria-label="Mese successivo">${icona('avanti')}</button>
        </span>
      </div>
      ${
        righe.length
          ? `<div class="totale"><span class="big">${pagati} su ${righe.length}</span><span class="sm">pagati · incassati ${euro(incassato)} su ${euro(atteso)}</span></div>
             <div class="barra"><div style="width:${perc}%"></div></div>
             <div class="inquilini">
               ${righe
                 .map(
                   (r) =>
                     // Nell'app del gestore, clic su chi non ha pagato = registra il pagamento già compilato.
                     gestore && r.stato !== 'pagato'
                       ? `<button class="inq ${colore(r)}" data-registra-pagamento="${esc(r.contratto.id)}" data-mese-pagamento="${mese}" title="Registra il pagamento">
                     <span class="q"></span><span class="tx"><span class="n">${esc(r.cognome)}</span><span class="d">${testoStato(r)}</span></span>${icona('piu')}</button>`
                       : `<a class="inq ${colore(r)}" href="#/contratto/${encodeURIComponent(r.contratto.id)}">
                     <span class="q"></span><span class="tx"><span class="n">${esc(r.cognome)}</span><span class="d">${testoStato(r)}</span></span></a>`,
                 )
                 .join('')}
             </div>
             <p class="legenda"><span class="q v"></span>pagato <span class="q r"></span>da pagare <span class="q n"></span>non ancora dovuto</p>`
          : `<p class="sm">Nessun affitto previsto in questo mese.</p>`
      }
    </section>`;
}

// ---------- contratti ----------

export function elencoContratti(d: Dati): string {
  const mese = meseDi(oggi());
  const ordinati = [...d.contratti].sort((a, b) => nomeContratto(d, a).localeCompare(nomeContratto(d, b), 'it'));
  const chiusi = ordinati.filter((c) => cessato(c));
  const riga = (c: (typeof ordinati)[number]) => {
          const u = unitaDi(d, c.unita);
          const cognome = inquilinoDi(d, c)?.cognome ?? c.inquilino ?? '';
          const arr = arretrato(d, c);
          const att = attesoMensile(c);
          const pagatoMese = att > 0 && pagatoNelMese(d, c, mese).totale >= att;
          const pill = cessato(c) && arr <= 0
            ? '<span class="pill n">Cessato</span>'
            : arr > 0
              ? `<span class="pill r">Arretrato ${euro(arr)}</span>`
              : att > 0
                ? `<span class="pill ${pagatoMese ? 'v' : 'n'}">${pagatoMese ? 'Pagato' : 'In attesa'}</span>`
                : '';
          return `<a class="riga${cessato(c) ? ' chiuso' : ''}" href="#/contratto/${encodeURIComponent(c.id)}">
            <div><div class="t">${esc(nomeContratto(d, c))}</div>
            <div class="s">${esc(u?.immobile ?? '')} · ${esc(cognome)} · ${esc(c.tipo ?? '')}${cessato(c) ? ' · cessato il ' + data(c.fine) : ''}</div></div>
            <div class="r">${att > 0 ? euro(att) : '—'}<br>${pill}</div></a>`;
  };
  return `
    <section class="lista">${ordinati.filter((c) => !cessato(c)).map(riga).join('')}</section>
    ${chiusi.length ? `<h3 class="fuori">Contratti cessati</h3><section class="lista">${chiusi.map(riga).join('')}</section>` : ''}
    <button class="secondario largo" data-cartella="${esc(d.impostazioni.cartellaContratti)}">${icona('documenti')} Tutti i contratti su Dropbox ${icona('esterno')}</button>`;
}

export function schedaContratto(d: Dati, id: string, gestore = false): string {
  const c = d.contratti.find((x) => x.id === id);
  if (!c) return `<p class="vuoto">Contratto non trovato.</p>`;
  const inq = inquilinoDi(d, c);
  const u = unitaDi(d, c.unita);
  const p = unitaDi(d, c.pertinenza);
  const arr = arretrato(d, c);
  const fine = fineInCorso(c);
  const kv = (k: string, v: string | undefined) => (v ? `<div class="kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>` : '');
  const catasto = (x: typeof u) => (x && (x.foglio || x.particella || x.subalterno) ? `Fg ${x.foglio ?? '—'} · Part ${x.particella ?? '—'} · Sub ${x.subalterno ?? '—'}` : undefined);
  const copiabile = (etichetta: string, valore: string) =>
    `<div class="ct"><span class="et">${esc(etichetta)}</span><span class="val">${esc(valore)}</span><button class="copia" data-copia="${esc(valore)}" aria-label="Copia ${esc(etichetta)}">${icona('copia')} Copia</button></div>`;

  // Ultimi 6 mesi di pagamenti
  const att = attesoMensile(c);
  const meseOggi = meseDi(oggi());
  const storico =
    att > 0
      ? Array.from({ length: 6 }, (_, i) => aggiungiMesi(meseOggi, i - 5))
          .filter((m) => !c.inizio || m >= meseDi(c.inizio))
          .map((m) => {
            const pag = pagatoNelMese(d, c, m).totale;
            const col = pag >= att ? 'v' : m >= d.impostazioni.inizioMonitoraggio ? 'r' : 'n';
            return `<div class="mese-pag"><span class="q ${col}"></span><span>${meseEsteso(m).replace(/ \d+$/, '').slice(0, 3)}</span><small>${pag ? euro(pag) : '—'}</small></div>`;
          })
          .join('')
      : '';

  return `
    <section class="scheda">
      <div class="sottotitolo">${esc(u?.immobile ?? '')}${cessato(c) ? `<span class="pill n">Cessato il ${data(c.fine)}</span>` : ''}${arr > 0 ? `<span class="pill r">Arretrato ${euro(arr)}</span>` : ''}</div>
      ${
        gestore && arr > 0
          ? `<button class="secondario largo sollecito" data-sollecito="${esc(c.id)}">${icona('copia')} Copia una bozza di sollecito</button>
             <p class="aiuto">Testo pronto da incollare in un messaggio o in un'email: controllalo e firmalo prima di inviarlo.</p>`
          : ''
      }

      <h3>Inquilino</h3>
      ${
        inq
          ? `<div class="nome-inq">${esc(inq.cognome)} ${esc(inq.nome ?? '')}</div>
             ${copiabile('Nome e cognome', `${inq.nome ?? ''} ${inq.cognome}`.trim())}
             ${inq.campi.map((f) => copiabile(f.etichetta, f.valore)).join('')}`
          : `<p class="sm">${esc(c.inquilino ?? 'Nessun inquilino indicato')}</p>`
      }

      <h3>Contratto</h3>
      ${kv('Tipo', [c.tipo, c.regime].filter(Boolean).join(' · '))}
      ${kv('Canone', c.canone ? euro(c.canone) + '/mese' + (c.speseMensili ? ` + ${euro(c.speseMensili)} spese` : '') : undefined)}
      ${kv('Modalità di pagamento', c.modalita)}
      ${kv('Deposito cauzionale', c.deposito !== undefined ? euro(c.deposito) : undefined)}
      ${kv('Dal', c.inizio ? data(c.inizio) : undefined)}
      ${kv('Durata', c.durataAnni ? `${c.durataAnni}${c.rinnovoAnni ? '+' + c.rinnovoAnni : ''} anni` : undefined)}
      ${cessato(c) ? kv('Cessato il', data(c.fine)) : kv('Fine periodo in corso', fine ? data(fine) : undefined)}
      ${kv('Preavviso disdetta', c.preavvisoMesi ? c.preavvisoMesi + ' mesi' : undefined)}
      ${kv('Aggiornamento ISTAT', c.istat ? 'Sì' + (c.percentualeIstat ? ` (${c.percentualeIstat}%)` : '') : c.istat === false ? 'No' : undefined)}
      ${kv('Registrazione', [c.dataRegistrazione ? data(c.dataRegistrazione) : '', c.estremiRegistrazione ?? ''].filter(Boolean).join(' · ') || undefined)}
      ${kv('Note', c.note)}

      <h3>Unità</h3>
      ${kv(u?.nome ?? c.unita, catasto(u))}
      ${p ? kv(p.nome + ' (pertinenza)', catasto(p) ?? 'inclusa nel contratto') : ''}

      ${storico ? `<h3>Pagamenti degli ultimi mesi</h3><div class="storico">${storico}</div>` : ''}

      <h3>Documenti</h3>
      <button class="secondario largo" data-cartella="${esc(d.impostazioni.cartellaContratti + '/' + (c.cartella ?? c.unita))}" data-riserva="${esc(d.impostazioni.cartellaContratti)}">
        ${icona('documenti')} Apri la cartella su Dropbox ${icona('esterno')}</button>
    </section>`;
}

// ---------- scadenze ----------

export function elencoScadenze(d: Dati): string {
  const { elenco, daCompletare } = scadenze(d);
  const quando = (g: number) => (g === 0 ? 'oggi' : g === 1 ? 'domani' : `tra ${g} giorni`);
  return `
    <section class="lista">
      ${
        elenco.length
          ? elenco
              .map(
                (s) => `<div class="riga statica"><span class="punto ${classe(s.livello)}"></span>
                  <div><div class="t">${esc(s.titolo)}</div><div class="s">${esc(s.riferimento ?? '')}</div></div>
                  <div class="r">${data(s.data)}<br><small>${quando(s.giorni)}</small></div></div>`,
              )
              .join('')
          : '<p class="sm">Nessuna scadenza.</p>'
      }
    </section>
    ${
      daCompletare.length
        ? `<h3 class="fuori">Senza data (da completare nell'Excel)</h3>
           <section class="lista">${daCompletare
             .map((s) => `<div class="riga statica"><span class="punto n"></span><div><div class="t">${esc(s.titolo)}</div><div class="s">${esc(s.riferimento ?? '')}</div></div></div>`)
             .join('')}</section>`
        : ''
    }`;
}

// ---------- pannelli ----------

export function pannelli(d: Dati): string {
  const anni = [...new Set(d.fotovoltaico.map((v) => v.mese.slice(0, 4)))].sort().reverse();
  if (!anni.length) return `<p class="vuoto">Nessun dato sui pannelli ancora. Si inseriscono nel foglio "Fotovoltaico" dell'Excel.</p>`;
  return `<section class="lista">${anni
    .map((a) => {
      const p = pannelliAnno(d, a);
      return `<div class="riga statica"><div><div class="t">${a}</div><div class="s">${numero(p.prodotta)} kWh prodotti · risparmio inquilini ~${euro(Math.round(p.risparmio))}</div></div>
        <div class="r">${euro(p.gse)}<br><small>bonifici GSE</small></div></div>`;
    })
    .join('')}</section>`;
}

// ---------- movimenti (pagamenti, spese, richieste, pannelli) ----------

type Lista = 'pagamenti' | 'spese' | 'richieste' | 'fotovoltaico' | 'riepilogo';

/**
 * Registro di tutti i movimenti, dal più recente. Nell'app del gestore quelli registrati
 * nell'app si possono modificare o eliminare; quelli dell'Excel si correggono nell'Excel.
 */
export function movimenti(d: Dati, gestore: boolean, sezione: Lista = 'pagamenti'): string {
  const schede: [Lista, string, number][] = [
    ['pagamenti', 'Pagamenti', d.pagamenti.length],
    ['spese', 'Spese', d.spese.length],
    ['richieste', 'Richieste', d.richieste.length],
    ['fotovoltaico', 'Pannelli', d.fotovoltaico.length],
    ['riepilogo', 'Riepilogo annuale', anniConPagamenti(d).length],
  ];
  if (sezione === 'riepilogo') return `<nav class="schede">${schede
    .map(([k, t, n]) => `<a href="#/movimenti/${k}" class="${k === sezione ? 'attiva' : ''}">${t} <small>${n}</small></a>`)
    .join('')}</nav>${riepilogo(d)}`;
  type Voce = { indice: number; data: string; titolo: string; dettaglio: string; importo?: number; origine?: string };
  let voci: Voce[] = [];
  if (sezione === 'pagamenti')
    voci = d.pagamenti.map((p, i) => ({ indice: i, data: p.data ?? p.mese + '-01', titolo: `${p.inquilino ?? ''} · ${p.voce ?? 'Canone'} ${meseEsteso(p.mese).toLowerCase()}`, dettaglio: `${p.unita.split(' - ').slice(1).join(' - ') || p.unita}${p.modalita ? ' · ' + p.modalita : ''}${p.note ? ' · ' + p.note : ''}`, importo: p.importo, origine: p.origine }));
  else if (sezione === 'spese')
    voci = d.spese.map((s, i) => ({ indice: i, data: s.data ?? '', titolo: s.descrizione ?? s.categoria ?? 'Spesa', dettaglio: [s.categoria, s.riferimento].filter(Boolean).join(' · '), importo: -s.importo, origine: s.origine }));
  else if (sezione === 'richieste')
    voci = d.richieste.map((r, i) => ({ indice: i, data: r.dataInvio, titolo: `${r.inquilino ?? ''} · ${r.descrizione ?? 'Richiesta'}`, dettaglio: r.pagataIl ? `pagata il ${data(r.pagataIl)}` : 'non ancora pagata', importo: r.importo, origine: r.origine }));
  else
    voci = d.fotovoltaico.map((v, i) => ({ indice: i, data: v.mese + '-01', titolo: `${meseEsteso(v.mese)} · ${v.riferimento ?? ''}`, dettaglio: [v.prodottaKwh !== undefined ? `${numero(v.prodottaKwh)} kWh prodotti` : '', v.dataBilancio ? `bilancio ${data(v.dataBilancio)}` : ''].filter(Boolean).join(' · '), importo: v.bonificoGse, origine: v.origine }));
  voci.sort((a, b) => b.data.localeCompare(a.data));

  return `
    <nav class="schede">${schede
      .map(([k, t, n]) => `<a href="#/movimenti/${k}" class="${k === sezione ? 'attiva' : ''}">${t} <small>${n}</small></a>`)
      .join('')}</nav>
    <section class="lista">
      ${
        voci.length
          ? voci
              .map(
                (v) => `<div class="riga statica mov">
                  <div><div class="t">${esc(v.titolo)}</div><div class="s">${data(v.data)}${v.dettaglio ? ' · ' + esc(v.dettaglio) : ''}</div>
                  ${
                    gestore
                      ? v.origine === 'app'
                        ? `<div class="azioni"><button class="mini-btn neutro" data-modifica="${sezione}:${v.indice}">${icona('modifica')} Modifica</button><button class="mini-btn rosso" data-elimina="${sezione}:${v.indice}">${icona('cestino')} Elimina</button></div>`
                        : `<div class="s nota-excel">Dall'Excel: si corregge nell'Excel</div>`
                      : ''
                  }</div>
                  <div class="r ${v.importo !== undefined && v.importo < 0 ? 'neg' : ''}">${v.importo !== undefined ? euro(v.importo) : ''}</div></div>`,
              )
              .join('')
          : `<p class="sm">Nessun movimento.</p>`
      }
    </section>`;
}

/** Riepilogo annuale degli incassi per unità e inquilino (utile per la dichiarazione dei redditi). */
function riepilogo(d: Dati): string {
  const anni = anniConPagamenti(d);
  if (!anni.length) return '<p class="sm">Nessun pagamento registrato ancora.</p>';
  return anni
    .map((anno) => {
      const righe = riepilogoAnnuale(d, anno);
      const tot = righe.reduce((s, r) => s + r.canoni, 0);
      const altro = righe.reduce((s, r) => s + r.altro, 0);
      return `
        <h3 class="fuori">${anno}</h3>
        <section class="lista">
          ${righe
            .map(
              (r) => `<div class="riga statica"><div><div class="t">${esc(r.unita)} · ${esc(r.inquilino)}</div><div class="s">${esc(r.immobile)}${r.altro ? ' · altre voci ' + euro(r.altro) : ''}</div></div>
                <div class="r">${euro(r.canoni)}<br><small>canoni</small></div></div>`,
            )
            .join('')}
          <div class="riga statica totale-anno"><div><div class="t">Totale canoni ${anno}</div>${altro ? `<div class="s">altre voci ${euro(altro)}</div>` : ''}</div><div class="r">${euro(tot)}</div></div>
        </section>
        <button class="secondario largo" data-scarica-riepilogo="${anno}">${icona('excel')} Scarica il riepilogo ${anno} (si apre con Excel)</button>`;
    })
    .join('') + '<p class="aiuto fuori">Somme degli incassi registrati, per mese di riferimento. Non è un calcolo delle imposte: verifica sempre con il commercialista.</p>';
}
