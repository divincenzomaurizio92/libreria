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
const APP_VERSION = 48; // va tenuto uguale al numero in version.json

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

function setStatus(b, status) {
  const before = b.status || '';
  b.status = status || '';
  if (b.status === 'read') { if (!b.readAt && before === 'reading') b.readAt = todayIt(); } else b.readAt = '';
  if (b.status === 'reading' && !b.startedAt) b.startedAt = today();
}

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

function storeLinks(book) {
  const q = encodeURIComponent(book.isbn || [book.title, book.authors].filter(Boolean).join(' '));
  if (!q) return [];
  return [
    ['Amazon', 'https://www.amazon.it/s?i=stripbooks&k=' + q],
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
let viewMode = 'library'; // 'library' = libri posseduti, 'wish' = liste desideri
let filterList = '';

function coverHtml(book, big) {
  const initial = esc((book.title || '?').trim().charAt(0).toUpperCase() || '?');
  const inner = book.cover
    ? `<img src="${esc(book.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}">`
    : initial;
  return `<div class="cover${big ? ' big' : ''}">${inner}</div>`;
}

function isIncomplete(b) {
  return !b.authors || !b.publisher || !b.pages || !b.year || !(b.genres && b.genres.length);
}

function bookRowHtml(b, attr) {
  const series = b.series ? b.series + (b.seriesNum ? ' n. ' + b.seriesNum : '') : '';
  const meta = [b.publisher, b.year, b.pages ? b.pages + ' pag.' : '', series, b.rating ? '★'.repeat(b.rating) : '', b.list && Number(b.price) > 0 ? euro(b.price) : ''].filter(Boolean).join(' · ');
  const tags = (b.status === 'reading' ? '<span class="tag reading">In corso</span>' : b.status === 'toread' ? '<span class="tag">Da leggere</span>' : '')
    + (b.loanTo ? `<span class="tag loan">Prestato a ${esc(b.loanTo)}</span>` : '')
    + (b.list ? `<span class="tag wish">${esc(b.list)}</span>` : '')
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

function gridCellHtml(b) {
  const color = bookColor(b);
  const initial = esc((b.title || '?').trim().charAt(0).toUpperCase() || '?');
  const inner = b.cover
    ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}">`
    : `<span class="ph-title">${esc(b.title || 'Senza titolo')}</span><span class="ph-rule"></span><span class="ph-author">${esc(firstAuthor(b.authors))}</span>`;
  return `<button class="cell${b.id === lastAddedId ? ' new' : ''}" data-id="${esc(b.id)}">
    <span class="cell-cover" style="background:${color};color:${inkOn(color)}">${inner}${b.status === 'reading' ? '<span class="badge">In corso</span>' : ''}${b.loanTo ? '<span class="badge loan-badge">In prestito</span>' : ''}${mediaBadges(b) ? `<span class="media-badges">${mediaBadges(b)}</span>` : ''}</span>
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

function matchesOne(b, f) {
  if (f === 'loan') return Boolean(b.loanTo);
  if (f.startsWith('media:')) return mediaOf(b).includes(f.slice(6));
  if (f.startsWith('theme:')) return (b.theme || '') === f.slice(6);
  if (f.startsWith('owner:')) return ownersOf(b).includes(f.slice(6));
  if (f.startsWith('status:')) return (b.status || '') === f.slice(7);
  if (f.startsWith('place:')) return b.shelf === f.slice(6);
  return (b.genres || []).includes(f.slice(6));
}
function matchesFilter(b) { return filterParts().every((f) => matchesOne(b, f)); }

/* Quante copertine stanno in una riga, con la grandezza scelta: serve a mettere ogni riga sulla sua mensola. */
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
function railsHtml(owned) {
  return homeSections(owned).map(([title, items, empty]) => `<section class="rail-sec">
    <h3 class="rail-label">${title}${items.length ? `<small>${items.length}</small>` : ''}</h3>
    ${items.length ? `<div class="rail" style="--rail-w:${[0, 98, 74, 58][gridZoom]}px">${items.map(gridCellHtml).join('')}</div>` : `<p class="rail-empty">${empty}</p>`}
    <div class="plank"></div>
  </section>`).join('') + ALL_LABEL;
}
function listSectionsHtml(owned) {
  return homeSections(owned).map(([title, items, empty]) => `<section class="list-sec">
    <h3 class="rail-label">${title}${items.length ? `<small>${items.length}</small>` : ''}</h3>
    ${items.length ? items.map((b) => bookRowHtml(b, `data-id="${esc(b.id)}"`)).join('') : `<p class="rail-empty">${empty}</p>`}
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
const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9à-ù]+/g, ' ').trim();
function haveIt(item) {
  return state.books.find((b) => (item.isbn && b.isbn === item.isbn) || (normTitle(b.title) && normTitle(b.title) === normTitle(item.title)));
}
function discoverHtml() {
  const d = loadDiscover();
  discoverItems = [];
  const rail = (title, items) => {
    if (!items || !items.length) return '';
    const cells = items.slice(0, 15).map((it) => {
      const i = discoverItems.push(it) - 1;
      const own = haveIt(it);
      const color = SPINE_COLORS[hashOf(it.title || '') % SPINE_COLORS.length];
      const inner = it.cover
        ? `<img src="${esc(httpsUrl(it.cover))}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : `<span class="ph-title">${esc(it.title || '')}</span><span class="ph-rule"></span><span class="ph-author">${esc(firstAuthor(it.authors))}</span>`;
      return `<button class="cell disc" data-disc="${i}">
        <span class="cell-cover" style="background:${color};color:${inkOn(color)}">${inner}${own ? `<span class="badge">${own.list ? 'Nei desideri' : 'Ce l\'avete'}</span>` : ''}</span>
        <span class="cell-title">${esc(it.title || '')}</span>
        ${it.reason ? `<span class="disc-reason">${esc(it.reason)}</span>` : ''}
      </button>`;
    }).join('');
    return `<p class="disc-sub">${title}</p><div class="rail">${cells}</div>`;
  };
  const body = d ? rail('I più venduti in Italia', d.bestsellers) + rail('Simili ai vostri', d.similar) : '';
  const when = d && d.updatedAt ? ' · aggiornato il ' + new Date(d.updatedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '';
  return `<section class="rail-sec discover">
    <h3 class="rail-label">Da scoprire<small>${esc(when)}</small></h3>
    ${body || `<div class="disc-empty">
      <div class="disc-ghosts" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <p><strong>Presto, ogni settimana</strong>I libri più venduti in Italia e quelli simili ai vostri, scelti da Claude a partire dai libri che avete votato bene e dai vostri temi. Con un tocco finiscono nei desideri.</p>
    </div>`}
  </section>`;
}
function openDiscover(i) {
  const it = discoverItems[i];
  if (!it) return;
  const own = haveIt(it);
  if (own) return openView(own);
  if (it.isbn && toIsbn13(it.isbn)) return handleIsbn(toIsbn13(it.isbn));
  openBook({ title: it.title || '', authors: it.authors || '', cover: it.cover ? httpsUrl(it.cover) : '', genres: [] }, { banner: it.reason ? 'Suggerito da Claude: ' + it.reason : '' });
}

function greeting() {
  const h = new Date().getHours();
  const word = h >= 5 && h < 13 ? 'Buongiorno' : h >= 13 && h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const me = pref('libreria.me', '');
  return word + (me && state.owners.includes(me) ? ' ' + me : '');
}

function renderList() {
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
  if (wish) {
    if (filterList && !state.wishlists.includes(filterList)) filterList = '';
    $('filters').innerHTML = state.wishlists.length
      ? chip('', 'Tutte', !filterList) + state.wishlists.map((l) => chip(l, l + ' (' + wished.filter((b) => b.list === l).length + ')', filterList === l)).join('')
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
      const sections = !wish && !audio && viewKind !== 'shelf' && !q && sort === 'recent' && !grouped
        && !filterParts().some((p) => p.startsWith('status:')) && (filterGenre ? homeSections(books).length > 0 : owned.length >= 6);
      owned = filterGenre ? books : owned;
      // «Tutti i libri» si divide come lo Scaffale quando si guarda la libreria nell'ordine normale.
      const split = !wish && !audio && viewKind !== 'shelf' && !q && sort === 'recent' && !grouped;
      homeOrder = null;
      $('list').innerHTML = home ? (sections ? railsHtml(owned) : '') + (split ? homeGroupsHtml(books, true) : shelfRowsHtml(books))
        : viewKind === 'grid' ? books.map(gridCellHtml).join('')
        : viewKind === 'shelf' ? shelvesHtml(wish ? books : books.filter(hasPaper), wish, grouped ? (groupBy === 'owner' ? 'owner' : 'genre') : '')
        : (sections ? listSectionsHtml(owned) : '') + (split ? homeGroupsHtml(books, false) : books.map((b) => bookRowHtml(b, `data-id="${esc(b.id)}"`)).join(''));
      if (homeOrder) books = homeOrder;
    }
  }
  // Nei desideri, senza ricerca né lista scelta, in cima c'è «Da scoprire».
  if (wish && !q && !filterList) $('list').insertAdjacentHTML('afterbegin', discoverHtml());
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
  if (el && el.tagName === 'IMG' && el.dataset.initial && el.parentNode) el.parentNode.textContent = el.dataset.initial;
}, true);

/* ================= ANTEPRIMA RAPIDA ================= */

let peekId = '';

function openPeek(id, anchor) {
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
        ${b.rating ? `<span aria-label="${b.rating} stelle su 5">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</span>` : ''}
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
  fetchPlot(book);
  renderView(book);
  show('view');
  $('view-body').scrollTop = 0;
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
          ${b.authors ? `<span class="hero-author">${esc(b.authors)}</span>` : ''}
          ${b.rating ? `<span class="hero-stars" role="img" aria-label="${b.rating} stelle su 5">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</span>` : ''}
        </div>
      </div>
      ${tags.length ? `<div class="hero-tags">${tags.map(([label, go]) => go ? `<button class="tag" data-goto="${esc(go)}">${esc(label)}</button>` : `<span class="tag still">${esc(label)}</span>`).join('')}</div>` : ''}
    </div>
    ${!isOwned(b) ? '' : `<div class="seg view-status" role="group" aria-label="Lettura">${Object.keys(STATUS).map((k) => `<button data-status="${k}" class="${b.status === k ? 'on' : ''}" aria-pressed="${b.status === k}">${STATUS[k]}</button>`).join('')}</div>`}
    ${b.loanTo ? `<p class="banner" style="margin-top:16px">In prestito a ${esc(b.loanTo)}${b.loanDate ? ' dal ' + esc(itDate(b.loanDate)) : ''}.</p>` : ''}
    ${b.plot ? `<p class="view-label">Trama</p><p class="plot${b.plot.length > 320 ? ' clamp' : ''}" id="view-plot">${esc(b.plot)}</p>${b.plot.length > 320 ? '<button class="link-btn" data-act="plot">Leggi tutto</button>' : ''}` : ''}
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    ${b.notes ? `<p class="view-label">Commento e note</p><p class="view-comment">${esc(b.notes)}</p>` : ''}
    ${links.length ? `<p class="view-label">Dove trovarlo</p><div class="stores">${links.map(([name, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${name}</a>`).join(' ')}</div>` : ''}
    <div class="view-actions">
      ${b.loanTo ? '<button class="btn primary wide" data-act="returned">È tornato a casa</button>' : ''}
      ${b.list ? '<button class="btn primary wide" data-act="bought">Comprato: sposta in libreria</button>' : ''}
      ${b.status === 'read' && !b.readAt ? '<button class="btn ghost wide" data-act="readdate">Aggiungi quando l\'hai letto</button>' : ''}
      ${b.list && !(Number(b.price) > 0) ? '<button class="btn ghost wide" data-act="price">Aggiungi il prezzo di copertina</button>' : ''}
    </div>`;
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
  $('book-heading').textContent = isNew ? 'Nuovo libro' : 'Scheda libro';
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

function renderFormRating() {
  $('f-rating').innerHTML = [1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="${n <= current.rating ? 'on' : ''}" data-star="${n}" aria-label="${n} su 5" aria-pressed="${n === current.rating}">★</button>`)
    .join('');
}

function renderFormLists() {
  const chip = (value, label) => `<button type="button" class="chip${current.list === value ? ' on' : ''}" data-list="${esc(value)}" aria-pressed="${current.list === value}">${esc(label)}</button>`;
  $('f-lists').innerHTML = chip('', 'In libreria') + state.wishlists.map((l) => chip(l, l)).join('');
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
  $('review-stars').innerHTML = [1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="${n <= reviewStars ? 'on' : ''}" data-star="${n}" aria-label="${n} su 5" aria-pressed="${n === reviewStars}">★</button>`).join('');
}
function openReview(b) {
  reviewId = b.id;
  reviewStars = Number(b.rating) || 0;
  $('review-title').textContent = 'Com\'era «' + (b.title || 'questo libro') + '»?';
  $('review-text').value = b.notes || '';
  $('review-card').style.setProperty('--book', bookColor(b));
  renderReviewStars();
  show('review');
}
function saveReview() {
  const b = state.books.find((x) => x.id === reviewId);
  if (b) {
    b.rating = reviewStars;
    b.notes = $('review-text').value.trim();
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

async function batchLookup(item) {
  let found = null, failed = false;
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

function renderSettings() {
  renderInstall();
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
const LAYERS = ['review', 'book', 'view', 'settings', 'manual', 'scanner', 'batch', 'arrange', 'filter-sheet'];
let backGuard = false;
let backPending = false;
let backQueued = false;

function topLayer() {
  if (!$('peek').hidden && !$('peek').classList.contains('float')) return 'peek';
  const open = LAYERS.find((id) => !$(id).hidden);
  return open || (backTo ? 'filtered' : null);
}

function closeLayer(layer) {
  if (layer === 'peek') closePeek();
  else if (layer === 'scanner') closeScanner();
  else if (layer === 'filtered') $('btn-back').click();
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
  $('filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.openFilters !== undefined) {
      $('filter-q').value = '';
      renderFilterSheet();
      show('filter-sheet');
      return;
    }
    if (viewMode === 'wish') filterList = chip.dataset.genre; else filterGenre = chip.dataset.genre;
    renderList();
  });
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
  $('btn-home').addEventListener('click', () => {
    for (const id of ['view', 'book', 'settings', 'manual', 'filter-sheet', 'arrange']) hide(id);
    backTo = null;
    closePeek();
    viewMode = 'library';
    viewKind = 'grid';
    setPref('libreria.view', 'grid');
    filterGenre = '';
    filterList = '';
    $('search').value = '';
    $('tools').hidden = true;
    renderList();
    window.scrollTo(0, 0);
    document.querySelector('.top').classList.remove('away');
  });
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
  $('list').addEventListener('click', (e) => { const d = e.target.closest('[data-disc]'); if (d) openDiscover(Number(d.dataset.disc)); });

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
    batchApply((b) => setStatus(b, s));
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
  $('f-rating').addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (!star) return;
    const n = Number(star.dataset.star);
    current.rating = current.rating === n ? 0 : n;
    renderFormRating();
  });
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
  $('review-stars').addEventListener('click', (e) => {
    const s = e.target.closest('[data-star]');
    if (!s) return;
    const n = Number(s.dataset.star);
    reviewStars = reviewStars === n ? 0 : n;
    renderReviewStars();
  });
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
  $('settings-close').addEventListener('click', () => hide('settings'));
  $('backup-download').addEventListener('click', downloadBackup);
  $('export-csv').addEventListener('click', exportCsv);
  $('backup-file').addEventListener('change', (e) => { if (e.target.files[0]) restoreBackup(e.target.files[0]); e.target.value = ''; });
  $('gkey-save').addEventListener('click', async () => {
    const key = $('gkey').value.trim();
    try { if (key) localStorage.setItem(GKEY, key); else localStorage.removeItem(GKEY); } catch (e) { return toast('Non riesco a salvare la chiave su questo telefono.'); }
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
