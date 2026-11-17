// Impostazioni dell'app.
// Nessuna di queste informazioni è segreta: la "App key" di Dropbox è pubblica per
// costruzione (con PKCE non esiste alcun segreto nel codice).

export const CONFIG = {
  /** Vetrina (tutti): app Dropbox con SOLI permessi di lettura. */
  dropboxAppKey: 'ofhicfd48thcd2c',
  scopes: ['files.metadata.read', 'files.content.read', 'sharing.read'],

  /** App del gestore (solo chi aggiorna i dati): seconda app Dropbox, con il permesso di scrittura. */
  dropboxAppKeyGestore: 'bv7qojkbmf9huqa',
  scopesGestore: ['files.metadata.read', 'files.content.read', 'files.content.write', 'sharing.read'],

  /** Nome della cartella condivisa. Se è stata spostata, l'app la ritrova da sola. */
  nomeCartellaCondivisa: 'Gestione Immobili',
  /** Cartella privata del gestore (accanto a quella condivisa, mai condivisa). */
  nomeCartellaPrivata: 'Gestione Immobili - Privato',

  /** File dei dati, relativo alla cartella condivisa. */
  fileDati: '_app/dati.json',
  /** File delle note private, relativo alla cartella privata. */
  filePrivato: '_app/privato.json',
  /** Quante copie di sicurezza tenere. */
  copieDiSicurezza: 5,
} as const;
