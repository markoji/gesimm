// Formati italiani per date e importi, e piccole utilità sulle date (senza fusi orari:
// le date sono stringhe aaaa-mm-gg e i mesi aaaa-mm).

/**
 * Formato dei numeri scelto dal gestore: PUNTO per i decimali e apostrofo per le migliaia
 * (come nel suo Excel): 1234.5 → "1'234.50". Scritto a mano perché non dipenda dal browser.
 */
function italiano(n: number, decimali: number): string {
  const [intera, dec] = Math.abs(n).toFixed(decimali).split('.');
  const conSeparatori = intera.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return (n < 0 ? '−' : '') + conSeparatori + (dec ? '.' + dec : '');
}

/**
 * Importo scritto dall'utente → numero. Il decimale è il punto ("250.50"); si accettano anche
 * l'apostrofo delle migliaia ("1'234.50") e, per comodità, la virgola come decimale ("250,50").
 * undefined = campo vuoto, NaN = scritto male.
 */
export function leggiImporto(s: string): number | undefined {
  let t = s.replace(/[€\s']/g, '');
  if (t === '') return undefined;
  if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  else if (t.includes(',')) return NaN; // virgola e punto insieme: ambiguo
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** 1234.5 → "1'234.50 €" (senza decimali se interi). */
export function euro(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  return italiano(n, Number.isInteger(n) ? 0 : 2) + ' €';
}

export const numero = (n: number) => italiano(Math.round(n), 0);

/** "2026-11-05" → "05/11/2026". Il risultato è sempre sicuro da inserire nell'HTML. */
export function data(iso: string | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(iso);
}

/**
 * Mese scritto dall'utente → "aaaa-mm". Accetta "2026-11" (campo mese dei browser)
 * e "11/2026" o "11-2026" (Safari su Mac mostra un campo di testo). undefined se non valido.
 */
export function normalizzaMese(s: string): string | undefined {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2].padStart(2, '0')}` : undefined;
  m = /^(\d{1,2})[/\-.](\d{4})$/.exec(t);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1].padStart(2, '0')}` : undefined;
  return undefined;
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** "2026-11" → "Novembre 2026". */
export function meseEsteso(mese: string): string {
  const [a, m] = mese.split('-').map(Number);
  const nome = MESI[m - 1];
  if (!nome || !a) return esc(mese); // mese scritto in modo non valido: lo mostriamo com'è
  return nome.charAt(0).toUpperCase() + nome.slice(1) + ' ' + a;
}

/**
 * Prima data (>= `da`) della serie origine, origine + passo, origine + 2·passo… (passo in mesi).
 * Si calcola sempre dalla data d'origine, così un 31 o un 29 febbraio non "scivolano" nel tempo.
 */
export function prossimaRicorrenza(origine: string, da: string, passoMesi: number, minimo = 0): string {
  let k = minimo;
  let d = aggiungiAData(origine, 0, k * passoMesi);
  for (let i = 0; d < da && i < 2000; i++) d = aggiungiAData(origine, 0, ++k * passoMesi);
  return d;
}

/** Oggi come "aaaa-mm-gg" (ora locale). */
export function oggi(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const meseDi = (iso: string) => iso.slice(0, 7);

/** Somma mesi a "aaaa-mm". */
export function aggiungiMesi(mese: string, n: number): string {
  const [a, m] = mese.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Somma anni/mesi a una data "aaaa-mm-gg" (il giorno resta, ridotto se il mese è più corto). */
export function aggiungiAData(iso: string, anni: number, mesi = 0): string {
  const [a, m, g] = iso.split('-').map(Number);
  const t = a * 12 + (m - 1) + anni * 12 + mesi;
  const na = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  const ultimo = new Date(Date.UTC(na, nm, 0)).getUTCDate();
  return `${na}-${String(nm).padStart(2, '0')}-${String(Math.min(g, ultimo)).padStart(2, '0')}`;
}

/** Giorni tra due date "aaaa-mm-gg" (b − a). */
export function giorniTra(a: string, b: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Testo sicuro da inserire nell'HTML. */
export const esc = (s: string | number | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
