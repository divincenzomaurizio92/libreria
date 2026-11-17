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
const APP_VERSION = 29;

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
    cover: httpsUrl(img.thumbnail || img.smallThumbnail),
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
let shelfSort = pref('libreria.shelfSort', 'genre'); // 'genre', 'room', 'owner'
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

let filterGenre = '';
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
      ${b.id && !b.list && isIncomplete(b) ? '<span class="missing-dot">Dati da completare</span>' : ''}
    </span>
  </button>`;
}

function gridCellHtml(b) {
  const color = bookColor(b);
  const initial = esc((b.title || '?').trim().charAt(0).toUpperCase() || '?');
  const inner = b.cover
    ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}">`
    : `<span class="ph-author">${esc(firstAuthor(b.authors))}</span><span class="ph-title">${esc(b.title || 'Senza titolo')}</span>`;
  return `<button class="cell${b.id === lastAddedId ? ' new' : ''}" data-id="${esc(b.id)}">
    <span class="cell-cover" style="background:${color};color:${inkOn(color)}">${inner}${b.status === 'reading' ? '<span class="badge">In corso</span>' : ''}</span>
    <span class="cell-title">${esc(b.title || 'Senza titolo')}</span>
    ${b.list && Number(b.price) > 0 ? `<span class="cell-price">${euro(b.price)}</span>` : ''}
    ${b.loanTo ? '<span class="tag loan">In prestito</span>' : ''}
  </button>`;
}

function spineHtml(b) {
  const color = bookColor(b);
  const width = Math.max(26, Math.min(64, 18 + Math.round((Number(b.pages) || 200) / 9)));
  const height = 172 + (hashOf(b.title || '') % 44);
  return `<button class="spine" data-id="${esc(b.id)}" aria-label="${esc(b.title || 'Senza titolo')}" style="width:${width}px;height:${height}px;background:${color};color:${inkOn(color)}"><span>${esc(b.title || 'Senza titolo')}</span></button>`;
}

