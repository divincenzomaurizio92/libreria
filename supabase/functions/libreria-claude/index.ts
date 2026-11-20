// Libreria di casa · funzione «libreria-claude» (20/11/2026).
// L'app chiede a Claude cose che i cataloghi non sanno fare bene. Solo per i membri della libreria (Maurizio ed Elena):
// la chiave di Claude resta qui, tra i segreti di Supabase, e non passa mai dai telefoni.
// Chiave: LIBRERIA_ANTHROPIC_KEY se c'è (per tenere i costi separati), altrimenti ANTHROPIC_API_KEY già usata dall'HUB.
//  · {azione: "autore", nome, lingua, vostri: [{titolo, numero}]} → { ok, libri: [{titolo, saga, numero, anno, editore, isbn, prezzo, nota}], costo }
//  · {azione: "scopri", preferiti: [{titolo, autore, voto}], generi: [..], temi: [..], avete: [titoli]}
//      → { ok, fonte, settimana, bestseller: [{posizione, titolo, autore, isbn, editore}], amazon: [idem], simili: [{titolo, autore, isbn, editore, simile_a}], costo }   (sezione «Da scoprire», una volta a settimana)
const SB = Deno.env.get("SUPABASE_URL")!;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const MODELLO = "claude-sonnet-5-5";
const PREZZO: [number, number] = [2, 10]; // dollari per milione di token (entrata, uscita), come nell'HUB

// Chi chiama: il gateway di Supabase ha già controllato il token (verify_jwt), qui se ne legge l'utente
// e si guarda che sia nella libreria, con il token stesso dell'utente (le regole del database fanno il resto).
async function membro(auth: string): Promise<boolean> {
  const tok = auth.replace(/^Bearer\s+/i, "");
  let uid = "";
  try { const p = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); uid = JSON.parse(atob(p + "===".slice((p.length + 3) % 4))).sub || ""; } catch { return false; }
  if (!/^[0-9a-f-]{36}$/.test(uid)) return false;
  const anon = "sb_publishable_y_GGmVv2RD7z83XXgGStDw_0HfaoloX"; // chiave pubblica della libreria (è già nell'app)
  const r = await fetch(`${SB}/rest/v1/libreria_members?select=library_id&user_id=eq.${uid}&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${tok}` } });
  if (!r.ok) { console.log(JSON.stringify({ membro: "errore", status: r.status, testo: (await r.text()).slice(0, 200) })); return false; }
  const rows = await r.json();
  if (!rows.length) console.log(JSON.stringify({ membro: "non trovato", uid }));
  return rows.length > 0;
}

// Una domanda a Claude con la ricerca sul web; «pause_turn» = Claude non ha finito di cercare, si continua.
async function chiedi(prompt: string, ricerche = 5, pagine = 0): Promise<{ testo: string; costo: number; err?: string }> {
  const key = Deno.env.get("LIBRERIA_ANTHROPIC_KEY") || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { testo: "", costo: 0, err: "manca la chiave" };
  const messages: any[] = [{ role: "user", content: prompt }];
  let tin = 0, tout = 0, cerche = 0, testo = "";
  for (let giro = 0; giro < 4; giro++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODELLO, max_tokens: 5000, output_config: { effort: "low" }, messages, // poco ragionamento: risposta più rapida
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: ricerche, user_location: { type: "approximate", country: "IT", timezone: "Europe/Rome" } },
          // Aprire una pagina intera (es. la classifica completa) quando la ricerca ne mostra solo un pezzo.
          ...(pagine ? [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: pagine, max_content_tokens: 12000 }] : [])] }),
    });
    const j = await r.json();
    tin += Number(j?.usage?.input_tokens || 0); tout += Number(j?.usage?.output_tokens || 0); cerche += Number(j?.usage?.server_tool_use?.web_search_requests || 0);
    if (!r.ok) return { testo: "", costo: 0, err: j?.error?.message || "nessuna risposta" };
    testo = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    if (j.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: j.content });
  }
  const costo = Math.round(((tin * PREZZO[0] + tout * PREZZO[1]) / 1e6 + cerche * 0.01) * 1000) / 1000;
  console.log(JSON.stringify({ chiedi: { tin, tout, cerche, costo } }));
  return { testo, costo };
}

