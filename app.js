/* Libreria di casa — logica dell'app.
   Sezioni del file, nell'ordine:
   1. Dati salvati (per ora sul telefono, in localStorage)
   2. ISBN: controlli e conversioni
   3. Cataloghi online: Google Books e Open Library
   4. Suggerimento del genere
   5. Elenco dei libri
   6. Scheda libro (sempre modificabile)
   7. Scanner del codice a barre
   8. Aggiunta a mano
   9. Impostazioni, backup, esportazione
   10. Avvio
*/
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================= 1. DATI SALVATI ================= */

/* Numero di versione: va aumentato a ogni modifica, qui e nei ?v= di index.html,
   così il telefono scarica i file nuovi invece di usare quelli in memoria. */
const APP_VERSION = 75; // va tenuto uguale al numero in version.json

const STORAGE_KEY = 'libreria.v1';
const DEFAULT_GENRES = [
  'Narrativa', 'Giallo', 'Thriller', 'Romanzo storico', 'Romance', 'Fantasy', 'Fantascienza', 'Horror',
  'Classici', 'Bambini e ragazzi', 'Fumetti', 'Poesia', 'Biografie', 'Saggistica', 'Storia', 'Scienza',
  'Psicologia', 'Crescita personale', 'Medicina e salute', 'Filosofia', 'Religione e spiritualità',
  'Economia', 'Arte', 'Cucina', 'Viaggi',
];

/* Liste desideri: un libro ha il campo "list" vuoto se è in libreria,
   oppure il nome della lista desideri in cui si trova. */
const DEFAULT_WISHLISTS = ['Lista Elena', 'Lista Maurizio', 'Regali', 'Tommaso'];

const DEFAULT_OWNERS = ['Elena', 'Maurizio', 'Tommaso'];

/* places = mobili e librerie di casa. Ogni libro ha "shelf" (il mobile) e "shelfRow" (il ripiano, facoltativo). */
let state = { books: [], genres: [...DEFAULT_GENRES], wishlists: [...DEFAULT_WISHLISTS], owners: [...DEFAULT_OWNERS], places: [] };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.books = Array.isArray(data.books) ? data.books : [];
      state.genres = Array.isArray(data.genres) && data.genres.length ? data.genres : [...DEFAULT_GENRES];
      state.wishlists = Array.isArray(data.wishlists) ? data.wishlists : [...DEFAULT_WISHLISTS];
      state.owners = Array.isArray(data.owners) ? data.owners : [...DEFAULT_OWNERS];
      state.places = Array.isArray(data.places) ? data.places : [];
      // Le posizioni scritte a mano nelle versioni precedenti diventano mobili.
      for (const b of state.books) if (b.shelf && !state.places.includes(b.shelf)) state.places.push(b.shelf);
      // Una volta sola: gli editori salvati dalle prime versioni perdono "Editore", "Edizioni" e simili.
      if (!localStorage.getItem('libreria.pubClean')) {
        let changed = false;
        for (const b of state.books) {
          const clean = cleanPublisher(b.publisher);
          if (b.publisher && clean !== b.publisher) { b.publisher = clean; changed = true; }
        }
        if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        localStorage.setItem('libreria.pubClean', '1');
      }
    }
  } catch (e) {
    console.warn('Lettura dei dati non riuscita', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (typeof scheduleSync === 'function') scheduleSync(); // e poco dopo parte verso la libreria online
    return true;
  } catch (e) {
    toast('Memoria del telefono piena: scarica un backup dalle impostazioni.');
    return false;
  }
}

/* Chiave di Google Books: sta solo su questo telefono, mai nel codice pubblico né nel backup. */
const GKEY = 'libreria.googleKey';
function googleKey() { try { return localStorage.getItem(GKEY) || ''; } catch (e) { return ''; } }
function googleUrl(query) {
  const key = googleKey();
  return 'https://www.googleapis.com/books/v1/volumes?country=IT&' + query + (key ? '&key=' + encodeURIComponent(key) : '');
}

/* Proprietari di un libro: elenco di nomi. I libri salvati prima della versione 9 avevano un solo nome. */
/* Supporto: un libro della libreria può essere cartaceo, su Kindle o tutti e due. Senza indicazione è cartaceo.
   Gli audiolibri (audio: true) stanno in una sezione a parte: non sono in libreria né tra i desideri. */
const MEDIA = { paper: 'Cartaceo', kindle: 'Kindle', audio: 'Audible' };
/* Lo stesso titolo può esistere in più forme insieme. Un libro in libreria senza indicazione è cartaceo.
   Un libro in lista desideri è il cartaceo che si vorrebbe: può comunque essere già su Kindle o ascoltato su Audible. */
const mediaOf = (b) => {
  const m = Array.isArray(b.media) ? Object.keys(MEDIA).filter((k) => b.media.includes(k)) : [];
  return b.list ? m.filter((k) => k !== 'paper') : m.length ? m : ['paper'];
};
const hasPaper = (b) => mediaOf(b).includes('paper');
const isOwned = (b) => !b.list || mediaOf(b).length > 0; // lo si ha in almeno una forma
const MEDIA_ICON = {
  kindle: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9.5 7.5h5M9.5 11h5M9.5 14.5h3"/></svg>',
  audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
};
/* Il simbolo compare solo quando di quel titolo non c'è la copia di carta. */
const mediaBadges = (b) => (hasPaper(b) ? '' : mediaOf(b).map((k) => `<span class="media-badge" title="${MEDIA[k]}" role="img" aria-label="${MEDIA[k]}">${MEDIA_ICON[k]}</span>`).join(''));
/* Stima dello spazio sulla mensola: circa 1 mm ogni 15 pagine più la copertina; senza pagine, un libro medio. */
const spineMm = (b) => (Number(b.pages) > 0 ? Number(b.pages) / 15 + (b.format === 'Copertina rigida' ? 8 : 4) : 22);
const ownersOf = (b) => (Array.isArray(b.owners) ? b.owners : b.owner ? [b.owner] : []);

/* Lettura: nessuna pagina da aggiornare, solo tre stati. Vuoto = non indicato. */
const STATUS = { toread: 'Da leggere', reading: 'In corso', read: 'Letto' };
let stickyStatus = ''; // lo stato scelto resta proposto mentre si scansionano più libri di fila

/* "Letto nel" è un testo libero e facoltativo (un anno, una data): catalogando una libreria intera
   si segnano come letti libri finiti anni fa, e la data di oggi sarebbe falsa.
   Si compila da sola solo quando un libro passa da "In corso" a "Letto": quello è finito davvero adesso. */
const todayIt = () => new Date().toLocaleDateString('it-IT');
const showRead = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? itDate(v) : v);

/* Storico delle letture: per ogni libro, chi l'ha letto e quando. Si compila da solo:
   «In corso» = inizio oggi, «Letto» = fine oggi. Chi legge è la persona di «Chi usa questo telefono»
   (o l'unica persona del libro). Una rilettura apre una voce nuova. Le date si possono correggere nella scheda.
   b.reads = [{ id, who, start: 'AAAA-MM-GG' | '', end: 'AAAA-MM-GG' | '' }] */
function readerFor(b) {
  const me = typeof pref === 'function' ? pref('libreria.me', '') : '';
  if (me && state.owners.includes(me)) return me;
  const o = ownersOf(b);
  return o.length === 1 ? o[0] : '';
}
function setStatus(b, status, opts = {}) {
  const before = b.status || '';
  b.status = status || '';
  if (b.status === 'read') { if (!b.readAt && before === 'reading') b.readAt = todayIt(); } else b.readAt = '';
  if (b.status === 'reading' && !b.startedAt) b.startedAt = today();
  if (b.status !== 'reading') b.startedAt = b.status === 'read' ? b.startedAt : '';
  if (opts.bulk || before === b.status) return; // in blocco (vecchi libri) niente date inventate
  const who = readerFor(b);
  b.reads = Array.isArray(b.reads) ? b.reads : [];
  const open = b.reads.filter((r) => !r.end && (!who || !r.who || r.who === who)).pop();
  if (b.status === 'reading') {
    if (!open) b.reads.push({ id: newId(), who, start: today(), end: '' });
  } else if (b.status === 'read') {
    if (open) { open.end = today(); if (!open.who) open.who = who; }
    else b.reads.push({ id: newId(), who, start: before === 'reading' && b.startedAt ? b.startedAt : '', end: today() });
    b.readAt = b.readAt || todayIt();
  } else if (open) {
    // Tolto «In corso» senza finirlo: la lettura aperta si toglie (era per sbaglio o è stato lasciato).
    b.reads = b.reads.filter((r) => r !== open);
  }
}
const readsOf = (b) => (Array.isArray(b.reads) ? b.reads : []);
const fmtDay = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const daysBetween = (a, z) => (a && z ? Math.max(1, Math.round((new Date(z) - new Date(a)) / 864e5) + 1) : 0);

const euro = (n) => Number(n).toFixed(2).replace('.', ',') + ' €';

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ================= 2. ISBN ================= */

const cleanIsbn = (s) => String(s || '').toUpperCase().replace(/[^0-9X]/g, '');

function isValidEan13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

function isValidIsbn10(code) {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (code[i] === 'X' ? 10 : Number(code[i])) * (10 - i);
  return sum % 11 === 0;
}

function isbn10to13(code) {
  const base = '978' + code.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}

/* Restituisce l'ISBN a 13 cifre, oppure '' se il testo non è un ISBN valido. */
function toIsbn13(text) {
  const c = cleanIsbn(text);
  if (c.length === 13 && isValidEan13(c) && /^97[89]/.test(c)) return c;
  if (c.length === 10 && isValidIsbn10(c)) return isbn10to13(c);
  return '';
}

/* ================= 3. CATALOGHI ONLINE ================= */

async function getJson(url, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const yearOf = (s) => (String(s || '').match(/\d{4}/) || [''])[0];
const httpsUrl = (u) => (u ? u.replace(/^http:/, 'https:').replace('&edge=curl', '') : '');

function fromGoogleItem(item) {
  const v = (item && item.volumeInfo) || {};
  const ids = v.industryIdentifiers || [];
  const id13 = ids.find((x) => x.type === 'ISBN_13');
  const id10 = ids.find((x) => x.type === 'ISBN_10');
  const img = v.imageLinks || {};
  return {
    isbn: id13 ? id13.identifier : id10 ? toIsbn13(id10.identifier) : '',
    title: v.title || '',
    subtitle: v.subtitle || '',
    authors: (v.authors || []).join(', '),
    publisher: v.publisher || '',
    year: yearOf(v.publishedDate),
    pages: v.pageCount ? String(v.pageCount) : '',
    cover: httpsUrl(img.medium || img.small || img.thumbnail || img.smallThumbnail),
    subjects: v.categories || [],
    description: String(v.description || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim(),
    lang: v.language || '',
    seriesNum: String((v.seriesInfo && v.seriesInfo.bookDisplayNumber) || ''),
    stars: Number(v.averageRating) || 0, // voto medio dei lettori su Google Books, quando c'è
  };
}

async function lookupGoogle(isbn) {
  const data = await getJson(googleUrl('q=isbn:' + isbn));
  if (!data.items || !data.items.length) return null;
  let item = data.items[0];
  const v = item.volumeInfo || {};
  // La scheda completa del volume ha più spesso editore e pagine, e categorie molto più precise
  // (es. "Biography & Autobiography / Personal Memoirs" invece di "Fiction"): si chiede sempre.
  if (item.id) {
    try {
      const key = googleKey();
      const full = await getJson('https://www.googleapis.com/books/v1/volumes/' + encodeURIComponent(item.id) + '?country=IT' + (key ? '&key=' + encodeURIComponent(key) : ''));
      if (full && full.volumeInfo) {
        const f = full.volumeInfo;
        item = { ...item, volumeInfo: { ...v, ...f, categories: [...(v.categories || []), ...(f.categories || [])] } };
      }
    } catch (e) { /* restano i dati dell'elenco */ }
  }
  return fromGoogleItem(item);
}

async function lookupOpenLibrary(isbn) {
  const data = await getJson('https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=ISBN:' + isbn);
  const b = data['ISBN:' + isbn];
  if (!b) return null;
  return {
    isbn,
    title: b.title || '',
    subtitle: b.subtitle || '',
    authors: (b.authors || []).map((a) => a.name).join(', '),
    publisher: (b.publishers || []).map((p) => p.name).join(', '),
    year: yearOf(b.publish_date),
    pages: b.number_of_pages ? String(b.number_of_pages) : '',
    cover: (b.cover && (b.cover.medium || b.cover.large)) || '',
    subjects: (b.subjects || []).map((s) => s.name || s),
  };
}

/* Editori italiani riconoscibili dalle prime cifre dell'ISBN (dopo 978-88).
   Si usa solo se i cataloghi non indicano l'editore. */
const IT_PUBLISHERS = [
  // [prime cifre, editore, nomi e collane che i cataloghi usano per lo stesso editore]
  ['04', 'Mondadori', /mondadori|oscar/i], ['06', 'Einaudi', /einaudi/i], ['07', 'Feltrinelli', /feltrinelli/i],
  ['08', 'Zanichelli', /zanichelli/i], ['09', 'Giunti', /giunti/i], ['11', 'Garzanti', /garzanti/i],
  ['15', 'Il Mulino', /mulino/i], ['17', 'Rizzoli', /rizzoli|bur\b|biblioteca universale/i],
  ['200', 'Sperling & Kupfer', /sperling/i], ['304', 'Longanesi', /longanesi/i], ['389', 'Sellerio', /sellerio/i],
  ['420', 'Laterza', /laterza/i], ['452', 'Bompiani', /bompiani/i], ['459', 'Adelphi', /adelphi/i],
  ['541', 'Newton Compton', /newton/i], ['566', 'Piemme', /piemme/i],
];
function publisherEntry(isbn) {
  if (!/^97888/.test(isbn)) return null;
  const rest = isbn.slice(5);
  return IT_PUBLISHERS.find(([prefix]) => rest.startsWith(prefix)) || null;
}
/* L'editore indicato dall'ISBN è affidabile: le prime cifre sono assegnate all'editore.
   Se il catalogo ne indica uno diverso (capita: schede di audiolibri o dati sbagliati),
   vince quello dell'ISBN. Se il catalogo indica una collana dello stesso editore, resta quella. */
function fixPublisher(isbn, fromCatalog) {
  const entry = publisherEntry(isbn);
  if (!entry) return fromCatalog || '';
  if (fromCatalog && entry[2].test(fromCatalog)) return fromCatalog;
  return entry[1];
}

/* Uniforma il nome dell'editore: "Giunti Editore" -> "Giunti", "Editori Laterza" -> "Laterza". */
function cleanPublisher(name) {
  const cleaned = String(name || '')
    .replace(/\b(casa editrice|editore|editori|edizioni|editrice)\b/gi, ' ')
    .replace(/\b(s\.?p\.?a\.?|s\.?r\.?l\.?)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '');
  return cleaned || String(name || '').trim();
}

/* Guide di viaggio: non hanno un autore persona, quindi si propone il nome della collana. */
const GUIDE_BRANDS = ['Lonely Planet', 'Touring Club Italiano', 'Touring', 'Routard', 'Michelin', 'Rough Guides', 'Marco Polo', 'National Geographic', 'Baedeker', 'Dumont'];
function guideAuthor(book) {
  const text = (book.publisher + ' | ' + book.title).toLowerCase();
  const brand = GUIDE_BRANDS.find((g) => text.includes(g.toLowerCase()));
  if (brand) return brand;
  // In Italia le Lonely Planet escono con l'editore EDT.
  if (/^edt\b/i.test(book.publisher) && /travel|viagg/i.test((book.subjects || []).join(' '))) return 'Lonely Planet';
  return '';
}

/* Interroga i due cataloghi insieme e unisce i risultati:
   per ogni campo vale il primo catalogo che lo ha. */
async function lookupIsbn(isbn) {
  const results = await Promise.allSettled([lookupGoogle(isbn), lookupOpenLibrary(isbn)]);
  const found = results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
  const failed = results.every((r) => r.status === 'rejected');
  const googleDown = results[0].status === 'rejected';
  if (!found.length) return { data: null, failed, googleDown };
  const merged = { isbn, title: '', subtitle: '', authors: '', publisher: '', year: '', pages: '', cover: '', subjects: [], description: '', seriesNum: '', lang: '' };
  for (const f of found) {
    for (const k of ['title', 'subtitle', 'authors', 'publisher', 'year', 'pages', 'cover', 'seriesNum', 'lang']) if (!merged[k] && f[k]) merged[k] = f[k];
    merged.subjects.push(...(f.subjects || []));
    if (!merged.description && f.description) merged.description = f.description;
  }
  merged.publisher = cleanPublisher(fixPublisher(isbn, merged.publisher));
  // Numero del volume scritto nel titolo ("Vol. 2", "Libro 3"), se il catalogo non lo indica.
  if (!merged.seriesNum) {
    const m = (merged.title + ' ' + merged.subtitle).match(/\b(?:vol(?:ume)?\.?|libro|parte)\s*(\d{1,3})\b/i);
    if (m) merged.seriesNum = m[1];
  }
  if (!merged.authors) merged.authors = guideAuthor(merged);
  return { data: merged, failed: false };
}

async function searchByText(text) {
  const data = await getJson(googleUrl('maxResults=12&q=' + encodeURIComponent(text)));
  return (data.items || []).map(fromGoogleItem).filter((b) => b.title).map((b) => ({ ...b, publisher: cleanPublisher(b.publisher) }));
}

/* Copertina di riserva da Open Library: si prova solo se manca. */
function probeCover(isbn) {
  return new Promise((resolve) => {
    if (!isbn) return resolve('');
    const url = 'https://covers.openlibrary.org/b/isbn/' + isbn + '-M.jpg?default=false';
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 10 ? url : '');
    img.onerror = () => resolve('');
    img.src = url;
  });
}

/* Copertina per un libro proposto (dal Bibliotecario o da una classifica): si provano tre strade, dalla più precisa.
   1) ISBN su Open Library; 2) titolo e autore su Google Books; 3) titolo e autore su Open Library.
   Torna { cover, isbn } (l'ISBN se trovato strada facendo). */
async function findCover(title, author, isbn) {
  // Amazon scrive titoli lunghi («Titolo. Sottotitolo: edizione speciale»): per cercare basta la parte principale.
  title = String(title || '').split(/\s*[:(–—]\s*|\s+-\s+/)[0].trim() || title;
  const t = norm(title || '');
  const sameTitle = (x) => { const n = norm(x || ''); return n && t && (n.startsWith(t) || t.startsWith(n)); };
  if (isbn) { const c = await probeCover(isbn); if (c) return { cover: c, isbn }; }
  try {
    const q = 'intitle:' + JSON.stringify(title) + (author ? ' inauthor:' + JSON.stringify(firstAuthor(author)) : '');
    const data = await getJson(googleUrl('maxResults=10&q=' + encodeURIComponent(q)));
    const hits = (data.items || []).map(fromGoogleItem).filter((b) => sameTitle(b.title));
    const stars = (hits.find((b) => b.stars) || {}).stars || 0;
    const withCover = hits.find((b) => b.cover);
    if (withCover) return { cover: httpsUrl(withCover.cover), isbn: isbn || withCover.isbn || '', stars };
    for (const h of hits.slice(0, 3)) if (h.isbn) { const c = await probeCover(h.isbn); if (c) return { cover: c, isbn: isbn || h.isbn }; }
  } catch (e) { /* si prova con Open Library */ }
  try {
    const data = await getJson('https://openlibrary.org/search.json?limit=5&fields=title,cover_i,isbn&title=' + encodeURIComponent(title) + (author ? '&author=' + encodeURIComponent(firstAuthor(author)) : ''));
    const d = (data.docs || []).find((x) => x.cover_i && sameTitle(x.title));
    if (d) return { cover: 'https://covers.openlibrary.org/b/id/' + d.cover_i + '-M.jpg', isbn: isbn || ((d.isbn || []).map(toIsbn13).find(Boolean) || '') };
  } catch (e) { /* niente */ }
  return { cover: '', isbn: isbn || '' };
}

function storeLinks(book) {
  const q = encodeURIComponent(book.isbn || [book.title, book.authors].filter(Boolean).join(' '));
  if (!q) return [];
  return [
    ['Amazon', 'https://www.amazon.it/s?i=stripbooks&k=' + q],
    ['IBS', 'https://www.ibs.it/search/?ts=as&query=' + q],
    ['Feltrinelli', 'https://www.lafeltrinelli.it/search/?ts=as&query=' + q],
    ['Mondadori', 'https://www.mondadoristore.it/search?query=' + q],
  ];
}

/* ================= 4. SUGGERIMENTO DEL GENERE ================= */

/* Dalle categorie dei cataloghi (quasi sempre in inglese) ai generi della lista.
   L'ordine conta: prima i generi più specifici. */
const GENRE_RULES = [
  [/thriller|suspense/, 'Thriller'],
  [/mystery|detective|crime|giall|polizies/, 'Giallo'],
  [/historical fiction|romanzo storico/, 'Romanzo storico'],
  [/science fiction|fantascienza/, 'Fantascienza'],
  [/fantasy/, 'Fantasy'],
  [/horror/, 'Horror'],
  [/romance|love stor/, 'Romance'],
  [/juvenile|children|young adult|ragazzi|bambini|infanzia/, 'Bambini e ragazzi'],
  [/comics|graphic novel|manga|fumett/, 'Fumetti'],
  [/poetry|poesia/, 'Poesia'],
  [/biograph|memoir|biograf/, 'Biografie'],
  [/cooking|cookbook|cucina|ricette/, 'Cucina'],
  [/travel|viagg/, 'Viaggi'],
  [/psycholog|psicolog/, 'Psicologia'],
  [/self-help|personal growth|crescita personale/, 'Crescita personale'],
  [/medical|medicine|health|nursing|medicina|salute/, 'Medicina e salute'],
  [/business|econom|finance|finanza/, 'Economia'],
  [/philosoph|filosof/, 'Filosofia'],
  [/religion|spiritual|religione/, 'Religione e spiritualità'],
  [/\bhistory\b|\bstoria\b/, 'Storia'],
  [/\bscience\b|mathematic|nature|scienz/, 'Scienza'],
  [/\bart\b|photograph|architecture|music|\barte\b/, 'Arte'],
  [/classics|classici/, 'Classici'],
  [/social science|political|essays|saggi/, 'Saggistica'],
  [/fiction|narrativa|romanzo|literary/, 'Narrativa'],
];

/* Parole della trama che indicano un genere in modo esplicito.
   Si usano solo se le categorie del catalogo non dicono nulla di più preciso di "Narrativa". */
const PLOT_RULES = [
  [/\bthriller\b/, 'Thriller'],
  [/\bgiallo\b|\bnoir\b|\bpoliziesco\b/, 'Giallo'],
  [/\bmemoir\b|autobiograf|\bbiografia\b/, 'Biografie'],
  [/romanzo storico/, 'Romanzo storico'],
  [/\bfantasy\b/, 'Fantasy'],
  [/fantascienza|distopi/, 'Fantascienza'],
  [/\bhorror\b/, 'Horror'],
  [/graphic novel|\bfumetto\b/, 'Fumetti'],
  [/\bsaggio\b/, 'Saggistica'],
];

function suggestGenres(subjects, authors, description) {
  // 1. Le scelte già fatte per lo stesso autore valgono più dei cataloghi.
  const first = firstAuthor(authors).toLowerCase();
  if (first) {
    const same = state.books.filter((b) => firstAuthor(b.authors).toLowerCase() === first && b.genres && b.genres.length);
    if (same.length) {
      same.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return { genres: same[0].genres.filter((g) => state.genres.includes(g)), source: 'author' };
    }
  }
  // 2. Altrimenti si traducono le categorie dei cataloghi.
  // Ogni categoria si valuta da sola. In una categoria di narrativa ("Fiction / Thrillers / Psychological")
  // contano solo i generi narrativi: "Psychological" lì non significa Psicologia.
  const FICTION = ['Thriller', 'Giallo', 'Romanzo storico', 'Fantascienza', 'Fantasy', 'Horror', 'Romance', 'Bambini e ragazzi', 'Fumetti', 'Classici', 'Narrativa'];
  let hits = [];
  for (const subject of subjects || []) {
    const text = String(subject).toLowerCase();
    const isFiction = /^(juvenile |young adult )?fiction\b/.test(text);
    for (const [re, genre] of GENRE_RULES) {
      if (!re.test(text) || !state.genres.includes(genre) || hits.includes(genre)) continue;
      if (isFiction && !FICTION.includes(genre)) continue;
      hits.push(genre);
    }
  }
  if (hits.length > 1) hits = hits.filter((g) => g !== 'Narrativa');
  if (!hits.length || (hits.length === 1 && hits[0] === 'Narrativa')) {
    const plot = String(description || '').toLowerCase();
    const fromPlot = PLOT_RULES.filter(([re, genre]) => re.test(plot) && state.genres.includes(genre)).map((r) => r[1]);
    if (fromPlot.length) hits = fromPlot;
  }
  return { genres: hits.slice(0, 2), source: hits.length ? 'catalog' : '' };
}

const firstAuthor = (authors) => String(authors || '').split(',')[0].trim();

/* ================= ASPETTO: tema, viste, colori ================= */

function pref(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; } }
function setPref(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* si resta sul valore in memoria */ } }

let viewKind = pref('libreria.view', 'grid');      // 'grid' copertine, 'list' lista, 'shelf' scaffale
let flatView = pref('libreria.flatView', 'grid');   // la vista a cui si torna uscendo dallo scaffale
let shelfSort = pref('libreria.shelfSort', 'room'); // 'genre', 'room', 'owner'
let gridZoom = Number(pref('libreria.zoom', '1')) || 1; // 1 copertine grandi, 2 medie, 3 piccole
let lastAddedId = '';

const VIEWS = {
  grid: ['Copertine', '<rect x="4" y="4" width="6" height="7"/><rect x="14" y="4" width="6" height="7"/><rect x="4" y="14" width="6" height="7"/><rect x="14" y="14" width="6" height="7"/>', 'Le copertine una accanto all\'altra'],
  list: ['Lista', '<path d="M4 6h16M4 12h16M4 18h16"/>', 'Un libro per riga, con tutti i dettagli'],
  shelf: ['Scaffale', '<path d="M5 4v14M9 6v12M13 4v14M17 8v10M3 20h18"/>', 'I dorsi sulle mensole, come in casa'],
};

function setZoom(z) {
  gridZoom = Math.max(1, Math.min(3, z));
  setPref('libreria.zoom', String(gridZoom));
  for (const b of document.querySelectorAll('[data-zoom]')) b.classList.toggle('on', Number(b.dataset.zoom) === gridZoom);
  renderList();
}

function applyTheme(theme) {
  const t = theme === 'day' ? 'day' : 'night';
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'day' ? '#EADBAA' : '#1F1712';
  for (const b of document.querySelectorAll('[data-theme-set]')) b.classList.toggle('on', b.dataset.themeSet === t);
}

/* Colore di un libro: quello letto dalla copertina, altrimenti uno fisso scelto in base al titolo. */
const SPINE_COLORS = ['#7A2E2B', '#1F3A4D', '#5E7A64', '#B5533C', '#D9A441', '#C9B79C', '#3F4A6B', '#6B3F5B', '#2F5D50', '#8A6A48', '#A8763E', '#4A4038'];
function hashOf(text) { let h = 0; for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function bookColor(b) { return b.color || SPINE_COLORS[hashOf(b.title || b.isbn || '') % SPINE_COLORS.length]; }
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#1E1A14' : '#FFF8EC';
}

/* Legge il colore dominante di una copertina. Con le immagini di altri siti il browser
   può vietarlo: in quel caso restituisce '' e si usa il colore scelto dal titolo. */
function extractColor(src) {
  return new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 24; c.height = 36;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 24, 36);
        const d = ctx.getImageData(0, 0, 24, 36).data;
        let R = 0, G = 0, B = 0, W = 0;
        for (let i = 0; i < d.length; i += 4) {
          // I pixel più colorati pesano di più di bianchi, grigi e neri.
          const w = (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255 + 0.08;
          R += d[i] * w; G += d[i + 1] * w; B += d[i + 2] * w; W += w;
        }
        resolve('#' + [R, G, B].map((v) => Math.round(v / W).toString(16).padStart(2, '0')).join(''));
      } catch (e) { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}
const coverKey = (b) => (b.cover ? b.cover.length + ':' + b.cover.slice(-24) : '');

/* Calcola una volta sola il colore dei libri che non l'hanno ancora. */
async function refreshColors() {
  let changed = false;
  for (const b of state.books) {
    const key = coverKey(b);
    if ((b.colorFor || '') === key) continue;
    b.color = key ? await extractColor(b.cover) : '';
    b.colorFor = key;
    changed = true;
  }
  if (changed) { saveState(); renderList(); }
}

function tintBook(color) {
  for (const id of ['book', 'view']) {
    $(id).style.setProperty('--book', color);
    $(id).style.setProperty('--book-ink', inkOn(color));
  }
}

/* ================= 5. ELENCO DEI LIBRI ================= */

let filterGenre = ''; // uno o più filtri uniti da "|", al massimo uno per tipo: "owner:Elena|genre:Giallo"
const filterParts = () => (filterGenre ? filterGenre.split('|') : []);
const filterKind = (v) => (v === 'loan' ? 'loan' : v.slice(0, v.indexOf(':')));
function toggleFilter(v) {
  const parts = filterParts();
  filterGenre = (parts.includes(v) ? parts.filter((p) => p !== v) : [...parts.filter((p) => filterKind(p) !== filterKind(v)), v]).join('|');
}
let viewMode = 'home'; // 'home' = pagina iniziale, 'library' = libri posseduti, 'wish' = liste desideri, 'audio', 'discover' = Scopri
let filterList = '';
let claims = {}; // libri dei desideri prenotati da chi ha il link della lista: id libro → { name, id }
// Il nome di chi regala resta nascosto (sorpresa!) finché non si tocca «Mostra»: vale fino alla chiusura dell'app.
let claimsShown = false;
const claimRevealed = new Set();
const claimName = (id) => (claimsShown || claimRevealed.has(id) ? claims[id].name : '');

