// Lettura del modello Excel direttamente nel browser (app del gestore).
// Le colonne si riconoscono dal titolo, quindi si possono aggiungere colonne nuove
// (es. nel foglio Inquilini) senza rompere nulla.
// Le righe di esempio (nota che inizia con "ESEMPIO", inquilino "Esempio") vengono ignorate.

import type { Contratto, Dati, Inquilino, Pagamento, Richiesta, ScadenzaManuale, Spesa, Unita, VoceFotovoltaico } from './modello';

type Grezzo = string | number | boolean | Date | null;
type Riga = Record<string, Grezzo> & { _celle: { etichetta: string; valore: Grezzo }[] };

export interface Privato {
  versione: number;
  aggiornatoIl: string;
  notePrivate: { inquilino: string; note: string }[];
}

export interface RisultatoImport {
  dati: Pick<Dati, 'unita' | 'inquilini' | 'contratti' | 'pagamenti' | 'richieste' | 'scadenze' | 'spese' | 'fotovoltaico'>;
  notePrivate: Privato['notePrivate'];
  avvisi: string[];
}

// ---------- lettura celle ----------

const pad = (n: number | string) => String(n).padStart(2, '0');
const isoDaData = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grezzo(cell: any): Grezzo {
  let v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if ('richText' in v) v = v.richText.map((t: { text: string }) => t.text).join('');
    else if ('text' in v) v = v.text;
    else if ('hyperlink' in v) v = v.hyperlink;
  }
  return v ?? null;
}

