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

const STORAGE_KEY = 'libreria.v1';
const DEFAULT_GENRES = [
  'Narrativa', 'Giallo', 'Thriller', 'Romanzo storico', 'Romance', 'Fantasy', 'Fantascienza', 'Horror',
  'Classici', 'Bambini e ragazzi', 'Fumetti', 'Poesia', 'Biografie', 'Saggistica', 'Storia', 'Scienza',
  'Psicologia', 'Crescita personale', 'Medicina e salute', 'Filosofia', 'Religione e spiritualità',
  'Economia', 'Arte', 'Cucina', 'Viaggi',
];

let state = { books: [], genres: [...DEFAULT_GENRES] };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.books = Array.isArray(data.books) ? data.books : [];
      state.genres = Array.isArray(data.genres) && data.genres.length ? data.genres : [...DEFAULT_GENRES];
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
    title: [v.title, v.subtitle].filter(Boolean).join('. '),
    authors: (v.authors || []).join(', '),
    publisher: v.publisher || '',
    year: yearOf(v.publishedDate),
    pages: v.pageCount ? String(v.pageCount) : '',
    cover: httpsUrl(img.thumbnail || img.smallThumbnail),
    subjects: v.categories || [],
  };
}

async function lookupGoogle(isbn) {
  const data = await getJson('https://www.googleapis.com/books/v1/volumes?country=IT&q=isbn:' + isbn);
  if (!data.items || !data.items.length) return null;
  return fromGoogleItem(data.items[0]);
}

async function lookupOpenLibrary(isbn) {
  const data = await getJson('https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=ISBN:' + isbn);
  const b = data['ISBN:' + isbn];
  if (!b) return null;
  return {
    isbn,
    title: [b.title, b.subtitle].filter(Boolean).join('. '),
    authors: (b.authors || []).map((a) => a.name).join(', '),
    publisher: (b.publishers || []).map((p) => p.name).join(', '),
    year: yearOf(b.publish_date),
    pages: b.number_of_pages ? String(b.number_of_pages) : '',
    cover: (b.cover && (b.cover.medium || b.cover.large)) || '',
    subjects: (b.subjects || []).map((s) => s.name || s),
  };
}

/* Interroga i due cataloghi insieme e unisce i risultati:
   per ogni campo vale il primo catalogo che lo ha. */
async function lookupIsbn(isbn) {
  const results = await Promise.allSettled([lookupGoogle(isbn), lookupOpenLibrary(isbn)]);
  const found = results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
  const failed = results.every((r) => r.status === 'rejected');
  if (!found.length) return { data: null, failed };
  const merged = { isbn, title: '', authors: '', publisher: '', year: '', pages: '', cover: '', subjects: [] };
  for (const f of found) {
    for (const k of ['title', 'authors', 'publisher', 'year', 'pages', 'cover']) if (!merged[k] && f[k]) merged[k] = f[k];
    merged.subjects.push(...(f.subjects || []));
  }
  return { data: merged, failed: false };
}

