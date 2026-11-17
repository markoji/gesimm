// Tutti i calcoli dell'app: affitti del mese, arretrati, scadenze e avvisi.
// Le regole fiscali e le soglie NON sono scritte qui: vengono dalle impostazioni o dai dati.

import type { Contratto, Dati, Inquilino, Unita } from './modello';
import { aggiungiAData, aggiungiMesi, euro, giorniTra, meseDi, oggi, prossimaRicorrenza } from './formato';

export type Livello = 'ok' | 'attenzione' | 'urgente';

// ---------- contratti ----------

const isComodato = (c: Contratto) => /comodato/i.test(c.tipo ?? '');

/** Importo che ci si aspetta ogni mese (canone + eventuali spese fisse). 0 = nessun pagamento previsto. */
export const attesoMensile = (c: Contratto) => (c.canone ?? 0) + (c.speseMensili ?? 0);

/** Fine del periodo contrattuale in corso a una certa data (considerando i rinnovi). */
export function fineInCorso(c: Contratto, alla: string = oggi()): string | undefined {
  if (!c.inizio || !c.durataAnni) return undefined;
  const primaFine = aggiungiAData(c.inizio, c.durataAnni);
  if (primaFine >= alla) return primaFine;
  // Rinnovi successivi calcolati sempre dalla prima scadenza (nessuno "scivolamento" del giorno).
  return prossimaRicorrenza(primaFine, alla, (c.rinnovoAnni || c.durataAnni) * 12);
}

/** Il contratto è attivo in quel mese? (iniziato; nessuna data di fine certa nei dati: resta attivo con i rinnovi) */
export function attivoNelMese(c: Contratto, mese: string): boolean {
  return !c.inizio || meseDi(c.inizio) <= mese;
}

export const contrattiAttivi = (d: Dati, mese = meseDi(oggi())) => d.contratti.filter((c) => attivoNelMese(c, mese));

export const inquilinoDi = (d: Dati, c: Contratto): Inquilino | undefined => d.inquilini.find((i) => i.id === c.inquilino);
export const unitaDi = (d: Dati, id: string | undefined): Unita | undefined => d.unita.find((u) => u.id === id);

/** Nome breve dell'unità: "Piano terra esterno" (+ pertinenza). */
export function nomeContratto(d: Dati, c: Contratto): string {
  const u = unitaDi(d, c.unita);
  const p = unitaDi(d, c.pertinenza);
  return (u?.nome ?? c.unita) + (p ? ' + ' + p.nome : '');
}

// ---------- pagamenti ----------

/** Voci che contano come "affitto" del mese. */
const VOCI_AFFITTO = /canone|spese condominiali|affitto/i;

export function pagatoNelMese(d: Dati, c: Contratto, mese: string) {
  const unita = [c.unita, c.pertinenza].filter(Boolean);
  const voci = d.pagamenti.filter(
    (p) =>
      p.mese === mese &&
      unita.includes(p.unita) &&
      // Se il pagamento indica chi ha pagato, deve essere l'inquilino di questo contratto
      // (così, se un appartamento cambia inquilino, i pagamenti non si mescolano).
      (!p.inquilino || !c.inquilino || p.inquilino === c.inquilino) &&
      (!p.voce || VOCI_AFFITTO.test(p.voce)),
  );
  const totale = voci.reduce((s, p) => s + p.importo, 0);
  const ultima = voci.map((p) => p.data).filter(Boolean).sort().pop();
  return { totale, ultima };
}

/** 'non_controllato' = mese precedente all'inizio del monitoraggio (nessun pagamento registrato lì). */
export type StatoAffitto = 'pagato' | 'parziale' | 'da_pagare' | 'non_ancora_dovuto' | 'non_controllato';

export interface RigaAffitto {
  contratto: Contratto;
  cognome: string;
  atteso: number;
  pagato: number;
  stato: StatoAffitto;
  dataPagamento?: string;
}

