// Libreria di casa · funzione «libreria-claude» (20/11/2026).
// L'app chiede a Claude cose che i cataloghi non sanno fare bene. Solo per i membri della libreria (Maurizio ed Elena):
// la chiave di Claude resta qui, tra i segreti di Supabase, e non passa mai dai telefoni.
// Chiave: LIBRERIA_ANTHROPIC_KEY se c'è (per tenere i costi separati), altrimenti ANTHROPIC_API_KEY già usata dall'HUB.
//  · {azione: "autore", nome, lingua, vostri: [{titolo, numero}]} → { ok, libri: [{titolo, saga, numero, anno, editore, isbn, prezzo, nota}], costo }
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
async function chiedi(prompt: string, ricerche = 5): Promise<{ testo: string; costo: number; err?: string }> {
  const key = Deno.env.get("LIBRERIA_ANTHROPIC_KEY") || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { testo: "", costo: 0, err: "manca la chiave" };
  const messages: any[] = [{ role: "user", content: prompt }];
  let tin = 0, tout = 0, cerche = 0, testo = "";
  for (let giro = 0; giro < 4; giro++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODELLO, max_tokens: 4000, output_config: { effort: "low" }, messages, // poco ragionamento: risposta più rapida
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: ricerche, user_location: { type: "approximate", country: "IT", timezone: "Europe/Rome" } }] }),
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return out({ ok: false, error: "solo POST" }, 405);
  try {
    if (!(await membro(req.headers.get("Authorization") || ""))) return out({ ok: false, error: "accesso non valido" }, 401);
    const b = await req.json().catch(() => ({}));
    if (b.azione === "autore") return out(await autore(b));
    return out({ ok: false, error: "azione sconosciuta" }, 400);
  } catch (e) { return out({ ok: false, error: String((e as Error).message || e).slice(0, 300) }, 500); }
});