async function searchByText(text) {
  const data = await getJson('https://www.googleapis.com/books/v1/volumes?country=IT&maxResults=12&q=' + encodeURIComponent(text));
  return (data.items || []).map(fromGoogleItem).filter((b) => b.title);
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
    ['Mondadori', 'https://www.mondadoristore.it/search/?g=' + q],
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

function suggestGenres(subjects, authors) {
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
  const text = (subjects || []).join(' | ').toLowerCase();
  let hits = [];
  for (const [re, genre] of GENRE_RULES) {
    if (re.test(text) && state.genres.includes(genre) && !hits.includes(genre)) hits.push(genre);
  }
  if (hits.length > 1) hits = hits.filter((g) => g !== 'Narrativa');
  return { genres: hits.slice(0, 2), source: hits.length ? 'catalog' : '' };
}

const firstAuthor = (authors) => String(authors || '').split(',')[0].trim();

/* ================= 5. ELENCO DEI LIBRI ================= */

let filterGenre = '';

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
  const meta = [b.publisher, b.year, b.pages ? b.pages + ' pag.' : ''].filter(Boolean).join(' · ');
  const tags = (b.genres || []).map((g) => `<span class="tag">${esc(g)}</span>`).join('');
  return `<button class="book" ${attr}>
    ${coverHtml(b)}
    <span class="book-info">
      <span class="book-title">${esc(b.title || 'Senza titolo')}</span>
      ${b.authors ? `<span class="book-author">${esc(b.authors)}</span>` : ''}
      ${meta ? `<span class="book-meta">${esc(meta)}</span>` : ''}
      ${tags ? `<span class="book-tags">${tags}</span>` : ''}
      ${b.id && isIncomplete(b) ? '<span class="missing-dot">Dati da completare</span>' : ''}
    </span>
  </button>`;
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const sort = $('sort').value;
  let books = state.books.filter((b) => {
    if (filterGenre && !(b.genres || []).includes(filterGenre)) return false;
    if (!q) return true;
    return [b.title, b.authors, b.publisher, b.isbn, b.notes].some((x) => String(x || '').toLowerCase().includes(q));
  });
  const byText = (k) => (a, b) => String(a[k] || '').localeCompare(String(b[k] || ''), 'it', { sensitivity: 'base' });
  if (sort === 'title') books.sort(byText('title'));
  else if (sort === 'author') books.sort(byText('authors'));
  else books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  const total = state.books.length;
  $('count').textContent = total === 0 ? 'Nessun libro' : total === 1 ? '1 libro' : total + ' libri'
    + (books.length !== total ? ' · ' + books.length + ' mostrati' : '');

  // Filtri: solo i generi usati almeno una volta.
  const used = state.genres.filter((g) => state.books.some((b) => (b.genres || []).includes(g)));
  if (filterGenre && !used.includes(filterGenre)) filterGenre = '';
  $('filters').innerHTML = used.length
    ? [`<button class="chip${filterGenre ? '' : ' on'}" data-genre="">Tutti</button>`]
        .concat(used.map((g) => `<button class="chip${filterGenre === g ? ' on' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`)).join('')
    : '';

  if (!total) {
    $('list').innerHTML = `<div class="empty"><strong>La libreria è vuota</strong>
      Tocca «Scansiona un libro» e inquadra il codice a barre sul retro della copertina.</div>`;
  } else if (!books.length) {
    $('list').innerHTML = '<div class="empty"><strong>Nessun libro trovato</strong>Prova a cambiare ricerca o filtro.</div>';
  } else {
    $('list').innerHTML = books.map((b) => bookRowHtml(b, `data-id="${esc(b.id)}"`)).join('');
  }
}

/* Se una copertina non si carica, al suo posto compare l'iniziale del titolo. */
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el && el.tagName === 'IMG' && el.dataset.initial && el.parentNode) el.parentNode.textContent = el.dataset.initial;
}, true);

/* ================= 6. SCHEDA LIBRO ================= */

let current = null; // { book, isNew, selected:Set }

const FIELDS = ['title', 'authors', 'publisher', 'pages', 'year', 'isbn', 'notes'];

function openBook(book, opts = {}) {
  const isNew = !book.id;
  current = { book: { ...book }, isNew, selected: new Set(book.genres || []) };
  $('book-heading').textContent = isNew ? 'Nuovo libro' : 'Scheda libro';
  for (const k of FIELDS) $('f-' + k).value = book[k] || '';
  $('f-genre-new').value = '';
  $('f-genre-note').textContent = opts.genreNote || '';
  const banner = $('book-banner');
  banner.hidden = !opts.banner;
  banner.textContent = opts.banner || '';
  $('book-delete').hidden = isNew;
  $('book-save-next').hidden = !isNew;
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
  renderList();
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
  for (const k of ['title', 'authors', 'publisher', 'pages', 'year']) {
    if (!$('f-' + k).value.trim() && data[k]) { $('f-' + k).value = data[k]; filled++; }
  }
  if (!current.book.cover) {
    const cover = data.cover || (await probeCover(isbn));
    if (cover) { current.book.cover = cover; renderFormCover(); filled++; }
  }
  if (current.selected.size === 0) {
    const s = suggestGenres(data.subjects, $('f-authors').value);
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
    openBook(dup, { banner: 'Questo libro è già in libreria (aggiunto' + when + ').' });
    return;
  }
  const { data, failed } = await lookupIsbn(isbn);
  if (!data) {
    openBook({ isbn, genres: [] }, {
      banner: failed
        ? 'Cataloghi non raggiungibili. Puoi compilare la scheda a mano e completarla più tardi.'
        : 'Libro non trovato nei cataloghi. Compila la scheda a mano: l\'ISBN è già inserito.',
    });
    return;
  }
  if (!data.cover) data.cover = await probeCover(isbn);
  const s = suggestGenres(data.subjects, data.authors);
  const note = s.source === 'author' ? 'suggerito dai tuoi libri di ' + firstAuthor(data.authors)
    : s.source === 'catalog' ? 'suggerito dal catalogo, correggilo se serve' : 'scegline uno o più';
  openBook({ ...data, subjects: undefined, genres: s.genres }, { genreNote: '(' + note + ')' });
}