/** Elenco "Affitti del mese": un cognome per ogni contratto con un canone. */
export function affittiDelMese(d: Dati, mese: string): RigaAffitto[] {
  const oggiIso = oggi();
  const dovutoDal = `${mese}-${String(d.impostazioni.giornoScadenzaAffitto).padStart(2, '0')}`;
  return contrattiAttivi(d, mese)
    .filter((c) => attesoMensile(c) > 0)
    .map((c) => {
      const atteso = attesoMensile(c);
      const { totale, ultima } = pagatoNelMese(d, c, mese);
      let stato: StatoAffitto;
      if (totale >= atteso) stato = 'pagato';
      else if (totale > 0) stato = 'parziale';
      else if (mese < d.impostazioni.inizioMonitoraggio) stato = 'non_controllato';
      // Il giorno di scadenza stesso è ancora "in tempo" (coerente con il calcolo degli arretrati).
      else if (oggiIso <= dovutoDal) stato = 'non_ancora_dovuto';
      else stato = 'da_pagare';
      return {
        contratto: c,
        cognome: inquilinoDi(d, c)?.cognome ?? c.inquilino ?? '—',
        atteso,
        pagato: totale,
        stato,
        dataPagamento: ultima,
      };
    })
    .sort((a, b) => a.cognome.localeCompare(b.cognome, 'it'));
}

/** Arretrato di un contratto dal mese di inizio monitoraggio a oggi. */
export function arretrato(d: Dati, c: Contratto): number {
  const atteso = attesoMensile(c);
  if (atteso <= 0) return 0;
  const oggiIso = oggi();
  let mese = d.impostazioni.inizioMonitoraggio;
  if (c.inizio && meseDi(c.inizio) > mese) mese = meseDi(c.inizio);
  const meseOggi = meseDi(oggiIso);
  const giornoOggi = Number(oggiIso.slice(8));
  // Il mese corrente conta solo dopo il giorno di scadenza dell'affitto.
  const ultimo = giornoOggi > d.impostazioni.giornoScadenzaAffitto ? meseOggi : aggiungiMesi(meseOggi, -1);
  let tot = 0;
  for (let i = 0; mese <= ultimo && i < 600; i++, mese = aggiungiMesi(mese, 1)) {
    tot += Math.max(0, atteso - pagatoNelMese(d, c, mese).totale);
  }
  return Math.round(tot * 100) / 100;
}

// ---------- scadenze ----------

export interface Scadenza {
  data: string;
  titolo: string;
  riferimento?: string;
  avvisoGiorni: number;
  giorni: number;
  livello: Livello;
  origine: 'contratto' | 'manuale';
}

export interface ScadenzaDaCompletare {
  titolo: string;
  riferimento?: string;
}

const PASSI: Record<string, number> = { mensile: 1, trimestrale: 3, semestrale: 6, annuale: 12 };

/** Prossima ricorrenza annuale di una data (es. anniversario del contratto). */
function prossimoAnniversario(inizio: string, da: string): string {
  return prossimaRicorrenza(inizio, da, 12, 1);
}

