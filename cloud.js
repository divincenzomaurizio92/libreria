/* Libreria online: accesso con email e password e sincronizzazione tra i telefoni.
   I dati restano anche nella memoria del telefono: senza rete l'app funziona come prima,
   e quando la rete torna le modifiche partono da sole.
   La chiave qui sotto è quella pubblica del progetto: da sola non apre nulla,
   perché le regole del database lasciano leggere e scrivere solo ai membri della libreria. */
const CLOUD_URL = 'https://yhtdnfxlszkeydlnxwme.supabase.co';
const CLOUD_KEY = 'sb_publishable_y_GGmVv2RD7z83XXgGStDw_0HfaoloX';
const SYNC_KEY = 'libreria.sync';

let sb = null;
let cloudUser = null;
let cloud = loadSyncState();
let syncTimer = null, syncing = false, syncAgain = false;
let cloudStatus = { kind: 'off', text: '' }; // off | ok | busy | error | offline | denied

function loadSyncState() {
  try { const s = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); if (s && typeof s === 'object') return { synced: {}, ...s }; } catch (e) { /* niente */ }
  return { lib: '', name: '', lastPull: '', synced: {}, settingsSig: '', settingsAt: 0 };
}
function saveSyncState() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(cloud)); } catch (e) { /* memoria piena: si riprova al prossimo giro */ } }

const bookSig = (b) => JSON.stringify(b);
const settingsOf = () => ({ genres: state.genres, wishlists: state.wishlists, owners: state.owners, places: state.places });
const settingsSig = () => JSON.stringify(settingsOf());

function setCloudStatus(kind, text) {
  cloudStatus = { kind, text };
  if (!$('settings').hidden) renderCloud();
}

function cloudReady() { return Boolean(sb && cloudUser && cloud.lib); }

/* Liste desideri condivise: chi ha il link può segnare «Lo prendo io»; qui si leggono i nomi. */
async function pullClaims() {
  const { data, error } = await sb.from('libreria_claims').select('id,book_id,name').eq('library_id', cloud.lib);
  if (error) { console.warn('[Libreria] prenotazioni', error); return false; }
  const next = {};
  for (const c of data || []) next[c.book_id] = { name: c.name, id: c.id };
  const changed = JSON.stringify(next) !== JSON.stringify(claims);
  claims = next;
  return changed;
}

async function unclaimBook(bookId) {
  const c = claims[bookId];
  if (!c || !cloudReady()) return;
  const { error } = await sb.from('libreria_claims').delete().eq('id', c.id);
  if (error) return toast('Non riesco a liberarlo: riprova tra poco.');
  delete claims[bookId];
  renderList();
  const b = state.books.find((x) => x.id === bookId);
  if (b && !$('view').hidden) renderView(b);
  toast('Di nuovo libero: chi apre il link può prenderlo.');
}

/* Claude: la domanda passa dalla funzione «libreria-claude» su Supabase, che tiene la chiave. */
async function askClaude(body) {
  if (!cloudReady()) return { ok: false, error: 'serve la libreria online' };
  if (!navigator.onLine) return { ok: false, error: 'serve la connessione' };
  try {
    const { data, error } = await sb.functions.invoke('libreria-claude', { body });
    if (error) {
      let msg = error.message || 'nessuna risposta';
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* niente */ }
      return { ok: false, error: msg };
    }
    return data || { ok: false, error: 'risposta vuota' };
  } catch (e) { return { ok: false, error: 'nessuna risposta, riprova tra poco' }; }
}

