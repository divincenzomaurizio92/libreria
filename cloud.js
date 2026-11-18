/* Libreria online: accesso con codice via email e sincronizzazione tra i telefoni.
   I dati restano anche nella memoria del telefono: senza rete l'app funziona come prima,
   e quando la rete torna le modifiche partono da sole.
   La chiave qui sotto è quella pubblica del progetto: da sola non apre nulla,
   perché le regole del database lasciano leggere e scrivere solo ai membri della libreria. */
const CLOUD_URL = 'https://yhtdnfxlszkeydlnxwme.supabase.co';
const CLOUD_KEY = 'sb_publishable_y_GGmVv2RD7z83XXgGStDw_0HfaoloX';
const SYNC_KEY = 'libreria.sync';

let sb = null;
let cloudUser = null;
let cloudPendingEmail = '';
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
    const changedLocally = await pullBooks();
    await syncSettings();
    await pushBooks();
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

/* Generi, liste, persone e mobili: vince l'ultima modifica, unendo i nomi così non se ne perde nessuno. */
async function syncSettings() {
  const { data, error } = await sb.from('libreria_libraries').select('settings,settings_at').eq('id', cloud.lib).single();
  if (error) throw error;
  const local = settingsSig();
  const localChanged = local !== cloud.settingsSig;
  const remote = data.settings || {};
  const remoteNewer = Number(data.settings_at) > (cloud.settingsAt || 0);
  if (remoteNewer && Object.keys(remote).length) {
    for (const k of ['genres', 'wishlists', 'owners', 'places']) {
      if (!Array.isArray(remote[k])) continue;
      const extra = localChanged ? (state[k] || []).filter((x) => !remote[k].includes(x)) : [];
      state[k] = [...remote[k], ...extra];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    cloud.settingsAt = Number(data.settings_at);
    cloud.settingsSig = settingsSig();
    if (!localChanged) return;
  }
  if (localChanged || !Object.keys(remote).length) {
    const at = Date.now();
    const { error: e2 } = await sb.from('libreria_libraries').update({ settings: settingsOf(), settings_at: at }).eq('id', cloud.lib);
    if (e2) throw e2;
    cloud.settingsAt = at;
    cloud.settingsSig = settingsSig();
  }
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

async function cloudSendCode() {
  const email = $('cloud-email').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Scrivi un indirizzo email valido.');
  const btn = $('cloud-send');
  btn.disabled = true;
  btn.textContent = 'Invio…';
  // shouldCreateUser: false → entra solo chi ha già un account sul progetto.
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  btn.disabled = false;
  btn.textContent = 'Ricevi il codice';
  if (error) {
    const msg = /rate|too many|seconds/i.test(error.message) ? 'Troppe richieste ravvicinate: riprova tra qualche minuto.'
      : /signups|not allowed|not found|user/i.test(error.message) ? 'Per questa email non c\'è ancora un account: chiedi a Maurizio di crearlo.'
      : 'Invio non riuscito: ' + error.message;
    return toast(msg);
  }
  cloudPendingEmail = email;
  renderCloud();
  setTimeout(() => { const c = $('cloud-code'); if (c) c.focus(); }, 50);
}

async function cloudVerify() {
  const token = $('cloud-code').value.replace(/\D/g, '');
  if (token.length < 6) return toast('Il codice ha 6 cifre: lo trovi nell\'email.');
  const btn = $('cloud-verify');
  btn.disabled = true;
  btn.textContent = 'Controllo…';
  const { data, error } = await sb.auth.verifyOtp({ email: cloudPendingEmail, token, type: 'email' });
  btn.disabled = false;
  btn.textContent = 'Entra';
  if (error) return toast(/expired|invalid/i.test(error.message) ? 'Codice scaduto o sbagliato: chiedine uno nuovo.' : 'Accesso non riuscito: ' + error.message);
  cloudUser = data.user;
  cloudPendingEmail = '';
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
    box.innerHTML = cloudPendingEmail
      ? `<p class="hint">Ti ho mandato un codice di 6 cifre a <b>${esc(cloudPendingEmail)}</b>. Controlla anche lo spam.</p>
         <div class="row"><input id="cloud-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Codice" aria-label="Codice ricevuto per email">
         <button class="btn primary" id="cloud-verify">Entra</button></div>
         <button class="btn ghost wide" id="cloud-back">Cambia email</button>`
      : `<p class="hint">Entra con la tua email: la libreria sarà la stessa su tutti i vostri telefoni, e resta anche senza internet.</p>
         <div class="row"><input id="cloud-email" type="email" inputmode="email" autocomplete="email" placeholder="La tua email" aria-label="La tua email">
         <button class="btn primary" id="cloud-send">Ricevi il codice</button></div>`;
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
    if (e.target.closest('#cloud-send')) cloudSendCode();
    else if (e.target.closest('#cloud-verify')) cloudVerify();
    else if (e.target.closest('#cloud-back')) { cloudPendingEmail = ''; renderCloud(); }
    else if (e.target.closest('#cloud-sync')) syncNow();
    else if (e.target.closest('#cloud-out')) cloudSignOut();
  });
  $('cloud-box').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'cloud-email') cloudSendCode();
    if (e.target.id === 'cloud-code') cloudVerify();
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
