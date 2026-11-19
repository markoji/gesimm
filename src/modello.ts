// Formato dei dati salvati su Dropbox in "Gestione Immobili/_app/dati.json".
// Contiene i dati "grezzi" (come nell'Excel): tutti i calcoli (arretrati, scadenze, avvisi)
// li fa l'app, così basta aggiornare un dato perché tutto il resto si aggiorni da solo.
// Le sole "Note private" degli inquilini NON stanno qui ma in "Gestione Immobili - Privato".

export const VERSIONE_DATI = 2;

/**
 * Da dove arriva un movimento (pagamento, spesa, richiesta, dati pannelli):
 * 'excel' = importato dall'Excel (viene sostituito al prossimo import),
 * 'app'   = registrato nell'app (viene sempre mantenuto).
 */
export type Origine = 'excel' | 'app';

export interface Impostazioni {
  /** Allarme quando l'arretrato raggiunge questa percentuale del canone mensile. */
  sogliaArretratoPercentuale: number;
  /** Giorni dopo l'invio di una richiesta oltre i quali, se non pagata, scatta l'avviso (se la richiesta non ne indica altri). */
  giorniRitardoRichiesta: number;
  /** Giorno del mese entro cui si considera dovuto l'affitto. */
  giornoScadenzaAffitto: number;
  /** Primo mese (aaaa-mm) da cui l'app controlla i pagamenti: i mesi precedenti non generano arretrati. */
  inizioMonitoraggio: string;
  /** Anticipo predefinito (giorni) con cui avvisare delle scadenze. */
  avvisoScadenzeGiorni: number;
  /** Cartella dei contratti, relativa alla cartella condivisa. */
  cartellaContratti: string;
}

export interface Unita {
  /** Identificativo leggibile, es. "Via Esempio 1 - Appartamento A". */
  id: string;
  immobile: string;
  nome: string;
  tipo?: string;
  stato?: string;
  foglio?: string;
  particella?: string;
  subalterno?: string;
  note?: string;
}

export interface Campo {
  etichetta: string;
  valore: string;
}

export interface Inquilino {
  /** Il cognome (come nei menu dell'Excel). */
  id: string;
  cognome: string;
  nome?: string;
  /** Tutti gli altri dati (telefono, email, documento...), nell'ordine delle colonne dell'Excel. */
  campi: Campo[];
}

export interface Contratto {
  id: string;
  unita: string;
  pertinenza?: string;
  tipo?: string;
  regime?: string;
  inquilino?: string;
  /** Altri inquilini dello stesso contratto (cognomi), oltre a quello principale. */
  coinquilini?: string[];
  /** Data ISO aaaa-mm-gg. */
  inizio?: string;
  /** Data di fine (contratto cessato). Dopo questa data non conta più negli affitti e nelle scadenze. */
  fine?: string;
  durataAnni?: number;
  rinnovoAnni?: number;
  canone?: number;
  speseMensili?: number;
  deposito?: number;
  modalita?: string;
  dataRegistrazione?: string;
  estremiRegistrazione?: string;
  istat?: boolean;
  percentualeIstat?: number;
  preavvisoMesi?: number;
  cartella?: string;
  note?: string;
}

export interface Pagamento {
  origine?: Origine;
  data?: string;
  unita: string;
  inquilino?: string;
  /** Mese di riferimento aaaa-mm. */
  mese: string;
  voce?: string;
  importo: number;
  modalita?: string;
  note?: string;
}

export interface Richiesta {
  origine?: Origine;
  dataInvio: string;
  unita?: string;
  inquilino?: string;
  descrizione?: string;
  importo?: number;
  giorni?: number;
  pagataIl?: string;
  note?: string;
}

export interface ScadenzaManuale {
  descrizione: string;
  riferimento?: string;
  data?: string;
  ricorrenza?: string;
  avvisoGiorni?: number;
  note?: string;
}

export interface Spesa {
  origine?: Origine;
  data?: string;
  riferimento?: string;
  categoria?: string;
  descrizione?: string;
  importo: number;
  note?: string;
}

export interface VoceFotovoltaico {
  origine?: Origine;
  mese: string;
  riferimento?: string;
  prodottaKwh?: number;
  cedutaKwh?: number;
  prezzoMedio?: number;
  bonificoGse?: number;
  dataAccredito?: string;
  dataBilancio?: string;
  note?: string;
}

export interface Dati {
  versione: number;
  /** Istante dell'ultimo aggiornamento (ISO). */
  aggiornatoIl: string;
  impostazioni: Impostazioni;
  unita: Unita[];
  inquilini: Inquilino[];
  contratti: Contratto[];
  pagamenti: Pagamento[];
  richieste: Richiesta[];
  scadenze: ScadenzaManuale[];
  spese: Spesa[];
  fotovoltaico: VoceFotovoltaico[];
}

export function datiValidi(x: unknown): x is Dati {
  const d = x as Dati;
  return (
    !!d &&
    typeof d.versione === 'number' &&
    !!d.impostazioni &&
    ['unita', 'inquilini', 'contratti', 'pagamenti', 'richieste', 'scadenze', 'spese', 'fotovoltaico'].every((k) =>
      Array.isArray((d as unknown as Record<string, unknown>)[k]),
    )
  );
}