/* Crea (o riusa) il link della lista e lo passa a WhatsApp, Telegram, email… */
async function shareList(list) {
  if (!list) return;
  if (!cloudReady()) return toast('Per condividere una lista serve la libreria online: Impostazioni → La vostra libreria online.');
  if (!navigator.onLine) return toast('Serve la connessione per creare il link.');
  let token = '';
  const { data, error } = await sb.from('libreria_shares').select('token').eq('library_id', cloud.lib).eq('list', list).eq('revoked', false).limit(1);
  if (error) return toast('Non riesco a creare il link: riprova tra poco.');
  if (data && data.length) token = data[0].token;
  else {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    token = Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
    const { error: e2 } = await sb.from('libreria_shares').insert({ token, library_id: cloud.lib, list });
    if (e2) return toast('Non riesco a creare il link: riprova tra poco.');
  }
  const url = new URL('share.html?t=' + token, location.href).href;
  const text = 'La mia lista desideri «' + list + '»: se vuoi regalarmi un libro, tocca «Lo prendo io» così non arrivano doppioni.';
  if (navigator.share) {
    try { await navigator.share({ title: 'Lista desideri: ' + list, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copiato: incollalo dove vuoi.'); }
  catch (e) { prompt('Copia il link della lista:', url); }
}

/* Ogni salvataggio sul telefono fa partire, poco dopo, l'invio al database. */
function scheduleSync(delay = 2500) {
  if (!cloudReady()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}

async function syncNow() {
  if (!cloudReady()) return;
  if (!navigator.onLine) return setCloudStatus('offline', 'Senza connessione: le modifiche partono appena torna la rete.');
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setCloudStatus('busy', 'Sincronizzo…');
  try {
    let changedLocally = await pullBooks();
    if (await syncSettings()) changedLocally = true;
    await pushBooks();
    if (await pullClaims()) changedLocally = true;
    cloud.lastSync = Date.now();
    saveSyncState();
    setCloudStatus('ok', '');
    if (changedLocally) { renderList(); refreshColors(); if (!$('view').hidden) { const b = state.books.find((x) => x.id === viewId); if (b) renderView(b); else hide('view'); } }
  } catch (e) {
    console.warn('[Libreria] sincronizzazione', e);
    setCloudStatus('error', 'Sincronizzazione non riuscita: riprovo tra poco.');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 30000);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(500); }
  }
}

/* Scarica ciò che è cambiato dall'ultima volta. Se un libro è stato modificato solo altrove, vince quello;
   se è stato modificato su entrambi i telefoni, vince la modifica più recente. */
async function pullBooks() {
  let changed = false, maxAt = cloud.lastPull || '', from = 0;
  const since = cloud.lastPull ? new Date(new Date(cloud.lastPull).getTime() - 10000).toISOString() : '';
  for (;;) {
    let q = sb.from('libreria_books').select('id,data,deleted,updated_at').eq('library_id', cloud.lib).order('updated_at').range(from, from + 499);
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data) {
      if (r.updated_at > maxAt) maxAt = r.updated_at;
      const i = state.books.findIndex((b) => b.id === r.id);
      const local = i >= 0 ? state.books[i] : null;
      const untouched = local && bookSig(local) === cloud.synced[r.id];
      if (r.deleted) {
        if (local && (untouched || (local.updatedAt || 0) <= (r.data.deletedAt || 0))) { state.books.splice(i, 1); changed = true; }
        if (!local || untouched) delete cloud.synced[r.id];
        continue;
      }
      const remote = r.data;
      if (!local) {
        if (cloud.synced[r.id] !== undefined) continue; // eliminato qui e non ancora inviato
        state.books.push(remote); changed = true;
      } else if (bookSig(local) === bookSig(remote)) {
        // già uguale
      } else if (untouched || (remote.updatedAt || remote.addedAt || 0) > (local.updatedAt || local.addedAt || 0)) {
        state.books[i] = remote; changed = true;
      } else {
        continue; // la versione di questo telefono è più recente: partirà con l'invio
      }
      cloud.synced[r.id] = bookSig(remote);
    }
    if (data.length < 500) break;
    from += 500;
  }
  cloud.lastPull = maxAt;
  if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return changed;
}

async function pushBooks() {
  const rows = [];
  for (const b of state.books) {
    const sig = bookSig(b);
    if (cloud.synced[b.id] !== sig) rows.push([{ library_id: cloud.lib, id: b.id, data: b, deleted: false }, sig]);
  }
  const ids = new Set(state.books.map((b) => b.id));
  for (const id of Object.keys(cloud.synced)) {
    if (!ids.has(id)) rows.push([{ library_id: cloud.lib, id, data: { id, deletedAt: Date.now() }, deleted: true }, undefined]);
  }
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await sb.from('libreria_books').upsert(chunk.map(([r]) => r), { onConflict: 'library_id,id' });
    if (error) throw error;
    for (const [r, sig] of chunk) { if (sig === undefined) delete cloud.synced[r.id]; else cloud.synced[r.id] = sig; }
    saveSyncState();
  }
}

/* Generi, liste desideri, persone e mobili.
   Si confronta ogni telefono con l'ultima versione sincronizzata («base»): ciò che è stato aggiunto
   da una parte si aggiunge, ciò che è stato tolto o rinominato da una parte sparisce anche dall'altra.
   Così una lista eliminata su un telefono non ricompare dall'altro. */
const SETTINGS_KEYS = ['genres', 'wishlists', 'owners', 'places'];
async function syncSettings() {
  const { data, error } = await sb.from('libreria_libraries').select('settings,settings_at').eq('id', cloud.lib).single();
  if (error) throw error;
  const remote = data.settings || {};
  const local = settingsOf();
  const hasRemote = SETTINGS_KEYS.some((k) => Array.isArray(remote[k]));
  let merged;
  if (!hasRemote) {
    merged = local;                                   // primo telefono: la sua configurazione diventa quella di tutti
  } else if (!cloud.settingsBase) {
    // Telefono già sincronizzato con la versione precedente dell'app (che univa tutto): vale quella online.
    merged = cloud.settingsSig ? remote : null;
    if (!merged) {                                    // primo accesso di questo telefono: si uniscono le due
      merged = {};
      for (const k of SETTINGS_KEYS) { const R = remote[k] || []; merged[k] = [...R, ...(local[k] || []).filter((x) => !R.includes(x))]; }
    }
  } else {
    merged = {};
    for (const k of SETTINGS_KEYS) {
      const R = Array.isArray(remote[k]) ? remote[k] : [], L = local[k] || [], B = cloud.settingsBase[k] || [];
      const removed = B.filter((x) => !L.includes(x));
      const added = L.filter((x) => !B.includes(x) && !R.includes(x));
      merged[k] = [...R.filter((x) => !removed.includes(x)), ...added];
    }
  }
  for (const k of SETTINGS_KEYS) merged[k] = Array.isArray(merged[k]) ? merged[k] : (local[k] || []);
  const mergedSig = JSON.stringify(merged);
  if (mergedSig !== JSON.stringify(local)) {
    for (const k of SETTINGS_KEYS) state[k] = merged[k];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!$('settings').hidden) renderSettings();
  }
  // Chiave di Google Books: viaggia con la libreria (la leggono solo i membri), così ogni telefono la riceve da solo.
  // Se è stata cambiata su questo telefono vince quella; altrimenti si prende quella online.
  const localKey = localStorage.getItem('libreria.googleKey') || '';
  const remoteKey = typeof remote.googleKey === 'string' ? remote.googleKey : '';
  const key = localKey && localKey !== (cloud.keySeen || '') ? localKey : remoteKey || localKey;
  if (key !== localKey) {
    localStorage.setItem('libreria.googleKey', key);
    if (!$('settings').hidden) renderSettings();
  }
  cloud.keySeen = key;
  // Obiettivi di lettura (persona e anno): per ognuno vince l'ultimo cambiato, su qualsiasi telefono.
  const rGoals = remote.goals && typeof remote.goals === 'object' ? remote.goals : {};
  const lGoals = state.goals || {};
  const goals = { ...rGoals };
  for (const [k, g] of Object.entries(lGoals)) if (!goals[k] || (g.at || 0) > (goals[k].at || 0)) goals[k] = g;
  const sortedSig = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k].n, o[k].at]));
  const goalsSig = sortedSig(goals);
  const goalsChanged = goalsSig !== sortedSig(lGoals);
  if (goalsChanged) {
    state.goals = goals;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!$('year').hidden) renderYear();
  }
  const remoteSig = JSON.stringify(SETTINGS_KEYS.reduce((o, k) => ((o[k] = remote[k] || []), o), {}));
  if (!hasRemote || mergedSig !== remoteSig || key !== remoteKey || goalsSig !== sortedSig(rGoals)) {
    const at = Date.now();
    const { error: e2 } = await sb.from('libreria_libraries').update({ settings: { ...merged, googleKey: key, goals }, settings_at: at }).eq('id', cloud.lib);
    if (e2) throw e2;
    cloud.settingsAt = at;
  } else {
    cloud.settingsAt = Number(data.settings_at) || cloud.settingsAt;
  }
  cloud.settingsBase = JSON.parse(mergedSig);
  cloud.settingsSig = settingsSig();
  return mergedSig !== JSON.stringify(local) || goalsChanged;
}