export function scadenze(d: Dati): { elenco: Scadenza[]; daCompletare: ScadenzaDaCompletare[] } {
  const oggiIso = oggi();
  const anticipo = d.impostazioni.avvisoScadenzeGiorni;
  const grezze: Omit<Scadenza, 'giorni' | 'livello'>[] = [];
  const daCompletare: ScadenzaDaCompletare[] = [];

  for (const c of d.contratti) {
    const nome = nomeContratto(d, c);
    const cognome = inquilinoDi(d, c)?.cognome ?? c.inquilino ?? '';
    const rif = cognome ? `${nome} · ${cognome}` : nome;
    const fine = fineInCorso(c, oggiIso);
    if (fine) {
      grezze.push({ data: fine, titolo: 'Fine periodo contrattuale', riferimento: rif, avvisoGiorni: 90, origine: 'contratto' });
      if (c.preavvisoMesi) {
        const disdetta = aggiungiAData(fine, 0, -c.preavvisoMesi);
        if (disdetta >= oggiIso)
          grezze.push({ data: disdetta, titolo: 'Ultimo giorno per la disdetta', riferimento: rif, avvisoGiorni: anticipo, origine: 'contratto' });
      }
    }
    if (c.inizio && !isComodato(c)) {
      if (/ordinario/i.test(c.regime ?? ''))
        grezze.push({ data: prossimoAnniversario(c.inizio, oggiIso), titolo: 'Imposta di registro annuale', riferimento: rif, avvisoGiorni: anticipo, origine: 'contratto' });
      if (c.istat)
        grezze.push({ data: prossimoAnniversario(c.inizio, oggiIso), titolo: `Aggiornamento ISTAT${c.percentualeIstat ? ' (' + c.percentualeIstat + '%)' : ''}`, riferimento: rif, avvisoGiorni: anticipo, origine: 'contratto' });
    }
  }

  for (const s of d.scadenze) {
    if (!s.data) {
      daCompletare.push({ titolo: s.descrizione, riferimento: s.riferimento });
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.data)) continue;
    const passo = PASSI[(s.ricorrenza ?? '').toLowerCase()];
    const data = passo ? prossimaRicorrenza(s.data, oggiIso, passo) : s.data;
    if (data < oggiIso) continue; // non ricorrente e già passata
    grezze.push({ data, titolo: s.descrizione, riferimento: s.riferimento, avvisoGiorni: s.avvisoGiorni ?? anticipo, origine: 'manuale' });
  }

  const elenco = grezze
    .map((s) => {
      const giorni = giorniTra(oggiIso, s.data);
      const livello: Livello = giorni <= Math.min(7, s.avvisoGiorni) ? 'urgente' : giorni <= s.avvisoGiorni ? 'attenzione' : 'ok';
      return { ...s, giorni, livello };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
  return { elenco, daCompletare };
}

// ---------- avvisi ----------

export interface Avviso {
  livello: Livello;
  testo: string;
  data?: string;
  link?: string;
  /** Posizione della richiesta in d.richieste (per "segna come pagata"). */
  richiesta?: number;
}

export function avvisi(d: Dati): Avviso[] {
  const out: Avviso[] = [];
  const oggiIso = oggi();
  const soglia = d.impostazioni.sogliaArretratoPercentuale / 100;

  for (const c of contrattiAttivi(d)) {
    const a = arretrato(d, c);
    if (a <= 0) continue;
    const cognome = inquilinoDi(d, c)?.cognome ?? '';
    const sopra = a >= attesoMensile(c) * soglia;
    out.push({
      livello: sopra ? 'urgente' : 'attenzione',
      testo: `${cognome} (${nomeContratto(d, c)}): arretrato ${euro(a)}${sopra ? ' — controllare e sollecitare' : ''}`,
      link: '#/contratto/' + encodeURIComponent(c.id),
    });
  }

  for (const [indice, r] of d.richieste.entries()) {
    if (r.pagataIl) continue;
    const giorni = r.giorni ?? d.impostazioni.giorniRitardoRichiesta;
    const passati = giorniTra(r.dataInvio, oggiIso);
    if (passati <= giorni) continue;
    out.push({
      livello: 'urgente',
      testo: `${r.inquilino ?? r.unita ?? ''}: "${r.descrizione ?? 'richiesta'}"${r.importo ? ' (' + euro(r.importo) + ')' : ''} non pagata da ${passati} giorni`,
      richiesta: indice,
    });
  }

  for (const s of scadenze(d).elenco) {
    if (s.livello === 'ok') continue;
    out.push({ livello: s.livello, testo: `${s.titolo}${s.riferimento ? ' — ' + s.riferimento : ''}`, data: s.data, link: '#/scadenze' });
  }

  const peso = { urgente: 0, attenzione: 1, ok: 2 };
  return out.sort((a, b) => peso[a.livello] - peso[b.livello] || (a.data ?? '').localeCompare(b.data ?? ''));
}

// ---------- bilancio e pannelli ----------

export function bilancioAnno(d: Dati, anno: string) {
  const incassi = d.pagamenti.filter((p) => p.mese.startsWith(anno)).reduce((s, p) => s + p.importo, 0);
  const gse = d.fotovoltaico.filter((v) => v.mese.startsWith(anno)).reduce((s, v) => s + (v.bonificoGse ?? 0), 0);
  const spese = d.spese.filter((s) => (s.data ?? '').startsWith(anno)).reduce((s, v) => s + v.importo, 0);
  return { incassi: incassi + gse, spese, netto: incassi + gse - spese };
}

export function pannelliAnno(d: Dati, anno: string) {
  const voci = d.fotovoltaico.filter((v) => v.mese.startsWith(anno));
  const somma = (f: (v: (typeof voci)[number]) => number | undefined) => voci.reduce((s, v) => s + (f(v) ?? 0), 0);
  const risparmio = voci.reduce((s, v) => {
    const auto = (v.prodottaKwh ?? 0) - (v.cedutaKwh ?? 0);
    return s + (v.prezzoMedio && auto > 0 ? auto * v.prezzoMedio : 0);
  }, 0);
  const ultimo = d.fotovoltaico
    .flatMap((v) => [v.dataBilancio, v.dataAccredito, v.mese + '-01'])
    .filter((x): x is string => !!x)
    .sort()
    .pop();
  return { gse: somma((v) => v.bonificoGse), prodotta: somma((v) => v.prodottaKwh), risparmio, ultimoAggiornamento: ultimo };
}