/* Scaffale: una mensola per genere, per stanza o per persona. Nei desideri, una per lista. */
function shelvesHtml(books, wish) {
  const empty = wish ? '' : shelfSort === 'room' ? 'Senza posto' : shelfSort === 'owner' ? 'Di casa' : 'Senza genere';
  const keysOf = (b) => {
    if (wish) return [b.list];
    if (shelfSort === 'room') return [b.shelf ? b.shelf + (b.shelfRow ? ' · ripiano ' + b.shelfRow : '') : empty];
    if (shelfSort === 'owner') return ownersOf(b).length ? ownersOf(b) : [empty];
    return [(b.genres || [])[0] || empty];
  };
  const groups = new Map();
  for (const b of books) for (const k of keysOf(b)) groups.set(k, [...(groups.get(k) || []), b]);
  const labels = [...groups.keys()].sort((a, b) => (a === empty) - (b === empty) || a.localeCompare(b, 'it'));
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
      `<button class="chip${filterGenre === v ? ' on' : ''}" data-filter="${esc(v)}">${esc(label)} <small>${n}</small></button>`).join('')}</div>`;
  }).join('');
  $('filter-body').innerHTML = html || '<p class="hint">Nessuna voce con questo nome.</p>';
  $('filter-clear').hidden = !filterGenre;
}

/* Suggerimento di disposizione: solo gruppi che stanno bene insieme, in ordine di precedenza.
   Regole scelte dalla famiglia: i libri di Tommaso in un posto loro; i ricettari in cucina;
   i "da leggere" a portata di mano; serie numerate e guide di viaggio sempre unite;
   per tutto il resto vince il genere e, dentro il genere, le collane stanno vicine. */
function arrangeGroups() {
  const rest = new Set(state.books.filter((b) => !b.list));
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
  $('arrange-body').innerHTML = groups.map((g) => `<section class="arr">
    <h3>${esc(g.title)}<small>${g.items.length === 1 ? '1 libro' : g.items.length + ' libri'}</small></h3>
    <p class="hint">${esc(g.hint)}</p>
    <div class="shelf-unit"><div class="shelf-row">${g.items.map(spineHtml).join('')}</div><div class="plank"></div></div>
    <details><summary>Elenco in ordine</summary><ol>${g.items.map((b) => `<li>${esc(b.title || 'Senza titolo')}${b.seriesNum ? ' (n. ' + esc(b.seriesNum) + ')' : ''}${b.authors ? ' · ' + esc(firstAuthor(b.authors)) : ''}</li>`).join('')}</ol></details>
  </section>`).join('') || '<p class="hint">Aggiungete qualche libro per vedere i suggerimenti.</p>';
}

function matchesFilter(b) {
  if (!filterGenre) return true;
  if (filterGenre === 'loan') return Boolean(b.loanTo);
  if (filterGenre.startsWith('owner:')) return ownersOf(b).includes(filterGenre.slice(6));
  if (filterGenre.startsWith('status:')) return (b.status || '') === filterGenre.slice(7);
  if (filterGenre.startsWith('place:')) return b.shelf === filterGenre.slice(6);
  return (b.genres || []).includes(filterGenre.slice(6));
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const sort = $('sort').value;
  const wish = viewMode === 'wish';
  const owned = state.books.filter((b) => !b.list);
  const wished = state.books.filter((b) => b.list);
  const base = wish ? wished : owned;
  let books = base.filter((b) => {
    if (wish && filterList && b.list !== filterList) return false;
    if (!wish && !matchesFilter(b)) return false;
    if (!q) return true;
    return [b.title, b.authors, b.publisher, b.isbn, b.notes].some((x) => String(x || '').toLowerCase().includes(q));
  });
  const byText = (k) => (a, b) => String(a[k] || '').localeCompare(String(b[k] || ''), 'it', { sensitivity: 'base' });
  if (sort === 'title') books.sort(byText('title'));
  else if (sort === 'author') books.sort(byText('authors'));
  else books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  $('tab-library').textContent = 'Libreria (' + owned.length + ')';
  $('tab-wish').textContent = 'Desideri (' + wished.length + ')';
  for (const [id, on] of [['tab-library', !wish], ['tab-wish', wish]]) {
    $(id).classList.toggle('on', on);
    $(id).setAttribute('aria-selected', on);
  }

  const total = base.length;
  const one = wish ? '1 desiderio' : '1 libro';
  const many = wish ? ' desideri' : ' libri';
  $('count').textContent = total === 0 ? (wish ? 'Nessun desiderio' : 'Nessun libro')
    : (total === 1 ? one : total + many) + (books.length !== total ? ' · ' + books.length + ' mostrati' : '');
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
  } else {
    const used = state.genres.filter((g) => owned.some((b) => (b.genres || []).includes(g)));
    // Un filtro alla volta: prestiti, proprietario oppure genere.
    const loans = owned.filter((b) => b.loanTo).length;
    const people = state.owners.filter((o) => owned.some((b) => ownersOf(b).includes(o)));
    const count = (test) => owned.filter(test).length;
    const rooms = state.places.filter((p) => owned.some((b) => b.shelf === p));
    // Le scelte stanno in un pannello a parte, divise per gruppo e con ricerca: reggono anche decine di generi.
    filterGroups = [
      ['Lettura', Object.keys(STATUS).map((k) => ['status:' + k, k === 'read' ? 'Letti' : STATUS[k], count((b) => b.status === k)]).filter((x) => x[2])],
      ['Prestiti', loans ? [['loan', 'In prestito', loans]] : []],
      ['Di chi è', people.map((o) => ['owner:' + o, o, count((b) => ownersOf(b).includes(o))])],
      ['Dove sta', rooms.map((p) => ['place:' + p, p, count((b) => b.shelf === p)])],
      ['Genere', used.map((g) => ['genre:' + g, g, count((b) => (b.genres || []).includes(g))])],
    ].filter(([, items]) => items.length);
    const all = filterGroups.flatMap(([, items]) => items);
    const active = all.find(([v]) => v === filterGenre);
    if (!active) filterGenre = '';
    $('filters').innerHTML = all.length
      ? `<button class="chip" data-open-filters><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtra</button>`
        + (active ? `<button class="chip on" data-genre="" aria-label="Togli il filtro ${esc(active[1])}">${esc(active[1])} ✕</button>` : '')
      : '';
  }

  if (!total) {
    $('list').innerHTML = wish
      ? `<div class="empty"><strong>Nessun desiderio</strong>Scansiona un libro in negozio, oppure aggiungilo a mano: finirà nella lista che scegli.</div>`
      : `<div class="empty"><strong>La libreria è vuota</strong>
      Tocca «Scansiona un libro» e inquadra il codice a barre sul retro della copertina.</div>`;
  } else if (!books.length) {
    $('list').innerHTML = '<div class="empty"><strong>Nessun libro trovato</strong>Prova a cambiare ricerca o filtro.</div>';
  } else {
    $('list').innerHTML = viewKind === 'grid' ? books.map(gridCellHtml).join('')
      : viewKind === 'shelf' ? shelvesHtml(books, wish)
      : books.map((b) => bookRowHtml(b, `data-id="${esc(b.id)}"`)).join('');
  }
  visibleIds = books.map((b) => b.id);
  $('btn-back').hidden = !backTo;
  const showing = total && books.length;
  $('list').className = 'list' + (showing && viewKind === 'grid' ? ' grid z' + gridZoom : showing && viewKind === 'shelf' ? ' shelves' : '');
  // Il pulsante dice a parole la vista attuale; toccandolo si apre l'elenco delle tre viste.
  $('view-cycle').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + VIEWS[viewKind][1] + '</svg>' + VIEWS[viewKind][0]
    + '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  $('view-menu').innerHTML = Object.keys(VIEWS).map((k) => `<button data-view="${k}" class="${k === viewKind ? 'on' : ''}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${VIEWS[k][1]}</svg>
      <span><b>${VIEWS[k][0]}</b><small>${VIEWS[k][2]}</small></span>
    </button>`).join('');
  $('shelf-sort').hidden = viewKind !== 'shelf' || wish;
  $('btn-arrange').hidden = viewKind !== 'shelf' || wish || !owned.length;
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
  const tags = [...(b.list ? [[b.list, 'list:' + b.list]] : []),
    ...(b.genres || []).map((g) => [g, b.list ? '' : 'genre:' + g]),
    ...ownersOf(b).map((o) => [o, b.list ? '' : 'owner:' + o]),
    ...(b.shelf ? [[b.shelf + (b.shelfRow ? ', ripiano ' + b.shelfRow : ''), b.list ? '' : 'place:' + b.shelf]] : [])];
  const facts = [
    ['Letto nel', b.status === 'read' && b.readAt ? showRead(b.readAt) : ''],
    ['In lettura da', b.status === 'reading' && b.startedAt ? new Date(b.startedAt).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : ''],
    ['Casa editrice', b.publisher], ['Anno di questa edizione', b.year], ['Pagine', b.pages],
    ['Serie', b.series ? b.series + (b.seriesNum ? ', n. ' + b.seriesNum : '') : ''],
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
    ${b.list ? '' : `<div class="seg view-status" role="group" aria-label="Lettura">${Object.keys(STATUS).map((k) => `<button data-status="${k}" class="${b.status === k ? 'on' : ''}" aria-pressed="${b.status === k}">${STATUS[k]}</button>`).join('')}</div>`}
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

const FIELDS = ['title', 'subtitle', 'authors', 'publisher', 'pages', 'year', 'isbn', 'notes', 'plot', 'readAt', 'shelfRow', 'series', 'seriesNum', 'boughtAt', 'price', 'loanTo', 'loanDate'];

function openBook(book, opts = {}) {
  const isNew = !book.id;
  // Un libro nuovo va dove si sta guardando: in libreria, oppure nella lista desideri aperta.
  const defaultList = viewMode === 'wish' ? (filterList || state.wishlists[0] || '') : '';
  current = { book: { ...book }, isNew, selected: new Set(book.genres || []), list: isNew ? (book.list ?? defaultList) : (book.list || '') };
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
  $('f-status-field').hidden = Boolean(current.list);
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
  setStatus(b, b.list ? '' : current.status);
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

function saveBook() {
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
  toast(b.list ? 'Salvato in «' + b.list + '»' : current.isNew ? 'Aggiunto in libreria' : 'Salvato', null, null, b.cover);
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
  setScanMode(mode === 'check' ? 'check' : 'add');
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

async function onCode(text) {
  const isbn = toIsbn13(text);
  if (!isbn) {
    setScanStatus('Questo codice non è un ISBN. Cerca il codice che inizia con 978 o 979.');
    return;
  }
  if (scan.mode === 'check') return showCheckResult(isbn);
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
  if (scan.stream) setScanStatus(mode === 'check' ? 'Inquadra il codice per sapere se il libro è già vostro' : 'Inquadra il codice a barre sul retro del libro');
}

function showCheckResult(isbn) {
  const book = state.books.find((b) => b.isbn === isbn);
  scan.paused = true;
  scan.found = book || null;
  scan.isbn = isbn;
  if (navigator.vibrate) navigator.vibrate(book && !book.list ? [60, 60, 60] : 60);
  $('scan-answer').textContent = !book ? 'No, non ce l\'avete' : book.list ? 'È tra i desideri' : 'Sì, ce l\'avete già';
  $('scan-detail').textContent = !book ? 'ISBN ' + isbn
    : '«' + book.title + '»' + (book.list ? ' è nella lista ' + book.list + '.' : book.loanTo ? ' è in libreria, in prestito a ' + book.loanTo + '.' : ' è in libreria' + (book.shelf ? ': ' + book.shelf : '') + '.');
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

function closeScanner() { stopCamera(); hide('scan-result'); hide('scanner'); }
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

async function manualSearch(text) {
  text = text.trim();
  if (!text) return;
  const isbn = toIsbn13(text);
  if (isbn) {
    $('manual-status').textContent = 'Cerco ' + isbn + '…';
    await handleIsbn(isbn);
    hide('manual');
    return;
  }
  $('manual-status').textContent = 'Cerco…';
  $('manual-results').innerHTML = '';
  try {
    manualResults = await searchByText(text);
    $('manual-status').textContent = manualResults.length ? 'Tocca l\'edizione giusta.' : 'Nessun risultato: prova con altre parole.';
    $('manual-results').innerHTML = manualResults.map((b, i) => bookRowHtml(b, `data-result="${i}"`)).join('');
  } catch (e) {
    $('manual-status').textContent = 'Catalogo non raggiungibile: controlla la connessione.';
  }
}

function pickManualResult(i) {
  const data = manualResults[i];
  if (!data) return;
  const dup = data.isbn && state.books.find((b) => b.isbn === data.isbn);
  hide('manual');
  if (dup) return openBook(dup, { banner: dup.list ? 'Questo libro è già nella lista desideri «' + dup.list + '».' : 'Questo libro è già in libreria.' });
  const s = suggestGenres(data.subjects, data.authors, data.description);
  openBook({ ...data, subjects: undefined, description: undefined, plot: data.description || '', plotTried: true, genres: s.genres }, { genreNote: s.genres.length ? '(suggerito, correggilo se serve)' : '(scegline uno o più)' });
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
  const cols = [['title', 'Titolo'], ['subtitle', 'Sottotitolo'], ['authors', 'Autore'], ['publisher', 'Casa editrice'], ['year', 'Anno'], ['pages', 'Pagine'], ['genres', 'Genere'], ['isbn', 'ISBN'], ['list', 'Lista'], ['status', 'Lettura'], ['readAt', 'Letto nel'], ['owners', 'Di chi è'], ['rating', 'Voto'], ['notes', 'Commento'], ['shelf', 'Mobile'], ['shelfRow', 'Ripiano'], ['series', 'Serie'], ['seriesNum', 'Numero'], ['boughtAt', 'Comprato il'], ['price', 'Prezzo'], ['loanTo', 'Prestato a'], ['loanDate', 'Prestato dal']];
  const cell = (v) => '"' + String(Array.isArray(v) ? v.join(', ') : v ?? '').replace(/"/g, '""') + '"';
  const rows = [cols.map((c) => cell(c[1])).join(';')].concat(state.books.map((b) => cols.map((c) => cell(c[0] === 'list' ? (b.list || 'Libreria') : c[0] === 'owners' ? ownersOf(b) : c[0] === 'status' ? (STATUS[b.status] || '') : b[c[0]])).join(';')));
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

function renderSettings() {
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
  saveState();
  renderSettings();
  renderList();
  toast(clash >= 0 ? '«' + old + '» unito a «' + target + '».' : 'Mobile rinominato.');
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
  if (filterGenre === 'genre:' + old) filterGenre = 'genre:' + target;
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
const LAYERS = ['book', 'view', 'settings', 'manual', 'scanner', 'arrange', 'filter-sheet'];
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
    filterGenre = filterGenre === chip.dataset.filter ? '' : chip.dataset.filter;
    renderList();
    hide('filter-sheet');
  });
  $('tab-library').addEventListener('click', () => { backTo = null; viewMode = 'library'; renderList(); });
  $('tab-wish').addEventListener('click', () => { backTo = null; viewMode = 'wish'; renderList(); });
  const closeViewMenu = () => { $('view-menu').hidden = true; $('view-cycle').setAttribute('aria-expanded', 'false'); };
  $('view-cycle').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = $('view-menu').hidden;
    $('view-menu').hidden = !open;
    $('view-cycle').setAttribute('aria-expanded', String(open));
  });
  $('view-menu').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    viewKind = btn.dataset.view;
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
      renderList();
      window.scrollTo(0, 0);
      document.querySelector('.top').classList.remove('away');
      return;
    }
    const st = e.target.closest('[data-status]');
    const sb = st && state.books.find((x) => x.id === viewId);
    if (sb) {
      // Un tocco imposta lo stato; un secondo tocco sullo stesso lo toglie.
      setStatus(sb, sb.status === st.dataset.status ? '' : st.dataset.status);
      sb.updatedAt = Date.now();
      saveState();
      renderList();
      renderView(sb);
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
    if (btn.dataset.act === 'bought') { b.list = ''; if (!b.boughtAt) b.boughtAt = today(); }
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
  $('place-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSettingsPlace(); });
  $('shelf-sort').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    shelfSort = btn.dataset.sort;
    setPref('libreria.shelfSort', shelfSort);
    renderList();
  });
  $('theme-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-set]');
    if (!btn) return;
    setPref('libreria.theme', btn.dataset.themeSet);
    applyTheme(btn.dataset.themeSet);
  });
  applyTheme(pref('libreria.theme', 'night'));
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
  $('scan-again').addEventListener('click', () => setScanMode('check'));
  $('scan-open').addEventListener('click', () => { const b = scan.found; closeScanner(); if (b) openView(b); });
  $('scan-wish').addEventListener('click', async () => {
    const isbn = scan.isbn;
    closeScanner();
    viewMode = 'wish';
    renderList();
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
  $('manual-empty').addEventListener('click', () => { hide('manual'); openBook({ title: $('manual-q').value.trim(), genres: [] }); });

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
  $('f-lists').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    current.list = chip.dataset.list;
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
  $('book-save-next').addEventListener('click', () => { const s = current.status; if (saveBook()) { stickyStatus = s; hide('book'); openScanner(); } });
  $('f-status').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    current.status = current.status === btn.dataset.status ? '' : btn.dataset.status;
    renderFormStatus();
  });
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

function openManual() {
  $('manual-q').value = '';
  $('manual-results').innerHTML = '';
  $('manual-status').textContent = 'Utile per i libri senza codice a barre.';
  show('manual');
  $('manual-q').focus();
}

init();