/* ---------- Accesso ---------- */
async function cloudJoin() {
  const { data, error } = await sb.rpc('libreria_join');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.library_id) {
    cloud.lib = '';
    saveSyncState();
    setCloudStatus('denied', 'Questa email non è tra quelle della famiglia. Chiedi a Maurizio di aggiungerla.');
    return false;
  }
  if (cloud.lib && cloud.lib !== row.library_id) cloud = { lib: '', name: '', lastPull: '', synced: {}, settingsSig: '', settingsAt: 0 };
  cloud.lib = row.library_id;
  cloud.name = row.name || '';
  saveSyncState();
  // Il saluto e «Chi usa questo telefono» seguono chi ha fatto l'accesso.
  if (cloud.name) {
    if (!state.owners.includes(cloud.name)) { state.owners.push(cloud.name); saveState(); }
    setPref('libreria.me', cloud.name);
  }
  return true;
}

/* Accesso con email e password: gli account li crea Maurizio dal pannello di Supabase. */
async function cloudSignIn() {
  const email = $('cloud-email').value.trim().toLowerCase();
  const password = $('cloud-pass').value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Scrivi un indirizzo email valido.');
  if (!password) return toast('Scrivi la password.');
  const btn = $('cloud-login');
  btn.disabled = true;
  btn.textContent = 'Entro…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.textContent = 'Entra';
  if (error) {
    return toast(/invalid|credentials/i.test(error.message) ? 'Email o password sbagliate.'
      : /confirm/i.test(error.message) ? 'Account non ancora confermato: chiedi a Maurizio di spuntare «Auto Confirm User».'
      : /rate|too many/i.test(error.message) ? 'Troppi tentativi: riprova tra qualche minuto.'
      : 'Accesso non riuscito: ' + error.message);
  }
  cloudUser = data.user;
  try {
    if (await cloudJoin()) { toast('Collegato: sincronizzo la libreria…'); await syncNow(); toast('Libreria sincronizzata.'); }
  } catch (e) { setCloudStatus('error', 'Collegato, ma la libreria non risponde: riprovo tra poco.'); scheduleSync(15000); }
  renderCloud();
  renderList();
}