// Classifica pubblica di Feltrinelli (i più venduti di oggi), letta direttamente dal sito: niente Claude, sempre 10 titoli in ordine.
const dec = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&egrave;/g, "è").replace(/&agrave;/g, "à").replace(/&ograve;/g, "ò")
  .replace(/&ugrave;/g, "ù").replace(/&igrave;/g, "ì").replace(/&eacute;/g, "é").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
async function feltrinelli(): Promise<any[]> {
  const r = await fetch("https://www.lafeltrinelli.it/classifica/libri/1day/sold?defaultPage=1", { headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36", "Accept-Language": "it-IT,it" } });
  if (!r.ok) throw new Error("Feltrinelli " + r.status);
  const h = await r.text();
  const at = h.indexOf("ranking-");
  if (at < 0) throw new Error("classifica non trovata nella pagina");
  const body = h.slice(Math.max(0, at - 4000));
  const eans: string[] = [], pos: number[] = [];
  for (const m of body.matchAll(/\/e\/(97[89]\d{10})/g)) { if (!eans.includes(m[1])) { eans.push(m[1]); pos.push(m.index!); } if (eans.length >= 10) break; }
  return eans.map((ean, k) => {
    const seg = body.slice(pos[k], pos[k + 1] || pos[k] + 15000);
    const titolo = dec((seg.match(/alt="([^"]{2,200})"/) || [])[1] || "").trim();
    const tok = dec(seg.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, "|")).split("|").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    // Dopo il titolo: «di», poi gli autori (separati da «,») fino a «Recensioni».
    const i = tok.findIndex((x) => x === titolo), au: string[] = [];
    if (i >= 0 && tok[i + 1] === "di") for (let j = i + 2; j < tok.length && !/^Recensioni/i.test(tok[j]) && au.length < 4; j++) if (tok[j] !== ",") au.push(tok[j]);
    const autore = au.join(", ");
    const ed = tok.find((x) => /^[A-Za-zÀ-ÿ&'.\- ]{2,40},?\s*\(?(19|20)\d{2}\)?$/.test(x)) || "";
    return { posizione: k + 1, titolo, autore, editore: ed.replace(/,?\s*\(?(19|20)\d{2}\)?$/, "").trim() || null, isbn: ean,
      copertina: `https://www.lafeltrinelli.it/images/${ean}_0_0_190_0_75.jpg` };
  }).filter((x) => x.titolo);
}

function jsonDa(t: string): any { const m = t.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } }
const s = (v: unknown, n = 160) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

async function autore(b: any) {
  const nome = s(b.nome, 80), lingua = s(b.lingua || "it", 5);
  if (!nome) return { ok: false, error: "manca l'autore" };
  const vostri = (Array.isArray(b.vostri) ? b.vostri : []).slice(0, 80).map((x: any) => `- ${s(x.titolo, 120)}${x.numero ? " (n. " + Number(x.numero) + ")" : ""}`).join("\n");
  const lin = { it: "italiano", en: "inglese", fr: "francese", de: "tedesco", es: "spagnolo" }[lingua] || lingua;
  const prompt = `Sei l'assistente di una libreria di casa italiana. Autore: «${nome}».\n`
    + `Libri di questo autore che la famiglia ha già:\n${vostri || "(nessuno)"}\n\n`
    + `Cerca sul web (siti degli editori, Amazon.it, IBS, Feltrinelli, Wikipedia) i libri di questo autore pubblicati in ${lin}, e indica quelli che la famiglia NON ha ancora.\n`
    + `Regole: solo edizioni in ${lin} realmente pubblicate; per le saghe a volumi indica nome della saga e numero del volume, e metti i volumi che mancano tra quelli posseduti (es. hanno 1-5: proponi 6, 7, …);\n`
    + `ordina: prima i volumi mancanti delle saghe che hanno già, in ordine di numero; poi le altre saghe e i libri singoli in ordine di uscita. Al massimo 20 libri.\n`
    + `Sii rapido: bastano una o due ricerche mirate (per esempio la bibliografia dell'autore e la pagina della saga), non controllare libro per libro.\n`
    + `Non inventare: se non sei sicuro di ISBN o prezzo, metti null. Non ripetere libri che hanno già (stesso titolo e stesso numero).\n`
    + `Rispondi SOLO con il JSON, senza altro testo: {"libri": [{"titolo": titolo dell'edizione in ${lin}, "saga": nome della saga o null, "numero": numero del volume o null, "anno": anno o null, "editore": editore o null, "isbn": ISBN-13 o null, "prezzo": prezzo di copertina in euro (numero) o null, "nota": nota brevissima o null}]}`;
  const r = await chiedi(prompt, 3);
  if (r.err) return { ok: false, error: r.err };
  const j = jsonDa(r.testo);
  if (!j) return { ok: false, error: "risposta non leggibile", costo: r.costo };
  const libri = (Array.isArray(j.libri) ? j.libri : []).slice(0, 20).filter((x: any) => x && x.titolo).map((x: any) => ({
    titolo: s(x.titolo), saga: x.saga ? s(x.saga, 100) : null, numero: Number(x.numero) || null, anno: /^\d{4}$/.test(String(x.anno)) ? String(x.anno) : null,
    editore: x.editore ? s(x.editore, 60) : null, isbn: /^97[89]\d{10}$/.test(String(x.isbn || "").replace(/-/g, "")) ? String(x.isbn).replace(/-/g, "") : null,
    prezzo: Number(x.prezzo) > 0 && Number(x.prezzo) < 500 ? Number(x.prezzo) : null, nota: x.nota ? s(x.nota, 120) : null,
  }));
  return { ok: true, libri, costo: r.costo };
}

async function scopri(b: any) {
  const pref = (Array.isArray(b.preferiti) ? b.preferiti : []).slice(0, 30).map((x: any) => `- «${s(x.titolo, 100)}» di ${s(x.autore, 60)}${x.voto ? " (" + Number(x.voto) + "★)" : ""}`).join("\n");
  const gen = (Array.isArray(b.generi) ? b.generi : []).slice(0, 12).map((x: any) => s(x, 40)).join(", ");
  const temi = (Array.isArray(b.temi) ? b.temi : []).slice(0, 12).map((x: any) => s(x, 40)).join(", ");
  const avete = (Array.isArray(b.avete) ? b.avete : []).slice(0, 250).map((x: any) => s(x, 60)).join("; ");
  const oggi = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  // La classifica Feltrinelli si legge direttamente dal sito (esatta e gratis); Claude la cerca solo se il sito non risponde.
  let felt: any[] = [];
  try { felt = await feltrinelli(); } catch (e) { console.log(JSON.stringify({ feltrinelli: String(e).slice(0, 200) })); }
  const conFelt = felt.length >= 5;
  const prompt = `Sei il bibliotecario di una famiglia italiana. Oggi è ${oggi}.\n`
    + (conFelt ? `1) (la classifica delle librerie è già pronta: salta questo punto e lascia "bestseller" vuoto)\n` : ``
      + `1) Cerca «classifica libri più venduti lafeltrinelli» e apri con web_fetch la pagina della classifica sul sito lafeltrinelli.it\n`
    + `   e riporta la sua TOP 10 nell'ordine mostrato, senza mescolare altre classifiche. Se la pagina non si apre, usa la classifica settimanale delle librerie Feltrinelli\n`
    + `   pubblicata da L'Espresso; se manca anche quella, la classifica dei più venduti di Mondadori Store (mondadoristore.it). Scrivi in "fonte" quale hai usato.\n`
    + `   Servono TUTTI E 10 i titoli: se una pagina ne mostra meno, aprila intera con web_fetch.\n`
    )
    + `2) Cerca i «Bestseller in Libri» di Amazon.it (la classifica dei più venduti su Amazon Italia) e riporta i primi 10 nell'ordine mostrato (apri la pagina con web_fetch se serve, tutti e 10 i titoli).\n`
    + `3) Proponi 10 libri, usciti in italiano, simili a quelli che la famiglia ha amato:\n${pref || "(nessun voto ancora)"}\n`
    + (gen ? `Generi che leggono: ${gen}.\n` : "") + (temi ? `Temi che amano: ${temi}.\n` : "")
    + `Non proporre libri che hanno già: ${avete || "(nessuno)"}.\n`
    + `Sii rapido: una ricerca per ciascuna classifica basta; i libri simili scegli tu, senza cercarli uno per uno.\n`
    + `Non inventare: solo libri che esistono in italiano; se non sei sicuro dell'ISBN metti null.\n`
    + `Per ogni libro simile indica in "simile_a" il titolo ESATTO di uno dei loro libri amati qui sopra a cui somiglia di più.\n`
    + `Rispondi SOLO con il JSON: {"fonte": "Classifica Feltrinelli" (o quella usata), "settimana": periodo delle vendite se scritto, es. "dal 9 al 15 novembre", altrimenti null, "bestseller": [{"posizione": 1, 2, 3… in ordine di vendita, "titolo", "autore", "editore" o null, "isbn" (ISBN-13) o null, "voto": media delle stelle dei lettori da 1 a 5 (es. 4.6) se la vedi su Amazon o Goodreads, altrimenti null,`
    + ` "copertina": indirizzo dell'immagine di copertina se lo vedi nella pagina aperta (per Amazon quelli che iniziano con https://m.media-amazon.com/images/), altrimenti null}],`
    + ` "amazon": [stessi campi di bestseller, con la posizione su Amazon e il voto medio mostrato da Amazon],`
    + ` "simili": [{"titolo", "autore", "editore" o null, "isbn" o null, "simile_a": titolo di un loro libro amato}]}`;
  const r = await chiedi(prompt, conFelt ? 2 : 4, 3);
  if (r.err) return { ok: false, error: r.err };
  const j = jsonDa(r.testo);
  if (!j) return { ok: false, error: "risposta non leggibile", costo: r.costo };
  const pulisci = (L: any) => (Array.isArray(L) ? L : []).slice(0, 12).filter((x: any) => x && x.titolo).map((x: any) => ({
    titolo: s(x.titolo), autore: s(x.autore, 100), editore: x.editore ? s(x.editore, 60) : null,
    isbn: /^97[89]\d{10}$/.test(String(x.isbn || "").replace(/-/g, "")) ? String(x.isbn).replace(/-/g, "") : null,
    posizione: Number(x.posizione) > 0 && Number(x.posizione) < 100 ? Number(x.posizione) : null, simile_a: x.simile_a ? s(x.simile_a, 100) : null,
    voto: Number(x.voto) >= 1 && Number(x.voto) <= 5 ? Math.round(Number(x.voto) * 10) / 10 : null,
    copertina: /^https:\/\/(m\.media-amazon\.com|images-[a-z]+\.ssl-images-amazon\.com)\/images\/[^\s"']+$/.test(String(x.copertina || "")) ? String(x.copertina) : null,
  }));
  if (conFelt) return { ok: true, fonte: "Classifica Feltrinelli · i più venduti di oggi", settimana: null, bestseller: felt, amazon: pulisci(j.amazon), simili: pulisci(j.simili), costo: r.costo };
  return { ok: true, fonte: j.fonte ? s(j.fonte, 60) : null, settimana: j.settimana ? s(j.settimana, 60) : null, bestseller: pulisci(j.bestseller), amazon: pulisci(j.amazon), simili: pulisci(j.simili), costo: r.costo };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return out({ ok: false, error: "solo POST" }, 405);
  try {
    if (!(await membro(req.headers.get("Authorization") || ""))) return out({ ok: false, error: "accesso non valido" }, 401);
    const b = await req.json().catch(() => ({}));
    if (b.azione === "autore") return out(await autore(b));
    if (b.azione === "scopri") return out(await scopri(b));
    return out({ ok: false, error: "azione sconosciuta" }, 400);
  } catch (e) { return out({ ok: false, error: String((e as Error).message || e).slice(0, 300) }, 500); }
});
