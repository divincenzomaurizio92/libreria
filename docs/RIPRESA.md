# Libreria – come riprendere il lavoro

Documento per ripartire in una conversazione nuova con Claude dal punto in cui ci siamo fermati
(18 novembre 2026, **Versione 50**). Basta allegarlo, oppure incollare il prompt in fondo.

---

## 1. Cos'è

Web app per catalogare i libri di casa di Maurizio ed Elena, pensata soprattutto per **Elena** (iPhone).
Sviluppa **Maurizio** (Pixel 6, PC Windows, livello base di programmazione, vuole essere guidato passo passo).

- **App:** https://divincenzomaurizio92.github.io/libreria/
- **Codice:** repository pubblico GitHub `divincenzomaurizio92/libreria`, branch `main`, pubblicato con GitHub Pages.
- **Dati online:** Supabase, progetto **DR HUB** (`yhtdnfxlszkeydlnxwme`), solo tabelle con prefisso `libreria_`.
- Nessun passaggio di compilazione: HTML, CSS e JavaScript semplici.

Principio guida, chiesto da Maurizio: **tanta automazione, ma tutto modificabile**. I dati incerti
(genere, tema…) sono suggerimenti che si correggono sempre.

---

## 2. Com'è fatta

| File | Cosa contiene |
|---|---|
| `index.html` | Struttura: testata, schede Libreria/Desideri/Audible, elenco, tutti i pannelli (scanner, scheda, modifica, impostazioni…) |
| `style.css` | Grafica: tema **Sera** (unico), font Fraunces + Figtree. Le regole nuove sono aggiunte in fondo, con un commento `vNN` |
| `app.js` | Tutta l'app: dati, cataloghi, scansione, viste, filtri, scaffale, schede. `APP_VERSION` in cima |
| `cloud.js` | Parte online: accesso con email e password, sincronizzazione con Supabase |
| `version.json` | Numero dell'ultima versione pubblicata, per l'aggiornamento automatico |
| `manifest.webmanifest`, `icons/` | Icona sulla schermata Home (dorsi su una mensola, tema Sera) |
| `vendor/zxing.min.js` | Lettore di codici a barre per iPhone (su Android si usa quello del browser) |
| `vendor/supabase.min.js` | Libreria ufficiale Supabase 2.119.0 |
| `supabase/001_libreria_init.sql` | Schema delle tabelle online (le email ammesse non sono nel file, perché il repository è pubblico) |

### Dati sul telefono (localStorage)
- `libreria.v1`: `{ books, genres, wishlists, owners, places }`
- Preferenze: `libreria.googleKey` (chiave Google Books, **mai** nel codice), `libreria.view`, `libreria.zoom`,
  `libreria.shelfSort`, `libreria.homeSplit`, `libreria.me` (chi usa il telefono), `libreria.pubClean`
- `libreria.sync`: stato della sincronizzazione; `libreria.auth`: sessione Supabase; `libreria.discover`: dati di "Da scoprire"

### Un libro
Campi principali: `id, isbn, barcode (codici non ISBN), title, subtitle, authors, publisher, year, pages, cover,
genres[], theme, owners[], list ('' = in libreria, altrimenti nome lista desideri), media[] ('paper','kindle','audio'),
status ('toread','reading','read'), readAt, rating, notes, plot, shelf, shelfRow, series, seriesNum, format,
boughtAt, price, loanTo, loanDate, addedAt, updatedAt`.

### Parte online (DR HUB)
- Tabelle: `libreria_libraries` (una: "Libreria di casa", con `settings` = generi/liste/persone/mobili),
  `libreria_allowed` (email ammesse → nome), `libreria_members`, `libreria_books` (una riga per libro, `data` jsonb).
- Funzioni: `libreria_join()` (all'accesso aggiunge la persona alla libreria se l'email è ammessa), `libreria_is_member()`.
- Regole: senza accesso nessuno legge o scrive; chi è collegato vede solo la propria libreria.
- Email ammesse: quelle di Maurizio ("Maurizio") ed Elena ("Elena").
- Accesso con **email e password**: gli account li crea Maurizio da *Authentication → Users → Add user*
  (spuntare *Auto Confirm User*). Il codice via email non si può usare: Supabase permette di modificare
  le email solo con un servizio di posta proprio (SMTP).
- Sincronizzazione: dopo ogni salvataggio (2,5 s), all'apertura, al ritorno nell'app e ogni minuto.
  Un libro cambiato su un solo telefono vince; se cambiato su entrambi vince la modifica più recente;
  i generi/liste/persone/mobili si uniscono.

---

## 3. Cosa c'è (Versione 57)

**Inserimento:** scansione singola, a raffica (con riepilogo e "vale per tutti": persona, mobile, lettura),
"Ce l'ho già?" in negozio, penna con risultati mentre scrivi, codici non ISBN (edicola 977, codici interni dei
libri vecchi) salvati nella scheda. Cataloghi: Google Books (con chiave personale) e Open Library di riserva.
Editore dal prefisso ISBN, generi suggeriti, trama.

**Scheda:** copertina (anche foto propria), versioni Cartaceo/Kindle/Audible insieme, persone, mobile e ripiano,
serie, tema, formato, stato di lettura; segnando "Letto" si chiedono stelle e recensione; prestiti; prezzo.