const testo = (v: Grezzo | undefined): string | undefined => {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return isoDaData(v);
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

const numeroDa = (v: Grezzo | undefined): number | undefined => {
  if (v === null || v === undefined || v === '' || v instanceof Date) return undefined;
  if (typeof v === 'number') return v;
  let t = String(v).replace(/[€\s']/g, '');
  // "1.234,50" → punti = migliaia; "0.280" o "12.5" (senza virgola) → il punto è il decimale.
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

const dataDa = (v: Grezzo | undefined): string | undefined => {
  if (v instanceof Date) return isoDaData(v);
  const m = String(v ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : undefined;
};

const meseDa = (v: Grezzo | undefined): string | undefined => {
  if (v instanceof Date) return isoDaData(v).slice(0, 7);
  const m = String(v ?? '').match(/(\d{1,2})\/(\d{4})/);
  return m ? `${m[2]}-${pad(m[1])}` : undefined;
};

const siNo = (v: string | undefined) => (v === undefined ? undefined : /^s[iì]/i.test(v));

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

/** Primo valore tra più nomi di colonna possibili. */
function campo(r: Riga, ...nomi: string[]): Grezzo | undefined {
  for (const n of nomi) {
    const k = Object.keys(r).find((x) => x === norm(n) || x.startsWith(norm(n)));
    if (k && testo(r[k]) !== undefined) return r[k];
  }
  return undefined;
}

// ---------- importazione ----------

export async function leggiExcel(file: ArrayBuffer): Promise<RisultatoImport> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file);
  const avvisi: string[] = [];

  function leggiFoglio(nome: string): Riga[] {
    const ws = wb.worksheets.find((w) => norm(w.name).startsWith(norm(nome)));
    if (!ws) {
      avvisi.push(`Foglio "${nome}" non trovato: saltato.`);
      return [];
    }
    const intestazioni: (string | undefined)[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (intestazioni[col] = testo(grezzo(cell))));
    const righe: Riga[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const r = { _celle: [] } as unknown as Riga;
      let piena = false;
      intestazioni.forEach((h, col) => {
        if (!h) return;
        const v = grezzo(row.getCell(col));
        if (testo(v) !== undefined) piena = true;
        r[norm(h)] = v;
        r._celle.push({ etichetta: h, valore: v });
      });
      if (!piena) return;
      const tuttoTesto = r._celle.map((c) => (typeof c.valore === 'string' ? c.valore : '')).join(' ');
      if (/(^|\s)ESEMPIO\b/.test(tuttoTesto)) return;
      righe.push(r);
    });
    return righe;
  }

  const unita: Unita[] = leggiFoglio('Unità')
    .map((r) => {
      const immobile = testo(campo(r, 'Immobile')) ?? '';
      const nome = testo(campo(r, 'Unità')) ?? '';
      return {
        id: `${immobile} - ${nome}`,
        immobile,
        nome,
        tipo: testo(campo(r, 'Tipo')),
        stato: testo(campo(r, 'Stato')),
        foglio: testo(campo(r, 'Foglio')),
        particella: testo(campo(r, 'Particella')),
        subalterno: testo(campo(r, 'Subalterno')),
        note: testo(campo(r, 'Note')),
      };
    })
    .filter((u) => u.nome);

  const notePrivate: Privato['notePrivate'] = [];
  const inquilini: Inquilino[] = [];
  for (const r of leggiFoglio('Inquilini')) {
    const cognome = testo(campo(r, 'Cognome'));
    if (!cognome || /^esempio$/i.test(cognome)) continue;
    const np = testo(campo(r, 'Note private'));
    if (np) notePrivate.push({ inquilino: cognome, note: np });
    const campi = r._celle
      .filter((c) => !/^(cognome|nome|note private)$/.test(norm(c.etichetta)))
      .map((c) => ({ etichetta: c.etichetta, valore: c.valore instanceof Date ? isoDaData(c.valore).split('-').reverse().join('/') : testo(c.valore) ?? '' }))
      .filter((c) => c.valore);
    inquilini.push({ id: cognome, cognome, nome: testo(campo(r, 'Nome')), campi });
  }

  const contratti: Contratto[] = [];
  for (const r of leggiFoglio('Contratti')) {
    const unitaId = testo(campo(r, 'Unità'));
    const inq = testo(campo(r, 'Inquilino'));
    if (!unitaId || /^esempio$/i.test(inq ?? '')) continue;
    const durataTesto = testo(campo(r, 'Durata'));
    contratti.push({
      id: `${unitaId} · ${inq ?? 'senza inquilino'}`,
      unita: unitaId,
      pertinenza: testo(campo(r, 'Pertinenza')),
      tipo: testo(campo(r, 'Tipo contratto')),
      regime: testo(campo(r, 'Regime')),
      inquilino: inq,
      coinquilini: (testo(campo(r, 'Altri inquilini')) ?? '').split(/[,;/]| e /).map((s) => s.trim()).filter(Boolean),
      inizio: dataDa(campo(r, 'Data inizio')),
      fine: dataDa(campo(r, 'Data fine')),
      durataAnni: durataTesto ? numeroDa(durataTesto.split('+')[0]) : undefined,
      rinnovoAnni: numeroDa(campo(r, 'Rinnovo')),
      canone: numeroDa(campo(r, 'Canone')),
      speseMensili: numeroDa(campo(r, 'Spese mensili')),
      deposito: numeroDa(campo(r, 'Deposito')),
      modalita: testo(campo(r, 'Modalità')),
      dataRegistrazione: dataDa(campo(r, 'Data registrazione')),
      estremiRegistrazione: testo(campo(r, 'Estremi')),
      istat: siNo(testo(campo(r, 'Aggiornamento ISTAT'))),
      percentualeIstat: numeroDa(campo(r, '% ISTAT')),
      preavvisoMesi: numeroDa(campo(r, 'Preavviso')),
      cartella: testo(campo(r, 'Cartella')),
      note: testo(campo(r, 'Note')),
    });
  }

  const pagamenti: Pagamento[] = [];
  for (const r of leggiFoglio('Pagamenti')) {
    const p = {
      origine: 'excel' as const,
      data: dataDa(campo(r, 'Data incasso')),
      unita: testo(campo(r, 'Unità')),
      inquilino: testo(campo(r, 'Inquilino')),
      mese: meseDa(campo(r, 'Mese')),
      voce: testo(campo(r, 'Voce')),
      importo: numeroDa(campo(r, 'Importo')),
      modalita: testo(campo(r, 'Modalità')),
      note: testo(campo(r, 'Note')),
    };
    if (!p.unita || !p.mese || p.importo === undefined) {
      avvisi.push('Pagamenti: una riga senza unità, mese o importo è stata saltata.');
      continue;
    }
    pagamenti.push(p as Pagamento);
  }

  const richieste: Richiesta[] = leggiFoglio('Richieste')
    .map((r) => ({
      origine: 'excel' as const,
      dataInvio: dataDa(campo(r, 'Data invio')) ?? '',
      unita: testo(campo(r, 'Unità')),
      inquilino: testo(campo(r, 'Inquilino')),
      descrizione: testo(campo(r, 'Cosa hai chiesto')),
      importo: numeroDa(campo(r, 'Importo')),
      giorni: numeroDa(campo(r, 'Da pagare entro')),
      pagataIl: dataDa(campo(r, 'Pagata il')),
      note: testo(campo(r, 'Note')),
    }))
    .filter((r) => r.dataInvio);

  const scadenze: ScadenzaManuale[] = leggiFoglio('Scadenze')
    .map((r) => ({
      descrizione: testo(campo(r, 'Descrizione')) ?? '',
      riferimento: testo(campo(r, 'Riferimento')),
      data: dataDa(campo(r, 'Data scadenza')),
      ricorrenza: testo(campo(r, 'Ricorrenza')),
      avvisoGiorni: numeroDa(campo(r, 'Avvisami')),
      note: testo(campo(r, 'Note')),
    }))
    .filter((s) => s.descrizione);

  const spese: Spesa[] = leggiFoglio('Spese')
    .map((r) => ({
      origine: 'excel' as const,
      data: dataDa(campo(r, 'Data')),
      riferimento: testo(campo(r, 'Riferimento')),
      categoria: testo(campo(r, 'Categoria')),
      descrizione: testo(campo(r, 'Descrizione')),
      importo: numeroDa(campo(r, 'Importo')) as number,
      note: testo(campo(r, 'Note')),
    }))
    .filter((s) => s.importo !== undefined);

  const fotovoltaico: VoceFotovoltaico[] = leggiFoglio('Fotovoltaico')
    .map((r) => ({
      origine: 'excel' as const,
      mese: meseDa(campo(r, 'Mese')) ?? '',
      riferimento: testo(campo(r, 'Appartamento')),
      prodottaKwh: numeroDa(campo(r, 'Energia prodotta')),
      cedutaKwh: numeroDa(campo(r, 'Energia ceduta')),
      prezzoMedio: numeroDa(campo(r, 'Prezzo medio')),
      bonificoGse: numeroDa(campo(r, 'Bonifico GSE')),
      dataAccredito: dataDa(campo(r, 'Data accredito')),
      dataBilancio: dataDa(campo(r, 'Bilancio GSE')),
      note: testo(campo(r, 'Note')),
    }))
    .filter((v) => v.mese);

  // Controlli di coerenza
  const idUnita = new Set(unita.map((u) => u.id));
  const idInquilini = new Set(inquilini.map((i) => i.id));
  for (const c of contratti) {
    if (!idUnita.has(c.unita)) avvisi.push(`Contratti: unità "${c.unita}" non presente nel foglio Unità.`);
    if (c.pertinenza && !idUnita.has(c.pertinenza)) avvisi.push(`Contratti: pertinenza "${c.pertinenza}" non presente nel foglio Unità.`);
    for (const q of [c.inquilino, ...(c.coinquilini ?? [])]) if (q && !idInquilini.has(q)) avvisi.push(`Contratti: inquilino "${q}" non presente nel foglio Inquilini.`);
    if (!c.inizio) avvisi.push(`Contratti: "${c.unita}" senza data di inizio.`);
  }

  return {
    dati: { unita, inquilini, contratti, pagamenti, richieste, scadenze, spese, fotovoltaico },
    notePrivate,
    avvisi: [...new Set(avvisi)],
  };
}

/**
 * Unisce l'Excel ai dati esistenti: anagrafiche e scadenze vengono dall'Excel;
 * i movimenti registrati nell'app (origine 'app') restano, quelli dell'Excel vengono sostituiti.
 */
export function unisci(esistenti: Dati | null, nuovi: RisultatoImport['dati']): RisultatoImport['dati'] {
  const app = <T extends { origine?: string }>(l: T[] | undefined) => (l ?? []).filter((x) => x.origine === 'app');
  return {
    ...nuovi,
    pagamenti: [...nuovi.pagamenti, ...app(esistenti?.pagamenti)],
    richieste: [...nuovi.richieste, ...app(esistenti?.richieste)],
    spese: [...nuovi.spese, ...app(esistenti?.spese)],
    fotovoltaico: [...nuovi.fotovoltaico, ...app(esistenti?.fotovoltaico)],
  };
}