/* Copertina piccola. Senza immagine (o se non si carica) compare un segnaposto colorato con titolo e autore. */
const phInner = (b) => `<span class="ph-title">${esc(b.title || 'Senza titolo')}</span><span class="ph-rule"></span><span class="ph-author">${esc(firstAuthor(b.authors))}</span>`;
function coverHtml(book, big) {
  if (!book.cover) return phCoverHtml(book, big);
  const initial = esc((book.title || '?').trim().charAt(0).toUpperCase() || '?');
  return `<div class="cover${big ? ' big' : ''}"><img src="${esc(book.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}" data-ph="${esc(phInner(book))}" data-color="${esc(bookColor(book))}"></div>`;
}
function phCoverHtml(book, big) {
  const c = bookColor(book);
  return `<div class="cover ph-cover${big ? ' big' : ''}" style="background:${c};color:${inkOn(c)}">${phInner(book)}</div>`;
}

function isIncomplete(b) {
  return !b.authors || !b.publisher || !b.pages || !b.year || !(b.genres && b.genres.length);
}

function bookRowHtml(b, attr) {
  const series = b.series ? b.series + (b.seriesNum ? ' n. ' + b.seriesNum : '') : '';
  const meta = [b.publisher, b.year, b.pages ? b.pages + ' pag.' : '', series, b.rating ? starsStr(b.rating) : '', b.list && Number(b.price) > 0 ? euro(b.price) : ''].filter(Boolean).join(' · ');
  const tags = (b.status === 'reading' ? '<span class="tag reading">In corso</span>' : b.status === 'toread' ? '<span class="tag">Da leggere</span>' : '')
    + (b.loanTo ? `<span class="tag loan">Prestato a ${esc(b.loanTo)}</span>` : '')
    + (b.list ? `<span class="tag wish">${esc(b.list)}</span>` : '')
    + (b.list && claims[b.id] ? `<span class="tag claim">🎁 ${claimName(b.id) ? 'Lo prende ' + esc(claimName(b.id)) : 'Già preso'}</span>` : '')
    + ownersOf(b).map((o) => `<span class="tag">${esc(o)}</span>`).join('')
    + (b.genres || []).map((g) => `<span class="tag">${esc(g)}</span>`).join('');
  return `<button class="book" ${attr}>
    ${coverHtml(b)}
    <span class="book-info">
      <span class="book-title">${esc(b.title || 'Senza titolo')}</span>
      ${b.authors ? `<span class="book-author">${esc(b.authors)}</span>` : ''}
      ${meta ? `<span class="book-meta">${esc(meta)}</span>` : ''}
      ${tags ? `<span class="book-tags">${tags}</span>` : ''}
      ${b.id && isOwned(b) && isIncomplete(b) ? '<span class="missing-dot">Dati da completare</span>' : ''}
    </span>
  </button>`;
}

function withGaps(books) {
  const nums = books.map(seriesNumOf).filter(Boolean);
  if (nums.length < 2) return books;
  const max = Math.max(...nums), have = new Set(nums), out = [];
  let i = 0;
  const sorted = [...books];
  for (let n = 1; n <= max; n++) {
    while (i < sorted.length && (seriesNumOf(sorted[i]) || 999) <= n) out.push(sorted[i++]);
    if (!have.has(n)) out.push({ ghost: true, num: n });
  }
  return out.concat(sorted.slice(i));
}

function gridCellHtml(b) {
  if (b.ghost) return `<div class="cell ghost-cell" aria-label="Manca il numero ${b.num}"><span class="cell-cover"><span class="ghost-num">${b.num}</span><span class="ghost-txt">Manca</span></span></div>`;
  if (b.more) return `<button class="cell more-cell" data-more="${esc(b.more)}"><span class="cell-cover"><span class="ghost-num">+${b.count}</span><span class="ghost-txt">Vedi tutti</span></span></button>`;
  const color = bookColor(b);
  const initial = esc((b.title || '?').trim().charAt(0).toUpperCase() || '?');
  const inner = b.cover
    ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}">`
    : `<span class="ph-title">${esc(b.title || 'Senza titolo')}</span><span class="ph-rule"></span><span class="ph-author">${esc(firstAuthor(b.authors))}</span>`;
  return `<button class="cell${b.id === lastAddedId ? ' new' : ''}${selecting && selected.has(b.id) ? ' sel' : ''}" data-id="${esc(b.id)}">
    <span class="cell-cover" style="background:${color};color:${inkOn(color)}">${inner}${b.status === 'reading' ? '<span class="badge">In corso</span>' : ''}${b.loanTo ? '<span class="badge loan-badge">In prestito</span>' : ''}${b.list && claims[b.id] ? `<span class="badge claim-badge">🎁 ${esc(claimName(b.id) || 'Preso')}</span>` : ''}${Number(b.rating) > 0 ? `<span class="rating-badge" role="img" aria-label="Voto ${fmtRating(b.rating)} su 5"><b>★</b>${fmtRating(b.rating)}</span>` : ''}${mediaBadges(b) ? `<span class="media-badges">${mediaBadges(b)}</span>` : ''}</span>
    <span class="cell-title">${esc(b.title || 'Senza titolo')}</span>
    ${b.list && Number(b.price) > 0 ? `<span class="cell-price">${euro(b.price)}</span>` : ''}
  </button>`;
}

function spineHtml(b) {
  const color = bookColor(b);
  const width = Math.max(26, Math.min(64, 18 + Math.round((Number(b.pages) || 200) / 9)));
  const height = 172 + (hashOf(b.title || '') % 44);
  return `<button class="spine" data-id="${esc(b.id)}" aria-label="${esc(b.title || 'Senza titolo')}" style="width:${width}px;height:${height}px;background:${color};color:${inkOn(color)}"><span>${esc(b.title || 'Senza titolo')}</span></button>`;
}

/* Scaffale: una mensola per genere, per stanza o per persona. Nei desideri, una per lista. */
function groupBooks(books, by) {
  const empty = by === 'owner' ? 'Di casa' : 'Senza genere';
  const groups = new Map();
  for (const b of books) {
    const keys = by === 'owner' ? (ownersOf(b).length ? ownersOf(b) : [empty]) : [(b.genres || [])[0] || empty];
    for (const k of keys) groups.set(k, [...(groups.get(k) || []), b]);
  }
  // Dal gruppo con più titoli a quello con meno; i gruppi vuoti non esistono proprio.
  return [...groups].sort((a, b) => (a[0] === empty) - (b[0] === empty) || b[1].length - a[1].length || a[0].localeCompare(b[0], 'it'));
}

/* Le mensole dello Scaffale: per stanza, genere o persona. Le usa anche «Tutti i libri» in home. */
function shelfGroups(books, mode, wish) {
  const empty = wish ? '' : mode === 'room' ? 'Senza posto' : mode === 'owner' ? 'Di casa' : 'Senza genere';
  const keysOf = (b) => {
    if (wish) return [b.list];
    if (mode === 'room') return [b.shelf ? b.shelf + (b.shelfRow ? ' · ripiano ' + b.shelfRow : '') : empty];
    if (mode === 'owner') return ownersOf(b).length ? ownersOf(b) : [empty];
    return [(b.genres || [])[0] || empty];
  };
  const groups = new Map();
  for (const b of books) for (const k of keysOf(b)) groups.set(k, [...(groups.get(k) || []), b]);
  // Prima le mensole con più libri. I ripiani dello stesso mobile restano vicini, in ordine;
  // la mensola dei libri senza genere, posto o proprietario va sempre in fondo.
  const base = (label) => label.split(' · ripiano ')[0];
  const total = {};
  for (const [label, items] of groups) total[base(label)] = (total[base(label)] || 0) + items.length;
  const labels = [...groups.keys()].sort((a, b) => (a === empty) - (b === empty)
    || total[base(b)] - total[base(a)]
    || base(a).localeCompare(base(b), 'it')
    || a.localeCompare(b, 'it', { numeric: true }));
  return labels.map((label) => [label, groups.get(label), label === empty]);
}

function shelvesHtml(books, wish, forced) {
  const groups = new Map(shelfGroups(books, forced || shelfSort, wish).map(([l, items]) => [l, items]));
  const labels = [...groups.keys()];
  return labels.map((label) => `<section>
    <h3 class="shelf-label">${esc(label)} · ${groups.get(label).length}</h3>
    <div class="shelf-unit">
      <div class="shelf-row">${groups.get(label).map(spineHtml).join('')}</div>
      <div class="plank"></div>
    </div>
  </section>`).join('');
}

let filterGroups = [];

function renderFilterSheet() {
  const q = $('filter-q').value.trim().toLowerCase();
  const html = filterGroups.map(([title, items]) => {
    const shown = items.filter(([, label]) => !q || label.toLowerCase().includes(q));
    if (!shown.length) return '';
    return `<p class="view-label">${title}</p><div class="chips">${shown.map(([v, label, n]) =>
      `<button class="chip${filterParts().includes(v) ? ' on' : ''}" data-filter="${esc(v)}" aria-pressed="${filterParts().includes(v)}">${esc(label)} <small>${n}</small></button>`).join('')}</div>`;
  }).join('');
  $('filter-body').innerHTML = html || '<p class="hint">Nessuna voce con questo nome.</p>';
  $('filter-clear').hidden = !filterGenre;
  const n = state.books.filter((b) => isOwned(b) && matchesFilter(b)).length;
  $('filter-done').textContent = filterGenre ? (n === 1 ? 'Vedi 1 libro' : 'Vedi ' + n + ' libri') : 'Vedi tutti i libri';
}

/* Suggerimento di disposizione: solo gruppi che stanno bene insieme, in ordine di precedenza.
   Regole scelte dalla famiglia: i libri di Tommaso in un posto loro; i ricettari in cucina;
   i "da leggere" a portata di mano; serie numerate e guide di viaggio sempre unite;
   per tutto il resto vince il genere e, dentro il genere, le collane stanno vicine. */