**Home:** saluto con nome, mensole "Sul comodino" (in corso) e "Da leggere", poi "Tutti i libri"
(toccabile = tutti insieme; Stanza/Genere/Persona = divisi come lo Scaffale). Copertine come libri su mensole.
Vista lista con le stesse sezioni in riquadri. Filtri combinabili: lettura, prestiti, persona, mobile, tema,
versione, genere. Scaffale con dorsi e "Suggerisci come disporli" con i metri di mensola.

**Desideri:** più liste, prezzo e totale, sezione "Da scoprire" pronta ma vuota (la riempirà Claude).
**Audible:** scheda con i titoli ascoltati.
**Altro:** aggiornamento automatico all'apertura, icona sulla schermata Home, backup JSON ed Excel,
rinomina di persone/mobili/liste/generi.

**Novità v56–57:** selezione multipla e modifica in blocco; pagina autore e pagina serie (con i volumi mancanti);
"Da sistemare" nelle impostazioni (libri senza persona, genere, voto, mobile, serie, doppioni); citazioni nella
scheda; "Cosa leggo stasera?"; mensole con "Vedi tutti". **Liste desideri condivisibili**: nei Desideri, scelta
una lista, "Condividi" crea un link (`share.html?t=…`) che parenti e amici aprono senza account e dove toccano
"Lo prendo io"; voi vedete "🎁 Lo prende Nome" (e potete renderlo libero). Tabelle `libreria_shares` e
`libreria_claims` su DR HUB (vedi `supabase/002_libreria_shares.sql`). **Anno in libri** (omino in alto): per
persona e anno, letti, obiettivo sincronizzato tra i telefoni, pagine, voto medio, genere e autore preferiti,
mese per mese, copertine. **Importa da altre app** (Impostazioni): CSV di Goodreads/StoryGraph/Libib/Handy
Library, Excel, oppure elenco incollato (ISBN o "Titolo - Autore"); doppioni saltati, poi completamento dai
cataloghi come la raffica (anche per titolo, se manca l'ISBN).

---

## 4. Cosa manca, in ordine

1. **Collaudo su iPhone** (Elena, dall'icona installata da Safari). Punti a rischio: scansione con ZXing,
   gesti (tocco prolungato, pizzico, scorrimento), prima sincronizzazione vera. Su iPhone non c'è vibrazione.
2. **Funzioni con Claude** (crediti API inclusi nel piano Max: 100 $ al mese).
   - Prima: Maurizio collega un'organizzazione della Claude Console da claude.ai *Impostazioni → Fatturazione →
     API credits* e crea una chiave. **La chiave non va mai in chat né nel codice**: si salva tra i segreti di
     Supabase (DR HUB). Da chiarire se l'Hub ha già una chiave Anthropic salvata (ha funzioni "vision").
   - Poi, con una funzione su Supabase: copertine fisse nel proprio archivio (con il colore vero), genere e tema
     proposti dalla trama (anche in blocco), prezzi di copertina, riconoscimento dalla foto della copertina
     (risolve edicola e libri senza ISBN), "Da scoprire" settimanale (più venduti in Italia + simili ai vostri).
4. **Ritaglio delle foto di copertina** (riquadro guida, niente tavolo attorno).
5. **Libreria nuova a parete:** misure dei vani, "oggetti" nel catalogo (set Pokémon, pianta, quadretto),
   disposizione vano per vano nello scaffale digitale e PDF stampabile con caselle da spuntare.
6. Più avanti: foto della mensola fatta guardare a Claude, rifinitura per PC.

Rimandati o scartati: Telegram (inutile per ora), tema Giorno (tolto: a Elena piace solo Sera),
due recensioni per lo stesso titolo (ne resta una).

---

## 5. Decisioni e preferenze da rispettare

- **Rispondere sempre in italiano.** Risposte dettagliate; Maurizio spesso scrive da telefono:
  domande a risposta multipla quando servono scelte.
- App leggera, carina ma non pesante; prima di tutto ottimizzata per telefono e iPhone.
- **DR HUB è la produzione dell'Hub di famiglia**: solo tabelle `libreria_`, nessuna modifica all'esistente.
  Ogni nuova modifica al database va confermata da Maurizio con un sì esplicito.
- Segreti (chiave Google, chiave Anthropic, password): mai in chat, mai nel repository pubblico.
- Copertina fissa per sempre: il libro è un oggetto fisico.
- Anno = quello dell'edizione posseduta; editori senza la parola "Editore".
- Stato di lettura senza pagine; "Letto" non mette la data di oggi.
- Disposizione: livello mobile/ripiano; serie e guide sempre unite; il tema vince sul genere;
  libri di Tommaso in un posto loro in basso; ricettari in cucina.
- Prezzi: li recupererà Claude con la parte online, non a mano in blocco.

---

## 6. Come si lavora sul codice

1. Modificare i file; per ogni versione aumentare **tutti e tre**: `APP_VERSION` in `app.js`, i `?v=N` in
   `index.html` e `manifest.webmanifest`, e il numero in `version.json`.
2. Provare nel browser (Claude usa Playwright con Chrome headless; i cataloghi si simulano).
3. Commit e push su `main`: GitHub Pages pubblica in un paio di minuti, le app si aggiornano da sole.

---

## 7. Prompt per ripartire

> Sto sviluppando con te l'app "Libreria" (repository GitHub `divincenzomaurizio92/libreria`, app su
> https://divincenzomaurizio92.github.io/libreria/, dati su Supabase DR HUB con tabelle `libreria_`).
> Ti allego il file RIPRESA.md con tutto lo stato del progetto: leggilo, clona il repository e riprendiamo
> dal punto 4 ("Cosa manca"). Rispondimi sempre in italiano.