async function cloudSignOut() {
  if (!confirmSoft('Uscire? I libri restano su questo telefono, ma smettono di sincronizzarsi finché non rientri.')) return;
  await sb.auth.signOut();
  cloudUser = null;
  cloud.lib = '';
  saveSyncState();
  setCloudStatus('off', '');
  renderCloud();
}
function confirmSoft(text) { return window.confirm(text); }

function renderCloud() {
  const box = $('cloud-box');
  if (!box) return;
  if (!sb) { box.innerHTML = '<p class="hint">La parte online non si è caricata: controlla la connessione e riapri l\'app.</p>'; return; }
  if (!cloudUser) {
    box.innerHTML = `<p class="hint">Entra con la tua email e la tua password: la libreria sarà la stessa su tutti i vostri telefoni, e resta anche senza internet. Si fa una volta sola.</p>
      <div class="field"><input id="cloud-email" type="email" inputmode="email" autocomplete="username" placeholder="La tua email" aria-label="La tua email"></div>
      <div class="field"><input id="cloud-pass" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password"></div>
      <button class="btn primary wide" id="cloud-login">Entra</button>
      <p class="hint">Password dimenticata? Maurizio può cambiarla dal pannello di Supabase.</p>`;
    return;
  }
  const when = cloud.lastSync ? new Date(cloud.lastSync).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'mai';
  const status = cloudStatus.kind === 'denied' || cloudStatus.kind === 'error' || cloudStatus.kind === 'offline' ? cloudStatus.text
    : cloudStatus.kind === 'busy' ? 'Sincronizzo…' : 'Tutto sincronizzato · ultimo controllo: ' + when;
  box.innerHTML = `<p class="cloud-who"><span class="cloud-dot ${esc(cloudStatus.kind)}"></span>${esc(cloud.name || cloudUser.email)} <small>${esc(cloudUser.email)}</small></p>
    <p class="hint">${esc(status)}</p>
    <div class="row"><button class="btn ghost" id="cloud-sync" style="flex:1">Sincronizza adesso</button><button class="btn ghost" id="cloud-out">Esci</button></div>`;
}

function initCloud() {
  if (!window.supabase || !window.supabase.createClient) { renderCloud(); return; }
  sb = window.supabase.createClient(CLOUD_URL, CLOUD_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'libreria.auth' },
  });
  $('cloud-box').addEventListener('click', (e) => {
    if (e.target.closest('#cloud-login')) cloudSignIn();
    else if (e.target.closest('#cloud-sync')) syncNow();
    else if (e.target.closest('#cloud-out')) cloudSignOut();
  });
  $('cloud-box').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'cloud-email') $('cloud-pass').focus();
    if (e.target.id === 'cloud-pass') cloudSignIn();
  });
  sb.auth.getSession().then(async ({ data }) => {
    cloudUser = data.session ? data.session.user : null;
    if (!cloudUser) return renderCloud();
    try { if (await cloudJoin()) syncNow(); } catch (e) { setCloudStatus('error', 'La libreria online non risponde: riprovo tra poco.'); scheduleSync(15000); }
  });
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { cloudUser = null; renderCloud(); }
    else if (session) cloudUser = session.user;
  });
  window.addEventListener('online', () => scheduleSync(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });
  setInterval(() => { if (document.visibilityState === 'visible') scheduleSync(0); }, 60000);
}

initCloud();