function arrangeGroups() {
  const rest = new Set(state.books.filter(hasPaper));
  const groups = [];
  const text = (v) => String(v || '');
  const cmp = (...keys) => (a, b) => { for (const k of keys) { const r = text(a[k]).localeCompare(text(b[k]), 'it', { numeric: true, sensitivity: 'base' }); if (r) return r; } return 0; };
  const take = (title, hint, test, sort) => {
    const items = [...rest].filter(test);
    if (!items.length) return;
    items.forEach((b) => rest.delete(b));
    groups.push({ title, hint: typeof hint === 'function' ? hint(items) : hint, items: items.sort(sort) });
  };
  take('Libri di Tommaso', 'Un posto tutto loro, in basso, alla sua altezza.', (b) => ownersOf(b).length === 1 && ownersOf(b)[0] === 'Tommaso', cmp('title'));
  take('Ricettari', 'Restano in cucina.', (b) => (b.genres || []).includes('Cucina'), cmp('authors', 'title'));
  take('Da leggere', 'A portata di mano, dove li vedete ogni giorno.', (b) => b.status === 'toread', cmp('authors', 'title'));
  for (const name of [...new Set([...rest].map((b) => b.series).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'))) {
    take('Serie: ' + name, 'In fila per numero. Lasciate un po\' di spazio accanto per i prossimi volumi.', (b) => b.series === name, cmp('seriesNum', 'title'));
  }
  // Il tema taglia i generi: tutto il Giappone insieme, che sia narrativa, giallo o saggio.
  for (const name of [...new Set([...rest].map((b) => b.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'))) {
    take('Tema: ' + name, 'Tutti insieme, anche se di generi diversi. Dentro il tema, per genere e autore.', (b) => b.theme === name, (a, b) => text((a.genres || [])[0]).localeCompare(text((b.genres || [])[0]), 'it') || cmp('authors', 'title')(a, b));
  }
  take('Guide di viaggio', 'Tutte in fila: i dorsi uguali fanno arredamento.',
    (b) => (b.genres || []).includes('Viaggi') || GUIDE_BRANDS.some((g) => text(b.authors).toLowerCase().includes(g.toLowerCase())), cmp('authors', 'title'));
  // Dentro un genere si ordina per editore, così le collane (Adelphi, Einaudi…) finiscono vicine.
  const collane = (items) => {
    const count = {};
    for (const b of items) if (b.publisher) count[b.publisher] = (count[b.publisher] || 0) + 1;
    const near = Object.entries(count).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([p, n]) => n + ' ' + p);
    return near.length ? 'Vicini tra loro: ' + near.join(', ') + '.' : 'Ordinati per editore e autore.';
  };
  for (const g of state.genres) take(g, collane, (b) => (b.genres || [])[0] === g, cmp('publisher', 'authors', 'title'));
  take('Senza genere', 'Assegnate un genere per sistemarli meglio.', () => true, cmp('publisher', 'authors', 'title'));
  return groups;
}

function renderArrange() {
  const groups = arrangeGroups();
  const paper = state.books.filter(hasPaper);
  const metres = paper.reduce((sum, b) => sum + spineMm(b), 0) / 1000;
  const guessed = paper.filter((b) => !(Number(b.pages) > 0)).length;
  $('arrange-metres').textContent = paper.length
    ? 'I ' + paper.length + ' libri di carta occupano circa ' + (metres < 1 ? Math.round(metres * 100) + ' centimetri' : metres.toFixed(1).replace('.', ',') + ' metri') + ' di mensola (stima dalle pagine'
      + (guessed ? '; per ' + guessed + ' senza pagine ho contato un libro medio' : '') + ').'
    : '';
  $('arrange-body').innerHTML = groups.map((g) => `<section class="arr">
    <h3>${esc(g.title)}<small>${g.items.length === 1 ? '1 libro' : g.items.length + ' libri'}</small></h3>
    <p class="hint">${esc(g.hint)}</p>
    <div class="shelf-unit"><div class="shelf-row">${g.items.map(spineHtml).join('')}</div><div class="plank"></div></div>
    <details><summary>Elenco in ordine</summary><ol>${g.items.map((b) => `<li>${esc(b.title || 'Senza titolo')}${b.seriesNum ? ' (n. ' + esc(b.seriesNum) + ')' : ''}${b.authors ? ' · ' + esc(firstAuthor(b.authors)) : ''}</li>`).join('')}</ol></details>
  </section>`).join('') || '<p class="hint">Aggiungete qualche libro per vedere i suggerimenti.</p>';
}

/* Pagine speciali raggiunte da un tocco: tutti i libri di un autore, i volumi di una serie, i libri da sistemare. */
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const authorsOf = (b) => String(b.authors || '').split(/\s*,\s*/).filter(Boolean);
const seriesNumOf = (b) => Number(b.seriesNum) || Number((String(b.subtitle || '').match(/\b(?:vol(?:ume)?|n|numero|tomo|libro)\.?\s*(\d+)/i) || [])[1]) || 0;
const TODO = {
  owner: ['Senza persona', (b) => !ownersOf(b).length],
  genre: ['Senza genere', (b) => !(b.genres || []).length],
  rating: ['Letti senza voto', (b) => b.status === 'read' && !Number(b.rating)],
  place: ['Senza mobile', (b) => hasPaper(b) && !b.shelf],
  series: ['Serie da completare', (b) => seriesSuggestions().has(b.id)],
  dup: ['Possibili doppioni', (b) => duplicateIds().has(b.id)],
};
/* Libri con lo stesso titolo (accenti a parte) e un numero di volume, ma senza serie impostata: si propone la serie. */
function seriesSuggestions() {
  const groups = new Map();
  for (const b of state.books.filter(isOwned)) {
    const k = norm(b.title);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const out = new Map();
  for (const items of groups.values()) {
    if (items.length < 2 || !items.some((b) => !b.series || !b.seriesNum)) continue;
    const name = items.find((b) => b.series)?.series || items[0].title;
    for (const b of items) if (!b.series || !b.seriesNum) out.set(b.id, { series: name, num: seriesNumOf(b) });
  }
  return out;
}
/* Stesso ISBN, oppure stesso titolo, sottotitolo e autore: probabilmente lo stesso libro inserito due volte. */
function duplicateIds() {
  const seen = new Map(), dup = new Set();
  for (const b of state.books.filter(isOwned)) {
    for (const k of [b.isbn ? 'i' + b.isbn : '', 't' + norm(b.title) + '|' + norm(b.subtitle) + '|' + norm(b.authors)]) {
      if (!k || k === 't||') continue;
      if (seen.has(k)) { dup.add(b.id); dup.add(seen.get(k)); } else seen.set(k, b.id);
    }
  }
  return dup;
}
const specialLabel = (f) => (f.startsWith('author:') ? 'Libri di ' + f.slice(7) : f.startsWith('series:') ? 'Serie: ' + f.slice(7) : f.startsWith('todo:') ? (TODO[f.slice(5)] || ['Da sistemare'])[0] : f);

function matchesOne(b, f) {
  if (f === 'loan') return Boolean(b.loanTo);
  if (f.startsWith('author:')) return authorsOf(b).includes(f.slice(7));
  if (f.startsWith('series:')) return (b.series || '') === f.slice(7);
  if (f.startsWith('todo:')) return TODO[f.slice(5)] ? TODO[f.slice(5)][1](b) : false;
  if (f.startsWith('media:')) return mediaOf(b).includes(f.slice(6));
  if (f.startsWith('theme:')) return (b.theme || '') === f.slice(6);
  if (f.startsWith('owner:')) return ownersOf(b).includes(f.slice(6));
  if (f.startsWith('status:')) return (b.status || '') === f.slice(7);
  if (f.startsWith('place:')) return b.shelf === f.slice(6);
  return (b.genres || []).includes(f.slice(6));
}
function matchesFilter(b) { return filterParts().every((f) => matchesOne(b, f)); }

/* Quante copertine stanno in una riga, con la grandezza scelta: serve a mettere ogni riga sulla sua mensola. */
/* Selezione di più libri: si accende con «Seleziona», si toccano le copertine, poi «Modifica». */
let selecting = false;
let selected = new Set();
function setSelecting(on) {
  selecting = on;
  selected = new Set();
  document.body.classList.toggle('selecting', on);
  renderSelectBar();
  renderList();
}
function renderSelectBar() {
  $('select-bar').hidden = !selecting;
  $('select-count').textContent = selected.size === 1 ? '1 selezionato' : selected.size + ' selezionati';
  $('select-edit').disabled = !selected.size;
  $('btn-select').classList.toggle('on', selecting);
}
const selectedBooks = () => state.books.filter((b) => selected.has(b.id));
function renderBulk() {
  const books = selectedBooks();
  const all = (test) => books.length > 0 && books.every(test);
  $('bulk-title').textContent = books.length === 1 ? 'Modifica 1 libro' : 'Modifica ' + books.length + ' libri';
  $('bulk-owners').innerHTML = state.owners.map((o) => `<button type="button" class="chip${all((b) => ownersOf(b).includes(o)) ? ' on' : ''}" data-owner="${esc(o)}">${esc(o)}</button>`).join('');
  $('bulk-places').innerHTML = state.places.length ? state.places.map((p) => `<button type="button" class="chip${all((b) => b.shelf === p) ? ' on' : ''}" data-place="${esc(p)}">${esc(p)}</button>`).join('') : '<p class="hint">Nessun mobile: si creano dalle Impostazioni.</p>';
  $('bulk-status').innerHTML = Object.keys(STATUS).map((k) => `<button type="button" data-status="${k}" class="${all((b) => b.status === k) ? 'on' : ''}">${STATUS[k]}</button>`).join('');
  $('bulk-genres').innerHTML = state.genres.map((g) => `<button type="button" class="chip${all((b) => (b.genres || []).includes(g)) ? ' on' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('');
  $('theme-options-bulk').innerHTML = [...new Set(state.books.map((b) => b.theme).filter(Boolean))].map((t) => `<option value="${esc(t)}">`).join('');
  $('series-options-bulk').innerHTML = [...new Set(state.books.map((b) => b.series).filter(Boolean))].map((t) => `<option value="${esc(t)}">`).join('');
}
function bulkApply(change) {
  for (const b of selectedBooks()) { change(b); b.updatedAt = Date.now(); }
  saveState();
  renderBulk();
  renderList();
}

function gridCols() {
  const list = $('list');
  const cs = getComputedStyle(list);
  const w = list.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 12;
  const land = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
  const min = [land ? 96 : 98, 74, 58][gridZoom - 1];
  const gap = [14, 12, 10][gridZoom - 1];
  return Math.max(2, Math.floor((w + gap) / (min + gap)));
}

function shelfRowsHtml(books) {
  const cols = gridCols();
  let html = '';
  for (let i = 0; i < books.length; i += cols) {
    html += `<div class="shelf-line"><div class="shelf-books" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${books.slice(i, i + cols).map(gridCellHtml).join('')}</div><div class="plank"></div></div>`;
  }
  return html;
}

/* In cima alla libreria, senza filtri: file da scorrere di lato con i libri del momento. */
/* Le sezioni in cima alla libreria, uguali nelle copertine e nella lista:
   Sul comodino (i libri in corso, sempre presente) e Da leggere (solo se ce ne sono). */
function homeSections(owned) {
  const byAdded = (a, b) => (b.addedAt || 0) - (a.addedAt || 0);
  // Con un filtro attivo le sezioni vuote spariscono; senza filtri «Sul comodino» resta sempre, come invito.
  return [
    ['Sul comodino', owned.filter((b) => b.status === 'reading').sort(byAdded), filterGenre ? '' : 'Nessun libro in corso. Apri un libro e tocca «In corso»: lo troverai qui.'],
    ['Da leggere', owned.filter((b) => b.status === 'toread').sort(byAdded), ''],
  ].filter(([, items, empty]) => items.length || empty);
}
/* «Tutti i libri» diviso come lo Scaffale (stanza, genere o persona), con la scelta a destra del titolo.
   Se il filtro attivo è già su quel criterio (es. una persona e «Persona»), si divide per il criterio successivo. */
let homeOrder = null;
let homeSplit = pref('libreria.homeSplit', ''); // '' = tutti insieme, come prima; altrimenti 'room', 'genre' o 'owner'
function homeGroupsHtml(books, asGrid) {
  const kinds = filterParts().map(filterKind);
  const mode = homeSplit ? [homeSplit, 'room', 'genre', 'owner'].find((m) => !kinds.includes(m === 'room' ? 'place' : m)) || 'genre' : '';
  const groups = mode ? shelfGroups(books, mode, false) : [];
  const only = !mode || (groups.length === 1 && groups[0][2]); // tutti insieme, o tutti senza posto/genere/persona
  const seen = new Set();
  homeOrder = mode ? groups.flatMap(([, items]) => items).filter((b) => !seen.has(b.id) && seen.add(b.id)) : null;
  const sw = ['room', 'genre', 'owner'].map((m) => `<button data-hsort="${m}" class="${m === mode ? 'on' : ''}" aria-pressed="${m === mode}">${{ room: 'Stanza', genre: 'Genere', owner: 'Persona' }[m]}</button>`).join('');
  // «Tutti i libri» si tocca per tornare a vederli tutti insieme; le tre scelte a destra li dividono.
  const head = `<div class="all-head"><h3 class="rail-label all-label"><button class="all-btn${mode ? '' : ' on'}" data-hsort="" aria-pressed="${!mode}">${filterGenre ? 'Tutti' : 'Tutti i libri'}<small>${books.length}</small></button></h3><div class="hsort" role="group" aria-label="Dividi per">${sw}</div></div>`;
  const body = (items) => (asGrid ? shelfRowsHtml(items) : items.map((b) => bookRowHtml(b, `data-id="${esc(b.id)}"`)).join(''));
  if (only) return head + (asGrid ? body(books) : `<section class="home-group">${body(books)}</section>`);
  return head + groups.map(([label, items]) => `<section class="home-group"><p class="group-label">${esc(label)}<small>${items.length}</small></p>${body(items)}</section>`).join('');
}
const ALL_LABEL = '';
const DICE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.3"/><circle cx="15" cy="15" r="1.3"/><circle cx="15" cy="9" r="1.3"/><circle cx="9" cy="15" r="1.3"/></svg>';
const railHead = (title, items) => `<div class="rail-head"><h3 class="rail-label">${title}${items.length ? `<small>${items.length}</small>` : ''}</h3>${title === 'Da leggere' && items.length > 1 ? `<button class="chip pick-btn" data-pick>${DICE}Cosa leggo stasera?</button>` : ''}</div>`;
const RAIL_MAX = 8;
function railsHtml(owned) {
  return homeSections(owned).map(([title, items, empty]) => `<section class="rail-sec">
    ${railHead(title, items)}
    ${items.length ? `<div class="rail" style="--rail-w:${[0, 98, 74, 58][gridZoom]}px">${(items.length > RAIL_MAX ? [...items.slice(0, RAIL_MAX), { more: title === 'Da leggere' ? 'status:toread' : 'status:reading', count: items.length - RAIL_MAX }] : items).map(gridCellHtml).join('')}</div>` : `<p class="rail-empty">${empty}</p>`}
    <div class="plank"></div>
  </section>`).join('') + ALL_LABEL;
}
function listSectionsHtml(owned) {
  return homeSections(owned).map(([title, items, empty]) => `<section class="list-sec">
    ${railHead(title, items)}
    ${items.length ? items.slice(0, 5).map((b) => bookRowHtml(b, `data-id="${esc(b.id)}"`)).join('') + (items.length > 5 ? `<button class="link-btn more-row" data-more="${title === 'Da leggere' ? 'status:toread' : 'status:reading'}">Vedi tutti i ${items.length} →</button>` : '') : `<p class="rail-empty">${empty}</p>`}
  </section>`).join('') + ALL_LABEL;
}

/* «Da scoprire», in cima ai Desideri: i più venduti e i libri simili ai vostri.
   Li preparerà ogni settimana la parte online (Claude con la ricerca web) e li salverà qui:
   { updatedAt, bestsellers: [{ title, authors, isbn, cover, reason }], similar: [...] }.
   Finché non ci sono, la sezione mostra cosa arriverà. */
const DISCOVER_KEY = 'libreria.discover';
let discoverItems = [];
function loadDiscover() {
  try { const d = JSON.parse(localStorage.getItem(DISCOVER_KEY) || 'null'); return d && typeof d === 'object' ? d : null; } catch (e) { return null; }
}
/* Una volta a settimana (per tutta la famiglia, la prima apertura dopo 7 giorni su qualsiasi telefono) il Bibliotecario
   prepara le proposte; il risultato passa agli altri telefoni con la libreria online. */
let discoverBusy = false;
async function maybeRefreshDiscover(force) {
  if (discoverBusy || typeof askClaude !== 'function' || !cloudReady() || !navigator.onLine) return;
  const d = loadDiscover();
  if (!force && d && Date.now() - (d.updatedAt || 0) < 7 * 864e5) return;
  // Dopo un errore si riprova al massimo una volta ogni 6 ore.
  const tried = Number(localStorage.getItem('libreria.discover.tried') || 0);
  if (!force && Date.now() - tried < 6 * 3600e3) return;
  localStorage.setItem('libreria.discover.tried', String(Date.now()));
  discoverBusy = true;
  if (viewMode === 'wish') renderList();
  const owned = state.books;
  const loved = owned.filter((b) => Number(b.rating) >= 4).sort((a, b) => b.rating - a.rating || (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 30);
  const count = (arr) => { const c = {}; arr.forEach((x) => { if (x) c[x] = (c[x] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map((x) => x[0]); };
  const r = await askClaude({
    azione: 'scopri',
    preferiti: loved.map((b) => ({ titolo: b.title, autore: firstAuthor(b.authors), voto: b.rating })),
    generi: count(owned.flatMap((b) => b.genres || [])).slice(0, 10),
    temi: count(owned.map((b) => b.theme)).slice(0, 10),
    avete: owned.map((b) => b.title).filter(Boolean),
  });
  if (!r || !r.ok) { discoverBusy = false; if (viewMode === 'wish') renderList(); return; }
  // Le copertine già trovate le volte prima si tengono (stesso titolo): non spariscono a ogni aggiornamento.
  const known = {};
  for (const it of [...((d && d.bestsellers) || []), ...((d && d.amazon) || []), ...((d && d.similar) || [])]) if (it.cover) known[normTitle(it.title)] = it;
  // Copertine date dalle classifiche stesse: Feltrinelli (sempre) e Amazon (quando il Bibliotecario le vede).
  const amazonImg = (u) => (/^https:\/\/(m\.media-amazon\.com|images-[a-z]+\.ssl-images-amazon\.com|www\.lafeltrinelli\.it\/images)\//.test(String(u || '')) ? u : '');
  // Frasi sempre uguali: «3° in classifica» per i più venduti, «Simile a «…»» per i simili.
  const conv = (x, reason) => {
    const old = known[normTitle(x.titolo)];
    return { title: x.titolo, authors: x.autore || '', isbn: x.isbn || (old && old.isbn) || '', publisher: x.editore || '', cover: amazonImg(x.copertina) || (old && old.cover) || '', reason, stars: Number(x.voto) || (old && old.stars) || 0 };
  };
  const best = (r.bestseller || []).slice().sort((a, b) => (a.posizione || 99) - (b.posizione || 99));
  const out = { updatedAt: Date.now(), source: [r.fonte, r.settimana].filter(Boolean).join(' · '),
    bestsellers: best.map((x, i) => ({ ...conv(x, (x.posizione || i + 1) + '° in classifica'), rank: x.posizione || i + 1 })),
    amazon: [], // una classifica sola (Feltrinelli); per ogni libro, nella scheda, i link a tutti i negozi
    similar: (r.simili || []).map((x) => conv(x, x.simile_a ? 'Simile a «' + x.simile_a + '»' : '')) };
  // Se una classifica questa volta non si trova (o arriva a metà), resta quella di prima invece di sparire.
  if (d && out.bestsellers.length < 5 && (d.bestsellers || []).length >= out.bestsellers.length) { out.bestsellers = d.bestsellers; out.source = d.source || ''; }
  const save = () => { try { localStorage.setItem(DISCOVER_KEY, JSON.stringify(out)); } catch (e) { /* niente */ } };
  // Copertine (e ISBN mancanti) dai cataloghi prima di mostrare le proposte nuove: niente copertine che vanno e vengono.
  await Promise.all([...out.bestsellers, ...out.amazon, ...out.similar].map(async (it) => {
    if (it.cover) return;
    try { const f = await findCover(it.title, it.authors, it.isbn); it.cover = f.cover; it.isbn = f.isbn; if (!it.stars && f.stars) it.stars = f.stars; } catch (e) { /* resta il segnaposto */ }
  }));
  out.updatedAt = Date.now();
  discoverBusy = false;
  save();
  if (viewMode === 'wish') renderList();
  if (typeof scheduleSync === 'function') scheduleSync(500);
}
const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9à-ù]+/g, ' ').trim();
function haveIt(item) {
  return state.books.find((b) => (item.isbn && b.isbn === item.isbn) || (normTitle(b.title) && normTitle(b.title) === normTitle(item.title)));
}
/* ---------- Pagina autore: gli altri suoi libri, dai cataloghi ----------
   Si cercano su Google Books (edizioni italiane prima) e si tolgono quelli che avete già. */
const authorMore = {}; // nome → { loading } oppure { items, lang }
const LANG_NAMES = { it: 'italiano', en: 'inglese', fr: 'francese', de: 'tedesco', es: 'spagnolo', ja: 'giapponese', pt: 'portoghese' };
/* Numero di volume e nome della saga dal titolo: «Pokémon. La grande avventura 5», «… Vol. 11», «#3», «tome 3». */
function volumeOf(b) {
  const full = [b.title, b.subtitle].filter(Boolean).join(' ');
  const m = full.match(/(?:\bvol(?:ume)?\.?|\bn\.|\bnr\.?|#|\btom[eo]\b|\blibro\b|\bnumero\b|\bpart[ei]?\b)\s*(\d{1,3})\b/i) || String(b.title || '').match(/\s(\d{1,3})\s*$/);
  const num = Number(b.seriesNum) || (m ? Number(m[1]) : 0);
  let base = String(b.title || '');
  if (m && b.title && b.title.includes(m[0].trim())) base = base.replace(m[0].trim(), '');
  base = norm(base.replace(/[([].*?[)\]]/g, ' ')).replace(/[^a-z0-9]+/g, ' ').trim();
  return { num, base };
}
/* ---------- Claude nella pagina autore ----------
   Su richiesta (costa qualche centesimo): Claude cerca sul web i libri dell'autore nella vostra lingua che vi mancano,
   con i volumi mancanti delle saghe. La risposta resta sul telefono per 30 giorni. */
const claudeAuthor = {}; // nome → { loading } | { error } | { at, riassunto, libri }
function claudeAuthorKey(name) { return 'libreria.claude.autore.' + norm(name); }
function claudeAuthorState(name) {
  if (!claudeAuthor[name]) {
    try { const c = JSON.parse(localStorage.getItem(claudeAuthorKey(name)) || 'null'); if (c && Date.now() - c.at < 30 * 864e5) claudeAuthor[name] = c; } catch (e) { /* niente */ }
  }
  return claudeAuthor[name] || null;
}
async function askClaudeAuthor(name) {
  if (typeof askClaude !== 'function' || !cloudReady()) return toast('Per chiedere al Bibliotecario serve la libreria online: Impostazioni → La vostra libreria online.');
  const mine = state.books.filter((b) => authorsOf(b).some((a) => norm(a) === norm(name)));
  const langs = {}; mine.forEach((b) => { if (b.lang) langs[b.lang.slice(0, 2)] = (langs[b.lang.slice(0, 2)] || 0) + 1; });
  const lingua = (Object.entries(langs).sort((a, b) => b[1] - a[1])[0] || ['it'])[0];
  claudeAuthor[name] = { loading: true };
  renderList();
  const r = await askClaude({ azione: 'autore', nome: name, lingua, vostri: mine.map((b) => ({ titolo: [b.title, b.subtitle].filter(Boolean).join(' – '), numero: seriesNumOf(b) || volumeOf(b).num || null })) });
  if (!r || !r.ok) { claudeAuthor[name] = { error: (r && r.error) || 'non risponde' }; }
  else {
    claudeAuthor[name] = { at: Date.now(), libri: r.libri || [], costo: r.costo || 0 };
    try { localStorage.setItem(claudeAuthorKey(name), JSON.stringify(claudeAuthor[name])); } catch (e) { /* niente */ }
    // Copertine di riserva per i libri con ISBN.
    const st = claudeAuthor[name];
    Promise.all(st.libri.slice(0, 20).map(async (x) => { const f = await findCover(x.titolo, name, x.isbn); x.cover = f.cover; if (!x.isbn) x.isbn = f.isbn; })).then(() => {
      try { localStorage.setItem(claudeAuthorKey(name), JSON.stringify(st)); } catch (e) { /* niente */ }
      if (filterParts().includes('author:' + name)) renderList();
    });
  }
  if (filterParts().includes('author:' + name)) renderList();
}
/* Il «Bibliotecario» è Claude: cerca per voi negli scaffali del web i libri dell'autore che vi mancano. */
let claudeSort = 'new'; // 'new' = dal più recente, 'old' = dal più vecchio
// Un libro proposto dal Bibliotecario nella forma comune delle proposte (la cache sul telefono tiene anche copertina e trama).
function claudeItem(x, name) {
  if (!x._it) {
    const num = x.numero && !String(x.titolo).includes(String(x.numero)) ? x.numero : 0;
    x._it = { title: x.titolo + (num ? ' n. ' + num : ''), authors: name, isbn: x.isbn || '', publisher: x.editore || '', year: x.anno || '', price: x.prezzo || '',
      cover: x.cover || '', reason: x.nota || '', series: x.saga || '', seriesNum: x.numero || '' };
  }
  if (x.cover && !x._it.cover) x._it.cover = x.cover;
  return x._it;
}
function claudeAuthorHtml(name) {
  const st = claudeAuthorState(name);
  const btn = (label) => `<button class="chip claude-ask" data-claude-author="${esc(name)}">✨ ${label}</button>`;
  // In cima, i suoi libri che avete già: titolo tra virgolette e anno.
  const mine = state.books.filter((b) => !b.list && authorsOf(b).some((a) => norm(a) === norm(name)));
  const haveBox = mine.length ? `<div class="claude-have"><strong>Avete già</strong><ul>${mine.slice()
    .sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999))
    .map((b) => `<li>«${esc(b.title)}»${seriesNumOf(b) ? ' n. ' + seriesNumOf(b) : ''}${b.year ? ' (' + esc(b.year) + ')' : ''}</li>`).join('')}</ul></div>` : '';
  if (!st) return `<section class="claude-box">${haveBox}<p class="hint">Il Bibliotecario può cercare per voi i libri di ${esc(name)} che vi mancano, con i volumi delle saghe.</p>${btn('Chiedi al Bibliotecario')}</section>`;
  if (st.loading) return `<section class="claude-box">${haveBox}<p class="hint claude-wait">✨ Il Bibliotecario sta cercando tra gli scaffali…</p></section>`;
  if (st.error) return `<section class="claude-box">${haveBox}<p class="hint">Il Bibliotecario non ha trovato risposta: ${esc(st.error)}.</p>${btn('Riprova')}</section>`;
  const have = (x) => state.books.some((b) => (x.isbn && b.isbn === x.isbn) || (norm(b.title) === norm(x.titolo) && (!x.numero || (seriesNumOf(b) || volumeOf(b).num) === x.numero)));
  const year = (x) => Number(x.anno) || 0;
  const libri = st.libri.filter((x) => !have(x)).sort((a, b) => (claudeSort === 'new' ? year(b) - year(a) : (year(a) || 9999) - (year(b) || 9999)) || (a.numero || 0) - (b.numero || 0));
  const days = Math.floor((Date.now() - st.at) / 864e5);
  return `<section class="claude-box">${haveBox}
    <div class="claude-head"><h3 class="shelf-label">✨ Il Bibliotecario propone · ${libri.length}</h3>
      ${libri.length > 1 ? `<div class="seg claude-sort"><button data-claude-sort="new" class="${claudeSort === 'new' ? 'on' : ''}">Più recenti</button><button data-claude-sort="old" class="${claudeSort === 'old' ? 'on' : ''}">Più vecchi</button></div>` : ''}</div>
    ${libri.length ? suggShelves(libri.map((x) => claudeItem(x, name)), (it) => [it.seriesNum ? 'n. ' + it.seriesNum : '', it.year].filter(Boolean).join(' · ')) : '<p class="hint">Il Bibliotecario non ha trovato altri suoi libri che vi mancano.</p>'}
    <p class="hint claude-foot">Ricerca di ${days ? days === 1 ? 'ieri' : days + ' giorni fa' : 'oggi'}. Il Bibliotecario può sbagliare: controlla prima di comprare. ${btn('Cerca di nuovo')}</p>
  </section>`;
}

/* Scelta della lista desideri: se ce n'è più di una, si chiede quale. */
function chooseWishlist(title, done, question) {
  if (!state.wishlists.length) state.wishlists.push('Da comprare');
  if (state.wishlists.length === 1) return done(state.wishlists[0]);
  const wrap = document.createElement('div');
  wrap.className = 'pick-list';
  wrap.innerHTML = `<div class="pick-list-card" role="dialog" aria-label="In quale lista?"><p>${question ? esc(question) : `In quale lista metto «${esc(title)}»?`}</p>
    ${state.wishlists.map((l, i) => `<button class="btn ghost wide" data-i="${i}">${esc(l)}</button>`).join('')}
    <button class="btn wide pick-list-no">Annulla</button></div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) { close(); done(state.wishlists[Number(b.dataset.i)]); return; }
    if (e.target === wrap || e.target.closest('.pick-list-no')) close();
  });
  document.body.appendChild(wrap);
}

function addClaudeToWish(key) {
  const i = key.lastIndexOf('|'), name = key.slice(0, i);
  const x = ((claudeAuthorState(name) || {}).libri || [])[Number(key.slice(i + 1))];
  if (!x) return;
  chooseWishlist(x.titolo, (list) => addClaudeBook(x, name, list));
}
function addClaudeBook(x, name, list) {
  const b = { id: newId(), addedAt: Date.now(), updatedAt: Date.now(), isbn: x.isbn || '', title: x.titolo, subtitle: x.numero && !String(x.titolo).includes(String(x.numero)) ? 'Volume ' + x.numero : '', authors: name, publisher: x.editore || '',
    year: x.anno || '', pages: '', cover: x.cover || '', genres: [], owners: [], list, status: '', media: [], price: x.prezzo ? String(x.prezzo) : '',
    series: x.saga || '', seriesNum: x.numero ? String(x.numero) : '' };
  state.books.push(b);
  saveState();
  renderList();
  toast('«' + x.titolo + '» aggiunto ai desideri: ' + list);
  // Copertina e trama dai cataloghi, in silenzio.
  if (navigator.onLine) batchLookup({ isbn: b.isbn, q: b.isbn ? '' : [b.title, name].join(' '), state: 'wait', id: b.id }).then(() => renderList()).catch(() => {});
}

function authorMoreHtml(name) {
  const head = `<h3 class="shelf-label">Altri libri di ${esc(name)}</h3>`;
  const st = authorMore[name];
  if (!st || st.loading) {
    if (!st) { authorMore[name] = { loading: true }; loadAuthorMore(name); }
    return `<section class="author-more">${head}<p class="hint">Cerco nei cataloghi…</p></section>`;
  }
  // Già vostri: stesso ISBN, oppure stessa saga e stesso numero, oppure stesso titolo.
  const mine = state.books.filter((b) => authorsOf(b).some((a) => norm(a) === norm(name)));
  const mineKeys = new Set(mine.map((b) => { const v = volumeOf(b); return v.base + '|' + (seriesNumOf(b) || v.num); }));
  const owned = (x) => state.books.some((b) => x.isbn && b.isbn === x.isbn) || mineKeys.has(x.vol.base + '|' + x.vol.num);
  const items = st.items.filter((x) => !owned(x));
  if (!items.length) return st.failed ? `<section class="author-more">${head}<p class="hint">Non riesco a raggiungere i cataloghi: riprova più tardi.</p></section>` : '';
  // Sui cataloghi la trama c'è già: la scheda la mostra subito.
  const asItem = (x) => { x.plot = x.plot || x.description || ''; x.plotTried = true; if (!x._num && x.vol.num && !String(x.title).includes(String(x.vol.num))) { x.title = x.title + ' n. ' + x.vol.num; } x._num = true; return x; };
  const shelf = (L) => suggShelves(L.map(asItem), (it) => it.year);
  const same = items.filter((x) => x.sameLang), other = items.filter((x) => !x.sameLang);
  const langName = LANG_NAMES[st.lang] || 'la vostra lingua';
  const cl = claudeAuthorState(name);
  if (cl && cl.libri) return `<details class="author-more more-other"><summary>Dai cataloghi (Google Books) · ${items.length}</summary>${shelf(same.concat(other))}</details>`;
  return `<section class="author-more">${head.replace('</h3>', ' · ' + items.length + '</h3>')}
    <p class="hint">Dai cataloghi, quelli che non avete: prima in ${langName}, in ordine di uscita e di volume.</p>
    ${same.length ? shelf(same) : `<p class="hint">Nessun altro suo libro in ${langName} nei cataloghi.</p>`}
    ${other.length ? `<details class="more-other"><summary>In altre lingue · ${other.length}</summary>${shelf(other)}</details>` : ''}
  </section>`;
}
async function loadAuthorMore(name) {
  const st = authorMore[name];
  // La lingua è quella dei suoi libri che avete già (di solito l'italiano).
  const langs = {};
  for (const b of state.books) if (authorsOf(b).some((a) => norm(a) === norm(name)) && b.lang) langs[b.lang] = (langs[b.lang] || 0) + 1;
  const lang = (Object.entries(langs).sort((a, b) => b[1] - a[1])[0] || ['it'])[0].slice(0, 2);
  st.lang = lang;
  try {
    const q = encodeURIComponent('inauthor:"' + name + '"');
    const [pref1, pref2, any] = await Promise.all([
      getJson(googleUrl('maxResults=40&printType=books&langRestrict=' + lang + '&q=' + q)),
      getJson(googleUrl('maxResults=40&startIndex=40&printType=books&langRestrict=' + lang + '&q=' + q)).catch(() => ({})),
      getJson(googleUrl('maxResults=40&printType=books&q=' + q)).catch(() => ({})),
    ]);
    const seen = new Set();
    const all = [...(pref1.items || []), ...(pref2.items || []), ...(any.items || [])].map(fromGoogleItem)
      .filter((b) => b.title && authorsOf(b).some((a) => norm(a) === norm(name)))
      .map((b) => ({ ...b, publisher: cleanPublisher(b.publisher), cover: (b.cover || '').replace(/^http:/, 'https:'), vol: volumeOf(b) }))
      // Una sola edizione per titolo e lingua (lo stesso libro esce spesso più volte).
      .filter((b) => { const k = b.vol.base + '|' + b.vol.num + '|' + (b.lang || '').slice(0, 2); if (seen.has(k) || (b.isbn && seen.has(b.isbn))) return false; seen.add(k); if (b.isbn) seen.add(b.isbn); return true; });
    for (const b of all) b.sameLang = (b.lang || lang).slice(0, 2) === lang;
    // Le saghe stanno insieme, in ordine di volume, al posto della loro prima uscita; il resto in ordine di uscita.
    const first = {};
    for (const b of all) if (b.vol.num) first[b.vol.base] = Math.min(first[b.vol.base] || 9999, Number(b.year) || 9999);
    const when = (b) => (b.vol.num ? first[b.vol.base] : Number(b.year) || 9999);
    st.items = all.sort((a, b) => when(a) - when(b) || (a.vol.num && b.vol.num && a.vol.base === b.vol.base ? a.vol.num - b.vol.num : a.vol.base.localeCompare(b.vol.base)) || (Number(a.year) || 9999) - (Number(b.year) || 9999));
  } catch (e) { st.items = []; st.failed = true; }
  st.loading = false;
  if (filterParts().includes('author:' + name)) renderList();
  const missing = st.items.filter((x) => !x.cover && x.isbn).slice(0, 20);
  if (missing.length) {
    await Promise.all(missing.map(async (x) => { x.cover = await probeCover(x.isbn); }));
    if (missing.some((x) => x.cover) && filterParts().includes('author:' + name)) renderList();
  }
}
function addAuthorMoreToWish(key) {
  const i = key.lastIndexOf('|');
  const x = (authorMore[key.slice(0, i)] || {}).items?.[Number(key.slice(i + 1))];
  if (!x) return;
  chooseWishlist(x.title, (list) => {
  state.books.push({ id: newId(), addedAt: Date.now(), updatedAt: Date.now(), isbn: x.isbn || '', title: x.title, subtitle: x.subtitle || '', authors: x.authors || '', publisher: x.publisher || '',
    year: x.year || '', pages: x.pages || '', cover: x.cover || '', plot: x.description || '', plotTried: true, lang: x.lang || '',
    genres: suggestGenres(x.subjects, x.authors, x.description).genres.filter((g) => state.genres.includes(g)), owners: [], list, status: '', media: [] });
  saveState();
  renderList();
  toast('«' + x.title + '» aggiunto ai desideri: ' + list);
  });
}

/* ================= PROPOSTE: mensole e scheda =================
   Tutti i libri suggeriti (classifiche, simili, pagina autore, cataloghi) stanno su mensole come la libreria.
   Toccandone uno si apre una scheda con le informazioni, «＋ Aggiungi ai desideri» e dove comprarlo. */
let suggItems = []; // si riempie a ogni disegno della lista
function suggCell(it, opts = {}) {
  const i = suggItems.push(it) - 1;
  const own = haveIt(it);
  const color = SPINE_COLORS[hashOf(it.title || '') % SPINE_COLORS.length];
  const inner = it.cover
    ? `<img src="${esc(httpsUrl(it.cover))}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${esc((it.title || '?').charAt(0))}" data-ph="${esc(phInner(it))}" data-color="${esc(color)}">`
    : phInner(it);
  return `<button class="cell disc" data-sugg="${i}">
    <span class="cell-cover${it.cover ? '' : ' ph-cover'}" style="background:${color};color:${inkOn(color)}">${inner}${opts.rank ? `<span class="rank-badge">${opts.rank}</span>` : ''}${Number(it.stars) ? `<span class="rating-badge" aria-label="Voto medio dei lettori ${fmtRating(Math.round(it.stars * 10) / 10)} su 5"><b>★</b>${fmtRating(Math.round(it.stars * 10) / 10)}</span>` : ''}${own ? `<span class="badge own-badge">${own.list ? 'Nei desideri' : 'Ce l\'avete'}</span>` : ''}</span>
    ${opts.caption ? `<span class="disc-reason">${esc(opts.caption)}</span>` : ''}
  </button>`;
}
function suggShelves(items, capOf, rankOf) {
  const cols = gridCols();
  let rows = '';
  for (let k = 0; k < items.length; k += cols) {
    rows += `<div class="shelf-line"><div class="shelf-books" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${items.slice(k, k + cols)
      .map((it, j) => suggCell(it, { caption: capOf ? capOf(it) : '', rank: rankOf ? rankOf(it, k + j) : 0 })).join('')}</div><div class="plank"></div></div>`;
  }
  return `<div class="chart-shelves">${rows}</div>`;
}

let suggOpen = null;
function openSugg(i) {
  const it = suggItems[i];
  if (!it) return;
  const own = haveIt(it);
  if (own) return openView(own);
  suggOpen = it;
  renderSugg();
  show('sugg');
  if (!it.plotTried) loadSuggInfo(it);
}
async function loadSuggInfo(it) {
  it.plotTried = true;
  try {
    let f = null;
    if (it.isbn) f = (await lookupIsbn(it.isbn)).data;
    if (!f || !f.description) {
      const t = norm(it.title.replace(/\s+n\.\s*\d+$/, ''));
      const hit = (await searchByText([it.title, firstAuthor(it.authors)].join(' '))).find((x) => norm(x.title).startsWith(t) || t.startsWith(norm(x.title)));
      if (hit) f = { ...hit, ...(f || {}), description: (f && f.description) || hit.description };
    }
    if (f) for (const [k, v] of [['plot', f.description], ['pages', f.pages], ['year', f.year], ['publisher', f.publisher], ['cover', f.cover && httpsUrl(f.cover)], ['isbn', f.isbn], ['subjects', f.subjects]]) if (!it[k] && v) it[k] = v;
  } catch (e) { /* senza trama */ }
  if (suggOpen === it && !$('sugg').hidden) renderSugg();
}
function renderSugg() {
  const it = suggOpen;
  const color = SPINE_COLORS[hashOf(it.title || '') % SPINE_COLORS.length];
  const cover = it.cover ? `<img src="${esc(httpsUrl(it.cover))}" alt="" referrerpolicy="no-referrer">` : phInner(it);
  const meta = [it.publisher, it.year, it.pages ? it.pages + ' pagine' : '', Number(it.price) ? euro(it.price) : ''].filter(Boolean).join(' · ');
  const author = firstAuthor(it.authors);
  $('sugg-card').innerHTML = `
    <div class="sugg-top">
      <div class="sugg-cover${it.cover ? '' : ' ph-cover'}" style="background:${color};color:${inkOn(color)}">${cover}</div>
      <div class="sugg-info">
        <h3>${esc(it.title)}</h3>
        ${author ? `<button class="link-btn sugg-author" data-sugg-author="${esc(author)}">${esc(it.authors)} ›</button>` : ''}
        ${meta ? `<p class="sugg-meta">${esc(meta)}</p>` : ''}
        ${it.reason ? `<p class="sugg-reason">✨ ${esc(it.reason)}</p>` : ''}
        ${Number(it.stars) ? `<p class="sugg-meta">Voto medio dei lettori: ★ ${fmtRating(Math.round(it.stars * 10) / 10)} su 5</p>` : ''}
      </div>
    </div>
    <p class="sugg-plot">${it.plot ? (it.plot.length > 280 && !it.plotOpen
      ? esc(it.plot.slice(0, 280).replace(/\s+\S*$/, '')) + '… <button class="link-btn" data-sugg-more>Leggi tutto</button>'
      : esc(it.plot)) : it.plotTried ? '' : '<span class="claude-wait">Cerco la trama…</span>'}</p>
    <button class="btn primary wide" data-sugg-wish>＋ Aggiungi ai desideri</button>
    <h4 class="sugg-h">Dove comprarlo</h4>
    <div class="sugg-stores">${storeLinks(it).map(([l, u]) => `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join('')}</div>
    <button class="btn ghost wide" data-sugg-close>Chiudi</button>`;
}
function addSuggToWish(it) {
  chooseWishlist(it.title, (list) => {
    const b = { id: newId(), addedAt: Date.now(), updatedAt: Date.now(), isbn: it.isbn || '', title: it.title, subtitle: it.subtitle || '', authors: it.authors || '', publisher: it.publisher || '',
      year: it.year || '', pages: it.pages || '', cover: it.cover || '', plot: it.plot || '', plotTried: Boolean(it.plot), lang: it.lang || '',
      genres: it.subjects ? suggestGenres(it.subjects, it.authors, it.plot).genres.filter((g) => state.genres.includes(g)) : [],
      owners: [], list, status: '', media: [], price: Number(it.price) ? String(it.price) : '', series: it.series || '', seriesNum: it.seriesNum ? String(it.seriesNum) : '' };
    state.books.push(b);
    saveState();
    hide('sugg');
    renderList();
    toast('«' + it.title + '» aggiunto ai desideri: ' + list);
    if (navigator.onLine && (!b.cover || !b.plot)) batchLookup({ isbn: b.isbn, q: b.isbn ? '' : [b.title, firstAuthor(b.authors)].join(' '), state: 'wait', id: b.id }).then(() => renderList()).catch(() => {});
  });
}

function discoverHtml() {
  const d = loadDiscover();
  const chart = (title, src, items) => (items && items.length
    ? `<p class="disc-sub">${title}</p>${src ? `<p class="disc-src">${esc(src)}</p>` : ''}${suggShelves(items.slice(0, 10), null, (it, k) => it.rank || k + 1)}` : '');
  const body = d ? chart('Classifica dei più venduti', d.source, d.bestsellers)
    + (d.similar && d.similar.length ? `<p class="disc-sub">Simili ai vostri preferiti</p>${suggShelves(d.similar.slice(0, 12), (it) => it.title)}` : '') : '';
  const canAsk = typeof cloudReady === 'function' && cloudReady();
  return `<section class="rail-sec discover">
    <div class="disc-head"><h3 class="rail-label">Da scoprire</h3>${d && canAsk ? `<button class="chip disc-refresh" data-disc-now ${discoverBusy ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>Aggiorna</button>` : ''}</div>
    ${discoverBusy ? '<p class="hint claude-wait disc-wait">✨ Il Bibliotecario sta scegliendo i libri della settimana…</p>' : ''}
    ${body || (discoverBusy ? '' : `<div class="disc-empty">
      <div class="disc-ghosts" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <p><strong>Ogni settimana, da solo</strong>I libri più venduti in Italia e quelli simili ai vostri preferiti, scelti dal Bibliotecario a partire dai libri che avete votato bene e dai vostri temi.
      ${typeof cloudReady === 'function' && cloudReady() ? '<button class="chip claude-ask" data-disc-now>✨ Prepara adesso</button>' : 'Serve la libreria online (Impostazioni).'}</p>
    </div>`)}
  </section>`;
}
function openDiscover(i) {
  const it = discoverItems[i];
  if (!it) return;
  const own = haveIt(it);
  if (own) return openView(own);
  if (it.isbn && toIsbn13(it.isbn)) return handleIsbn(toIsbn13(it.isbn));
  openBook({ title: it.title || '', authors: it.authors || '', cover: it.cover ? httpsUrl(it.cover) : '', genres: [] }, { banner: it.reason ? 'Suggerito dal Bibliotecario: ' + it.reason : '' });
}

/* «Cosa leggo stasera?»: pesca a caso tra i Da leggere (rispettando il filtro attivo), anche per lunghezza. */
let pickLen = '', pickId = '';
function pickPool() {
  return state.books.filter((b) => isOwned(b) && b.status === 'toread' && matchesFilter(b) && (!pickLen
    || (pickLen === 'short' ? (Number(b.pages) || 300) < 250 : pickLen === 'long' ? (Number(b.pages) || 0) >= 400 : true)));
}
/* La trama aiuta a scegliere: corta, con «Leggi tutto». Se manca, si cerca nei cataloghi e si salva nel libro. */
let pickPlotOpen = false;
function renderPickPlot(b) {
  const el = $('pick-plot');
  if (!b) { el.innerHTML = ''; return; }
  if (b.plot) {
    el.innerHTML = b.plot.length > 280 && !pickPlotOpen
      ? esc(b.plot.slice(0, 280).replace(/\s+\S*$/, '')) + '… <button class="link-btn" data-pick-more>Leggi tutto</button>'
      : esc(b.plot);
    return;
  }
  if (b.plotTried || !navigator.onLine) { el.innerHTML = '<span class="hint">Trama non disponibile.</span>'; return; }
  el.innerHTML = '<span class="hint claude-wait">Cerco la trama…</span>';
  b.plotTried = true;
  (async () => {
    try {
      let f = b.isbn ? (await lookupIsbn(b.isbn)).data : null;
      if (!f || !f.description) {
        const t = norm(b.title);
        const hit = (await searchByText([b.title, firstAuthor(b.authors)].join(' '))).find((x) => norm(x.title).startsWith(t) || t.startsWith(norm(x.title)));
        if (hit && hit.description) f = hit;
      }
      if (f && f.description) { b.plot = f.description; b.updatedAt = Date.now(); }
    } catch (e) { /* niente */ }
    saveState();
    if (pickId === b.id && !$('pick').hidden) renderPickPlot(b);
  })();
}
function openPick(again) {
  pickPlotOpen = false;
  const pool = pickPool().filter((b) => b.id !== pickId || pickPool().length === 1);
  const b = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  pickId = b ? b.id : '';
  $('pick-lens').innerHTML = [['', 'Qualsiasi'], ['short', 'Breve'], ['long', 'Lungo']].map(([k, l]) => `<button data-len="${k}" class="${pickLen === k ? 'on' : ''}">${l}</button>`).join('');
  $('pick-book').innerHTML = b
    ? `${coverHtml(b, true)}<div><h2>${esc(b.title)}</h2><p class="hint">${esc(b.authors || '')}${b.pages ? ' · ' + esc(b.pages) + ' pagine' : ''}</p></div>`
    : '<p class="hint">Nessun libro da leggere con questa scelta.</p>';
  renderPickPlot(b);
  $('pick-start').disabled = !b;
  $('pick-open').disabled = !b;
  $('pick-card').style.setProperty('--book', b ? bookColor(b) : 'var(--surface)');
  if (!again) show('pick');
  if (again && b) { const c = $('pick-book'); c.classList.remove('spin'); void c.offsetWidth; c.classList.add('spin'); }
}

/* ---------- Anno in libri e obiettivo ----------
   «Letto nel» può essere un anno (2019) o una data (12/03/2026): se ne prende l'anno, e il mese quando c'è.
   Un libro conta per le persone di «Di chi è»; senza persone conta solo in «Tutti». */
let yearWho = null, yearSel = new Date().getFullYear();
// Con lo storico: la lettura finita di quella persona (la più recente). Senza storico: «Letto nel» e «Di chi è».
const doneBy = (b, who) => readsOf(b).filter((r) => r.end && (!who || r.who === who || (!r.who && ownersOf(b).includes(who)))).pop() || null;
const isReadBy = (b, who) => (readsOf(b).some((r) => r.end) ? Boolean(doneBy(b, who)) : b.status === 'read' && (!who || ownersOf(b).includes(who)));
const readYear = (b, who) => { const e = doneBy(b, who); if (e) return Number(e.end.slice(0, 4)); const m = String(b.readAt || '').match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/); return m ? Number(m[1]) : 0; };
const readMonth = (b, who) => {
  const e = doneBy(b, who); if (e) return Number(e.end.slice(5, 7));
  const v = String(b.readAt || '');
  let m = v.match(/^(\d{4})-(\d{2})-\d{2}$/); if (m) return Number(m[2]);
  m = v.match(/^\d{1,2}[/.-](\d{1,2})[/.-]\d{4}$/); return m ? Number(m[1]) : 0;
};
const goalKey = (who, year) => (who || 'Tutti') + '|' + year;
const goalOf = (who, year) => Number(((state.goals || {})[goalKey(who, year)] || {}).n) || 0;

function renderYear() {
  if (yearWho === null) { const me = pref('libreria.me', ''); yearWho = state.owners.includes(me) ? me : ''; }
  if (yearWho && !state.owners.includes(yearWho)) yearWho = '';
  const now = new Date(), thisYear = now.getFullYear();
  const W = yearWho;
  const mine = state.books.filter((b) => !b.list && isReadBy(b, W));
  const years = [...new Set([thisYear, ...mine.map((b) => readYear(b, W)).filter(Boolean)])].sort((a, b) => b - a);
  if (!years.includes(yearSel)) yearSel = thisYear;
  const read = mine.filter((b) => readYear(b, W) === yearSel).sort((a, b) => (readMonth(b, W) - readMonth(a, W)) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const undated = mine.filter((b) => !readYear(b, W)).length;
  // Storico dell'anno: le letture con le date (inizio–fine), le più recenti in cima.
  const history = read.map((b) => ({ b, e: doneBy(b, W) })).filter((x) => x.e).sort((a, z) => z.e.end.localeCompare(a.e.end));
  const timed = history.filter((x) => x.e.start);
  const avgDays = timed.length ? Math.round(timed.reduce((t, x) => t + daysBetween(x.e.start, x.e.end), 0) / timed.length) : 0;
  const reading = state.books.filter((b) => !b.list && readsOf(b).some((r) => !r.end && r.start && (!W || r.who === W)));
  const goal = goalOf(yearWho, yearSel);
  const n = read.length;
  const pages = read.reduce((t, b) => t + (Number(b.pages) || 0), 0);
  const rated = read.filter((b) => b.rating);
  const avg = rated.length ? rated.reduce((t, b) => t + Number(b.rating), 0) / rated.length : 0;
  const top = (list) => { const c = {}; list.forEach((x) => { if (x) c[x] = (c[x] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0] || null; };
  const genre = top(read.flatMap((b) => b.genres || []));
  const author = top(read.map((b) => (authorsOf(b)[0] || '')));
  const longest = read.filter((b) => Number(b.pages)).sort((a, b) => b.pages - a.pages)[0];
  const heard = read.filter((b) => mediaOf(b).includes('audio') && !hasPaper(b)).length;
  const best = rated.filter((b) => b.rating >= 4).sort((a, b) => b.rating - a.rating).slice(0, 3);
  const months = Array.from({ length: 12 }, (_, i) => read.filter((b) => readMonth(b, W) === i + 1).length);
  const maxM = Math.max(1, ...months);

  // Obiettivo: quanti ne mancano e, per l'anno in corso, se si è in linea con il calendario.
  let goalHtml;
  if (goal) {
    const pct = Math.min(100, Math.round((n / goal) * 100));
    let pace = '';
    if (yearSel === thisYear && n < goal) {
      const day = (now - new Date(thisYear, 0, 1)) / 86400000 + 1;
      const expected = Math.floor((goal * day) / 365);
      pace = n >= expected ? (yearWho ? ' · sei in linea' : ' · siete in linea') : ' · a quest\'ora dell\'anno sarebbero ' + expected + ' per stare in linea';
    }
    goalHtml = `<div class="goal"><div class="goal-top"><strong>${n} su ${goal}</strong><span>${n >= goal ? 'Obiettivo raggiunto! 🎉' : 'ne mancano ' + (goal - n) + pace}</span></div>
      <div class="goal-bar"><i style="width:${pct}%"></i></div></div>`;
  } else {
    goalHtml = `<p class="hint">Nessun obiettivo per il ${yearSel}${yearWho ? ' per ' + esc(yearWho) : ''}: quanti libri ${yearWho ? 'vuoi' : 'volete'} leggere?</p>`;
  }
  const cell = (label, value) => (value ? `<div class="ystat"><span>${label}</span><strong>${value}</strong></div>` : '');
  $('year-body').innerHTML = `
    <div class="seg year-who">${[['', 'Tutti'], ...state.owners.map((o) => [o, o])].map(([v, l]) => `<button data-who="${esc(v)}" class="${yearWho === v ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    <div class="chips year-years">${years.map((y) => `<button class="chip${y === yearSel ? ' on' : ''}" data-year="${y}">${y}</button>`).join('')}</div>
    <div class="year-hero"><span class="year-n">${n}</span><span>${n === 1 ? 'libro letto' : 'libri letti'} nel ${yearSel}${yearWho ? ' da ' + esc(yearWho) : ''}</span></div>
    ${goalHtml}
    <div class="goal-set"><input id="goal-n" type="number" inputmode="numeric" min="0" max="999" placeholder="Quanti?" value="${goal || ''}" aria-label="Obiettivo di libri per il ${yearSel}"><button class="btn ghost" id="goal-save">${goal ? 'Cambia obiettivo' : 'Imposta obiettivo'}</button></div>
    ${n ? `<div class="ystats">
      ${cell('Pagine lette', pages ? pages.toLocaleString('it-IT') : '')}
      ${cell('Voto medio', avg ? avg.toFixed(1).replace('.', ',') + ' ★' : '')}
      ${cell('Genere preferito', genre ? esc(genre[0]) : '')}
      ${author && author[1] > 1 ? `<button class="ystat ystat-link" data-author="${esc(author[0])}"><span>Autore più letto</span><strong>${esc(author[0])} (${author[1]}) ›</strong></button>` : ''}
      ${cell('Il più lungo', longest ? esc(longest.title) + ' · ' + longest.pages + ' pag.' : '')}
      ${cell('Ascoltati su Audible', heard || '')}
      ${cell('Giorni per libro', avgDays ? 'in media ' + avgDays : '')}
    </div>` : ''}
    ${reading.length ? `<h3>Sta${W ? '' : 'te'} leggendo</h3><div class="hist">${reading.map((b) => { const r = readsOf(b).filter((x) => !x.end && x.start && (!W || x.who === W)).pop();
      return `<button class="hist-row" data-id="${esc(b.id)}"><strong>«${esc(b.title)}»</strong><span>${W ? '' : esc(r.who || '') + (r.who ? ' · ' : '')}dal ${fmtDay(r.start)} · da ${daysBetween(r.start, today())} giorni</span></button>`; }).join('')}</div>` : ''}
    ${history.length ? `<h3>Storico del ${yearSel}</h3><div class="hist">${history.map(({ b, e }) => `<button class="hist-row" data-id="${esc(b.id)}"><strong>«${esc(b.title)}»</strong>
      <span>${W ? '' : esc(e.who || '') + (e.who ? ' · ' : '')}${e.start ? 'dal ' + fmtDay(e.start) + ' al ' + fmtDay(e.end) + ' · ' + daysBetween(e.start, e.end) + (daysBetween(e.start, e.end) === 1 ? ' giorno' : ' giorni') : 'finito il ' + fmtDay(e.end)}</span></button>`).join('')}</div>` : ''}
    ${months.some(Boolean) ? `<h3>Mese per mese</h3><div class="months">${months.map((m, i) => `<div class="month"><i style="height:${Math.round((m / maxM) * 100)}%"></i><b>${m || ''}</b><span>${'GFMAMGLASOND'[i]}</span></div>`).join('')}</div>` : ''}
    ${best.length ? `<h3>I più amati</h3><div class="year-covers">${best.map((b) => `<button class="year-cover" data-id="${esc(b.id)}">${coverHtml(b, true)}<span>${starsStr(b.rating)}</span></button>`).join('')}</div>` : ''}
    ${n ? `<h3>Tutti i letti del ${yearSel}</h3><div class="year-covers">${read.map((b) => `<button class="year-cover" data-id="${esc(b.id)}">${coverHtml(b, true)}</button>`).join('')}</div>`
      : `<div class="empty"><strong>Ancora nessun libro letto nel ${yearSel}</strong>Quando segnate un libro come «Letto», qui compare con la sua copertina.</div>`}
    ${undated ? `<p class="hint">${undated === 1 ? '1 libro letto non ha' : undated + ' libri letti non hanno'} l'anno in «Letto nel», quindi non ${undated === 1 ? 'compare' : 'compaiono'} qui. <button class="link-btn" data-undated>Mostrali</button></p>` : ''}
    <p class="hint">Da oggi le date si segnano da sole: «In corso» è l'inizio, «Letto» la fine, per chi usa il telefono. Per i libri letti prima contano «Letto nel» e «Di chi è».</p>`;
}

/* ================= PAGINA INIZIALE (v75) =================
   Saluto, ricerca, il libro che si sta leggendo, «Cosa leggo stasera?», le mensole e gli ultimi arrivati.
   In basso la barra: Libreria (questa pagina), Desideri, scanner, Scopri, Il mio anno. */
function renderNav() {
  const on = viewMode === 'wish' ? 'wish' : viewMode === 'discover' ? 'discover' : 'home';
  for (const b of document.querySelectorAll('.navbar [data-nav]')) {
    const yes = b.dataset.nav === on;
    b.classList.toggle('on', yes);
    if (yes) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  document.body.dataset.page = viewMode;
  const h1 = document.querySelector('.top h1');
  if (h1) h1.textContent = viewMode === 'wish' ? 'Desideri' : 'Libreria';
}
function sinceText(d) {
  if (!d) return '';
  const n = Math.round((new Date(today() + 'T12:00:00') - new Date(d + 'T12:00:00')) / 864e5);
  return n <= 0 ? 'Iniziato oggi' : n === 1 ? 'Iniziato ieri' : 'Iniziato ' + n + ' giorni fa';
}
function readingNow() {
  const me = pref('libreria.me', '');
  const mine = (b) => readsOf(b).some((r) => !r.end && r.who === me) || ownersOf(b).includes(me);
  const all = state.books.filter((b) => isOwned(b) && b.status === 'reading');
  return me && state.owners.includes(me) ? [...all.filter(mine), ...all.filter((b) => !mine(b))] : all;
}
function renderHome() {
  const owned = state.books.filter(isOwned);
  const day = new Date().toLocaleDateString('it-IT', { weekday: 'long' });
  const h = new Date().getHours();
  const part = h >= 5 && h < 13 ? 'mattina' : h >= 13 && h < 18 ? 'pomeriggio' : 'sera';
  const me = pref('libreria.me', '');
  const who = me && state.owners.includes(me) ? me : '';
  const reading = readingNow();
  const cur = reading[0];
  const open = cur && readsOf(cur).filter((r) => !r.end).pop();
  const started = (open && open.start) || (cur && cur.startedAt) || '';
  const recent = [...owned].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 10);
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  $('list').innerHTML = `<header class="home-head">
      <div class="home-hello">
        <p class="count">${esc(day.charAt(0).toUpperCase() + day.slice(1))} ${part} · ${owned.length === 1 ? '1 libro' : owned.length + ' libri'}</p>
        <h1>${esc(greeting())}</h1>
      </div>
      <button class="icon-btn" data-home="manual" aria-label="Aggiungi un libro scrivendo titolo o ISBN">${svg('<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20zM14.5 6l3 3"/>')}</button>
      <button class="icon-btn" data-home="settings" aria-label="Impostazioni e backup">${svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4.5v5M6 14.5v5"/>')}</button>
      ${state.owners.length ? `<button class="home-me" data-home="me" aria-label="${who ? 'Chi usa il telefono: ' + esc(who) + '. Tocca per cambiare' : 'Scegli chi usa il telefono'}">${who ? esc(who.charAt(0).toUpperCase()) : '?'}</button>` : ''}
    </header>
    <button class="home-search" data-home="search">${svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>')}<span>Cerca titolo, autore, ISBN…</span></button>
    ${cur ? `<section class="home-reading" aria-label="Stai leggendo">
        <button class="home-reading-cover" data-id="${esc(cur.id)}" aria-label="Apri ${esc(cur.title)}">${coverHtml(cur, true)}</button>
        <div class="home-reading-info">
          <p class="home-kicker">${who && reading.length && (readsOf(cur).some((r) => !r.end && r.who === who) || ownersOf(cur).includes(who)) ? 'Stai leggendo' : 'In lettura'}</p>
          <button class="home-reading-title" data-id="${esc(cur.id)}">${esc(cur.title)}</button>
          <p class="hint">${esc(cur.authors || '')}${started ? (cur.authors ? ' · ' : '') + sinceText(started) : ''}</p>
          <button class="btn primary" data-home-done="${esc(cur.id)}">Finito! Segna come letto</button>
        </div>
      </section>
      ${reading.length > 1 ? `<p class="hint home-also">In lettura anche: ${reading.slice(1, 4).map((b) => `<button class="link-btn" data-id="${esc(b.id)}">${esc(b.title)}</button>`).join(', ')}</p>` : ''}`
    : `<section class="home-reading empty-reading"><div class="home-reading-info">
        <p class="home-kicker">In lettura</p>
        <p class="home-reading-title">Nessun libro in corso</p>
        <p class="hint">Quando ne iniziate uno, segnatelo «In corso»: qui comparirà con la data di inizio.</p>
      </div></section>`}
    <div class="home-tiles">
      <button class="home-tile" data-pick>${svg('<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/>')}<b>Cosa leggo stasera?</b><span>Te ne propongo uno</span></button>
      <button class="home-tile" data-home="shelf">${svg('<path d="M5 4v14M9 6v12M13 4v14M17 8v10M3 20h18"/>')}<b>Le mensole</b><span>Tutti i libri a scaffale</span></button>
    </div>
    ${recent.length ? `<section class="home-recent" aria-label="Aggiunti di recente">
      <div class="home-sec-head"><h2>Aggiunti di recente</h2><button class="link-btn" data-home="all">Vedi tutti (${owned.length})</button></div>
      <div class="home-covers">${recent.map((b) => `<button class="home-cover" data-id="${esc(b.id)}" aria-label="${esc(b.title)}">${coverHtml(b, true)}</button>`).join('')}</div>
    </section>` : `<div class="empty"><strong>La libreria è vuota</strong>Tocca il pulsante tondo in basso, al centro, e inquadra il codice a barre sul retro del libro.</div>`}`;
}
function homeAction(what) {
  if (what === 'manual') return openManual();
  if (what === 'settings') return $('btn-settings').click();
  if (what === 'me') {
    const list = state.owners;
    if (!list.length) return;
    const me = pref('libreria.me', '');
    const next = list[(list.indexOf(me) + 1) % list.length];
    setPref('libreria.me', next);
    renderList();
    return toast('Ora il telefono è di ' + next + ': le letture si segnano a suo nome.');
  }
  viewMode = 'library'; filterGenre = ''; filterList = ''; backTo = null;
  if (what === 'shelf') { if (viewKind !== 'shelf') { flatView = viewKind; setPref('libreria.flatView', flatView); } viewKind = 'shelf'; }
  else if (viewKind === 'shelf') viewKind = flatView === 'list' ? 'list' : 'grid';
  setPref('libreria.view', viewKind);
  if (what === 'search') { $('tools').hidden = false; }
  renderList();
  window.scrollTo(0, 0);
  document.querySelector('.top').classList.remove('away');
  if (what === 'search') $('search').focus();
}

function greeting() {
  const h = new Date().getHours();
  const word = h >= 5 && h < 13 ? 'Buongiorno' : h >= 13 && h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const me = pref('libreria.me', '');
  return word + (me && state.owners.includes(me) ? ' ' + me : '');
}

function renderList() {
  suggItems = [];
  renderNav();
  if (viewMode === 'home' || viewMode === 'discover') {
    if (selecting) setSelecting(false);
    visibleIds = [];
    $('list').className = 'list page-' + viewMode;
    if (viewMode === 'home') renderHome(); else $('list').innerHTML = `<header class="page-head"><h1>Scopri</h1><p class="count">I più venduti e i libri simili ai vostri preferiti</p></header>` + discoverHtml();
    return;
  }
  const q = $('search').value.trim().toLowerCase();
  const sort = $('sort').value;
  const wish = viewMode === 'wish';
  const audio = viewMode === 'audio';
  const grouped = !wish && !audio && Boolean(groupBy) && filterGenre === groupFor;
  let owned = state.books.filter(isOwned);
  const wished = state.books.filter((b) => b.list);
  const heard = state.books.filter((b) => mediaOf(b).includes('audio'));
  const base = wish ? wished : audio ? heard : owned;
  let books = base.filter((b) => {
    if (wish && filterList && b.list !== filterList) return false;
    if (!wish && !audio && !matchesFilter(b)) return false;
    if (!q) return true;
    return [b.title, b.authors, b.publisher, b.isbn, b.barcode, b.notes].some((x) => String(x || '').toLowerCase().includes(q));
  });
  const byText = (k) => (a, b) => String(a[k] || '').localeCompare(String(b[k] || ''), 'it', { sensitivity: 'base' });
  if (sort === 'title') books.sort(byText('title'));
  else if (sort === 'author') books.sort(byText('authors'));
  else books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const seriesPage = !wish && !audio && filterParts().find((p) => p.startsWith('series:'));
  const authorPage = !wish && !audio && filterParts().find((p) => p.startsWith('author:'));
  if (seriesPage) books.sort((a, b) => (seriesNumOf(a) || 999) - (seriesNumOf(b) || 999));
  else if (authorPage) {
    // Anche i vostri: le saghe insieme e in ordine di volume, il resto in ordine di uscita.
    const key = (b) => { const v = volumeOf(b); return { num: seriesNumOf(b) || v.num, base: b.series ? norm(b.series) : v.base }; };
    const first = {};
    for (const b of books) { const k = key(b); if (k.num) first[k.base] = Math.min(first[k.base] || 9999, Number(b.year) || 9999); }
    const when = (b) => { const k = key(b); return k.num ? first[k.base] : Number(b.year) || 9999; };
    books.sort((a, b) => { const ka = key(a), kb = key(b); return when(a) - when(b) || (ka.num && kb.num && ka.base === kb.base ? ka.num - kb.num : ka.base.localeCompare(kb.base)) || (Number(a.year) || 9999) - (Number(b.year) || 9999); });
  }

  $('tab-library').textContent = 'Libreria (' + owned.length + ')';
  $('tab-wish').textContent = 'Desideri (' + wished.length + ')';
  $('tab-audio').textContent = 'Audible (' + heard.length + ')';
  for (const [id, on] of [['tab-library', !wish && !audio], ['tab-wish', wish], ['tab-audio', audio]]) {
    $(id).classList.toggle('on', on);
    $(id).setAttribute('aria-selected', on);
  }

  const total = base.length;
  const one = wish ? '1 desiderio' : audio ? '1 ascoltato' : '1 libro';
  const many = wish ? ' desideri' : audio ? ' ascoltati' : ' libri';
  $('count').textContent = total === 0 ? (wish ? 'Nessun desiderio' : audio ? 'Nessun audiolibro' : 'Nessun libro')
    : (total === 1 ? one : total + many) + (books.length !== total ? ' · ' + books.length + ' mostrati' : '');
  // Il numero dei libri è già nella scheda «Libreria (25)»: senza filtri in alto resta solo il saluto.
  if (!wish && !audio && total && books.length === total) $('count').textContent = greeting();
  // Nei desideri: quanto costa comprare tutti i libri mostrati.
  if (wish && books.length) {
    const priced = books.filter((b) => Number(b.price) > 0);
    if (priced.length) {
      $('count').textContent += ' · ' + euro(priced.reduce((sum, b) => sum + Number(b.price), 0))
        + (priced.length < books.length ? ' (' + (books.length - priced.length) + ' senza prezzo)' : '');
    }
  }

  // Filtri: in libreria i generi usati, nei desideri le liste.
  const chip = (value, label, on) => `<button class="chip${on ? ' on' : ''}" data-genre="${esc(value)}">${esc(label)}</button>`;
  $('wish-lists').hidden = !wish || !state.wishlists.length;
  if (!wish) $('wish-lists').innerHTML = '';
  if (wish) {
    if (filterList && !state.wishlists.includes(filterList)) filterList = '';
    // Le liste stanno in una riga tutta loro, a capo se serve: nomi sempre interi, mai coperti dai pulsanti.
    // In alto, accanto ai pulsanti, «Condividi» (e «Mostra chi regala»); sotto, le liste in una riga tutta loro,
    // a capo se serve: nomi sempre interi, mai coperti dai pulsanti.
    $('filters').innerHTML = state.wishlists.length
      ? `<button class="chip share-chip" data-share><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5"/></svg>Condividi</button>`
        + (wished.some((b) => claims[b.id] && (!filterList || b.list === filterList))
          ? `<button class="chip${claimsShown ? ' on' : ''}" data-claims aria-pressed="${claimsShown}">🎁 ${claimsShown ? 'Nascondi' : 'Chi regala'}</button>` : '')
      : '';
    $('wish-lists').innerHTML = state.wishlists.length
      ? `<div class="wish-chips">${state.wishlists.map((l) => chip(l, l + ' (' + wished.filter((b) => b.list === l).length + ')', filterList === l)).join('')}</div>`
      : '';
  } else if (audio) {
    $('filters').innerHTML = '';
  } else {
    const used = state.genres.filter((g) => owned.some((b) => (b.genres || []).includes(g)));
    const kindle = owned.some((b) => !hasPaper(b) || mediaOf(b).length > 1);
    const themes = [...new Set(owned.map((b) => b.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    // Un filtro alla volta: prestiti, proprietario oppure genere.
    const loans = owned.filter((b) => b.loanTo).length;
    const people = state.owners.filter((o) => owned.some((b) => ownersOf(b).includes(o)));
    // Ogni numero tiene conto dei filtri già scelti negli altri gruppi: con «Elena» acceso, i generi contano solo i suoi libri.
    const parts = filterParts();
    const count = (test, kind) => owned.filter((b) => parts.every((p) => filterKind(p) === kind || matchesOne(b, p)) && test(b)).length;
    const rooms = state.places.filter((p) => owned.some((b) => b.shelf === p));
    // Le scelte stanno in un pannello a parte, divise per gruppo e con ricerca: reggono anche decine di generi.
    filterGroups = [
      ['Lettura', Object.keys(STATUS).map((k) => ['status:' + k, k === 'read' ? 'Letti' : STATUS[k], count((b) => b.status === k, 'status')])],
      ['Prestiti', loans ? [['loan', 'In prestito', count((b) => Boolean(b.loanTo), 'loan')]] : []],
      ['Di chi è', people.map((o) => ['owner:' + o, o, count((b) => ownersOf(b).includes(o), 'owner')])],
      ['Dove sta', rooms.map((p) => ['place:' + p, p, count((b) => b.shelf === p, 'place')])],
      ['Versione', kindle ? Object.keys(MEDIA).map((k) => ['media:' + k, MEDIA[k], count((b) => mediaOf(b).includes(k), 'media')]) : []],
      ['Tema', themes.map((t) => ['theme:' + t, t, count((b) => b.theme === t, 'theme')])],
      ['Genere', used.map((g) => ['genre:' + g, g, count((b) => (b.genres || []).includes(g), 'genre')])],
    ].map(([title, items]) => [title, items.filter(([v, , n]) => n || parts.includes(v))]).filter(([, items]) => items.length);
    // Autore, serie e «da sistemare» non stanno tra le scelte del pannello, ma restano accesi finché non si tolgono.
    const special = parts.filter((p) => /^(author|series|todo):/.test(p)).map((p) => [p, specialLabel(p), count(() => true, filterKind(p))]);
    if (special.length) filterGroups.unshift(['Pagina', special]);
    const all = filterGroups.flatMap(([, items]) => items);
    const chosen = all.filter(([v]) => parts.includes(v));
    if (chosen.length !== parts.length) filterGenre = chosen.map(([v]) => v).join('|');
    const active = chosen.length ? [filterGenre, chosen.map(([, label]) => label).join(' · ')] : null;
    $('filters').innerHTML = all.length
      // Con un filtro attivo, il pulsante Filtra prende il suo nome: un solo elemento, con la ✕ per toglierlo.
      ? (active
        ? `<span class="chip-pair"><button class="chip on" data-open-filters aria-label="Filtro attivo: ${esc(active[1])}. Tocca per cambiarlo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg><span class="lbl">${esc(active[1])}</span></button><button class="chip on" data-genre="" aria-label="Togli il filtro ${esc(active[1])}">✕</button></span>`
        : `<button class="chip" data-open-filters><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtra</button>`)
      : '';
  }

  if (!total) {
    $('list').innerHTML = audio
      ? `<div class="empty"><strong>Nessun audiolibro</strong>Tocca la penna e scrivi il titolo. Per un libro che avete già, apri la scheda e accendi «Audible» tra le versioni.</div>`
      : wish
      ? `<div class="empty"><strong>Nessun desiderio</strong>Scansiona un libro in negozio, oppure aggiungilo con la penna: finirà nella lista che scegli.</div>`
      : `<div class="empty"><strong>La libreria è vuota</strong>
      Tocca il pulsante con il codice a barre, in basso a destra, e inquadra il retro del libro.</div>`;
  } else if (!books.length) {
    $('list').innerHTML = '<div class="empty"><strong>Nessun libro trovato</strong>Prova a cambiare ricerca o filtro.</div>';
  } else {
    if (grouped && viewKind !== 'shelf') {
      const groups = groupBooks(books, groupBy);
      books = groups.flatMap(([, items]) => items);
      $('list').innerHTML = groups.map(([label, items]) => `<section class="group">
        <h3 class="shelf-label">${esc(label)} · ${items.length}</h3>
        <div class="${viewKind === 'grid' ? 'grid-in' : 'rows-in'}">${items.map((b) => (viewKind === 'grid' ? gridCellHtml(b) : bookRowHtml(b, `data-id="${esc(b.id)}"`))).join('')}</div>
      </section>`).join('');
    } else {
      const home = !wish && !audio && viewKind === 'grid';
      // Copertine e lista hanno le stesse sezioni, nello stesso ordine.
      // Stesse sezioni anche filtrando per persona, genere, tema…: non se il filtro è già sullo stato di lettura.
      const sections = !wish && !audio && viewKind !== 'shelf' && !q && sort === 'recent' && !grouped && !seriesPage && !authorPage
        && !filterParts().some((p) => /^(status|todo):/.test(p)) && (filterGenre ? homeSections(books).length > 0 : owned.length >= 6);
      owned = filterGenre ? books : owned;
      // «Tutti i libri» si divide come lo Scaffale quando si guarda la libreria nell'ordine normale.
      const split = !wish && !audio && viewKind !== 'shelf' && !q && sort === 'recent' && !grouped && !seriesPage && !authorPage;
      // Nella pagina di una serie i volumi mancanti compaiono come posti vuoti: «Manca il n. 3».
      const shown = seriesPage ? withGaps(books) : books;
      homeOrder = null;
      $('list').innerHTML = home ? (sections ? railsHtml(owned) : '') + (split ? homeGroupsHtml(books, true) : shelfRowsHtml(shown))
        : viewKind === 'grid' ? books.map(gridCellHtml).join('')
        : viewKind === 'shelf' ? shelvesHtml(wish ? books : books.filter(hasPaper), wish, grouped ? (groupBy === 'owner' ? 'owner' : 'genre') : '')
        : (sections ? listSectionsHtml(owned) : '') + (split ? homeGroupsHtml(books, false) : shown.map((b) => (b.ghost ? `<div class="book ghost-row"><span class="cover">${b.num}</span><span class="book-info"><span class="book-title">Manca il n. ${b.num}</span><span class="book-author">Non è tra i vostri libri</span></span></div>` : bookRowHtml(b, `data-id="${esc(b.id)}"`))).join(''));
      if (homeOrder) books = homeOrder;
    }
  }
  if (authorPage && total) $('list').insertAdjacentHTML('beforeend', claudeAuthorHtml(authorPage.slice(7)) + authorMoreHtml(authorPage.slice(7)));
  // Nei desideri, senza ricerca né lista scelta, in cima c'è «Da scoprire».
  // I vostri desideri in cima, sempre sott'occhio; «Da scoprire» sotto.
  visibleIds = books.map((b) => b.id);
  $('btn-back').hidden = !backTo;
  const showing = total && books.length;
  const homeShelves = showing && !wish && !audio && viewKind === 'grid' && !grouped;
  $('list').className = 'list' + (homeShelves ? ' home z' + gridZoom : showing && viewKind === 'shelf' ? ' shelves' : showing && grouped ? ' grouped z' + gridZoom : showing && viewKind === 'grid' ? ' grid z' + gridZoom : '');
  // Il pulsante dice a parole la vista attuale; toccandolo si apre l'elenco delle tre viste.
  // Solo i simboli: copertine e lista, un tocco per passare dall'una all'altra.
  $('view-cycle').innerHTML = ['grid', 'list'].map((k) => `<button data-view="${k}" class="${k === viewKind ? 'on' : ''}" aria-pressed="${k === viewKind}" aria-label="${VIEWS[k][0]}"><svg viewBox="0 0 24 24" aria-hidden="true">${VIEWS[k][1]}</svg></button>`).join('');
  $('view-cycle').hidden = viewKind === 'shelf';
  $('btn-shelf').classList.toggle('on', viewKind === 'shelf');
  $('btn-shelf').setAttribute('aria-pressed', viewKind === 'shelf');
  $('btn-shelf').setAttribute('aria-label', viewKind === 'shelf' ? 'Chiudi lo scaffale' : 'Scaffale');
  $('view-menu').innerHTML = ['grid', 'list'].map((k) => `<button data-view="${k}" class="${k === viewKind ? 'on' : ''}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${VIEWS[k][1]}</svg>
      <span><b>${VIEWS[k][0]}</b><small>${VIEWS[k][2]}</small></span>
    </button>`).join('');
  $('shelf-sort').hidden = viewKind !== 'shelf' || wish || audio || grouped;
  $('btn-arrange').hidden = viewKind !== 'shelf' || wish || audio || !owned.length;
  for (const b of document.querySelectorAll('#shelf-sort [data-sort]')) b.classList.toggle('on', b.dataset.sort === shelfSort);
}

/* Se una copertina non si carica, al suo posto compare l'iniziale del titolo. */
document.addEventListener('error', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG' || !el.dataset.initial || !el.parentNode) return;
  const box = el.parentNode;
  if (el.dataset.ph && box.classList.contains('cover')) {
    box.classList.add('ph-cover');
    box.style.background = el.dataset.color; box.style.color = inkOn(el.dataset.color);
    box.innerHTML = el.dataset.ph;
  } else box.textContent = el.dataset.initial;
}, true);

/* ================= ANTEPRIMA RAPIDA ================= */

let peekId = '';

function openPeek(id, anchor) {
  if (selecting) return;
  const b = state.books.find((x) => x.id === id);
  if (!b) return;
  peekId = id;
  const color = bookColor(b);
  const peek = $('peek');
  peek.style.setProperty('--book', color);
  peek.style.setProperty('--book-ink', inkOn(color));
  const place = b.shelf ? b.shelf + (b.shelfRow ? ', ripiano ' + b.shelfRow : '') : '';
  const facts = [
    ['Genere', (b.genres || []).join(', ')], ['Dove sta', place], ['Di chi è', ownersOf(b).join(', ')],
    ['Lettura', STATUS[b.status] || ''], ['Lista', b.list || ''], ['Prezzo', b.list && Number(b.price) > 0 ? euro(b.price) : ''], ['In prestito a', b.loanTo || ''],
  ].filter(([, v]) => v);
  $('peek-card').innerHTML = `
    <div class="peek-main">
      ${coverHtml(b)}
      <div class="peek-text">
        <strong>${esc(b.title || 'Senza titolo')}</strong>
        ${b.authors ? `<span>${esc(b.authors)}</span>` : ''}
        ${b.rating ? starsShow(b.rating) : ''}
      </div>
    </div>
    ${facts.length ? `<dl class="peek-facts">${facts.map(([k, v]) => `<div><b>${k}:</b> ${esc(v)}</div>`).join('')}</dl>` : ''}
    <button class="btn primary wide" id="peek-open">Apri la scheda</button>`;
  peek.classList.toggle('float', Boolean(anchor));
  peek.hidden = false;
  if (anchor) {
    // Sul PC il riquadro si mette accanto alla copertina, senza coprirla.
    const r = anchor.getBoundingClientRect();
    const card = $('peek-card').getBoundingClientRect();
    const left = r.right + 12 + card.width < window.innerWidth ? r.right + 12 : Math.max(8, r.left - card.width - 12);
    peek.style.left = left + 'px';
    peek.style.top = Math.max(8, Math.min(r.top, window.innerHeight - card.height - 8)) + 'px';
  } else {
    peek.style.left = '';
    peek.style.top = '';
  }
}

function closePeek() { $('peek').hidden = true; peekId = ''; }

/* ================= SCHEDA DA LEGGERE ================= */

let viewId = '';
/* Arrivando da un'etichetta della scheda, l'elenco si divide in gruppi:
   i libri di una persona per genere, i libri di un genere per persona. */
let groupBy = '';   // 'genre' oppure 'owner'
let groupFor = '';  // il filtro a cui il raggruppamento è legato: se il filtro cambia, i gruppi spariscono
let backTo = null; // da dove si è partiti toccando un'etichetta: serve al tasto Indietro
let visibleIds = []; // i libri mostrati nell'elenco, nel loro ordine: serve per passare al successivo
const itDate = (d) => { const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }); };

const LANGS = { it: 'Italiano', en: 'Inglese', fr: 'Francese', es: 'Spagnolo', de: 'Tedesco', pt: 'Portoghese', ja: 'Giapponese' };

/* I libri salvati prima della versione 23 non hanno la trama: la si cerca una volta sola, aprendo la scheda. */
async function fetchPlot(book) {
  if (book.plot || book.plotTried || !book.isbn) return;
  book.plotTried = true;
  try {
    const data = await lookupGoogle(book.isbn);
    if (data && data.description) book.plot = data.description;
    if (data && data.lang && !book.lang) book.lang = data.lang;
  } catch (e) { book.plotTried = false; /* senza rete si riprova la prossima volta */ }
  saveState();
  if (book.plot && viewId === book.id && !$('view').hidden) renderView(book);
}

function openView(book) {
  readsEditing = false;
  fetchPlot(book);
  renderView(book);
  show('view');
  $('view-body').scrollTop = 0;
}

/* Le letture del libro nella scheda: chi, dal, al. Si correggono qui (le date le mette l'app da sola). */
let readsEditing = false;
function readsHtml(b) {
  if (b.list) return '';
  const L = readsOf(b);
  if (!L.length && !readsEditing) return b.status === 'read' || b.status === 'reading' ? `<button class="link-btn reads-add" data-act="reads-edit">＋ Aggiungi le date di lettura</button>` : '';
  const line = (r) => `${r.who ? esc(r.who) + ' · ' : ''}${r.start ? 'dal ' + fmtDay(r.start) : 'inizio non segnato'}${r.end ? ' al ' + fmtDay(r.end) + (r.start ? ' · ' + daysBetween(r.start, r.end) + (daysBetween(r.start, r.end) === 1 ? ' giorno' : ' giorni') : '') : ' · in corso'}`;
  if (!readsEditing) return `<p class="view-label">Letture <button class="link-btn" data-act="reads-edit">Correggi</button></p>
    <ul class="reads">${L.map((r) => `<li>${line(r)}</li>`).join('')}</ul>`;
  const who = (r) => `<select data-r="${esc(r.id)}" data-f="who"><option value="">Chi?</option>${state.owners.map((o) => `<option${o === r.who ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  return `<p class="view-label">Letture <button class="link-btn" data-act="reads-done">Fatto</button></p>
    <div class="reads-edit">${L.map((r) => `<div class="reads-row">${who(r)}
      <label>Dal <input type="date" data-r="${esc(r.id)}" data-f="start" value="${esc(r.start || '')}"></label>
      <label>Al <input type="date" data-r="${esc(r.id)}" data-f="end" value="${esc(r.end || '')}"></label>
      <button class="link-btn danger" data-act="reads-del" data-r="${esc(r.id)}">Togli</button></div>`).join('')}
      <button class="link-btn" data-act="reads-new">＋ Aggiungi una lettura</button></div>`;
}

function renderView(b) {
  viewId = b.id;
  tintBook(bookColor(b));
  // Ogni etichetta porta all'elenco filtrato per quella voce. Nei desideri è attiva solo la lista.
  const own = isOwned(b);
  const tags = [...(b.list ? [[b.list, 'list:' + b.list]] : []),
    ...(b.genres || []).map((g) => [g, own ? 'genre:' + g : '']),
    ...ownersOf(b).map((o) => [o, own ? 'owner:' + o : '']),
    ...(mediaOf(b).length > 1 || !hasPaper(b) ? mediaOf(b).map((m) => [MEDIA[m], own ? 'media:' + m : '']) : []),
    ...(b.theme ? [['Tema: ' + b.theme, own ? 'theme:' + b.theme : '']] : []),
    ...(b.series ? [['Serie: ' + b.series + (seriesNumOf(b) ? ' · n. ' + seriesNumOf(b) : ''), own ? 'series:' + b.series : '']] : []),
    ...(b.shelf ? [[b.shelf + (b.shelfRow ? ', ripiano ' + b.shelfRow : ''), own ? 'place:' + b.shelf : '']] : [])];
  const facts = [
    ['Letto nel', b.status === 'read' && b.readAt ? showRead(b.readAt) : ''],
    ['In lettura da', b.status === 'reading' && b.startedAt ? new Date(b.startedAt).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : ''],
    ['Casa editrice', b.publisher], ['Anno di questa edizione', b.year], ['Pagine', b.pages],
    ['Serie', b.series ? b.series + (b.seriesNum ? ', n. ' + b.seriesNum : '') : ''],
    ['Formato', b.format],
    ['Comprato il', b.boughtAt ? itDate(b.boughtAt) : ''], [b.list ? 'Prezzo di copertina' : 'Prezzo pagato', Number(b.price) > 0 ? euro(b.price) : ''],
    ['Lingua', LANGS[b.lang] || ''],
    ['ISBN', b.isbn],
  ].filter(([, v]) => v);
  const links = storeLinks(b);
  $('view-body').innerHTML = `
    <div class="hero">
      <div class="hero-main">
        ${coverHtml(b, true)}
        <div class="hero-text">
          <h2>${esc(b.title || 'Senza titolo')}</h2>
          ${b.subtitle ? `<span class="hero-sub">${esc(b.subtitle)}</span>` : ''}
          ${b.authors ? `<span class="hero-author">${authorsOf(b).map((a) => (own ? `<button class="author-link" data-goto="author:${esc(a)}">${esc(a)}</button>` : esc(a))).join(', ')}</span>` : ''}
          ${b.rating ? `<span class="hero-stars">${starsShow(b.rating)}</span>` : ''}
        </div>
      </div>
      ${tags.length ? `<div class="hero-tags">${tags.map(([label, go]) => go ? `<button class="tag" data-goto="${esc(go)}">${esc(label)}</button>` : `<span class="tag still">${esc(label)}</span>`).join('')}</div>` : ''}
    </div>
    ${!isOwned(b) ? '' : `<div class="seg view-status" role="group" aria-label="Lettura">${Object.keys(STATUS).map((k) => `<button data-status="${k}" class="${b.status === k ? 'on' : ''}" aria-pressed="${b.status === k}">${STATUS[k]}</button>`).join('')}</div>`}
    ${b.loanTo ? `<p class="banner" style="margin-top:16px">In prestito a ${esc(b.loanTo)}${b.loanDate ? ' dal ' + esc(itDate(b.loanDate)) : ''}.</p>` : ''}
    ${b.plot ? `<p class="view-label">Trama</p><p class="plot${b.plot.length > 320 ? ' clamp' : ''}" id="view-plot">${esc(b.plot)}</p>${b.plot.length > 320 ? '<button class="link-btn" data-act="plot">Leggi tutto</button>' : ''}` : ''}
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    ${b.notes ? `<p class="view-label">Commento e note</p><p class="view-comment">${esc(b.notes)}</p>` : ''}
    ${readsHtml(b)}
    ${quotesHtml(b)}
    ${links.length ? `<p class="view-label">Dove trovarlo</p><div class="stores">${links.map(([name, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${name}</a>`).join(' ')}</div>` : ''}
    ${b.list && claims[b.id] ? `<p class="view-claim">🎁 ${claimName(b.id) ? `Lo prende <strong>${esc(claimName(b.id))}</strong>` : 'Qualcuno ha già preso questo libro'}, dal link della lista.
      ${claimName(b.id) ? '' : '<button class="link-btn" data-act="reveal">Mostra chi</button>'}<button class="link-btn" data-act="unclaim">Rendilo di nuovo libero</button></p>` : ''}
    <div class="view-actions">
      ${b.loanTo ? '<button class="btn primary wide" data-act="returned">È tornato a casa</button>' : ''}
      ${b.list ? '<button class="btn primary wide" data-act="bought">Comprato: sposta in libreria</button>' : ''}
      ${b.status === 'read' && !b.readAt ? '<button class="btn ghost wide" data-act="readdate">Aggiungi quando l\'hai letto</button>' : ''}
      ${b.list && !(Number(b.price) > 0) ? '<button class="btn ghost wide" data-act="price">Aggiungi il prezzo di copertina</button>' : ''}
    </div>`;
}

/* Citazioni: le frasi che vi sono rimaste, con la pagina. */
let quoteOpen = false;
function quotesHtml(b) {
  const qs = Array.isArray(b.quotes) ? b.quotes : [];
  return `<p class="view-label">Citazioni${qs.length ? ' · ' + qs.length : ''}</p>
    ${qs.map((q) => `<blockquote class="quote"><p>${esc(q.text)}</p><footer>${q.page ? 'p. ' + esc(q.page) : ''}<button class="link-btn" data-act="quote-del" data-quote="${esc(q.id)}" aria-label="Elimina la citazione">Elimina</button></footer></blockquote>`).join('')}
    ${quoteOpen ? `<div class="quote-form"><textarea id="quote-text" rows="3" placeholder="La frase che vuoi ricordare"></textarea>
      <div class="row"><input id="quote-page" type="text" inputmode="numeric" placeholder="Pagina" aria-label="Pagina"><button class="btn ghost" data-act="quote-cancel">Annulla</button><button class="btn primary" data-act="quote-save">Salva</button></div></div>`
      : '<button class="btn ghost wide" data-act="quote-add">Aggiungi una citazione</button>'}`;
}

/* ================= 6. SCHEDA LIBRO ================= */

let current = null; // { book, isNew, selected:Set }

const FIELDS = ['title', 'subtitle', 'authors', 'publisher', 'pages', 'year', 'isbn', 'notes', 'plot', 'readAt', 'shelfRow', 'series', 'seriesNum', 'theme', 'format', 'boughtAt', 'price', 'loanTo', 'loanDate'];

function openBook(book, opts = {}) {
  const isNew = !book.id;
  // Un libro nuovo va dove si sta guardando: in libreria, oppure nella lista desideri aperta.
  const defaultList = viewMode === 'wish' ? (filterList || state.wishlists[0] || '') : '';
  current = { book: { ...book }, isNew, selected: new Set(book.genres || []), list: isNew ? (book.list ?? defaultList) : (book.list || ''), media: new Set(mediaOf(book)) };
  if (current.list) current.media.delete('paper');
  $('book-heading').textContent = isNew ? 'Nuovo libro' : 'Modifica';
  $('book-close').innerHTML = isNew ? 'Annulla' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Indietro';
  for (const k of FIELDS) $('f-' + k).value = book[k] || '';
  current.owners = new Set(ownersOf(book));
  current.rating = Number(book.rating) || 0;
  $('f-owner-new').value = '';
  $('f-loan-back').hidden = isNew || !book.loanTo;
  // Suggerimenti: posizioni e serie già usate.
  const options = (key) => [...new Set(state.books.map((b) => b[key]).filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">`).join('');
  current.status = isNew ? (book.status || stickyStatus) : (book.status || '');
  renderFormStatus();
  current.place = book.shelf || '';
  $('f-place-new').value = '';
  renderFormPlaces();
  $('series-options').innerHTML = options('series');
  $('theme-options').innerHTML = options('theme');
  renderFormOwners();
  renderFormRating();
  $('f-genre-new').value = '';
  $('f-genre-note').textContent = opts.genreNote || '';
  const banner = $('book-banner');
  banner.hidden = !opts.banner;
  banner.textContent = opts.banner || '';
  $('book-delete').hidden = isNew;
  $('book-save-next').hidden = !isNew;
  $('book-bought').hidden = isNew || !current.list;
  $('f-list-new').value = '';
  renderFormLists();
  renderFormCover();
  renderFormGenres();
  renderStores();
  markMissing();
  show('book');
  $('book-form').scrollTop = 0;
}

function renderFormCover() {
  $('f-cover-view').outerHTML = coverHtml({ title: $('f-title').value, cover: current.book.cover }, true).replace('class="cover big"', 'class="cover big" id="f-cover-view"');
  $('f-cover-remove').hidden = !current.book.cover;
  // La scheda prende il colore della copertina.
  const b = current.book;
  const fallback = bookColor({ title: $('f-title').value, isbn: b.isbn });
  tintBook(b.cover && b.color && b.colorFor === coverKey(b) ? b.color : fallback);
  if (b.cover && b.colorFor !== coverKey(b)) {
    const cover = b.cover;
    extractColor(cover).then((color) => {
      if (!current || current.book !== b || b.cover !== cover) return;
      b.color = color;
      b.colorFor = coverKey(b);
      if (color) tintBook(color);
    });
  }
  if (!b.cover) { b.color = ''; b.colorFor = ''; }
}

function renderFormStatus() {
  for (const b of document.querySelectorAll('#f-status [data-status]')) {
    b.classList.toggle('on', b.dataset.status === current.status);
    b.setAttribute('aria-pressed', b.dataset.status === current.status);
  }
  // Lo stato di lettura vale per i libri posseduti, non per i desideri.
  $('f-status-field').hidden = Boolean(current.list) && !current.media.size;
  $('f-readAt-field').hidden = current.status !== 'read';
  if (current.status === 'read' && !$('f-readAt').value && current.book.status === 'reading') $('f-readAt').value = todayIt();
}

function renderFormPlaces() {
  $('f-places').innerHTML = state.places.length
    ? state.places.map((p) => `<button type="button" class="chip${current.place === p ? ' on' : ''}" data-place="${esc(p)}" aria-pressed="${current.place === p}">${esc(p)}</button>`).join('')
    : '<span class="hint">Aggiungi il primo mobile qui sotto: lo ritroverai in tutte le schede.</span>';
}

function addPlace(name) {
  name = name.trim().replace(/\s+/g, ' ');
  if (!name) return '';
  const existing = state.places.find((p) => p.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  state.places.push(name);
  saveState();
  return name;
}

function renderFormOwners() {
  $('f-owners').innerHTML = state.owners
    .map((o) => `<button type="button" class="chip${current.owners.has(o) ? ' on' : ''}" data-owner="${esc(o)}" aria-pressed="${current.owners.has(o)}">${esc(o)}</button>`)
    .join('');
}

/* ---------- Stelle: voto da 0,5 a 5 a mezze stelle ---------- */
const fmtRating = (r) => String(Number(r) || 0).replace('.', ',');
const starsStr = (r) => { r = Number(r) || 0; return '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : ''); };
const starsShow = (r) => `<span class="stars-show" style="--r:${Number(r) || 0}" role="img" aria-label="${fmtRating(r)} stelle su 5">★★★★★</span>`;
function starsButtons(v) {
  return [1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= v ? 'on' : n - 0.5 === v ? 'half' : ''}" data-star="${n}" aria-label="${n} su 5" aria-pressed="${n === v}">★</button>`).join('')
    + `<span class="stars-val">${v ? fmtRating(v) : ''}</span>`;
}
/* Si vota toccando una stella o facendo scorrere il dito sopra: la metà sinistra di una stella vale mezzo punto.
   Toccare di nuovo lo stesso voto lo toglie. */
function bindStars(el, get, set) {
  let start = 0, moved = false, active = false;
  const valueAt = (x) => {
    const btns = el.querySelectorAll('[data-star]');
    const left = btns[0].getBoundingClientRect().left, right = btns[4].getBoundingClientRect().right;
    return Math.max(0.5, Math.min(5, Math.ceil(((x - left) / (right - left)) * 10) / 2));
  };
  el.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('[data-star]')) return;
    active = true; moved = false; start = get();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* niente */ }
    set(valueAt(e.clientX));
  });
  el.addEventListener('pointermove', (e) => { if (!active) return; const v = valueAt(e.clientX); if (v !== get()) { moved = true; set(v); } });
  const end = () => {
    if (!active) return;
    active = false;
    if (!moved && get() === start) set(0);
    if (navigator.vibrate) navigator.vibrate(8);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { active = false; });
  // Tastiera: Invio sulla stella dà il voto pieno.
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-star]'); if (b && e.detail === 0) set(get() === Number(b.dataset.star) ? 0 : Number(b.dataset.star)); });
}

function renderFormRating() {
  $('f-rating').innerHTML = starsButtons(current.rating);
}

function renderFormLists() {
  // «In libreria» con l'icona dei libri; le liste desideri con un cuore, separate da una piccola scritta.
  const ICON_BOOKS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h3v16H5zM10 4h3v16h-3zM15.2 5.2l2.9-.8 3.6 14.7-2.9.8z"/></svg>';
  const ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
  const chip = (value, label, icon) => `<button type="button" class="chip place-chip${current.list === value ? ' on' : ''}" data-list="${esc(value)}" aria-pressed="${current.list === value}">${icon}${esc(label)}</button>`;
  $('f-lists').innerHTML = chip('', 'In libreria', ICON_BOOKS)
    + (state.wishlists.length ? '<span class="chips-sep">Desideri</span>' + state.wishlists.map((l) => chip(l, l, ICON_HEART)).join('') : '');
  // In lista desideri il cartaceo è quello che si vorrebbe: restano da indicare Kindle e Audible, se ci sono già.
  $('f-media-label').innerHTML = current.list ? 'Ce l\'ho già in versione <small>(facoltativo: il cartaceo è il desiderio)</small>' : 'Ce l\'ho in versione <small>(anche più di una)</small>';
  $('f-media').innerHTML = Object.keys(MEDIA).filter((k) => !(current.list && k === 'paper')).map((k) => `<button type="button" class="chip${current.media.has(k) ? ' on' : ''}" data-media="${k}" aria-pressed="${current.media.has(k)}">${MEDIA[k]}</button>`).join('');
  $('book').classList.toggle('is-digital', !current.list && !current.media.has('paper'));
  renderFormStatus();
}

function addWishlist(name) {
  name = name.trim().replace(/\s+/g, ' ');
  if (!name) return '';
  const existing = state.wishlists.find((l) => l.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  state.wishlists.push(name);
  saveState();
  return name;
}

function renderFormGenres() {
  $('f-genres').innerHTML = state.genres
    .map((g) => `<button type="button" class="chip${current.selected.has(g) ? ' on' : ''}" data-genre="${esc(g)}" aria-pressed="${current.selected.has(g)}">${esc(g)}</button>`)
    .join('');
}

function renderStores() {
  const links = storeLinks({ isbn: toIsbn13($('f-isbn').value), title: $('f-title').value, authors: $('f-authors').value });
  $('f-stores').innerHTML = links.length
    ? 'Cerca su ' + links.map(([name, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${name}</a>`).join(' ')
    : '';
}

function markMissing() {
  for (const k of ['title', 'authors', 'publisher', 'pages', 'year']) {
    document.querySelector(`.field[data-key="${k}"]`).classList.toggle('missing', !$('f-' + k).value.trim());
  }
  document.querySelector('.field[data-key="genres"]').classList.toggle('missing', current.selected.size === 0);
}

function readForm() {
  const b = current.book;
  for (const k of FIELDS) b[k] = $('f-' + k).value.trim();
  b.isbn = toIsbn13(b.isbn) || cleanIsbn(b.isbn);
  b.genres = state.genres.filter((g) => current.selected.has(g));
  b.list = current.list || '';
  b.media = Object.keys(MEDIA).filter((k) => current.media.has(k) && !(b.list && k === 'paper'));
  if (!b.list && !b.media.length) b.media = ['paper'];
  if (!b.list && !b.media.includes('paper')) { current.place = ''; b.format = ''; b.loanTo = ''; }
  setStatus(b, isOwned(b) ? current.status : '');
  if (b.status === 'read' && $('f-readAt').value) b.readAt = $('f-readAt').value;
  b.shelf = current.place || '';
  if (!b.shelf) b.shelfRow = '';
  b.owners = state.owners.filter((o) => current.owners.has(o));
  delete b.owner;
  b.rating = current.rating || 0;
  if (b.loanTo && !b.loanDate) b.loanDate = today();
  if (!b.loanTo) b.loanDate = '';
  return b;
}

/* Appena un libro diventa «Letto» si chiede com'era: stelle da 1 a 5 e due righe di commento.
   Si può sempre rimandare: voto e commento restano modificabili dalla scheda. */
let reviewId = '', reviewStars = 0;
function renderReviewStars() {
  $('review-stars').innerHTML = starsButtons(reviewStars);
}
function openReview(b) {
  reviewId = b.id;
  reviewStars = Number(b.rating) || 0;
  $('review-title').textContent = 'Com\'era «' + (b.title || 'questo libro') + '»?';
  $('review-text').value = b.notes || '';
  $('review-when').value = b.readAt || '';
  $('review-card').style.setProperty('--book', bookColor(b));
  renderReviewStars();
  show('review');
}
function saveReview() {
  const b = state.books.find((x) => x.id === reviewId);
  if (b) {
    b.rating = reviewStars;
    b.notes = $('review-text').value.trim();
    if (b.status === 'read') b.readAt = $('review-when').value.trim(); // serve all'anno in libri e all'obiettivo
    b.updatedAt = Date.now();
    saveState();
    renderList();
    if (!$('view').hidden && viewId === b.id) renderView(b);
    toast(reviewStars || b.notes ? 'Recensione salvata' : 'Salvato');
  }
  hide('review');
}

function saveBook(noReview) {
  const wasRead = current.book.status === 'read';
  const b = readForm();
  if (!b.title) {
    toast('Scrivi almeno il titolo.');
    $('f-title').focus();
    return false;
  }
  b.updatedAt = Date.now();
  if (current.isNew) {
    b.id = newId();
    b.addedAt = Date.now();
    state.books.push(b);
  } else {
    const i = state.books.findIndex((x) => x.id === b.id);
    if (i >= 0) state.books[i] = b;
  }
  if (!saveState()) return false;
  if (current.isNew) { lastAddedId = b.id; setTimeout(() => { lastAddedId = ''; }, 1500); }
  renderList();
  refreshColors();
  if (!$('view').hidden) renderView(b);
  if (!$('batch').hidden) renderBatch();
  toast(b.list ? 'Salvato in «' + b.list + '»' : current.isNew ? 'Aggiunto in libreria' : 'Salvato', null, null, b.cover);
  // Segnato «Letto» dal modulo senza dare un voto: si chiede subito la recensione.
  if (!noReview && b.status === 'read' && !wasRead && !b.rating) openReview(b);
  return true;
}

function addGenre(name) {
  name = name.trim().replace(/\s+/g, ' ');
  if (!name) return '';
  const existing = state.genres.find((g) => g.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  state.genres.push(name);
  saveState();
  return name;
}

/* Riduce una foto a una miniatura leggera, da salvare insieme al libro. */
function fileToThumb(file, maxSide = 420) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
    img.src = url;
  });
}

/* Completa SOLO i campi vuoti: quello che è stato scritto a mano non viene toccato. */
async function refillFromCatalogs() {
  const isbn = toIsbn13($('f-isbn').value);
  if (!isbn) return toast('Per cercare nei cataloghi serve un ISBN valido.');
  toast('Cerco nei cataloghi…');
  const { data, failed } = await lookupIsbn(isbn);
  if (!data) return toast(failed ? 'Cataloghi non raggiungibili: controlla la connessione.' : 'Nessun dato trovato per questo ISBN.');
  let filled = 0;
  for (const k of ['title', 'subtitle', 'authors', 'publisher', 'pages', 'year']) {
    if (!$('f-' + k).value.trim() && data[k]) { $('f-' + k).value = data[k]; filled++; }
  }
  if (!$('f-plot').value.trim() && data.description) { $('f-plot').value = data.description; filled++; }
  if (!current.book.cover) {
    const cover = data.cover || (await probeCover(isbn));
    if (cover) { current.book.cover = cover; renderFormCover(); filled++; }
  }
  if (current.selected.size === 0) {
    const s = suggestGenres(data.subjects, $('f-authors').value, data.description);
    if (s.genres.length) { s.genres.forEach((g) => current.selected.add(g)); renderFormGenres(); filled++; }
  }
  markMissing();
  toast(filled ? 'Campi completati: ' + filled : 'I cataloghi non hanno altri dati.');
}

/* Da un ISBN alla scheda precompilata. È il cuore dell'app. */
async function handleIsbn(isbn) {
  const dup = state.books.find((b) => b.isbn === isbn);
  if (dup) {
    const when = dup.addedAt ? ' il ' + new Date(dup.addedAt).toLocaleDateString('it-IT') : '';
    openBook(dup, { banner: dup.list
      ? 'Questo libro è già nella lista desideri «' + dup.list + '».'
      : 'Questo libro è già in libreria (aggiunto' + when + ').' });
    return;
  }
  const { data, failed, googleDown } = await lookupIsbn(isbn);
  if (!data) {
    openBook({ isbn, genres: [] }, {
      banner: googleDown && !googleKey()
        ? 'Google Books, il catalogo principale, non è ancora attivo: inserisci la chiave nelle Impostazioni. Intanto puoi compilare la scheda a mano.'
        : googleDown
        ? 'Google Books non ha risposto (chiave non valida o limite giornaliero raggiunto). Puoi compilare la scheda a mano e completarla più tardi.'
        : failed
        ? 'Cataloghi non raggiungibili. Puoi compilare la scheda a mano e completarla più tardi.'
        : 'Libro non trovato nei cataloghi. Compila la scheda a mano: l\'ISBN è già inserito.',
    });
    return;
  }
  if (!data.cover) data.cover = await probeCover(isbn);
  const s = suggestGenres(data.subjects, data.authors, data.description);
  const note = s.source === 'author' ? 'suggerito dai tuoi libri di ' + firstAuthor(data.authors)
    : s.source === 'catalog' ? 'suggerito dal catalogo, correggilo se serve' : 'scegline uno o più';
  openBook({ ...data, subjects: undefined, description: undefined, plot: data.description || '', plotTried: true, genres: s.genres }, { genreNote: '(' + note + ')' });
}

/* ================= 7. SCANNER ================= */

let scan = { stream: null, timer: null, busy: false, native: null, zxing: null, canvas: null, mode: 'add', paused: false, found: null, isbn: '' };

function zxingReader() {
  if (!scan.zxing && window.ZXing) {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    scan.zxing = new ZXing.MultiFormatReader();
    scan.zxing.setHints(hints);
  }
  return scan.zxing;
}

/* Legge un codice EAN-13 da un canvas. Restituisce le cifre oppure ''. */
function decodeCanvas(canvas) {
  const reader = zxingReader();
  if (!reader) return '';
  try {
    const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
    return reader.decodeWithState(bitmap).getText();
  } catch (e) {
    return '';
  } finally {
    reader.reset();
  }
}

async function nativeDetector() {
  if (scan.native !== null) return scan.native;
  scan.native = false;
  try {
    if ('BarcodeDetector' in window) {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('ean_13')) scan.native = new window.BarcodeDetector({ formats: ['ean_13'] });
    }
  } catch (e) { /* si usa la libreria ZXing */ }
  return scan.native;
}

async function readFrame(source, w, h) {
  const detector = await nativeDetector();
  if (detector) {
    try {
      const codes = await detector.detect(source);
      if (codes.length) return codes[0].rawValue;
      return '';
    } catch (e) { scan.native = false; }
  }
  // Riserva (iPhone): si ritaglia la fascia centrale del fotogramma e la si passa a ZXing.
  const c = scan.canvas || (scan.canvas = document.createElement('canvas'));
  const sx = w * 0.06, sw = w * 0.88, sy = h * 0.28, sh = h * 0.44;
  const scale = Math.min(1, 1100 / sw);
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext('2d', { willReadFrequently: true }).drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return decodeCanvas(c);
}

async function openScanner(mode) {
  setScanMode(mode === 'check' || mode === 'batch' ? mode : 'add');
  show('scanner');
  setScanStatus('Avvio la fotocamera…');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setScanStatus('Fotocamera non disponibile qui. Usa «Fotografa il codice» o «Scrivi l\'ISBN».');
    return;
  }
  try {
    scan.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    setScanStatus(e && e.name === 'NotAllowedError'
      ? 'Fotocamera non autorizzata. Consenti l\'accesso nelle impostazioni del browser, oppure usa i pulsanti qui sotto.'
      : 'Non riesco ad aprire la fotocamera. Usa i pulsanti qui sotto.');
    return;
  }
  const video = $('video');
  video.srcObject = scan.stream;
  try { await video.play(); } catch (e) { /* parte al primo tocco */ }
  const track = scan.stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  $('scan-torch').hidden = !caps.torch;
  $('scan-torch').dataset.on = '';
  setScanStatus('Inquadra il codice a barre sul retro del libro');
  scan.timer = setInterval(scanTick, 160);
}

async function scanTick() {
  const video = $('video');
  if (scan.busy || scan.paused || !scan.stream || video.readyState < 2 || !video.videoWidth) return;
  scan.busy = true;
  try {
    const text = await readFrame(video, video.videoWidth, video.videoHeight);
    if (text) await onCode(text);
  } finally {
    scan.busy = false;
  }
}

/* Codici che non sono ISBN ma stanno sui libri: 977 dei volumi da edicola, codici interni dei libri vecchi.
   Non si trovano nei cataloghi, ma si tengono nella scheda: così «Ce l'ho già?» li riconosce la volta dopo. */
let pendingBarcode = '';
const otherCode = (text) => { const c = String(text || '').replace(/\D/g, ''); return /^\d{6,14}$/.test(c) ? c : ''; };
const byBarcode = (code) => state.books.find((b) => b.barcode === code);

async function onCode(text) {
  const isbn = toIsbn13(text);
  if (!isbn) {
    const code = otherCode(text);
    if (!code) { setScanStatus('Questo codice non è un ISBN. Cerca il codice che inizia con 978 o 979.'); return; }
    if (scan.mode === 'check') return showCheckResult('', code);
    if (scan.mode === 'batch') return batchCode('', code);
    stopCamera();
    if (navigator.vibrate) navigator.vibrate(60);
    hide('scanner');
    const known = byBarcode(code);
    if (known) return openBook(known, { banner: 'Questo libro è già ' + (known.list ? 'nella lista «' + known.list + '».' : 'in libreria.') });
    return openManualForCode(code);
  }
  if (scan.mode === 'check') return showCheckResult(isbn);
  if (scan.mode === 'batch') return batchCode(isbn);
  stopCamera();
  if (navigator.vibrate) navigator.vibrate(60);
  setScanStatus('Trovato ' + isbn + '. Cerco il libro…');
  await handleIsbn(isbn);
  hide('scanner');
}

/* Modalità «Ce l'ho già?»: risposta immediata, senza aprire la scheda e senza internet. */
function setScanMode(mode) {
  scan.mode = mode;
  scan.paused = false;
  hide('scan-result');
  $('scan-mode-add').classList.toggle('on', mode === 'add');
  $('scan-mode-check').classList.toggle('on', mode === 'check');
  $('scan-mode-batch').classList.toggle('on', mode === 'batch');
  renderBatchBar();
  if (scan.stream) setScanStatus(mode === 'check' ? 'Inquadra il codice per sapere se il libro è già vostro'
    : mode === 'batch' ? 'Inquadra un libro dopo l\'altro: li salvo da solo' : 'Inquadra il codice a barre sul retro del libro');
}

/* ---------- Scansione a raffica ----------
   Un codice dopo l'altro, senza aprire la scheda: il libro viene cercato e salvato da solo
   mentre si inquadra già il successivo. Alla fine un riepilogo mostra cosa è entrato e cosa
   va completato, e permette di dare a tutti in un colpo la persona, il mobile e lo stato di lettura. */
let batch = { seen: new Set(), items: [], running: false };

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    batch.audio = batch.audio || new Ctx();
    const o = batch.audio.createOscillator(), g = batch.audio.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(batch.audio.destination);
    o.start(); o.stop(batch.audio.currentTime + 0.09);
  } catch (e) { /* senza suono resta il lampo verde */ }
}

function flashFrame(kind) {
  const f = document.querySelector('.scan-frame');
  f.classList.remove('hit', 'dup');
  void f.offsetWidth;
  f.classList.add(kind);
  setTimeout(() => f.classList.remove(kind), 600);
}

function batchCode(isbn, code) {
  const key = isbn || code;
  if (batch.seen.has(key)) return; // il codice resta inquadrato per qualche istante: si conta una volta sola
  batch.seen.add(key);
  const dup = isbn ? state.books.find((b) => b.isbn === isbn) : byBarcode(code);
  if (dup) {
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    flashFrame('dup');
    setScanStatus((dup.list ? 'Già tra i desideri: ' : 'Già in libreria: ') + '«' + (dup.title || isbn) + '»');
    return;
  }
  if (navigator.vibrate) navigator.vibrate(60);
  beep();
  flashFrame('hit');
  if (code) {
    // Niente da cercare: il libro entra con il solo codice e va completato a mano nel riepilogo.
    const b = { id: newId(), addedAt: Date.now(), updatedAt: Date.now(), isbn: '', barcode: code, title: '', genres: [], owners: [], list: '', status: '' };
    state.books.push(b);
    saveState();
    batch.items.push({ isbn: '', code, state: 'code', id: b.id });
    setScanStatus('Codice da edicola o interno: lo completi alla fine');
    renderBatchBar();
    return;
  }
  batch.items.push({ isbn, state: 'wait', id: '' });
  setScanStatus('Preso. Avanti il prossimo');
  renderBatchBar();
  runBatch();
}

const want0 = (item) => state.books.find((x) => x.id === item.id);
async function batchLookup(item) {
  let found = null, failed = false;
  if (!item.isbn && item.q) {
    // Libro importato senza ISBN: si cerca per titolo e autore, e si prende il primo con lo stesso titolo.
    try {
      const want = state.books.find((x) => x.id === item.id);
      const t = norm((want && want.title) || '');
      found = (await searchByText(item.q)).find((x) => t && (norm(x.title).startsWith(t) || t.startsWith(norm(x.title)))) || null;
      if (found && found.isbn && state.books.some((x) => x.isbn === found.isbn && x.id !== item.id)) found.isbn = '';
    } catch (e) { failed = true; }
    const b = want0(item);
    if (b && found) {
      if (!b.isbn && found.isbn) b.isbn = found.isbn;
      if (!found.cover && b.isbn) found.cover = await probeCover(b.isbn);
      for (const k of ['subtitle', 'authors', 'publisher', 'year', 'pages', 'cover', 'lang']) if (!b[k] && found[k]) b[k] = found[k];
      if (!b.plot) b.plot = found.description || '';
      b.plotTried = true;
      if (!(b.genres || []).length) b.genres = suggestGenres(found.subjects, found.authors, found.description).genres.filter((g) => state.genres.includes(g));
      b.updatedAt = Date.now();
    }
    item.state = found ? 'ok' : failed ? 'failed' : 'notfound';
    saveState();
    return;
  }
  try { const r = await lookupIsbn(item.isbn); found = r.data; failed = Boolean(r.failed || (r.googleDown && !r.data)); } catch (e) { failed = true; }
  let b = item.id ? state.books.find((x) => x.id === item.id) : null;
  if (!b) {
    if (state.books.some((x) => x.isbn === item.isbn)) { item.state = 'ok'; return; }
    b = { id: newId(), addedAt: Date.now(), isbn: item.isbn, title: '', genres: [], owners: [], list: '', status: '' };
    state.books.push(b);
    item.id = b.id;
  }
  if (found) {
    if (!found.cover) found.cover = await probeCover(item.isbn);
    const s = suggestGenres(found.subjects, found.authors, found.description);
    for (const k of ['title', 'subtitle', 'authors', 'publisher', 'year', 'pages', 'cover', 'seriesNum', 'lang']) if (!b[k] && found[k]) b[k] = found[k];
    if (!b.plot) b.plot = found.description || '';
    b.plotTried = true;
    if (!(b.genres || []).length) b.genres = s.genres.filter((g) => state.genres.includes(g));
  }
  b.updatedAt = Date.now();
  item.state = found ? 'ok' : failed ? 'failed' : 'notfound';
  saveState();
}

async function runBatch() {
  if (batch.running) return;
  batch.running = true;
  try {
    let item;
    while ((item = batch.items.find((x) => x.state === 'wait'))) {
      await batchLookup(item);
      const b = state.books.find((x) => x.id === item.id);
      if (scan.mode === 'batch' && !$('scanner').hidden && b) setScanStatus(item.state === 'ok' ? '✓ ' + (b.title || item.isbn) : 'Non trovato: lo completi alla fine');
      renderBatchBar();
      if (!$('batch').hidden) renderBatch();
    }
  } finally { batch.running = false; }
  renderList();
  refreshColors();
}

const batchBooks = () => batch.items.map((it) => [it, state.books.find((b) => b.id === it.id)]).filter(([it, b]) => b || it.state === 'wait');

function renderBatchBar() {
  const on = scan.mode === 'batch';
  $('scan-batch-bar').hidden = !on;
  if (!on) return;
  const n = batch.items.length, wait = batch.items.filter((x) => x.state === 'wait').length;
  $('scan-batch-count').textContent = (n === 1 ? '1 libro' : n + ' libri') + (wait ? ' · ' + wait + ' in ricerca' : '');
  $('scan-batch-done').disabled = !n;
}

function renderBatch() {
  const rows = batchBooks();
  const books = rows.map(([, b]) => b).filter(Boolean);
  const wait = rows.filter(([it]) => it.state === 'wait').length;
  const todo = rows.filter(([it, b]) => b && (it.state !== 'ok' || isIncomplete(b)));
  const offline = rows.filter(([it]) => it.state === 'failed').length;
  $('batch-title').textContent = books.length === 1 ? '1 libro aggiunto' : books.length + ' libri aggiunti';
  $('batch-info').textContent = wait ? 'Sto ancora cercando ' + (wait === 1 ? '1 libro' : wait + ' libri') + '…'
    : todo.length ? (todo.length === 1 ? '1 libro ha' : todo.length + ' libri hanno') + ' dati da completare: sono in cima, toccali per sistemarli.'
    : books.length ? 'Tutti completi. Tocca un libro se vuoi controllarlo.' : 'Nessun libro in questa raffica.';
  $('batch-retry').hidden = !offline || wait > 0;
  const all = (test) => books.length > 0 && books.every(test);
  $('batch-owners').innerHTML = state.owners.map((o) => `<button type="button" class="chip${all((b) => ownersOf(b).includes(o)) ? ' on' : ''}" data-owner="${esc(o)}">${esc(o)}</button>`).join('');
  $('batch-places').innerHTML = state.places.length
    ? state.places.map((p) => `<button type="button" class="chip${all((b) => b.shelf === p) ? ' on' : ''}" data-place="${esc(p)}">${esc(p)}</button>`).join('')
    : '<p class="hint">Nessun mobile ancora: si creano dalle Impostazioni o dalla scheda di un libro.</p>';
  $('batch-status').innerHTML = Object.keys(STATUS).filter((k) => k !== 'reading').map((k) => `<button type="button" data-status="${k}" class="${all((b) => b.status === k) ? 'on' : ''}">${STATUS[k]}</button>`).join('');
  $('batch-apply').hidden = !books.length;
  const order = (r) => (r[0].state === 'wait' ? 2 : r[1] && (r[0].state !== 'ok' || isIncomplete(r[1])) ? 0 : 1);
  $('batch-list').innerHTML = [...rows].sort((a, b) => order(a) - order(b)).map(([it, b]) => (b
    ? bookRowHtml(it.state === 'ok' ? b : { ...b, title: b.title || (it.state === 'code' ? 'Codice da edicola o interno: scrivi il titolo' : it.state === 'failed' ? 'Non cercato: mancava la connessione' : 'Non trovato nei cataloghi'), authors: b.authors || (it.code ? 'Codice ' + it.code : 'ISBN ' + it.isbn) }, `data-id="${esc(b.id)}"`)
    : `<div class="book"><div class="cover">…</div><span class="book-info"><span class="book-title">Sto cercando…</span><span class="book-author">ISBN ${esc(it.isbn)}</span></span></div>`)).join('');
}

/* ================= IMPORTA DA ALTRE APP =================
   Goodreads, StoryGraph, Libib, Handy Library, Bookshelf, un foglio Excel o un semplice elenco:
   si riconoscono da sole le colonne (anche in italiano), si saltano i doppioni e poi
   copertine e trame si completano dai cataloghi, come nella scansione a raffica. */
const IMPORT_COLS = [
  ['isbn', /^(isbn ?13|isbn13|ean|ean ?13|isbn|isbn ?10|isbn\/uid|codice|barcode|upc)$/],
  ['title', /^(title|titolo|book title|name|nome)$/],
  ['authors', /^(authors?|autor[ei]|scrittore|creators?|author l-f)$/],
  ['publisher', /^(publisher|editore|casa editrice|publishers)$/],
  ['year', /^(year published|original publication year|anno|anno di pubblicazione|publish date|date published|published|publication year|year)$/],
  ['pages', /^(number of pages|pages|pagine|page count|num pages|numero di pagine)$/],
  ['rating', /^(my rating|rating|voto|star rating|stelle|valutazione)$/],
  ['readAt', /^(date read|last date read|read date|data lettura|letto nel|finito il|date finished|dates read)$/],
  ['status', /^(exclusive shelf|read status|status|lettura|stato|shelf)$/],
  ['notes', /^(my review|review|recensione|notes|note|commento|private notes)$/],
  ['owners', /^(di chi è|proprietario|owner)$/],
  ['list', /^(lista|wishlist)$/],
  ['genres', /^(genre|genres|genere|generi|categoria|categories)$/],
  ['series', /^(serie|series)$/],
  ['seriesNum', /^(numero|series number|volume)$/],
];
let importRows = [], importOpts = { owners: [], toread: 'library', media: 'paper', complete: true };

function splitCsv(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

/* Da una tabella (prima riga = intestazioni) ai libri. Se le intestazioni non si riconoscono, ritorna null. */
function tableToRecords(rows) {
  if (rows.length < 2) return null;
  const head = rows[0].map((h) => String(h || '').trim().toLowerCase().replace(/\s+/g, ' '));
  const map = {};
  head.forEach((h, i) => { const hit = IMPORT_COLS.find(([k, re]) => re.test(h) && !(k in map)); if (hit) map[hit[0]] = i; });
  // «Author l-f» (Cognome, Nome) solo se manca «Author».
  if (!('title' in map) && !('isbn' in map)) return null;
  return rows.slice(1).map((r) => {
    const o = {};
    for (const [k, i] of Object.entries(map)) o[k] = String(r[i] ?? '').trim();
    return o;
  });
}

function cleanRecord(o) {
  const v = (x) => String(x || '').replace(/^="?|"$/g, '').trim();
  const r = { title: v(o.title).replace(/\s*\(([^()]*),?\s*#\d+(\.\d+)?\)\s*$/, ''), authors: v(o.authors), publisher: v(o.publisher) };
  // Goodreads mette la serie tra parentesi nel titolo: «Shogun (Asian Saga, #1)».
  const sm = v(o.title).match(/\(([^()]*?),?\s*#(\d+)(?:\.\d+)?\)\s*$/);
  r.series = v(o.series) || (sm ? sm[1].trim() : '');
  r.seriesNum = v(o.seriesNum) || (sm ? sm[2] : '');
  r.isbn = toIsbn13(v(o.isbn)) || '';
  if (!r.isbn && /^\d{6,14}$/.test(v(o.isbn))) r.barcode = v(o.isbn);
  const y = v(o.year).match(/(1[5-9]|20)\d{2}/); r.year = y ? y[0] : '';
  r.pages = String(parseInt(v(o.pages), 10) || '').replace(/^0$/, '');
  const rt = Math.round((parseFloat(v(o.rating).replace(',', '.')) || 0) * 2) / 2; r.rating = rt >= 0.5 && rt <= 5 ? rt : 0;
  const st = v(o.status).toLowerCase();
  r.status = /^(read|letto|letti|finished)$/.test(st) ? 'read' : /currently|in corso|reading|leggendo/.test(st) ? 'reading' : /to-read|to read|da leggere|want/.test(st) ? 'toread' : '';
  // Date: 2024/03/12, 2024-03-12, 12/03/2024 → 12/03/2024; un anno resta un anno.
  const d = v(o.readAt).split(/[,;]| - /)[0].trim();
  let m;
  if ((m = d.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/))) r.readAt = m[3].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[1];
  else if ((m = d.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/))) r.readAt = m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3];
  else r.readAt = /^(19|20)\d{2}$/.test(d) ? d : '';
  if (r.readAt && !r.status) r.status = 'read';
  if (r.rating && !r.status) r.status = 'read';
  r.notes = v(o.notes).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  r.owners = v(o.owners).split(/[,;]/).map((x) => x.trim()).filter((x) => state.owners.includes(x));
  r.list = v(o.list);
  r.genres = v(o.genres).split(/[,;|]/).map((x) => x.trim().toLowerCase()).map((g) => state.genres.find((x) => x.toLowerCase() === g)).filter(Boolean);
  return r;
}

/* Testo incollato: una tabella con intestazioni, oppure una riga per libro (ISBN, oppure «Titolo - Autore»). */
function parsePasted(text) {
  const table = tableToRecords(splitCsv(text));
  if (table && table.length) return table.map(cleanRecord);
  return text.split(/\r?\n/).map((l) => l.trim().replace(/^[-•*\d.)\s]+(?=\D)/, '')).filter(Boolean).map((l) => {
    const isbn = toIsbn13(l);
    if (isbn) return cleanRecord({ isbn });
    const codes = l.match(/\b(97[89][\d-]{10,14}|\d{9}[\dXx])\b/);
    const parts = l.replace(codes ? codes[0] : '', '').split(/\s+[-–—]\s+|\t|;/).map((x) => x.trim()).filter(Boolean);
    return cleanRecord({ isbn: codes ? codes[0] : '', title: parts[0] || '', authors: parts.slice(1).join(', ') });
  }).filter((r) => r.title || r.isbn);
}

function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/xlsx.full.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
}

async function importFile(file) {
  try {
    let recs;
    if (/\.(xlsx|xlsm|xls|ods|numbers)$/i.test(file.name)) {
      toast('Leggo il foglio…');
      await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      recs = (tableToRecords(rows) || []).map(cleanRecord);
    } else if (/\.json$/i.test(file.name)) {
      const j = JSON.parse(await file.text());
      const arr = Array.isArray(j) ? j : j.books || [];
      if (!Array.isArray(j) && j.books && j.genres) return toast('Questo è un backup della Libreria: usa «Ripristina da un backup».');
      recs = arr.map((o) => cleanRecord({ ...o, authors: o.authors || o.author, isbn: o.isbn13 || o.isbn }));
    } else {
      recs = parsePasted(await file.text());
    }
    openImport(recs);
  } catch (e) {
    console.warn('[Libreria] import', e);
    toast('Non riesco a leggere questo file. Prova a salvarlo come CSV.');
  }
}

function importKey(r) { return r.isbn || (r.barcode ? 'c' + r.barcode : 't' + norm(r.title) + '|' + norm(authorsOf(r)[0] || '')); }
function importDup(r) {
  return state.books.find((b) => (r.isbn && b.isbn === r.isbn) || (r.barcode && b.barcode === r.barcode)
    || (!r.isbn && r.title && norm(b.title) === norm(r.title) && (!r.authors || norm(authorsOf(b)[0] || '') === norm(authorsOf(r)[0] || ''))));
}

function openImport(recs) {
  const seen = new Set();
  importRows = recs.filter((r) => r.title || r.isbn).map((r) => {
    const k = importKey(r); const twice = seen.has(k); seen.add(k);
    return { r, dup: twice || Boolean(importDup(r)) };
  });
  if (!importRows.length) return toast('Non ho trovato libri: servono almeno il titolo o l\'ISBN, uno per riga.');
  const me = pref('libreria.me', '');
  importOpts = { owners: state.owners.includes(me) ? [me] : [], toread: 'library', media: 'paper', complete: true, list: state.wishlists[0] || '' };
  renderImport();
  show('import');
}

function renderImport() {
  const fresh = importRows.filter((x) => !x.dup);
  const dups = importRows.length - fresh.length;
  const toread = fresh.filter((x) => x.r.status === 'toread').length;
  const noIsbn = fresh.filter((x) => !x.r.isbn).length;
  $('import-info').textContent = (fresh.length === 1 ? '1 libro nuovo' : fresh.length + ' libri nuovi')
    + (dups ? ' · ' + dups + ' già presenti, li salto' : '')
    + (noIsbn ? ' · ' + noIsbn + ' senza ISBN: li cerco per titolo' : '');
  $('import-owners').innerHTML = state.owners.map((o) => `<button type="button" class="chip${importOpts.owners.includes(o) ? ' on' : ''}" data-owner="${esc(o)}">${esc(o)}</button>`).join('');
  $('import-media').innerHTML = Object.keys(MEDIA).map((k) => `<button type="button" data-media="${k}" class="${importOpts.media === k ? 'on' : ''}">${MEDIA[k]}</button>`).join('');
  $('import-toread-box').hidden = !toread;
  $('import-toread-n').textContent = toread === 1 ? '1 libro è segnato «da leggere»' : toread + ' libri sono segnati «da leggere»';
  $('import-toread').innerHTML = [['library', 'In libreria'], ['wish', 'Nei desideri']].map(([k, l]) => `<button type="button" data-toread="${k}" class="${importOpts.toread === k ? 'on' : ''}">${l}</button>`).join('');
  $('import-list').hidden = importOpts.toread !== 'wish' || !state.wishlists.length;
  $('import-list').innerHTML = state.wishlists.map((l) => `<option${l === importOpts.list ? ' selected' : ''}>${esc(l)}</option>`).join('');
  $('import-complete').checked = importOpts.complete;
  $('import-go').disabled = !fresh.length;
  $('import-go').textContent = fresh.length === 1 ? 'Importa 1 libro' : 'Importa ' + fresh.length + ' libri';
  $('import-preview').innerHTML = importRows.slice(0, 60).map(({ r, dup }) => `<div class="import-row${dup ? ' dup' : ''}"><strong>${esc(r.title || 'ISBN ' + r.isbn)}</strong><span>${esc([r.authors, r.status ? STATUS[r.status] : '', r.rating ? starsStr(r.rating) : '', dup ? 'già presente' : ''].filter(Boolean).join(' · '))}</span></div>`).join('')
    + (importRows.length > 60 ? `<p class="hint">…e altri ${importRows.length - 60}.</p>` : '');
}

function runImport() {
  const fresh = importRows.filter((x) => !x.dup);
  if (!state.wishlists.length && importOpts.toread === 'wish') state.wishlists.push('Da comprare');
  const list = importOpts.list || state.wishlists[0] || '';
  batch = { seen: new Set(), items: [], running: false, audio: batch.audio };
  for (const { r } of fresh) {
    const wish = r.status === 'toread' && importOpts.toread === 'wish';
    const b = {
      id: newId(), addedAt: Date.now(), updatedAt: Date.now(), isbn: r.isbn, title: r.title, subtitle: '', authors: r.authors, publisher: cleanPublisher(r.publisher || ''),
      year: r.year, pages: r.pages, genres: r.genres, owners: r.owners.length ? r.owners : [...importOpts.owners],
      list: wish ? (state.wishlists.includes(r.list) ? r.list : list) : '', status: wish ? '' : r.status, readAt: wish ? '' : r.readAt, rating: wish ? 0 : r.rating, notes: r.notes,
      media: importOpts.media === 'paper' ? ['paper'] : [importOpts.media], series: r.series, seriesNum: r.seriesNum,
    };
    if (r.barcode) b.barcode = r.barcode;
    // Data di fine lettura (Goodreads «Date Read», ecc.) nello storico della persona scelta.
    const dm = !wish && r.status === 'read' && String(r.readAt).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dm) b.reads = [{ id: newId(), who: b.owners.length === 1 ? b.owners[0] : '', start: '', end: dm[3] + '-' + dm[2] + '-' + dm[1] }];
    if (wish) b.media = importOpts.media === 'paper' ? [] : [importOpts.media];
    state.books.push(b);
    const lookup = importOpts.complete && navigator.onLine && (r.isbn || r.title);
    batch.items.push({ isbn: r.isbn, q: r.isbn ? '' : [r.title, r.authors].filter(Boolean).join(' '), state: lookup ? 'wait' : 'ok', id: b.id });
  }
  saveState();
  hide('import');
  hide('settings');
  renderList();
  renderBatch();
  show('batch');
  runBatch();
  toast(fresh.length === 1 ? '1 libro importato' : fresh.length + ' libri importati');
}

function openBatch() {
  stopCamera();
  hide('scanner');
  renderBatch();
  show('batch');
}

function closeBatch() {
  hide('batch');
  if (!batch.items.some((x) => x.state === 'wait')) batch = { seen: new Set(), items: [], running: false, audio: batch.audio };
  renderList();
}

function batchApply(change) {
  for (const [, b] of batchBooks()) if (b) { change(b); b.updatedAt = Date.now(); }
  saveState();
  renderBatch();
  renderList();
}

function showCheckResult(isbn, code) {
  const book = isbn ? state.books.find((b) => b.isbn === isbn) : byBarcode(code);
  scan.paused = true;
  scan.found = book || null;
  scan.isbn = isbn;
  scan.code = code || '';
  if (navigator.vibrate) navigator.vibrate(book && !book.list ? [60, 60, 60] : 60);
  const digital = book && !book.list && !hasPaper(book);
  $('scan-answer').textContent = !book ? 'No, non ce l\'avete' : book.list ? 'È tra i desideri' : digital ? 'Di carta no' : 'Sì, ce l\'avete già';
  $('scan-detail').textContent = !book ? (isbn ? 'ISBN ' + isbn : 'Codice ' + code + ': non è un ISBN, quindi lo riconosco solo se l\'avete già inserito con questo codice.')
    : '«' + book.title + '»' + (book.list ? ' è nella lista ' + book.list + '.' : digital ? ' lo avete solo su ' + mediaOf(book).map((m) => MEDIA[m]).join(' e ') + '.' : book.loanTo ? ' è in libreria, in prestito a ' + book.loanTo + '.' : ' è in libreria' + (book.shelf ? ': ' + book.shelf : '') + '.');
  $('scan-open').hidden = !book;
  $('scan-wish').hidden = Boolean(book);
  show('scan-result');
}

function stopCamera() {
  clearInterval(scan.timer);
  scan.timer = null;
  if (scan.stream) scan.stream.getTracks().forEach((t) => t.stop());
  scan.stream = null;
  $('video').srcObject = null;
}

function closeScanner() {
  // Uscendo da una raffica con dei libri presi si passa dal riepilogo, così non resta nulla in sospeso.
  if (scan.mode === 'batch' && batch.items.length) return openBatch();
  stopCamera(); hide('scan-result'); hide('scanner');
}
const setScanStatus = (t) => { $('scan-status').textContent = t; };

async function toggleTorch() {
  const track = scan.stream && scan.stream.getVideoTracks()[0];
  if (!track) return;
  const on = !$('scan-torch').dataset.on;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    $('scan-torch').dataset.on = on ? '1' : '';
    $('scan-torch').textContent = on ? 'Spegni luce' : 'Luce';
  } catch (e) { $('scan-torch').hidden = true; }
}

/* Riserva: una foto del codice al posto della scansione dal vivo. */
async function scanFromPhoto(file) {
  setScanStatus('Leggo la foto…');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = async () => {
    const c = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    let text = '';
    const detector = await nativeDetector();
    if (detector) { try { const r = await detector.detect(c); text = r.length ? r[0].rawValue : ''; } catch (e) { /* ZXing sotto */ } }
    if (!text) text = decodeCanvas(c);
    if (text) await onCode(text);
    else setScanStatus('Nella foto non leggo il codice. Riprova più da vicino e con buona luce.');
  };
  img.onerror = () => setScanStatus('Foto non leggibile, riprova.');
  img.src = url;
}

/* ================= 8. AGGIUNTA A MANO ================= */

let manualResults = [];
let manualSeq = 0, manualTimer = null;

/* live = ricerca partita da sola mentre si scrive: non apre schede e non mostra errori di passaggio. */
async function manualSearch(text, live) {
  text = text.trim();
  if (!text) return;
  const seq = ++manualSeq;
  const isbn = toIsbn13(text);
  if (live && (isbn || /^[\d\s-]+$/.test(text))) return; // un ISBN si cerca solo con «Cerca»
  if (isbn) {
    $('manual-status').textContent = 'Cerco ' + isbn + '…';
    await handleIsbn(isbn);
    hide('manual');
    return;
  }
  $('manual-status').textContent = 'Cerco…';
  if (!live) $('manual-results').innerHTML = '';
  try {
    const found = await searchByText(text);
    if (seq !== manualSeq) return; // nel frattempo è stato scritto altro: questi risultati sono vecchi
    manualResults = found;
    $('manual-status').textContent = manualResults.length ? 'Tocca l\'edizione giusta.' : 'Nessun risultato: prova con altre parole.';
    $('manual-results').innerHTML = manualResults.map((b, i) => bookRowHtml(b, `data-result="${i}"`)).join('');
  } catch (e) {
    if (seq === manualSeq) $('manual-status').textContent = 'Catalogo non raggiungibile: controlla la connessione.';
  }
}

function pickManualResult(i) {
  const data = manualResults[i];
  if (!data) return;
  const toAudio = viewMode === 'audio';
  // Per un libro da edicola il risultato è un'altra edizione: niente controllo doppioni sul suo ISBN.
  const dup = !pendingBarcode && data.isbn && state.books.find((b) => b.isbn === data.isbn);
  hide('manual');
  if (dup) return openBook(dup, { banner: dup.list ? 'Questo libro è già nella lista desideri «' + dup.list + '».' : 'Questo libro è già in libreria.' });
  const s = suggestGenres(data.subjects, data.authors, data.description);
  const code = pendingBarcode;
  pendingBarcode = '';
  if (code) return openBook({ ...data, isbn: '', barcode: code, subjects: undefined, description: undefined, plot: data.description || '', plotTried: true, genres: s.genres },
    { banner: 'Codice ' + code + ' salvato nella scheda. Titolo, autore e trama vengono da un\'altra edizione: controlla editore, anno e copertina.' });
  openBook({ ...data, list: toAudio ? '' : undefined, media: toAudio ? ['audio'] : undefined, subjects: undefined, description: undefined, plot: data.description || '', plotTried: true, genres: s.genres }, { genreNote: s.genres.length ? '(suggerito, correggilo se serve)' : '(scegline uno o più)' });
}

/* ================= 9. IMPOSTAZIONI, BACKUP, ESPORTAZIONE ================= */

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const today = () => new Date().toISOString().slice(0, 10);

function downloadBackup() {
  download('libreria-backup-' + today() + '.json', JSON.stringify({ app: 'libreria', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 1), 'application/json');
}

function exportCsv() {
  const cols = [['title', 'Titolo'], ['subtitle', 'Sottotitolo'], ['authors', 'Autore'], ['publisher', 'Casa editrice'], ['year', 'Anno'], ['pages', 'Pagine'], ['genres', 'Genere'], ['isbn', 'ISBN'], ['list', 'Lista'], ['status', 'Lettura'], ['readAt', 'Letto nel'], ['owners', 'Di chi è'], ['rating', 'Voto'], ['notes', 'Commento'], ['shelf', 'Mobile'], ['shelfRow', 'Ripiano'], ['series', 'Serie'], ['seriesNum', 'Numero'], ['format', 'Formato'], ['media', 'Versione'], ['theme', 'Tema'], ['boughtAt', 'Comprato il'], ['price', 'Prezzo'], ['loanTo', 'Prestato a'], ['loanDate', 'Prestato dal']];
  const cell = (v) => '"' + String(Array.isArray(v) ? v.join(', ') : v ?? '').replace(/"/g, '""') + '"';
  const rows = [cols.map((c) => cell(c[1])).join(';')].concat(state.books.map((b) => cols.map((c) => cell(c[0] === 'list' ? (b.list || 'Libreria') : c[0] === 'media' ? mediaOf(b).map((m) => MEDIA[m]) : c[0] === 'owners' ? ownersOf(b) : c[0] === 'status' ? (STATUS[b.status] || '') : b[c[0]])).join(';')));
  download('libreria-' + today() + '.csv', '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
}

/* Il ripristino AGGIUNGE i libri mancanti: non cancella mai quelli già presenti. */
async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.books)) throw new Error('formato');
    let added = 0;
    for (const b of data.books) {
      if (!b || !b.title) continue;
      if (state.books.some((x) => x.id === b.id || (b.isbn && x.isbn === b.isbn))) continue;
      state.books.push({ ...b, id: b.id || newId() });
      added++;
    }
    for (const g of data.genres || []) if (typeof g === 'string' && !state.genres.includes(g)) state.genres.push(g);
    for (const l of data.wishlists || []) if (typeof l === 'string' && !state.wishlists.includes(l)) state.wishlists.push(l);
    for (const b of state.books) if (b.list && !state.wishlists.includes(b.list)) state.wishlists.push(b.list);
    for (const p of data.places || []) if (typeof p === 'string' && !state.places.includes(p)) state.places.push(p);
    for (const b of state.books) if (b.shelf && !state.places.includes(b.shelf)) state.places.push(b.shelf);
    for (const o of data.owners || []) if (typeof o === 'string' && !state.owners.includes(o)) state.owners.push(o);
    saveState();
    renderList();
    renderSettings();
    toast(added ? 'Libri ripristinati: ' + added : 'Nessun libro nuovo nel backup.');
  } catch (e) {
    toast('Questo file non è un backup della libreria.');
  }
}

/* Icona sulla schermata Home. Chrome su Android offre l'installazione diretta; su iPhone si passa da Condividi. */
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; if (!$('settings').hidden) renderInstall(); });
window.addEventListener('appinstalled', () => { installEvent = null; toast('Icona aggiunta alla schermata Home.'); renderInstall(); });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() {
  const box = $('install-box');
  if (isStandalone()) { box.innerHTML = '<p class="hint">Stai già usando l\'app dalla schermata Home.</p>'; return; }
  box.innerHTML = installEvent
    ? '<button class="btn primary wide" id="install-go">Aggiungi l\'icona alla schermata Home</button>'
    : isIos()
    ? `<ol class="steps"><li>Apri questa pagina in <b>Safari</b>.</li><li>Tocca <b>Condividi</b> (il quadrato con la freccia in su).</li><li>Scegli <b>Aggiungi alla schermata Home</b>, poi <b>Aggiungi</b>.</li></ol>
       <p class="hint">Attenzione: su iPhone l'app aperta dall'icona ha una memoria sua, separata da Safari. Finché non c'è la parte online, inserite i libri sempre dallo stesso posto (meglio dall'icona).</p>`
    : `<ol class="steps"><li>Apri questa pagina in <b>Chrome</b>.</li><li>Tocca i <b>tre puntini</b> in alto a destra.</li><li>Scegli <b>Aggiungi a schermata Home</b> (o <b>Installa app</b>), poi <b>Installa</b>.</li></ol>
       <p class="hint">Su Android l'app dall'icona usa gli stessi dati di Chrome: ritrovi tutti i libri.</p>`;
}

function renderTodo() {
  const owned = state.books.filter(isOwned);
  const rows = Object.entries(TODO).map(([k, [label, test]]) => [k, label, owned.filter(test).length]).filter(([k, , n]) => n && !(k === 'place' && !state.places.length));
  const sugg = seriesSuggestions();
  $('todo-box').innerHTML = rows.length
    ? rows.map(([k, label, n]) => `<button class="todo-row" data-todo="${k}"><span>${label}</span><b>${n}</b></button>`).join('')
      + (sugg.size ? `<button class="btn ghost wide" id="todo-series-fix">Completa le serie in automatico (${sugg.size} ${sugg.size === 1 ? 'libro' : 'libri'})</button>` : '')
    : '<p class="hint">Tutto in ordine: nessun libro da sistemare.</p>';
  $('btn-settings').classList.toggle('has-dot', rows.some(([k]) => k === 'genre' || k === 'dup' || k === 'series'));
}

function renderSettings() {
  renderInstall();
  renderTodo();
  if (typeof renderCloud === 'function') renderCloud();
  const n = state.books.length;
  $('settings-info').textContent = (n === 1 ? '1 libro salvato' : n + ' libri salvati')
    + ' su questo telefono. Per ora i dati restano solo qui: scarica un backup ogni tanto.';
  $('app-version').textContent = 'Versione ' + APP_VERSION;
  $('gkey').value = googleKey();
  $('place-list').innerHTML = state.places.map((p, i) => {
    const used = state.books.filter((b) => b.shelf === p).length;
    return `<div class="genre-item">
      <input type="text" id="place-${i}" value="${esc(p)}" data-place-index="${i}" aria-label="Nome del mobile">
      <button class="btn ghost" data-place-del="${i}" ${used ? 'disabled' : ''} aria-label="Elimina ${esc(p)}">${used ? used + (used === 1 ? ' libro' : ' libri') : 'Elimina'}</button>
    </div>`;
  }).join('');
  const me = pref('libreria.me', '');
  $('me-pick').innerHTML = state.owners.map((o) => `<button type="button" class="chip${o === me ? ' on' : ''}" data-me="${esc(o)}" aria-pressed="${o === me}">${esc(o)}</button>`).join('');
  $('owner-list').innerHTML = state.owners.map((o, i) => {
    const used = state.books.filter((b) => ownersOf(b).includes(o)).length;
    return `<div class="genre-item">
      <input type="text" id="owner-${i}" value="${esc(o)}" data-owner-index="${i}" aria-label="Nome della persona">
      <button class="btn ghost" data-owner-del="${i}" ${used ? 'disabled' : ''} aria-label="Elimina ${esc(o)}">${used ? used + (used === 1 ? ' libro' : ' libri') : 'Elimina'}</button>
    </div>`;
  }).join('');
  $('wish-list').innerHTML = state.wishlists.map((l, i) => {
    const used = state.books.filter((b) => b.list === l).length;
    return `<div class="genre-item">
      <input type="text" id="wish-${i}" value="${esc(l)}" data-wish-index="${i}" aria-label="Nome della lista">
      <button class="btn ghost" data-wish-del="${i}" ${used ? 'disabled' : ''} aria-label="Elimina ${esc(l)}">${used ? used + (used === 1 ? ' libro' : ' libri') : 'Elimina'}</button>
    </div>`;
  }).join('');
  $('genre-list').innerHTML = state.genres.map((g, i) => {
    const used = state.books.filter((b) => (b.genres || []).includes(g)).length;
    return `<div class="genre-item">
      <input type="text" id="genre-${i}" value="${esc(g)}" data-genre-index="${i}" aria-label="Nome del genere">
      <button class="btn ghost" data-genre-del="${i}" aria-label="Elimina ${esc(g)}">${used ? 'Elimina (' + used + ')' : 'Elimina'}</button>
    </div>`;
  }).join('');
}

function renamePlace(i, name) {
  const old = state.places[i];
  name = name.trim().replace(/\s+/g, ' ');
  if (!name || name === old) return renderSettings();
  const clash = state.places.findIndex((p, j) => j !== i && p.toLowerCase() === name.toLowerCase());
  const target = clash >= 0 ? state.places[clash] : name;
  for (const b of state.books) if (b.shelf === old) b.shelf = target;
  if (clash >= 0) state.places.splice(i, 1); else state.places[i] = name;
  filterGenre = filterParts().map((p) => (p === 'place:' + old ? 'place:' + target : p)).join('|');
  saveState();
  renderSettings();
  renderList();
  toast(clash >= 0 ? '«' + old + '» unito a «' + target + '».' : 'Mobile rinominato.');
}

function renameOwner(i, name) {
  const old = state.owners[i];
  name = name.trim().replace(/\s+/g, ' ');
  if (!name || name === old) return renderSettings();
  const clash = state.owners.findIndex((o, j) => j !== i && o.toLowerCase() === name.toLowerCase());
  const target = clash >= 0 ? state.owners[clash] : name;
  for (const b of state.books) {
    if (ownersOf(b).includes(old)) { b.owners = [...new Set(ownersOf(b).map((o) => (o === old ? target : o)))]; delete b.owner; }
  }
  if (clash >= 0) state.owners.splice(i, 1); else state.owners[i] = name;
  if (pref('libreria.me', '') === old) setPref('libreria.me', target);
  filterGenre = filterParts().map((p) => (p === 'owner:' + old ? 'owner:' + target : p)).join('|');
  saveState();
  renderSettings();
  renderList();
  toast(clash >= 0 ? '«' + old + '» unito a «' + target + '».' : 'Nome cambiato.');
}

function addSettingsOwner() {
  const name = $('owner-new').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (!state.owners.some((o) => o.toLowerCase() === name.toLowerCase())) { state.owners.push(name); saveState(); }
  $('owner-new').value = '';
  renderSettings();
}

/* Le copertine salvate dalle prime versioni sono piccole: si chiede a Google la stessa immagine più grande.
   La copertina resta quella, cambia solo la nitidezza. Se Google non ne ha una più grande, non si tocca nulla. */
async function sharpenCovers() {
  const todo = state.books.filter((b) => /books\.google\.[a-z.]+\/books\/content/.test(b.cover || '') && /[?&]zoom=1\b/.test(b.cover));
  if (!todo.length) return toast('Le copertine sono già alla grandezza migliore.');
  const btn = $('covers-sharpen');
  btn.disabled = true;
  let done = 0, failed = 0;
  const key = googleKey();
  for (const [i, b] of todo.entries()) {
    btn.textContent = 'Copertina ' + (i + 1) + ' di ' + todo.length + '…';
    const id = (b.cover.match(/[?&]id=([^&]+)/) || [])[1];
    if (!id) continue;
    try {
      const full = await getJson('https://www.googleapis.com/books/v1/volumes/' + encodeURIComponent(id) + '?country=IT' + (key ? '&key=' + encodeURIComponent(key) : ''));
      const img = (full && full.volumeInfo && full.volumeInfo.imageLinks) || {};
      const better = httpsUrl(img.medium || img.small || '');
      if (better && better !== b.cover) { b.cover = better; done++; }
    } catch (e) { failed++; }
  }
  btn.disabled = false;
  btn.textContent = 'Rendi più nitide le copertine';
  if (done) { saveState(); renderList(); }
  toast(failed === todo.length ? 'Google non ha risposto: riprova più tardi.'
    : done ? (done === 1 ? '1 copertina migliorata.' : done + ' copertine migliorate.') + (done < todo.length ? ' Per le altre Google non ha un\'immagine più grande.' : '')
    : 'Per queste copertine Google non ha un\'immagine più grande.');
}

function renameWishlist(i, name) {
  const old = state.wishlists[i];
  name = name.trim().replace(/\s+/g, ' ');
  if (!name || name === old) return renderSettings();
  const clash = state.wishlists.findIndex((l, j) => j !== i && l.toLowerCase() === name.toLowerCase());
  const target = clash >= 0 ? state.wishlists[clash] : name;
  for (const b of state.books) if (b.list === old) b.list = target;
  if (clash >= 0) state.wishlists.splice(i, 1); else state.wishlists[i] = name;
  if (filterList === old) filterList = target;
  saveState();
  renderSettings();
  renderList();
  toast(clash >= 0 ? '«' + old + '» unita a «' + target + '».' : 'Lista rinominata.');
}

function deleteWishlist(i) {
  const l = state.wishlists[i];
  if (state.books.some((b) => b.list === l)) return toast('Sposta o elimina prima i libri di questa lista.');
  state.wishlists.splice(i, 1);
  saveState();
  renderSettings();
  renderList();
  toast('Lista «' + l + '» eliminata.', 'Annulla', () => {
    state.wishlists.splice(i, 0, l);
    saveState();
    renderSettings();
    renderList();
  });
}

function renameGenre(i, name) {
  const old = state.genres[i];
  name = name.trim().replace(/\s+/g, ' ');
  if (!name || name === old) return renderSettings();
  const clash = state.genres.findIndex((g, j) => j !== i && g.toLowerCase() === name.toLowerCase());
  // Se il nuovo nome esiste già, i due generi vengono uniti.
  const target = clash >= 0 ? state.genres[clash] : name;
  for (const b of state.books) {
    if ((b.genres || []).includes(old)) b.genres = [...new Set(b.genres.map((g) => (g === old ? target : g)))];
  }
  if (clash >= 0) state.genres.splice(i, 1); else state.genres[i] = name;
  filterGenre = filterParts().map((p) => (p === 'genre:' + old ? 'genre:' + target : p)).join('|');
  saveState();
  renderSettings();
  renderList();
  toast(clash >= 0 ? '«' + old + '» unito a «' + target + '».' : 'Genere rinominato.');
}

function deleteGenre(i) {
  const g = state.genres[i];
  const before = JSON.stringify(state);
  state.genres.splice(i, 1);
  for (const b of state.books) if (b.genres) b.genres = b.genres.filter((x) => x !== g);
  saveState();
  renderSettings();
  renderList();
  toast('Genere «' + g + '» eliminato.', 'Annulla', () => {
    state = JSON.parse(before);
    saveState();
    renderSettings();
    renderList();
  });
}

/* ---------- Schede e avvisi ---------- */

function show(id) { $(id).hidden = false; scheduleBackSync(); }
function hide(id) { $(id).hidden = true; scheduleBackSync(); }

/* ---------- Tasto indietro del telefono ----------
   Il gesto o il tasto indietro chiude prima ciò che è aperto sopra l'elenco (anteprima, scheda,
   modulo, scanner…), poi l'elenco filtrato da un'etichetta, e solo alla fine esce dall'app.
   Si ottiene tenendo nella cronologia del browser una voce "di guardia" finché qualcosa è aperto. */
const LAYERS = ['sugg', 'pick', 'review', 'bulk', 'book', 'view', 'import', 'year', 'settings', 'manual', 'scanner', 'batch', 'arrange', 'filter-sheet'];
let backGuard = false;
let backPending = false;
let backQueued = false;

function topLayer() {
  if (!$('peek').hidden && !$('peek').classList.contains('float')) return 'peek';
  const open = LAYERS.find((id) => !$(id).hidden);
  if (open) return open;
  if (backTo) return 'filtered';
  // Una pagina diversa dalla libreria di partenza (Desideri, Audible, un filtro, una ricerca, un autore…):
  // il gesto indietro riporta alla libreria invece di chiudere l'app.
  const q = $('search') && $('search').value.trim();
  return viewMode !== 'home' ? 'home' : null;
}

function goHome() {
  viewMode = 'home'; filterGenre = ''; filterList = ''; groupBy = ''; groupFor = ''; backTo = null;
  $('tools').hidden = true;
  if ($('search').value) $('search').value = '';
  renderList();
  window.scrollTo(0, 0);
}

function closeLayer(layer) {
  if (layer === 'peek') closePeek();
  else if (layer === 'scanner') closeScanner();
  else if (layer === 'filtered') $('btn-back').click();
  else if (layer === 'home') goHome();
  else hide(layer);
}

function syncBackGuard() {
  backQueued = false;
  if (backPending) return; // si aspetta che il browser abbia finito di tornare indietro
  const open = topLayer() !== null;
  try {
    if (open && !backGuard) { history.pushState({ libreria: 1 }, ''); backGuard = true; }
    else if (!open && backGuard) { backGuard = false; backPending = true; history.back(); }
  } catch (e) { /* dove la cronologia non è disponibile, il tasto indietro resta quello del browser */ }
}

function scheduleBackSync() {
  if (backQueued) return;
  backQueued = true;
  setTimeout(syncBackGuard, 0);
}

window.addEventListener('popstate', () => {
  if (backPending) { backPending = false; scheduleBackSync(); return; }
  backGuard = false;
  const layer = topLayer();
  if (layer) closeLayer(layer);
  scheduleBackSync();
});
// Qualunque tocco può aprire o chiudere qualcosa: dopo ognuno si ricontrolla.
document.addEventListener('click', scheduleBackSync);
document.addEventListener('touchend', scheduleBackSync, { passive: true });

let toastTimer = null;
function toast(text, actionLabel, action, cover) {
  const el = $('toast');
  el.innerHTML = (cover ? `<img class="toast-cover" src="${esc(cover)}" alt="" referrerpolicy="no-referrer">` : '') + `<span>${esc(text)}</span>`;
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.onclick = () => { el.hidden = true; action(); };
    el.appendChild(btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 7000 : 3200);
}

/* ================= 10. AVVIO ================= */

function init() {
  loadState();
  renderList();

  // Elenco
  $('search').addEventListener('input', renderList);
  $('sort').addEventListener('change', renderList);
  const filtersClick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.openFilters !== undefined) {
      $('filter-q').value = '';
      renderFilterSheet();
      show('filter-sheet');
      return;
    }
    if (chip.dataset.share !== undefined) { if (filterList) shareList(filterList); else chooseWishlist('il link', shareList, 'Quale lista vuoi condividere?'); return; }
    if (chip.dataset.claims !== undefined) { claimsShown = !claimsShown; renderList(); return; }
    // Nei desideri si tocca di nuovo la lista accesa per tornare a vederle tutte.
    if (viewMode === 'wish') filterList = filterList === chip.dataset.genre ? '' : chip.dataset.genre; else filterGenre = chip.dataset.genre;
    renderList();
  };
  $('filters').addEventListener('click', filtersClick);
  $('wish-lists').addEventListener('click', filtersClick);
  $('filter-close').addEventListener('click', () => hide('filter-sheet'));
  $('filter-clear').addEventListener('click', () => { filterGenre = ''; renderList(); hide('filter-sheet'); });
  $('filter-q').addEventListener('input', renderFilterSheet);
  $('filter-body').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    // Il pannello resta aperto: si possono accendere più filtri, uno per gruppo (es. Elena + Giallo).
    toggleFilter(chip.dataset.filter);
    renderList();
    renderFilterSheet();
  });
  $('filter-done').addEventListener('click', () => { hide('filter-sheet'); window.scrollTo(0, 0); });
  $('tab-library').addEventListener('click', () => { backTo = null; viewMode = 'library'; renderList(); });
  $('tab-wish').addEventListener('click', () => { backTo = null; viewMode = 'wish'; renderList(); });
  $('tab-audio').addEventListener('click', () => {
    backTo = null; viewMode = 'audio';
    if (viewKind === 'shelf') viewKind = flatView === 'list' ? 'list' : 'grid'; // gli audiolibri non stanno su uno scaffale
    renderList();
  });
  const closeViewMenu = () => { $('view-menu').hidden = true; $('view-cycle').setAttribute('aria-expanded', 'false'); };
  $('view-cycle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    viewKind = btn.dataset.view;
    flatView = viewKind;
    setPref('libreria.flatView', flatView);
    setPref('libreria.view', viewKind);
    closeViewMenu();
    renderList();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#view-menu')) closeViewMenu(); });
  window.addEventListener('scroll', closeViewMenu, { passive: true });
  // Home: si torna sempre al punto zero, cioè tutte le copertine della libreria, senza filtri.
  // Casa e «Libreria» nella barra in basso: si torna sempre alla pagina iniziale, senza filtri.
  const toHome = () => {
    for (const id of ['view', 'book', 'settings', 'manual', 'filter-sheet', 'arrange']) hide(id);
    closePeek();
    goHome();
    document.querySelector('.top').classList.remove('away');
  };
  $('btn-home').addEventListener('click', toHome);
  $('nav-home').addEventListener('click', toHome);
  $('nav-wish').addEventListener('click', () => {
    closePeek(); backTo = null; viewMode = 'wish'; $('tools').hidden = true; $('search').value = '';
    if (viewKind === 'shelf') viewKind = flatView === 'list' ? 'list' : 'grid';
    renderList(); window.scrollTo(0, 0); document.querySelector('.top').classList.remove('away');
  });
  $('nav-discover').addEventListener('click', () => {
    closePeek(); backTo = null; viewMode = 'discover'; renderList(); window.scrollTo(0, 0);
  });
  $('list').addEventListener('click', (e) => {
    const h = e.target.closest('[data-home]');
    if (h) { e.stopImmediatePropagation(); homeAction(h.dataset.home); return; }
    const d = e.target.closest('[data-home-done]');
    if (d) {
      e.stopImmediatePropagation();
      const b = state.books.find((x) => x.id === d.dataset.homeDone);
      if (!b) return;
      const prev = { status: b.status, readAt: b.readAt, startedAt: b.startedAt, reads: JSON.parse(JSON.stringify(readsOf(b))) };
      setStatus(b, 'read'); b.updatedAt = Date.now(); saveState(); renderList();
      toast('«' + b.title + '» segnato come letto, con la data di oggi.', 'Annulla', () => { Object.assign(b, prev); b.updatedAt = Date.now(); saveState(); renderList(); });
    }
  }, true);
  $('btn-arrange').addEventListener('click', () => { renderArrange(); show('arrange'); $('arrange-body').parentNode.scrollTop = 0; });
  $('arrange-close').addEventListener('click', () => hide('arrange'));
  $('arrange-body').addEventListener('click', (e) => {
    const el = e.target.closest('[data-id]');
    const book = el && state.books.find((b) => b.id === el.dataset.id);
    if (book) openView(book);
  });
  // Scaffale: un tocco lo apre, un secondo tocco riporta alla vista di prima (copertine o lista).
  $('btn-shelf').addEventListener('click', () => {
    if (viewKind === 'shelf') viewKind = flatView;
    else { flatView = viewKind; setPref('libreria.flatView', flatView); viewKind = 'shelf'; }
    setPref('libreria.view', viewKind);
    renderList();
    window.scrollTo(0, 0);
  });
  $('btn-search').addEventListener('click', () => {
    const tools = $('tools');
    tools.hidden = !tools.hidden;
    if (!tools.hidden) $('search').focus();
    else if ($('search').value) { $('search').value = ''; renderList(); }
  });
  $('zoom-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-zoom]'); if (b) setZoom(Number(b.dataset.zoom)); });
  for (const b of document.querySelectorAll('[data-zoom]')) b.classList.toggle('on', Number(b.dataset.zoom) === gridZoom);

  // Due dita sulla griglia: avvicinandole le copertine rimpiccioliscono, allontanandole ingrandiscono.
  let pinch = null;
  const spread = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  $('list').addEventListener('touchstart', (e) => { pinch = e.touches.length === 2 && viewKind === 'grid' ? { start: spread(e), done: false } : null; }, { passive: true });
  $('list').addEventListener('touchmove', (e) => {
    if (!pinch || pinch.done || e.touches.length !== 2) return;
    const ratio = spread(e) / pinch.start;
    if (ratio > 1.25) { pinch.done = true; setZoom(gridZoom - 1); }
    else if (ratio < 0.8) { pinch.done = true; setZoom(gridZoom + 1); }
  }, { passive: true });
  $('list').addEventListener('touchend', () => { pinch = null; }, { passive: true });
  $('list').addEventListener('click', (e) => {
    const d = e.target.closest('[data-disc]'); if (d) { openDiscover(Number(d.dataset.disc)); return; }
    const sg = e.target.closest('[data-sugg]'); if (sg) { e.stopPropagation(); openSugg(Number(sg.dataset.sugg)); return; }
    if (e.target.closest('[data-disc-now]')) maybeRefreshDiscover(true);
  });
  $('list').addEventListener('click', (e) => {
    const m = e.target.closest('[data-more-wish]'); if (m) { e.stopPropagation(); addAuthorMoreToWish(m.dataset.moreWish); return; }
    const c = e.target.closest('[data-claude-author]'); if (c) { e.stopPropagation(); askClaudeAuthor(c.dataset.claudeAuthor); return; }
    const w = e.target.closest('[data-claude-wish]'); if (w) { e.stopPropagation(); addClaudeToWish(w.dataset.claudeWish); return; }
    const so = e.target.closest('[data-claude-sort]'); if (so) { e.stopPropagation(); claudeSort = so.dataset.claudeSort; renderList(); }
  });

  // La testata si ritira scorrendo verso il basso e torna risalendo.
  let lastY = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const top = document.querySelector('.top');
    if (y > lastY + 6 && y > 140) top.classList.add('away');
    else if (y < lastY - 6 || y < 60) top.classList.remove('away');
    lastY = y;
  }, { passive: true });

  // Scheda da leggere: scorrendo con il dito a sinistra o a destra si passa al libro dopo o prima.
  // La scheda segue il dito: si trascina di lato, esce, e quella del libro vicino entra dal lato opposto.
  let drag = null;
  const card = $('view-body');
  const neighbor = (dir) => { const i = visibleIds.indexOf(viewId); return i < 0 ? null : state.books.find((b) => b.id === visibleIds[i + dir]) || null; };
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('view').addEventListener('touchstart', (e) => {
    drag = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dx: 0, on: false } : null;
  }, { passive: true });
  $('view').addEventListener('touchmove', (e) => {
    if (!drag) return;
    const dx = e.touches[0].clientX - drag.x;
    const dy = e.touches[0].clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) { drag.on = true; card.style.transition = 'none'; }
      else { if (Math.abs(dy) > 12) drag = null; return; }
    }
    // Se da quel lato non c'è un altro libro, la scheda oppone resistenza.
    drag.dx = neighbor(dx < 0 ? 1 : -1) ? dx : dx * 0.25;
    card.style.transform = 'translateX(' + drag.dx + 'px)';
    card.style.opacity = String(1 - Math.min(0.5, Math.abs(drag.dx) / 600));
  }, { passive: true });
  const endDrag = () => {
    if (!drag || !drag.on) { drag = null; return; }
    const dx = drag.dx;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - drag.t) > 0.5;
    const dir = dx < 0 ? 1 : -1;
    const next = neighbor(dir);
    drag = null;
    card.style.transition = calm ? 'none' : 'transform .18s ease-out, opacity .18s ease-out';
    if (next && (Math.abs(dx) > 90 || (fast && Math.abs(dx) > 30))) {
      card.style.transform = 'translateX(' + (-dir * 100) + '%)';
      card.style.opacity = '0';
      setTimeout(() => {
        openView(next);
        card.style.transition = 'none';
        card.style.transform = 'translateX(' + (dir * 55) + '%)';
        void card.offsetWidth; // fa partire l'animazione di ingresso dalla nuova posizione
        card.style.transition = calm ? 'none' : 'transform .24s cubic-bezier(.2, .8, .2, 1), opacity .24s ease-out';
        card.style.transform = '';
        card.style.opacity = '';
      }, calm ? 0 : 170);
    } else {
      card.style.transform = '';
      card.style.opacity = '';
      if (!next && Math.abs(dx) > 18) toast(dir > 0 ? 'È l\'ultimo libro dell\'elenco.' : 'È il primo libro dell\'elenco.');
    }
  };
  $('view').addEventListener('touchend', endDrag, { passive: true });
  $('view').addEventListener('touchcancel', endDrag, { passive: true });
  $('view-close').addEventListener('click', () => hide('view'));
  $('view-edit').addEventListener('click', () => { const b = state.books.find((x) => x.id === viewId); if (b) openBook(b); });
  $('view-body').addEventListener('change', (e) => {
    const f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    const b = state.books.find((x) => x.id === viewId);
    const r = b && readsOf(b).find((x) => x.id === e.target.dataset.r);
    if (!r) return;
    r[f] = e.target.value;
    if (f === 'end' && r.end && b.status !== 'read') setStatus(b, 'read', { bulk: true });
    if (r.end) b.readAt = new Date(r.end + 'T12:00:00').toLocaleDateString('it-IT');
    b.updatedAt = Date.now();
    saveState();
    renderList();
  });
  $('view-body').addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) {
      const target = go.dataset.goto;
      // Si ricorda il libro e l'elenco di partenza, per poterci tornare con Indietro.
      if (!backTo) backTo = { id: viewId, viewMode, filterGenre, filterList };
      hide('view');
      $('search').value = '';
      if (target.startsWith('list:')) { viewMode = 'wish'; filterList = target.slice(5); }
      else { viewMode = 'library'; filterGenre = target; }
      groupBy = target.startsWith('owner:') ? 'genre' : target.startsWith('genre:') ? 'owner' : '';
      quoteOpen = false;
      groupFor = target;
      renderList();
      window.scrollTo(0, 0);
      document.querySelector('.top').classList.remove('away');
      return;
    }
    const st = e.target.closest('[data-status]');
    const sb = st && state.books.find((x) => x.id === viewId);
    if (sb) {
      // Un tocco imposta lo stato; un secondo tocco sullo stesso lo toglie.
      const wasRead = sb.status === 'read';
      setStatus(sb, sb.status === st.dataset.status ? '' : st.dataset.status);
      // Toccando «Letto» nella scheda, di solito lo si è appena finito: si propone la data di oggi (modificabile).
      if (sb.status === 'read' && !wasRead && !sb.readAt) sb.readAt = todayIt();
      sb.updatedAt = Date.now();
      saveState();
      renderList();
      renderView(sb);
      if (sb.status === 'read' && !wasRead) openReview(sb);
      return;
    }
    const btn = e.target.closest('[data-act]');
    const b = btn && state.books.find((x) => x.id === viewId);
    if (!b) return;
    if (btn.dataset.act.startsWith('quote-')) {
      const act = btn.dataset.act;
      if (act === 'quote-add') { quoteOpen = true; renderView(b); setTimeout(() => $('quote-text').focus(), 30); return; }
      if (act === 'quote-cancel') { quoteOpen = false; renderView(b); return; }
      if (act === 'quote-save') {
        const text = $('quote-text').value.trim();
        if (!text) return toast('Scrivi la frase da ricordare.');
        b.quotes = [...(b.quotes || []), { id: newId(), text, page: $('quote-page').value.trim(), at: Date.now() }];
      }
      if (act === 'quote-del') b.quotes = (b.quotes || []).filter((q) => q.id !== btn.dataset.quote);
      quoteOpen = false;
      b.updatedAt = Date.now();
      saveState();
      renderView(b);
      return;
    }
    if (btn.dataset.act === 'plot') {
      const clamped = $('view-plot').classList.toggle('clamp');
      btn.textContent = clamped ? 'Leggi tutto' : 'Mostra meno';
      return;
    }
    if (btn.dataset.act === 'readdate') {
      openBook(b);
      $('f-readAt').scrollIntoView({ block: 'center' });
      $('f-readAt').focus();
      return;
    }
    if (btn.dataset.act === 'price') {
      openBook(b);
      $('f-price').scrollIntoView({ block: 'center' });
      $('f-price').focus();
      return;
    }
    if (btn.dataset.act === 'unclaim') { unclaimBook(b.id); return; }
    if (btn.dataset.act === 'reads-edit') { readsEditing = true; if (!readsOf(b).length) b.reads = [{ id: newId(), who: readerFor(b), start: '', end: b.status === 'read' ? today() : '' }]; renderView(b); return; }
    if (btn.dataset.act === 'reads-done') { readsEditing = false; b.reads = readsOf(b).filter((r) => r.start || r.end); b.updatedAt = Date.now(); saveState(); renderView(b); return; }
    if (btn.dataset.act === 'reads-new') { b.reads = [...readsOf(b), { id: newId(), who: readerFor(b), start: '', end: '' }]; renderView(b); return; }
    if (btn.dataset.act === 'reads-del') { b.reads = readsOf(b).filter((r) => r.id !== btn.dataset.r); b.updatedAt = Date.now(); saveState(); renderView(b); return; }
    if (btn.dataset.act === 'reveal') { claimRevealed.add(b.id); renderView(b); renderList(); return; }
    if (btn.dataset.act === 'returned') { b.loanTo = ''; b.loanDate = ''; }
    if (btn.dataset.act === 'bought') { const had = mediaOf(b); b.list = ''; b.media = ['paper', ...had]; if (!b.boughtAt) b.boughtAt = today(); }
    b.updatedAt = Date.now();
    saveState();
    renderList();
    renderView(b);
    toast(btn.dataset.act === 'bought' ? 'Spostato in libreria' : 'Segnato come tornato a casa');
  });

  // Mobili e librerie
  $('f-places').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    current.place = current.place === chip.dataset.place ? '' : chip.dataset.place;
    renderFormPlaces();
  });
  const addFormPlace = () => { const p = addPlace($('f-place-new').value); if (!p) return; current.place = p; $('f-place-new').value = ''; renderFormPlaces(); };
  $('f-place-add').addEventListener('click', addFormPlace);
  $('f-place-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFormPlace(); } });
  $('place-list').addEventListener('change', (e) => { if (e.target.dataset.placeIndex !== undefined) renamePlace(Number(e.target.dataset.placeIndex), e.target.value); });
  $('place-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-place-del]');
    if (!btn) return;
    const i = Number(btn.dataset.placeDel);
    if (state.books.some((b) => b.shelf === state.places[i])) return;
    state.places.splice(i, 1);
    saveState();
    renderSettings();
  });
  const addSettingsPlace = () => { if (addPlace($('place-new').value)) { $('place-new').value = ''; renderSettings(); } };
  $('place-add').addEventListener('click', addSettingsPlace);
  $('owner-list').addEventListener('change', (e) => { if (e.target.dataset.ownerIndex !== undefined) renameOwner(Number(e.target.dataset.ownerIndex), e.target.value); });
  $('owner-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-owner-del]');
    if (!del || del.disabled) return;
    state.owners.splice(Number(del.dataset.ownerDel), 1);
    saveState();
    renderSettings();
    renderList();
  });
  $('owner-add').addEventListener('click', addSettingsOwner);
  $('install-box').addEventListener('click', async (e) => {
    if (!e.target.closest('#install-go') || !installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch (err) { /* scelta annullata */ }
    installEvent = null;
    renderInstall();
  });
  $('me-pick').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-me]');
    if (!chip) return;
    setPref('libreria.me', chip.classList.contains('on') ? '' : chip.dataset.me);
    renderSettings();
    renderList();
  });
  // Ruotando il telefono o cambiando la finestra cambia il numero di copertine per mensola.
  let lastCols = 0, resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { const c = gridCols(); if (c !== lastCols) { lastCols = c; if ($('list').classList.contains('home')) renderList(); } }, 150);
  });
  $('covers-sharpen').addEventListener('click', sharpenCovers);
  $('place-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSettingsPlace(); });
  $('list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-hsort]');
    if (!btn) return;
    const m = btn.dataset.hsort;
    homeSplit = m && m !== homeSplit ? m : ''; // un secondo tocco sulla stessa scelta torna a tutti insieme
    setPref('libreria.homeSplit', homeSplit);
    if (homeSplit) { shelfSort = homeSplit; setPref('libreria.shelfSort', shelfSort); }
    renderList();
  });
  $('shelf-sort').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    shelfSort = btn.dataset.sort;
    setPref('libreria.shelfSort', shelfSort);
    renderList();
  });
  applyTheme('night'); // il tema Giorno è stato tolto: resta solo Sera
  refreshColors();
  // In modalità selezione un tocco sceglie o toglie il libro, invece di aprirlo.
  $('list').addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (more) { e.stopImmediatePropagation(); filterGenre = more.dataset.more; renderList(); window.scrollTo(0, 0); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) { e.stopImmediatePropagation(); openPick(); return; }
    if (!selecting) return;
    const el = e.target.closest('[data-id]');
    e.stopImmediatePropagation();
    if (!el) return;
    if (selected.has(el.dataset.id)) selected.delete(el.dataset.id); else selected.add(el.dataset.id);
    document.querySelectorAll(`#list [data-id="${CSS.escape(el.dataset.id)}"]`).forEach((n) => n.classList.toggle('sel', selected.has(el.dataset.id)));
    renderSelectBar();
  }, true);
  $('btn-select').addEventListener('click', () => setSelecting(!selecting));
  $('todo-box').addEventListener('click', (e) => {
    if (e.target.closest('#todo-series-fix')) {
      const sugg = seriesSuggestions();
      for (const b of state.books) {
        const s = sugg.get(b.id);
        if (!s) continue;
        b.series = b.series || s.series;
        if (!b.seriesNum && s.num) b.seriesNum = String(s.num);
        b.updatedAt = Date.now();
      }
      saveState();
      renderTodo();
      renderList();
      return toast('Serie completate: ' + sugg.size + (sugg.size === 1 ? ' libro.' : ' libri.'));
    }
    const row = e.target.closest('[data-todo]');
    if (!row) return;
    hide('settings');
    viewMode = 'library';
    filterGenre = 'todo:' + row.dataset.todo;
    renderList();
    window.scrollTo(0, 0);
  });
  $('pick-again').addEventListener('click', () => openPick(true));
  $('pick-close').addEventListener('click', () => hide('pick'));
  $('pick').addEventListener('click', (e) => { if (e.target === $('pick')) hide('pick'); });
  $('pick-lens').addEventListener('click', (e) => { const c = e.target.closest('[data-len]'); if (!c) return; pickLen = c.dataset.len; openPick(true); });
  $('pick-plot').addEventListener('click', (e) => { if (e.target.closest('[data-pick-more]')) { pickPlotOpen = true; const b = state.books.find((x) => x.id === pickId); if (b) renderPickPlot(b); } });
  $('pick-open').addEventListener('click', () => { const b = state.books.find((x) => x.id === pickId); hide('pick'); if (b) openView(b); });
  $('pick-start').addEventListener('click', () => {
    const b = state.books.find((x) => x.id === pickId);
    if (!b) return;
    setStatus(b, 'reading'); b.updatedAt = Date.now(); saveState(); hide('pick'); renderList();
    toast('«' + b.title + '» è sul comodino. Buona lettura!');
  });
  $('select-cancel').addEventListener('click', () => setSelecting(false));
  $('select-all').addEventListener('click', () => { for (const id of visibleIds) selected.add(id); renderList(); renderSelectBar(); });
  $('select-edit').addEventListener('click', () => { renderBulk(); show('bulk'); });
  $('bulk-close').addEventListener('click', () => { hide('bulk'); setSelecting(false); });
  $('bulk-back').addEventListener('click', () => hide('bulk')); // si torna alla scelta dei libri, ancora selezionati
  $('bulk-owners').addEventListener('click', (e) => {
    const c = e.target.closest('[data-owner]'); if (!c) return;
    const o = c.dataset.owner, off = c.classList.contains('on');
    bulkApply((b) => { const s = new Set(ownersOf(b)); if (off) s.delete(o); else s.add(o); b.owners = state.owners.filter((x) => s.has(x)); delete b.owner; });
  });
  $('bulk-places').addEventListener('click', (e) => {
    const c = e.target.closest('[data-place]'); if (!c) return;
    const p = c.classList.contains('on') ? '' : c.dataset.place;
    bulkApply((b) => { b.shelf = p; if (!p) b.shelfRow = ''; });
  });
  $('bulk-status').addEventListener('click', (e) => {
    const c = e.target.closest('[data-status]'); if (!c) return;
    const s = c.classList.contains('on') ? '' : c.dataset.status;
    bulkApply((b) => setStatus(b, s, { bulk: true }));
  });
  $('bulk-genres').addEventListener('click', (e) => {
    const c = e.target.closest('[data-genre]'); if (!c) return;
    const g = c.dataset.genre, off = c.classList.contains('on');
    bulkApply((b) => { const s = new Set(b.genres || []); if (off) s.delete(g); else s.add(g); b.genres = state.genres.filter((x) => s.has(x)); });
  });
  $('bulk-theme-go').addEventListener('click', () => { const t = $('bulk-theme').value.trim(); bulkApply((b) => { b.theme = t; }); toast(t ? 'Tema «' + t + '» assegnato.' : 'Tema tolto.'); });
  $('bulk-series-go').addEventListener('click', () => {
    const s = $('bulk-series').value.trim();
    bulkApply((b) => { b.series = s; if (s && !b.seriesNum && seriesNumOf(b)) b.seriesNum = String(seriesNumOf(b)); if (!s) b.seriesNum = ''; });
    toast(s ? 'Serie «' + s + '» assegnata: il numero è preso dal sottotitolo dove c\'è.' : 'Serie tolta.');
  });
  $('bulk-delete').addEventListener('click', () => {
    const n = selected.size;
    if (!n || !window.confirm('Eliminare ' + (n === 1 ? '1 libro' : n + ' libri') + '? Non si può annullare.')) return;
    state.books = state.books.filter((b) => !selected.has(b.id));
    saveState();
    hide('bulk');
    setSelecting(false);
    toast(n === 1 ? '1 libro eliminato.' : n + ' libri eliminati.');
  });

  $('list').addEventListener('click', (e) => {
    if (press.fired) { press.fired = false; return; }
    const row = e.target.closest('[data-id]');
    const book = row && state.books.find((b) => b.id === row.dataset.id);
    closePeek();
    if (book) openView(book);
  });
  $('btn-back').addEventListener('click', () => {
    const from = backTo;
    backTo = null;
    if (!from) return;
    viewMode = from.viewMode; filterGenre = from.filterGenre; filterList = from.filterList;
    renderList();
    if (from.reopen === 'year') { renderYear(); show('year'); return; }
    const book = state.books.find((b) => b.id === from.id);
    if (book) openView(book);
  });

  // Anteprima rapida. Telefono: tenere premuto. PC: fermare il puntatore sulla copertina.
  const press = { timer: null, fired: false, x: 0, y: 0 };
  const cancelPress = () => { clearTimeout(press.timer); press.timer = null; };
  $('list').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-id]');
    if (!el || e.pointerType === 'mouse') return;
    press.fired = false; press.x = e.clientX; press.y = e.clientY;
    cancelPress();
    press.timer = setTimeout(() => {
      press.fired = true;
      if (navigator.vibrate) navigator.vibrate(20);
      openPeek(el.dataset.id);
    }, 480);
  });
  $('list').addEventListener('pointermove', (e) => { if (press.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress(); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) $('list').addEventListener(type, cancelPress);
  $('list').addEventListener('touchstart', (e) => { if (e.touches.length > 1) cancelPress(); }, { passive: true });
  $('list').addEventListener('contextmenu', (e) => { if (e.target.closest('[data-id]')) e.preventDefault(); });
  for (const id of ['list', 'peek']) $(id).addEventListener('selectstart', (e) => e.preventDefault());
  $('peek').addEventListener('contextmenu', (e) => e.preventDefault());
  let hoverTimer = null;
  $('list').addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-id]');
    clearTimeout(hoverTimer);
    if (!el || !window.matchMedia('(hover: hover)').matches) return;
    hoverTimer = setTimeout(() => openPeek(el.dataset.id, el), 450);
  });
  $('list').addEventListener('mouseout', (e) => {
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-id]') === e.target.closest('[data-id]')) return;
    clearTimeout(hoverTimer);
    if ($('peek').classList.contains('float')) closePeek();
  });
  $('peek').addEventListener('click', (e) => {
    const id = peekId;
    const open = e.target.closest('#peek-open');
    if (!open && e.target.closest('.peek-card')) return;
    closePeek();
    const book = open && state.books.find((b) => b.id === id);
    if (book) openView(book);
  });
  // Il gesto è nascosto: lo si dice una volta sola.
  if (state.books.length && pref('libreria.hintPeek', '') !== '1' && !window.matchMedia('(hover: hover)').matches) {
    setPref('libreria.hintPeek', '1');
    setTimeout(() => toast('Tieni premuto su una copertina per vedere un\'anteprima.'), 900);
  }

  // Scanner
  $('btn-scan').addEventListener('click', () => { stickyStatus = ''; openScanner(); });
  $('scan-close').addEventListener('click', closeScanner);
  $('scan-mode-add').addEventListener('click', () => setScanMode('add'));
  $('scan-mode-check').addEventListener('click', () => setScanMode('check'));
  $('scan-mode-batch').addEventListener('click', () => { setScanMode('batch'); beep(); });
  $('scan-batch-done').addEventListener('click', openBatch);
  $('batch-close').addEventListener('click', closeBatch);
  $('batch-more').addEventListener('click', () => { hide('batch'); openScanner('batch'); });
  $('batch-retry').addEventListener('click', () => {
    for (const it of batch.items) if (it.state === 'failed') it.state = 'wait';
    renderBatch();
    runBatch();
  });
  $('batch-owners').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-owner]');
    if (!chip) return;
    const o = chip.dataset.owner, off = chip.classList.contains('on');
    batchApply((b) => { const set = new Set(ownersOf(b)); if (off) set.delete(o); else set.add(o); b.owners = state.owners.filter((x) => set.has(x)); delete b.owner; });
  });
  $('batch-places').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-place]');
    if (!chip) return;
    const p = chip.classList.contains('on') ? '' : chip.dataset.place;
    batchApply((b) => { b.shelf = p; if (!p) b.shelfRow = ''; });
  });
  $('batch-status').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    const s = btn.classList.contains('on') ? '' : btn.dataset.status;
    batchApply((b) => setStatus(b, s, { bulk: true }));
  });
  $('batch-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    const b = row && state.books.find((x) => x.id === row.dataset.id);
    if (b && b.barcode && !b.title) return openBook(b, { banner: 'Il codice ' + b.barcode + ' non è un ISBN (volume da edicola o libro vecchio). Scrivi titolo e autore. Se trovi l\'ISBN stampato all\'interno, scrivilo in fondo alla scheda e tocca «Completa i campi vuoti dai cataloghi».' });
    if (b) openBook(b);
  });
  $('scan-again').addEventListener('click', () => setScanMode('check'));
  $('scan-open').addEventListener('click', () => { const b = scan.found; closeScanner(); if (b) openView(b); });
  $('scan-wish').addEventListener('click', async () => {
    const isbn = scan.isbn, code = scan.code;
    closeScanner();
    viewMode = 'wish';
    renderList();
    if (!isbn) return openManualForCode(code);
    toast('Cerco il libro…');
    await handleIsbn(isbn);
  });
  $('scan-torch').addEventListener('click', toggleTorch);
  $('scan-type').addEventListener('click', () => { closeScanner(); openManual(); });
  $('scan-photo').addEventListener('change', (e) => { if (e.target.files[0]) scanFromPhoto(e.target.files[0]); e.target.value = ''; });

  // Aggiunta a mano
  $('btn-manual').addEventListener('click', openManual);
  $('manual-close').addEventListener('click', () => hide('manual'));
  $('manual-form').addEventListener('submit', (e) => { e.preventDefault(); manualSearch($('manual-q').value); });
  $('manual-results').addEventListener('click', (e) => {
    const row = e.target.closest('.book');
    if (row) pickManualResult(Number(row.dataset.result));
  });
  $('manual-empty').addEventListener('click', () => {
    hide('manual');
    if (pendingBarcode) { const code = pendingBarcode; pendingBarcode = ''; return openBook({ title: $('manual-q').value.trim(), genres: [], barcode: code }); }
    openBook(viewMode === 'audio' ? { title: $('manual-q').value.trim(), genres: [], list: '', media: ['audio'] } : { title: $('manual-q').value.trim(), genres: [] }); });
  $('manual-q').addEventListener('input', () => {
    clearTimeout(manualTimer);
    const text = $('manual-q').value.trim();
    if (text.length < 3) return;
    manualTimer = setTimeout(() => manualSearch(text, true), 450);
  });

  // Scheda libro
  $('book-form').addEventListener('submit', (e) => e.preventDefault());
  $('book-form').addEventListener('input', (e) => {
    markMissing();
    if (e.target.id === 'f-isbn' || e.target.id === 'f-title' || e.target.id === 'f-authors') renderStores();
  });
  $('book-close').addEventListener('click', () => hide('book'));
  $('book-save').addEventListener('click', () => {
    if (saveBook()) hide('book');
  });
  $('book-bought').addEventListener('click', () => {
    current.list = '';
    current.media.add('paper');
    if (!$('f-boughtAt').value) $('f-boughtAt').value = today();
    if (saveBook()) hide('book');
  });
  $('f-owners').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const o = chip.dataset.owner;
    if (current.owners.has(o)) current.owners.delete(o); else current.owners.add(o);
    renderFormOwners();
  });
  const addFormOwner = () => {
    const name = $('f-owner-new').value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const existing = state.owners.find((o) => o.toLowerCase() === name.toLowerCase());
    if (!existing) { state.owners.push(name); saveState(); }
    current.owners.add(existing || name);
    $('f-owner-new').value = '';
    renderFormOwners();
  };
  $('f-owner-add').addEventListener('click', addFormOwner);
  $('f-owner-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFormOwner(); } });
  bindStars($('f-rating'), () => current.rating, (v) => { current.rating = v; renderFormRating(); });
  $('f-loan-back').addEventListener('click', () => {
    $('f-loanTo').value = '';
    $('f-loanDate').value = '';
    if (saveBook()) hide('book');
  });
  $('f-media').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-media]');
    if (!chip) return;
    const k = chip.dataset.media;
    // Almeno un supporto resta sempre acceso.
    if (current.media.has(k)) { if (current.media.size > 1 || current.list) current.media.delete(k); } else current.media.add(k);
    renderFormLists();
  });
  $('f-lists').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const was = current.list;
    current.list = chip.dataset.list;
    if (current.list) current.media.delete('paper'); else if (was) current.media.add('paper');
    renderFormLists();
    renderFormStatus();
  });
  const addFormList = () => {
    const l = addWishlist($('f-list-new').value);
    if (!l) return;
    current.list = l;
    $('f-list-new').value = '';
    renderFormLists();
  };
  $('f-list-add').addEventListener('click', addFormList);
  $('f-list-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFormList(); } });
  $('book-save-next').addEventListener('click', () => { const s = current.status; if (saveBook(true)) { stickyStatus = s; hide('book'); openScanner(); } });
  $('f-status').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    current.status = current.status === btn.dataset.status ? '' : btn.dataset.status;
    renderFormStatus();
  });
  bindStars($('review-stars'), () => reviewStars, (v) => { reviewStars = v; renderReviewStars(); });
  $('review-save').addEventListener('click', saveReview);
  $('review-later').addEventListener('click', () => hide('review'));
  $('review').addEventListener('click', (e) => { if (e.target === $('review')) hide('review'); });
  $('book-refill').addEventListener('click', refillFromCatalogs);
  $('book-delete').addEventListener('click', () => {
    const b = current.book;
    const i = state.books.findIndex((x) => x.id === b.id);
    if (i < 0) return;
    const removed = state.books.splice(i, 1)[0];
    saveState();
    renderList();
    hide('book');
    hide('view');
    toast('«' + (removed.title || 'Libro') + '» eliminato.', 'Annulla', () => {
      state.books.splice(i, 0, removed);
      saveState();
      renderList();
    });
  });
  $('f-genres').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const g = chip.dataset.genre;
    if (current.selected.has(g)) current.selected.delete(g); else current.selected.add(g);
    $('f-genre-note').textContent = '';
    renderFormGenres();
    markMissing();
  });
  const addFormGenre = () => {
    const g = addGenre($('f-genre-new').value);
    if (!g) return;
    current.selected.add(g);
    $('f-genre-new').value = '';
    renderFormGenres();
    markMissing();
  };
  $('f-genre-add').addEventListener('click', addFormGenre);
  $('f-genre-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFormGenre(); } });
  $('f-cover-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { current.book.cover = await fileToThumb(file); renderFormCover(); } catch (err) { toast('Foto non leggibile, riprova.'); }
  });
  $('f-cover-remove').addEventListener('click', () => { current.book.cover = ''; renderFormCover(); });

  // Impostazioni
  $('btn-settings').addEventListener('click', () => { renderSettings(); show('settings'); });
  $('btn-year').addEventListener('click', () => { yearWho = null; yearSel = new Date().getFullYear(); renderYear(); show('year'); $('year-body').scrollTop = 0; });
  $('year-close').addEventListener('click', () => hide('year'));
  $('year-body').addEventListener('click', (e) => {
    const w = e.target.closest('[data-who]'); if (w) { yearWho = w.dataset.who; renderYear(); return; }
    const y = e.target.closest('[data-year]'); if (y) { yearSel = Number(y.dataset.year); renderYear(); return; }
    const c = e.target.closest('[data-id]'); if (c) { const b = state.books.find((x) => x.id === c.dataset.id); if (b) openView(b); return; }
    const au = e.target.closest('[data-author]');
    if (au) {
      backTo = { viewMode, filterGenre, filterList, reopen: 'year' };
      hide('year'); viewMode = 'library'; $('search').value = '';
      filterGenre = 'author:' + au.dataset.author; groupBy = '';
      renderList(); window.scrollTo(0, 0);
      return;
    }
    if (e.target.closest('[data-undated]')) {
      backTo = { viewMode, filterGenre, filterList, reopen: 'year' };
      hide('year'); viewMode = 'library';
      filterGenre = 'status:read' + (yearWho ? '|owner:' + yearWho : '');
      if (viewKind === 'shelf') viewKind = 'list';
      renderList(); window.scrollTo(0, 0);
      toast('Apri un libro e scrivi l\'anno in «Letto nel».');
      return;
    }
    if (e.target.closest('#goal-save')) {
      const raw = $('goal-n').value.trim();
      if (!raw || !(Number(raw) >= 0)) {
        $('goal-n').classList.remove('need'); void $('goal-n').offsetWidth; $('goal-n').classList.add('need');
        $('goal-n').focus();
        return toast('Scrivi prima quanti libri, poi tocca il pulsante.');
      }
      const v = Math.max(0, Math.min(999, Math.round(Number(raw))));
      state.goals = { ...(state.goals || {}), [goalKey(yearWho, yearSel)]: { n: v, at: Date.now() } };
      saveState(); renderYear();
      toast(v ? 'Obiettivo ' + yearSel + ': ' + v + ' libri.' : 'Obiettivo tolto.');
    }
  });
  $('settings-close').addEventListener('click', () => hide('settings'));
  $('backup-download').addEventListener('click', downloadBackup);
  $('export-csv').addEventListener('click', exportCsv);
  $('import-file').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
  $('import-paste-go').addEventListener('click', () => { const t = $('import-paste').value.trim(); if (!t) return toast('Incolla prima l\'elenco.'); openImport(parsePasted(t)); });
  $('import-close').addEventListener('click', () => hide('import'));
  $('sugg').addEventListener('click', (e) => {
    if (e.target === $('sugg') || e.target.closest('[data-sugg-close]')) { hide('sugg'); return; }
    if (e.target.closest('[data-sugg-wish]')) { addSuggToWish(suggOpen); return; }
    if (e.target.closest('[data-sugg-more]')) { suggOpen.plotOpen = true; renderSugg(); return; }
    const au = e.target.closest('[data-sugg-author]');
    if (au) {
      hide('sugg');
      backTo = { viewMode, filterGenre, filterList };
      viewMode = 'library'; filterGenre = 'author:' + au.dataset.suggAuthor; $('search').value = '';
      renderList(); window.scrollTo(0, 0);
    }
  });
  $('import-go').addEventListener('click', () => { $('import-paste').value = ''; runImport(); });
  $('import-complete').addEventListener('change', (e) => { importOpts.complete = e.target.checked; });
  $('import-list').addEventListener('change', (e) => { importOpts.list = e.target.value; });
  $('import').addEventListener('click', (e) => {
    const o = e.target.closest('[data-owner]'); if (o) { const v = o.dataset.owner; importOpts.owners = importOpts.owners.includes(v) ? importOpts.owners.filter((x) => x !== v) : [...importOpts.owners, v]; renderImport(); return; }
    const m = e.target.closest('[data-media]'); if (m) { importOpts.media = m.dataset.media; renderImport(); return; }
    const t = e.target.closest('[data-toread]'); if (t) { importOpts.toread = t.dataset.toread; renderImport(); }
  });
  $('backup-file').addEventListener('change', (e) => { if (e.target.files[0]) restoreBackup(e.target.files[0]); e.target.value = ''; });
  $('gkey-save').addEventListener('click', async () => {
    const key = $('gkey').value.trim();
    try { if (key) localStorage.setItem(GKEY, key); else localStorage.removeItem(GKEY); } catch (e) { return toast('Non riesco a salvare la chiave su questo telefono.'); }
    if (typeof scheduleSync === 'function') scheduleSync(500); // la chiave arriva anche sugli altri telefoni
    if (!key) return toast('Chiave rimossa.');
    toast('Provo la chiave…');
    try {
      const found = await lookupGoogle('9788806219352');
      toast(found ? 'Chiave funzionante: Google Books risponde.' : 'La chiave è accettata, ma il libro di prova non è stato trovato.');
    } catch (e) {
      toast('Google Books rifiuta questa chiave: controlla di averla copiata tutta e le restrizioni.');
    }
  });
  $('wish-list').addEventListener('change', (e) => {
    if (e.target.dataset.wishIndex !== undefined) renameWishlist(Number(e.target.dataset.wishIndex), e.target.value);
  });
  $('wish-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wish-del]');
    if (btn) deleteWishlist(Number(btn.dataset.wishDel));
  });
  const addSettingsList = () => { if (addWishlist($('wish-new').value)) { $('wish-new').value = ''; renderSettings(); renderList(); } };
  $('wish-add').addEventListener('click', addSettingsList);
  $('wish-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSettingsList(); });
  $('genre-list').addEventListener('change', (e) => {
    if (e.target.dataset.genreIndex !== undefined) renameGenre(Number(e.target.dataset.genreIndex), e.target.value);
  });
  $('genre-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-genre-del]');
    if (btn) deleteGenre(Number(btn.dataset.genreDel));
  });
  const addSettingsGenre = () => { if (addGenre($('genre-new').value)) { $('genre-new').value = ''; renderSettings(); } };
  $('genre-add').addEventListener('click', addSettingsGenre);
  $('genre-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSettingsGenre(); });

  // Se l'app va in secondo piano, la fotocamera si spegne.
  document.addEventListener('visibilitychange', () => { if (document.hidden && scan.stream) closeScanner(); });
}