/* ================= 7. SCANNER ================= */

let scan = { stream: null, timer: null, busy: false, native: null, zxing: null, canvas: null };

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

async function openScanner() {
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
  if (scan.busy || !scan.stream || video.readyState < 2 || !video.videoWidth) return;
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
  stopCamera();
  if (navigator.vibrate) navigator.vibrate(60);
  setScanStatus('Trovato ' + isbn + '. Cerco il libro…');
  await handleIsbn(isbn);
  hide('scanner');
}

function stopCamera() {
  clearInterval(scan.timer);
  scan.timer = null;
  if (scan.stream) scan.stream.getTracks().forEach((t) => t.stop());
  scan.stream = null;
  $('video').srcObject = null;
}

function closeScanner() { stopCamera(); hide('scanner'); }
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
  if (dup) return openBook(dup, { banner: 'Questo libro è già in libreria.' });
  const s = suggestGenres(data.subjects, data.authors);
  openBook({ ...data, subjects: undefined, genres: s.genres }, { genreNote: s.genres.length ? '(suggerito, correggilo se serve)' : '(scegline uno o più)' });
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
  const cols = [['title', 'Titolo'], ['authors', 'Autore'], ['publisher', 'Casa editrice'], ['year', 'Anno'], ['pages', 'Pagine'], ['genres', 'Genere'], ['isbn', 'ISBN'], ['notes', 'Note']];
  const cell = (v) => '"' + String(Array.isArray(v) ? v.join(', ') : v ?? '').replace(/"/g, '""') + '"';
  const rows = [cols.map((c) => cell(c[1])).join(';')].concat(state.books.map((b) => cols.map((c) => cell(b[c[0]])).join(';')));
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
  $('genre-list').innerHTML = state.genres.map((g, i) => {
    const used = state.books.filter((b) => (b.genres || []).includes(g)).length;
    return `<div class="genre-item">
      <input type="text" id="genre-${i}" value="${esc(g)}" data-genre-index="${i}" aria-label="Nome del genere">
      <button class="btn ghost" data-genre-del="${i}" aria-label="Elimina ${esc(g)}">${used ? 'Elimina (' + used + ')' : 'Elimina'}</button>
    </div>`;
  }).join('');
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
  if (filterGenre === old) filterGenre = target;
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

function show(id) { $(id).hidden = false; }
function hide(id) { $(id).hidden = true; }

let toastTimer = null;
function toast(text, actionLabel, action) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(text)}</span>`;
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
    filterGenre = chip.dataset.genre;
    renderList();
  });
  $('list').addEventListener('click', (e) => {
    const row = e.target.closest('.book');
    const book = row && state.books.find((b) => b.id === row.dataset.id);
    if (book) openBook(book);
  });

  // Scanner
  $('btn-scan').addEventListener('click', openScanner);
  $('scan-close').addEventListener('click', closeScanner);
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
  $('book-save').addEventListener('click', () => { if (saveBook()) { hide('book'); toast('Salvato.'); } });
  $('book-save-next').addEventListener('click', () => { if (saveBook()) { hide('book'); openScanner(); } });
  $('book-refill').addEventListener('click', refillFromCatalogs);
  $('book-delete').addEventListener('click', () => {
    const b = current.book;
    const i = state.books.findIndex((x) => x.id === b.id);
    if (i < 0) return;
    const removed = state.books.splice(i, 1)[0];
    saveState();
    renderList();
    hide('book');
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