function openManualForCode(code) {
  openManual();
  pendingBarcode = code;
  $('manual-title').textContent = 'Libro senza ISBN';
  $('manual-status').textContent = 'Il codice ' + code + ' non è un ISBN: di solito è un volume uscito in edicola o un libro vecchio. Scrivi titolo e autore e scegli il risultato più simile. Il codice resta nella scheda, così la prossima volta lo riconosco.';
}

function openManual() {
  pendingBarcode = '';
  $('manual-q').value = '';
  $('manual-results').innerHTML = '';
  $('manual-status').textContent = viewMode === 'audio' ? 'Scrivi il titolo dell\'audiolibro: i risultati arrivano mentre scrivi. Verrà salvato come ascoltato su Audible.' : 'Scrivi le prime lettere del titolo o dell\'autore: i risultati arrivano mentre scrivi.';
  $('manual-title').textContent = viewMode === 'audio' ? 'Aggiungi un audiolibro' : 'Aggiungi a mano';
  manualSeq++;
  show('manual');
  $('manual-q').focus();
}

/* Aggiornamento automatico. version.json dice qual è l'ultima versione pubblicata.
   All'apertura (e quando si torna all'app) se ce n'è una più nuova:
   - se non c'è niente di aperto, la pagina si ricarica da sola sulla versione nuova;
   - se si sta compilando una scheda, compare un avviso e si aggiorna quando si vuole.
   I libri stanno nella memoria del telefono: ricaricare non li tocca. */
async function checkUpdate() {
  if (!navigator.onLine) return;
  let latest = 0;
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    latest = Number((await r.json()).version) || 0;
  } catch (e) { return; }
  if (latest <= APP_VERSION) return;
  const go = () => location.replace(location.pathname + '?v=' + latest);
  let tried = '';
  try { tried = sessionStorage.getItem('libreria.updateTried'); sessionStorage.setItem('libreria.updateTried', String(latest)); } catch (e) { /* niente */ }
  if (topLayer() === null && tried !== String(latest)) return go();
  $('update-bar').hidden = false;
  $('update-go').onclick = go;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });

init();
checkUpdate();
