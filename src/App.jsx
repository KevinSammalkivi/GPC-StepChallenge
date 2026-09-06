import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "./supabase.js";

// ─── CONFIG ─────────────────────────────────────────────────
const CHALLENGE_START = new Date("2026-09-07");
const CHALLENGE_DAYS = 21;
const DAILY_GOAL = 5000;

// Streak-verstapostid. repeatable = saab uue seeriaga uuesti teenida.
const MILESTONES = [
  { days: 3,  bonus: 1500,  repeatable: true,  emoji: "🌱", label: "3 päeva järjest" },
  { days: 7,  bonus: 4000,  repeatable: true,  emoji: "⚡", label: "7 päeva järjest" },
  { days: 10, bonus: 6000,  repeatable: false, emoji: "💪", label: "10 päeva järjest" },
  { days: 14, bonus: 10000, repeatable: false, emoji: "🏆", label: "14 päeva järjest" },
  { days: 21, bonus: 25000, repeatable: false, emoji: "👑", label: "Kõik 21 päeva!" },
];

// Loodusboonus
const NATURE_BONUS = 2000;      // punkti matka kohta
const NATURE_MIN_STEPS = 5000;  // sel päeval nõutav sammude arv (praegu = päevanorm)
const NATURE_MAX = 7;           // mitu matka kogu challenge'i jooksul arvesse läheb

const MAX_FILE_MB = 5;

// ─── KUUPÄEVAD ──────────────────────────────────────────────
function getDayIndex(date = new Date()) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const s = new Date(CHALLENGE_START); s.setHours(0, 0, 0, 0);
  return Math.floor((d - s) / 86400000);
}

const MONTHS = ["jaan","veebr","märts","apr","mai","juuni","juuli","aug","sept","okt","nov","dets"];

function formatDate(dayIdx) {
  const d = new Date(CHALLENGE_START);
  d.setDate(d.getDate() + dayIdx);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

function formatNumber(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// ─── BOONUSMOOTOR ───────────────────────────────────────────
function goalDaySet(entries) {
  return new Set(entries.filter(e => e.steps >= DAILY_GOAL).map(e => e.day_index));
}

// Kõik katkematud seeriad (nende pikkused), kus päevanorm täis.
function getStreakRuns(entries) {
  const goal = goalDaySet(entries);
  const runs = [];
  let len = 0;
  for (let i = 0; i < CHALLENGE_DAYS; i++) {
    if (goal.has(i)) len++;
    else if (len) { runs.push(len); len = 0; }
  }
  if (len) runs.push(len);
  return runs;
}

// Käimasolev seeria: ulatub tänaseni, või eilseni kui täna on veel logimata.
function calcStreak(entries) {
  const goal = goalDaySet(entries);
  let idx = Math.min(getDayIndex(), CHALLENGE_DAYS - 1);
  if (idx < 0) return 0;
  if (!goal.has(idx)) idx--;
  let n = 0;
  while (idx >= 0 && goal.has(idx)) { n++; idx--; }
  return n;
}

// Iga seeria teenib iga verstaposti max korra.
// Kordumatud verstapostid (10/14/21) antakse kogu challenge'i peale ainult üks kord.
function calcBonuses(entries) {
  const runs = getStreakRuns(entries);
  const awards = [];
  const usedOnce = new Set();
  for (const run of runs) {
    for (const m of MILESTONES) {
      if (run < m.days) continue;
      if (m.repeatable) awards.push(m);
      else if (!usedOnce.has(m.days)) { usedOnce.add(m.days); awards.push(m); }
    }
  }
  const streakBonus = awards.reduce((sum, m) => sum + m.bonus, 0);

  const natureAll = entries
    .filter(e => e.nature_url)
    .sort((a, b) => a.day_index - b.day_index);
  const natureValid = natureAll.filter(e => e.steps >= NATURE_MIN_STEPS);
  const natureCounted = Math.min(natureValid.length, NATURE_MAX);
  const natureBonus = natureCounted * NATURE_BONUS;

  return {
    awards,
    streakBonus,
    natureAll,
    natureValid,
    natureCounted,
    natureBonus,
    runs,
    longestRun: runs.length ? Math.max(...runs) : 0,
    goalDays: entries.filter(e => e.steps >= DAILY_GOAL).length,
    total: streakBonus + natureBonus,
  };
}

// Mitu korda iga verstapost teenitud
function awardCounts(awards) {
  const map = {};
  for (const a of awards) map[a.days] = (map[a.days] || 0) + 1;
  return map;
}

// Areng: 3. nädala keskmine vs 1. nädala keskmine.
// Nõuab mõlemas nädalas vähemalt 3 logitud päeva, muidu saab ühe nõrga
// avapäevaga "arengut" võltsida.
function calcGrowth(entries) {
  const w1 = entries.filter(e => e.day_index <= 6);
  const w3 = entries.filter(e => e.day_index >= 14);
  if (w1.length < 3 || w3.length < 3) return null;
  const a1 = w1.reduce((s, e) => s + e.steps, 0) / w1.length;
  const a3 = w3.reduce((s, e) => s + e.steps, 0) / w3.length;
  if (a1 <= 0) return null;
  return (a3 - a1) / a1;
}

// Ühtlus: kui vähe päevad üksteisest kõiguvad (variatsioonikordaja pöördväärtus).
// Nõuab, et vähemalt 3/4 seniseks möödunud päevadest oleks logitud — muidu
// võidaks märgise kahe ühesuguse päevaga ja siis vaikimisega.
function calcEvenness(entries) {
  const elapsed = Math.min(getDayIndex() + 1, CHALLENGE_DAYS);
  const needed = Math.max(5, Math.ceil(elapsed * 0.75));
  if (entries.length < needed) return null;
  const mean = entries.reduce((s, e) => s + e.steps, 0) / entries.length;
  if (mean <= 0) return null;
  const variance = entries.reduce((s, e) => s + (e.steps - mean) ** 2, 0) / entries.length;
  return 1 - Math.sqrt(variance) / mean;   // suurem = ühtlasem
}

// ─── MÄRGISED ───────────────────────────────────────────────
// Iga märgis läheb ühele inimesele — challenge'i lõpus on mitu võitjat.
const BADGES = [
  { id: "machine", emoji: "👟", label: "Sammumasin",    desc: "Kõige rohkem reaalselt tehtud samme",
    value: u => u.realSteps,          min: 1,      fmt: v => `${formatNumber(v)} sammu` },
  { id: "growth",  emoji: "📈", label: "Suurim areng",  desc: "3. nädal vs 1. nädal",
    value: u => u.growth,             min: 0.0001, fmt: v => `+${Math.round(v * 100)}%` },
  { id: "forest",  emoji: "🌲", label: "Metsainimene",  desc: "Kõige rohkem loodusboonuseid",
    value: u => u.bonus.natureCounted, min: 1,     fmt: v => `${v} matka` },
  { id: "record",  emoji: "💥", label: "Rekordipäev",   desc: "Suurim üksik päev",
    value: u => u.bestDay,            min: 1,      fmt: v => `${formatNumber(v)} sammu` },
  { id: "even",    emoji: "⚖️", label: "Kõige ühtlasem", desc: "Väikseim päevade kõikumine",
    value: u => u.evenness,           min: 0,      fmt: v => `±${Math.round((1 - v) * 100)}% kõikumine` },
];

function awardBadges(users) {
  const out = {};
  for (const b of BADGES) {
    let best = null;
    for (const u of users) {
      const v = b.value(u);
      if (v == null || v < b.min) continue;
      if (!best || v > best.v) best = { u, v };
    }
    if (best) out[b.id] = { userId: best.u.id, value: best.v };
  }
  return out;
}

function buildUsers(participants, entries) {
  const users = participants.map(p => {
    const my = entries.filter(e => e.participant_id === p.id);
    const realSteps = my.reduce((sum, e) => sum + e.steps, 0);
    const bonus = calcBonuses(my);
    return {
      ...p,
      entries: my,
      realSteps,
      bonus,
      bonusSteps: bonus.total,
      points: realSteps + bonus.total,
      avg: my.length ? Math.round(realSteps / my.length) : 0,
      bestDay: my.length ? Math.max(...my.map(e => e.steps)) : 0,
      streak: calcStreak(my),
      growth: calcGrowth(my),
      evenness: calcEvenness(my),
      loggedDays: my.length,
    };
  });
  return { users, badges: awardBadges(users) };
}

// Lihtne PIN-i hash (pole krüptograafiliselt tugev, aga sõbralikuks
// väljakutseks piisab)
async function hashPin(pin) {
  const data = new TextEncoder().encode(pin + "step-challenge-salt-2026");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── ICONS ──────────────────────────────────────────────────
const Flame = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <path d="M12 2C12 2 4 10 4 15C4 19.4183 7.58172 23 12 23C16.4183 23 20 19.4183 20 15C20 10 12 2 12 2Z" fill="url(#fg)"/>
    <path d="M12 10C12 10 8 14 8 16.5C8 18.9853 9.79086 21 12 21C14.2091 21 16 18.9853 16 16.5C16 14 12 10 12 10Z" fill="url(#fg2)"/>
    <defs>
      <linearGradient id="fg" x1="12" y1="2" x2="12" y2="23"><stop stopColor="#FF6B35"/><stop offset="1" stopColor="#E91E8C"/></linearGradient>
      <linearGradient id="fg2" x1="12" y1="10" x2="12" y2="21"><stop stopColor="#FFD700"/><stop offset="1" stopColor="#FF6B35"/></linearGradient>
    </defs>
  </svg>
);

const Trophy = ({ rank }) => {
  const colors = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" };
  if (!colors[rank]) return <span style={{ width: 28, textAlign: "center", display: "inline-block", fontSize: 14, fontWeight: 700, color: "#9B7EC8" }}>#{rank}</span>;
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M7 4H17V8C17 11.3137 14.7614 14 12 14C9.23858 14 7 11.3137 7 8V4Z" fill={colors[rank]} opacity="0.9"/>
      <path d="M5 4H7V7C5.5 7 4 6 4 5C4 4.44772 4.44772 4 5 4Z" fill={colors[rank]} opacity="0.6"/>
      <path d="M19 4H17V7C18.5 7 20 6 20 5C20 4.44772 19.5523 4 19 4Z" fill={colors[rank]} opacity="0.6"/>
      <rect x="10" y="14" width="4" height="3" fill={colors[rank]} opacity="0.7"/>
      <rect x="8" y="17" width="8" height="2" rx="1" fill={colors[rank]} opacity="0.8"/>
    </svg>
  );
};

// ─── SUPABASE HELPERS ───────────────────────────────────────
async function getAllData() {
  const { data: participants } = await supabase.from("participants").select("id, name, name_lower, created_at").order("created_at");
  const { data: entries } = await supabase.from("step_entries").select("*");
  return { participants: participants || [], entries: entries || [] };
}

async function registerParticipant(name, pin) {
  const pinHash = await hashPin(pin);
  const { data, error } = await supabase
    .from("participants")
    .insert({ name: name.trim(), name_lower: name.trim().toLowerCase(), pin_hash: pinHash })
    .select("id, name, name_lower, created_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("See nimi on juba võetud!");
    throw error;
  }
  return data;
}

async function loginParticipant(nameLower, pin) {
  const pinHash = await hashPin(pin);
  const { data, error } = await supabase
    .from("participants")
    .select("id, name, name_lower, created_at")
    .eq("name_lower", nameLower)
    .eq("pin_hash", pinHash)
    .single();
  if (error || !data) throw new Error("Vale PIN-kood!");
  return data;
}

async function upsertSteps(participantId, dayIndex, steps, screenshotUrl, natureUrl, natureNote) {
  const { data, error } = await supabase
    .from("step_entries")
    .upsert({
      participant_id: participantId,
      day_index: dayIndex,
      steps,
      screenshot_url: screenshotUrl,
      nature_url: natureUrl,
      nature_note: natureNote,
      updated_at: new Date().toISOString(),
    }, { onConflict: "participant_id,day_index" })
    .select().single();
  if (error) throw error;
  return data;
}

async function deleteStepEntry(participantId, dayIndex) {
  await supabase.from("step_entries").delete().eq("participant_id", participantId).eq("day_index", dayIndex);
}

async function uploadImage(file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("screenshots").upload(fileName, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("screenshots").getPublicUrl(fileName);
  return data.publicUrl;
}

// ─── SESSION ────────────────────────────────────────────────
function saveSession(user) { try { sessionStorage.setItem("sc-user", JSON.stringify(user)); } catch {} }
function loadSession() { try { const d = sessionStorage.getItem("sc-user"); return d ? JSON.parse(d) : null; } catch { return null; } }
function clearSession() { try { sessionStorage.removeItem("sc-user"); } catch {} }

// ─── MAIN APP ───────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState("login");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  const loadData = useCallback(async () => {
    try {
      const data = await getAllData();
      setParticipants(data.participants);
      setEntries(data.entries);
    } catch (e) { console.error("Load error:", e); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const saved = loadSession();
    if (saved) { setCurrentUser(saved); setView("dashboard"); }
    loadData();
  }, [loadData]);

  useEffect(() => {
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleRegister = async (name, pin) => {
    try {
      const user = await registerParticipant(name, pin);
      setCurrentUser(user);
      saveSession(user);
      await loadData();
      setView("dashboard");
    } catch (e) {
      showToast(e.message || "Registreerimine ebaõnnestus!", "error");
      throw e;
    }
  };

  const handleLogin = async (nameLower, pin) => {
    try {
      const user = await loginParticipant(nameLower, pin);
      setCurrentUser(user);
      saveSession(user);
      await loadData();
      setView("dashboard");
    } catch (e) {
      showToast(e.message || "Sisselogimine ebaõnnestus!", "error");
      throw e;
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    clearSession();
    setView("login");
  };

  // p: { steps, file, hasNature, natureFile, natureNote }
  const handleLogSteps = async (dayIdx, p) => {
    try {
      const existing = entries.find(e => e.participant_id === currentUser.id && e.day_index === dayIdx);

      let screenshotUrl = existing?.screenshot_url || null;
      if (p.file) screenshotUrl = await uploadImage(p.file);

      let natureUrl = existing?.nature_url || null;
      let natureNote = existing?.nature_note || null;
      if (!p.hasNature) {
        natureUrl = null;
        natureNote = null;
      } else {
        if (p.natureFile) natureUrl = await uploadImage(p.natureFile);
        natureNote = (p.natureNote || "").trim() || null;
      }

      await upsertSteps(currentUser.id, dayIdx, p.steps, screenshotUrl, natureUrl, natureNote);
      await loadData();

      if (p.hasNature && p.steps < NATURE_MIN_STEPS) {
        showToast(`Salvestatud, aga loodusboonus vajab ${formatNumber(NATURE_MIN_STEPS)} sammu`, "error");
      } else {
        showToast("Sammud salvestatud! ✨");
      }
    } catch (e) {
      console.error(e);
      showToast(e.message || "Viga salvestamisel!", "error");
    }
  };

  const handleDelete = async (dayIdx) => {
    try {
      await deleteStepEntry(currentUser.id, dayIdx);
      await loadData();
      showToast("Kustutatud!");
    } catch (e) {
      showToast("Viga kustutamisel!", "error");
    }
  };

  if (loading) return (
    <div style={{ ...s.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <style>{css}</style>
      <div style={{ textAlign: "center" }}>
        <div className="pulse" style={{ fontSize: 48 }}>👟</div>
        <p style={{ color: "#9B7EC8", marginTop: 16, fontFamily: "'DM Sans', sans-serif" }}>Laadin...</p>
      </div>
    </div>
  );

  return (
    <div style={s.app}>
      <style>{css}</style>
      {toast && (
        <div className="slideDown" style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          background: toast.type === "error" ? "#E91E63" : "linear-gradient(135deg, #9B59B6, #E91E8C)",
          color: "#fff", padding: "10px 24px", borderRadius: 50, fontSize: 14,
          fontFamily: "'DM Sans', sans-serif", fontWeight: 600, zIndex: 1000,
          boxShadow: "0 4px 20px rgba(155,89,182,0.4)", maxWidth: "90vw", textAlign: "center",
        }}>{toast.msg}</div>
      )}
      {view === "login" && (
        <AuthScreen onRegister={handleRegister} onLogin={handleLogin} participants={participants} />
      )}
      {view === "dashboard" && currentUser && (
        <Dashboard
          user={currentUser}
          participants={participants}
          entries={entries}
          onLogSteps={handleLogSteps}
          onDelete={handleDelete}
          onLogout={handleLogout}
          onRefresh={loadData}
        />
      )}
    </div>
  );
}

// ─── AUTH SCREEN ────────────────────────────────────────────
function AuthScreen({ onRegister, onLogin, participants }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pinValid = /^\d{4}$/.test(pin);

  const handleSubmit = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        if (!name.trim()) { setError("Sisesta nimi"); setBusy(false); return; }
        if (!pinValid) { setError("PIN peab olema 4 numbrit"); setBusy(false); return; }
        await onRegister(name, pin);
      } else {
        if (!selectedUser) { setError("Vali oma nimi"); setBusy(false); return; }
        if (!pinValid) { setError("PIN peab olema 4 numbrit"); setBusy(false); return; }
        await onLogin(selectedUser, pin);
      }
    } catch (e) {
      setError(e.message || "Midagi läks valesti");
    }
    setBusy(false);
  };

  return (
    <div style={s.loginWrap}>
      <div className="fadeIn" style={s.loginCard}>
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <div style={s.logoCircle}>👟</div>
          <h1 style={s.title}>Step Challenge</h1>
          <p style={{ fontSize: 14, color: "#9B7EC8", fontWeight: 500, marginBottom: 2 }}>3 Nädala Sammude Väljakutse</p>
          <p style={{ fontSize: 12, color: "#C4A0D9" }}>{formatDate(0)} – {formatDate(CHALLENGE_DAYS - 1)} 2026</p>
        </div>

        <div style={s.rulesBox}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#7B1FA2", marginBottom: 6 }}>Kuidas punkte saab</div>
          <div style={s.ruleLine}><span>👟</span><span>1 samm = 1 punkt</span></div>
          <div style={s.ruleLine}><span>🔥</span><span>{formatNumber(DAILY_GOAL)}+ sammu järjest → boonused kuni +{formatNumber(MILESTONES.reduce((a, m) => a + m.bonus, 0))}</span></div>
          <div style={s.ruleLine}><span>🌲</span><span>Matkarada + foto → +{formatNumber(NATURE_BONUS)}</span></div>
        </div>

        <div style={s.modeToggle}>
          <button
            style={mode === "login" ? { ...s.modeBtn, ...s.modeBtnActive } : s.modeBtn}
            onClick={() => { setMode("login"); setError(""); setPin(""); }}
          >Logi sisse</button>
          <button
            style={mode === "register" ? { ...s.modeBtn, ...s.modeBtnActive } : s.modeBtn}
            onClick={() => { setMode("register"); setError(""); setPin(""); }}
          >Registreeru</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
          {mode === "register" ? (
            <>
              <div>
                <label style={s.label}>Sinu nimi</label>
                <input
                  style={s.input}
                  placeholder="nt. Mari"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div>
                <label style={s.label}>Vali 4-kohaline PIN</label>
                <input
                  style={{ ...s.input, letterSpacing: 8, textAlign: "center", fontSize: 22, fontWeight: 700 }}
                  placeholder="• • • •"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  type="tel"
                  inputMode="numeric"
                  maxLength={4}
                  disabled={busy}
                  onKeyDown={e => e.key === "Enter" && pinValid && handleSubmit()}
                />
                <p style={{ fontSize: 11, color: "#C4A0D9", marginTop: 4 }}>Jäta PIN meelde! Seda läheb vaja sisselogimiseks.</p>
              </div>
            </>
          ) : (
            <>
              <div>
                <label style={s.label}>Vali oma nimi</label>
                {participants.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#C4A0D9", textAlign: "center", padding: 12 }}>
                    Pole veel osalejaid. Registreeru esimesena! 🎉
                  </p>
                ) : (
                  <div style={s.nameGrid}>
                    {participants.map(p => (
                      <button
                        key={p.id}
                        style={selectedUser === p.name_lower ? { ...s.nameBtn, ...s.nameBtnActive } : s.nameBtn}
                        onClick={() => setSelectedUser(p.name_lower)}
                      >{p.name}</button>
                    ))}
                  </div>
                )}
              </div>
              {selectedUser && participants.length > 0 && (
                <div>
                  <label style={s.label}>PIN-kood</label>
                  <input
                    style={{ ...s.input, letterSpacing: 8, textAlign: "center", fontSize: 22, fontWeight: 700 }}
                    placeholder="• • • •"
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    type="tel"
                    inputMode="numeric"
                    maxLength={4}
                    disabled={busy}
                    onKeyDown={e => e.key === "Enter" && pinValid && handleSubmit()}
                  />
                </div>
              )}
            </>
          )}

          {error && <div style={s.errorBox}>{error}</div>}

          <button
            style={{ ...s.btnPrimary, opacity: busy ? 0.5 : 1 }}
            onClick={handleSubmit}
            disabled={busy}
          >
            {busy ? "Laadin..." : mode === "register" ? "Registreeru 💪" : "Logi sisse 🔓"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ──────────────────────────────────────────────
function Dashboard({ user, participants, entries, onLogSteps, onDelete, onLogout, onRefresh }) {
  const [tab, setTab] = useState("log");
  const todayIdx = getDayIndex();
  const isActive = todayIdx >= 0 && todayIdx < CHALLENGE_DAYS;

  const { users, badges } = useMemo(() => buildUsers(participants, entries), [participants, entries]);
  const me = users.find(u => u.id === user.id);

  const myEntries = me?.entries || [];
  const myBadges = BADGES.filter(b => badges[b.id]?.userId === user.id);

  return (
    <div style={s.dashWrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", marginBottom: 8 }}>
        <div>
          <h2 style={s.headerName}>Tere, {user.name}! 👋</h2>
          <p style={{ fontSize: 13, color: "#9B7EC8", marginTop: 2 }}>
            {isActive
              ? `Päev ${todayIdx + 1} / ${CHALLENGE_DAYS} · ${formatDate(todayIdx)}`
              : todayIdx < 0 ? `Algab ${formatDate(0)}` : "Väljakutse on läbi! 🎉"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.logoutBtn} onClick={onRefresh}>🔄</button>
          <button style={s.logoutBtn} onClick={onLogout}>Välja</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        <div style={s.statCard}>
          <div style={s.statValue}>{formatNumber(me?.points || 0)}</div>
          <div style={s.statLabel}>Punktid</div>
        </div>
        <div style={s.statCard}>
          <div style={{ ...s.statValue, color: "#2E7D32", background: "none", WebkitTextFillColor: "#2E7D32" }}>
            +{formatNumber(me?.bonusSteps || 0)}
          </div>
          <div style={s.statLabel}>Boonus</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statValue}>{me?.streak || 0} <Flame size={18} /></div>
          <div style={s.statLabel}>Streak</div>
        </div>
      </div>

      <div style={s.subStats}>
        Reaalselt tehtud sammud <b>{formatNumber(me?.realSteps || 0)}</b>
        {" · "}keskmine <b>{formatNumber(me?.avg || 0)}</b>
        {" · "}<b>{me?.bonus.goalDays || 0}</b> päeval üle {formatNumber(DAILY_GOAL)}
      </div>

      {myBadges.length > 0 && (
        <div style={s.myBadgeRow}>
          {myBadges.map(b => (
            <span key={b.id} style={s.badgeChipBig} title={b.desc}>{b.emoji} {b.label}</span>
          ))}
        </div>
      )}

      <div style={s.tabBar}>
        {[
          { id: "log", label: "Lisa" },
          { id: "bonus", label: "Boonused" },
          { id: "history", label: "Ajalugu" },
          { id: "leaderboard", label: "Edetabel" },
        ].map(t => (
          <button key={t.id} style={tab === t.id ? { ...s.tab, ...s.tabActive } : s.tab}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="fadeIn" key={tab}>
        {tab === "log" && <LogSteps myEntries={myEntries} onLogSteps={onLogSteps} todayIdx={todayIdx} />}
        {tab === "bonus" && <BonusView me={me} />}
        {tab === "history" && <History myEntries={myEntries} onDelete={onDelete} />}
        {tab === "leaderboard" && <LeaderboardView users={users} badges={badges} currentUserId={user.id} />}
      </div>
    </div>
  );
}

// ─── LOG STEPS ──────────────────────────────────────────────
function LogSteps({ myEntries, onLogSteps, todayIdx }) {
  const clampedToday = Math.max(0, Math.min(todayIdx, CHALLENGE_DAYS - 1));
  const [selectedDay, setSelectedDay] = useState(clampedToday);
  const [steps, setSteps] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [hasNature, setHasNature] = useState(false);
  const [natureFile, setNatureFile] = useState(null);
  const [naturePreview, setNaturePreview] = useState(null);
  const [natureNote, setNatureNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef();
  const natureRef = useRef();

  const existing = myEntries.find(e => e.day_index === selectedDay);

  useEffect(() => {
    setSteps(existing ? String(existing.steps) : "");
    setPreview(existing?.screenshot_url || null);
    setHasNature(!!existing?.nature_url);
    setNaturePreview(existing?.nature_url || null);
    setNatureNote(existing?.nature_note || "");
    setFile(null);
    setNatureFile(null);
    setErr("");
  }, [selectedDay, existing?.steps, existing?.screenshot_url, existing?.nature_url, existing?.nature_note]);

  const pickFile = (e, setF, setP) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { setErr("Lubatud on ainult pildid"); return; }
    if (f.size > MAX_FILE_MB * 1024 * 1024) { setErr(`Fail on liiga suur (max ${MAX_FILE_MB} MB)`); return; }
    setErr("");
    setF(f);
    const r = new FileReader();
    r.onload = () => setP(r.result);
    r.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    if (busy) return;
    const val = parseInt(steps, 10);
    if (!val || val <= 0 || val > 200000) { setErr("Sisesta sammude arv"); return; }
    if (hasNature) {
      if (!natureFile && !existing?.nature_url) { setErr("Loodusboonus vajab tõestuspilti"); return; }
      if (natureNote.trim().length < 4) { setErr("Kirjuta, kus sa käisid — nt RMK Kõrvemaa matkarada"); return; }
    }
    setErr("");
    setBusy(true);
    await onLogSteps(selectedDay, { steps: val, file, hasNature, natureFile, natureNote });
    setBusy(false);
    setFile(null);
    setNatureFile(null);
  };

  if (todayIdx < 0) {
    return (
      <div style={s.card}>
        <p style={{ textAlign: "center", color: "#9B7EC8", fontSize: 16 }}>
          Väljakutse algab {formatDate(0)}! 🚀
        </p>
        <p style={{ textAlign: "center", color: "#C4A0D9", fontSize: 13, marginTop: 8 }}>
          Sihiks {formatNumber(DAILY_GOAL)} sammu päevas, {CHALLENGE_DAYS} päeva järjest.
        </p>
      </div>
    );
  }

  const availableDays = [];
  for (let i = clampedToday; i >= 0; i--) availableDays.push(i);

  const stepVal = parseInt(steps, 10) || 0;
  const goalMet = stepVal >= DAILY_GOAL;
  const natureOk = stepVal >= NATURE_MIN_STEPS;

  return (
    <div style={s.card}>
      <h3 style={s.cardTitle}>📝 Lisa sammud</h3>

      <label style={s.label}>Päev</label>
      <select style={s.select} value={selectedDay} onChange={e => setSelectedDay(parseInt(e.target.value, 10))}>
        {availableDays.map(d => {
          const en = myEntries.find(x => x.day_index === d);
          const mark = !en ? "" : en.steps >= DAILY_GOAL ? " 🔥" : " ✅";
          return <option key={d} value={d}>Päev {d + 1} – {formatDate(d)}{mark}</option>;
        })}
      </select>

      <label style={{ ...s.label, marginTop: 14 }}>Sammude arv</label>
      <input style={s.input} type="number" inputMode="numeric" placeholder="nt. 6200" value={steps}
        onChange={e => setSteps(e.target.value)} min="0" max="200000" />
      {stepVal > 0 && (
        <p style={{ fontSize: 12, marginTop: 6, fontWeight: 600, color: goalMet ? "#2E7D32" : "#9B7EC8" }}>
          {goalMet
            ? `🔥 Päevanorm täis — streak jätkub`
            : `Veel ${formatNumber(DAILY_GOAL - stepVal)} sammu ${formatNumber(DAILY_GOAL)}-ni`}
        </p>
      )}

      <label style={{ ...s.label, marginTop: 14 }}>Screenshot (tõestus)</label>
      <div style={s.uploadArea} onClick={() => fileRef.current?.click()}>
        {preview ? (
          <img src={preview} alt="Screenshot" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 12, objectFit: "contain" }} />
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📸</div>
            <p style={{ color: "#9B7EC8", fontSize: 13 }}>Kliki pildi üleslaadimiseks</p>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={e => pickFile(e, setFile, setPreview)} />
      </div>

      {/* ─── LOODUSBOONUS ─── */}
      <div style={{ ...s.natureBox, borderColor: hasNature ? "#66BB6A" : "#D6E8D7" }}>
        <label style={s.checkRow}>
          <input type="checkbox" checked={hasNature} style={s.checkbox}
            onChange={e => { setHasNature(e.target.checked); setErr(""); }} />
          <span>
            <b style={{ fontSize: 14 }}>🌲 Käisin looduses / matkarajal</b>
            <span style={{ display: "block", fontSize: 11, color: "#5C8A5F", marginTop: 2 }}>
              +{formatNumber(NATURE_BONUS)} punkti · max {NATURE_MAX} korda · vajab {formatNumber(NATURE_MIN_STEPS)} sammu
            </span>
          </span>
        </label>

        {hasNature && (
          <div className="fadeIn" style={{ marginTop: 12 }}>
            <div style={s.natureUpload} onClick={() => natureRef.current?.click()}>
              {naturePreview ? (
                <img src={naturePreview} alt="Loodus" style={{ maxWidth: "100%", maxHeight: 180, borderRadius: 12, objectFit: "contain" }} />
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 6 }}>🏞️</div>
                  <p style={{ color: "#5C8A5F", fontSize: 13 }}>Lisa pilt rajalt</p>
                </div>
              )}
              <input ref={natureRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={e => pickFile(e, setNatureFile, setNaturePreview)} />
            </div>

            <input
              style={{ ...s.input, marginTop: 10, borderColor: "#C8E0C9" }}
              placeholder="Kus käisid? nt RMK Kõrvemaa matkarada"
              value={natureNote}
              maxLength={80}
              onChange={e => setNatureNote(e.target.value)}
            />

            {stepVal > 0 && !natureOk && (
              <p style={{ fontSize: 12, color: "#E65100", marginTop: 8, fontWeight: 600 }}>
                ⚠️ Boonus ei rakendu — sel päeval on vaja vähemalt {formatNumber(NATURE_MIN_STEPS)} sammu
              </p>
            )}
            <p style={{ fontSize: 11, color: "#7BA37E", marginTop: 8 }}>
              Ausussüsteem — keegi ei kinnita boonust, aga pilt on kõigile edetabelis nähtav.
            </p>
          </div>
        )}
      </div>

      {err && <div style={{ ...s.errorBox, marginTop: 12 }}>{err}</div>}

      <button
        style={{ ...s.btnPrimary, marginTop: 16, opacity: stepVal > 0 && !busy ? 1 : 0.5 }}
        onClick={handleSubmit}
        disabled={stepVal <= 0 || busy}
      >{busy ? "Salvestan..." : existing ? "Uuenda 🔄" : "Salvesta 💾"}</button>
    </div>
  );
}

// ─── BONUS VIEW ─────────────────────────────────────────────
function BonusView({ me }) {
  if (!me) return null;
  const b = me.bonus;
  const counts = awardCounts(b.awards);
  const streak = me.streak;
  const next = MILESTONES.find(m => m.days > streak && (m.repeatable || !counts[m.days]));
  const pct = next ? Math.min(100, Math.round((streak / next.days) * 100)) : 100;

  return (
    <div>
      <div style={{ ...s.card, textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#9B7EC8", fontWeight: 600 }}>BOONUSPUNKTE KOKKU</div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 40, fontWeight: 800, color: "#2E7D32", lineHeight: 1.2 }}>
          +{formatNumber(b.total)}
        </div>
        <div style={{ fontSize: 12, color: "#9B7EC8" }}>
          🔥 {formatNumber(b.streakBonus)} streak'idest · 🌲 {formatNumber(b.natureBonus)} loodusest
        </div>

        {next ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, color: "#2D1B4E", fontWeight: 600, marginBottom: 8 }}>
              Streak {streak} päeva → järgmine {next.emoji} {next.days} päeva juures
              <span style={{ color: "#9B7EC8", fontWeight: 500 }}> (+{formatNumber(next.bonus)})</span>
            </div>
            <div style={s.progressTrack}>
              <div style={{ ...s.progressFill, width: `${pct}%` }} />
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 16, fontSize: 14, fontWeight: 700, color: "#7B1FA2" }}>
            👑 Kõik verstapostid võetud!
          </div>
        )}
      </div>

      <div style={{ ...s.card, marginBottom: 12 }}>
        <h3 style={s.cardTitle}>🔥 Streak-boonused</h3>
        {MILESTONES.map(m => {
          const n = counts[m.days] || 0;
          const done = n > 0;
          return (
            <div key={m.days} style={{ ...s.milestoneRow, opacity: done ? 1 : 0.55 }}>
              <span style={{ fontSize: 20, width: 28 }}>{m.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: done ? "#2D1B4E" : "#9B7EC8" }}>
                  {m.label}
                  {n > 1 && <span style={s.countChip}>×{n}</span>}
                </div>
                <div style={{ fontSize: 11, color: "#9B7EC8" }}>
                  {m.repeatable ? "Uue streak'iga uuesti teenitav" : "Ainult üks kord challenge'i jooksul"}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: done ? "#2E7D32" : "#C4A0D9" }}>
                {done ? `+${formatNumber(m.bonus * n)}` : `+${formatNumber(m.bonus)}`}
              </div>
            </div>
          );
        })}
        {b.runs.length > 0 && (
          <p style={{ fontSize: 11, color: "#9B7EC8", marginTop: 10 }}>
            Sinu streak'id: {b.runs.join(" · ")} päeva · pikim {b.longestRun}
          </p>
        )}
      </div>

      <div style={s.card}>
        <h3 style={s.cardTitle}>🌲 Loodusboonused</h3>
        <div style={{ fontSize: 14, marginBottom: 12 }}>
          <b style={{ color: "#2E7D32" }}>{b.natureCounted} / {NATURE_MAX}</b>
          <span style={{ color: "#9B7EC8" }}> arvesse läinud · +{formatNumber(b.natureBonus)} punkti</span>
        </div>
        {b.natureAll.length === 0 ? (
          <p style={{ fontSize: 13, color: "#9B7EC8" }}>
            Käi matkarajal, tee pilt ja teeni +{formatNumber(NATURE_BONUS)} punkti. Sama päeva sammud peavad olema vähemalt {formatNumber(NATURE_MIN_STEPS)}.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {b.natureAll.map(e => {
              const valid = e.steps >= NATURE_MIN_STEPS;
              return (
                <div key={e.day_index} style={{ flexShrink: 0, width: 100 }}>
                  <img src={e.nature_url} alt={e.nature_note || "Loodus"}
                    style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 12,
                      border: valid ? "2px solid #66BB6A" : "2px solid #FFB74D", opacity: valid ? 1 : 0.6 }} />
                  <div style={{ fontSize: 10, color: "#9B7EC8", marginTop: 4, fontWeight: 600 }}>
                    P{e.day_index + 1} {valid ? "✅" : "⚠️"}
                  </div>
                  <div style={{ fontSize: 10, color: "#9B7EC8", lineHeight: 1.3 }}>{e.nature_note}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── HISTORY ────────────────────────────────────────────────
function History({ myEntries, onDelete }) {
  const sorted = [...myEntries].sort((a, b) => b.day_index - a.day_index);
  const [expandedImg, setExpandedImg] = useState(null);

  if (sorted.length === 0) {
    return <div style={s.card}><p style={{ textAlign: "center", color: "#9B7EC8" }}>Pole veel ühtegi sissekannet. Lisa oma esimesed sammud! 🏃‍♀️</p></div>;
  }

  return (
    <div>
      {expandedImg && (
        <div style={s.overlay} onClick={() => setExpandedImg(null)}>
          <img src={expandedImg} alt="Pilt" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} />
        </div>
      )}
      {sorted.map(entry => {
        const goalMet = entry.steps >= DAILY_GOAL;
        return (
          <div key={entry.day_index} className="fadeIn" style={s.historyCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 15, marginRight: 8 }}>Päev {entry.day_index + 1}</span>
                <span style={{ fontSize: 12, color: "#9B7EC8" }}>{formatDate(entry.day_index)}</span>
                {goalMet && <span style={{ marginLeft: 6 }}><Flame size={13} /></span>}
              </div>
              <div style={s.statValue}>{formatNumber(entry.steps)}</div>
            </div>
            {entry.nature_url && (
              <div style={{ fontSize: 12, color: entry.steps >= NATURE_MIN_STEPS ? "#2E7D32" : "#E65100", marginTop: 6, fontWeight: 600 }}>
                🌲 {entry.nature_note || "Loodusboonus"}
                {entry.steps >= NATURE_MIN_STEPS
                  ? ` · +${formatNumber(NATURE_BONUS)}`
                  : ` · ei kvalifitseeru (alla ${formatNumber(NATURE_MIN_STEPS)} sammu)`}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {entry.screenshot_url && (
                <button style={s.btnSmall} onClick={() => setExpandedImg(entry.screenshot_url)}>🖼️ Screenshot</button>
              )}
              {entry.nature_url && (
                <button style={{ ...s.btnSmall, background: "rgba(102,187,106,0.15)", color: "#2E7D32" }}
                  onClick={() => setExpandedImg(entry.nature_url)}>🌲 Loodusfoto</button>
              )}
              <button
                style={{ ...s.btnSmall, background: "rgba(233,30,99,0.1)", color: "#E91E63" }}
                onClick={() => { if (confirm("Kustuta see sissekanne?")) onDelete(entry.day_index); }}
              >🗑️ Kustuta</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── LEADERBOARD ────────────────────────────────────────────
function LeaderboardView({ users, badges, currentUserId }) {
  const [sortMode, setSortMode] = useState("points");
  const [expandedUser, setExpandedUser] = useState(null);
  const [expandedImg, setExpandedImg] = useState(null);

  const sorted = [...users].sort((a, b) =>
    sortMode === "points" ? b.points - a.points : b.realSteps - a.realSteps);

  const totalPoints = users.reduce((sum, u) => sum + u.points, 0);
  const totalReal = users.reduce((sum, u) => sum + u.realSteps, 0);

  return (
    <div>
      {expandedImg && (
        <div style={s.overlay} onClick={() => setExpandedImg(null)}>
          <img src={expandedImg} alt="Pilt" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} />
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, borderRadius: 20, padding: "14px 12px", textAlign: "center", background: "linear-gradient(135deg, #F3E5F5 0%, #E8D5F5 100%)" }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: "#7B1FA2" }}>{users.length}</div>
          <div style={{ fontSize: 11, color: "#9B7EC8", fontWeight: 500 }}>Osalejat</div>
        </div>
        <div style={{ flex: 1, borderRadius: 20, padding: "14px 12px", textAlign: "center", background: "linear-gradient(135deg, #FCE4EC 0%, #F3E5F5 100%)" }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: "#7B1FA2" }}>{formatNumber(totalReal)}</div>
          <div style={{ fontSize: 11, color: "#9B7EC8", fontWeight: 500 }}>Samme kokku</div>
        </div>
        <div style={{ flex: 1, borderRadius: 20, padding: "14px 12px", textAlign: "center", background: "linear-gradient(135deg, #E8F5E9 0%, #F1F8E9 100%)" }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: "#2E7D32" }}>+{formatNumber(totalPoints - totalReal)}</div>
          <div style={{ fontSize: 11, color: "#7BA37E", fontWeight: 500 }}>Boonuseid</div>
        </div>
      </div>

      <div style={s.sortToggle}>
        {[{ id: "points", label: "🏅 Punktid" }, { id: "real", label: "👟 Sammud" }].map(o => (
          <button key={o.id} style={sortMode === o.id ? { ...s.sortBtn, ...s.sortBtnActive } : s.sortBtn}
            onClick={() => setSortMode(o.id)}>{o.label}</button>
        ))}
      </div>

      {sorted.map((u, i) => {
        const myBadges = BADGES.filter(b => badges[b.id]?.userId === u.id);
        const bonusPct = u.points > 0 ? (u.bonusSteps / u.points) * 100 : 0;
        const open = expandedUser === u.id;
        const primary = sortMode === "points" ? u.points : u.realSteps;

        return (
          <div key={u.id} className="fadeIn" style={{ animationDelay: `${i * 0.04}s` }}>
            <div
              style={{
                ...s.leaderRow,
                ...(u.id === currentUserId ? { border: "2px solid #C77DDB", background: "rgba(243,229,245,0.5)" } : {}),
                cursor: "pointer",
                marginBottom: open ? 0 : 8,
                borderBottomLeftRadius: open ? 0 : 20,
                borderBottomRightRadius: open ? 0 : 20,
              }}
              onClick={() => setExpandedUser(open ? null : u.id)}
            >
              <div style={{ display: "flex", alignItems: "flex-start", minWidth: 0, flex: 1 }}>
                <Trophy rank={i + 1} />
                <div style={{ marginLeft: 10, minWidth: 0 }}>
                  {/* Märgised on siin ainult emojina — täisnimed on all "Märgised" kaardil,
                      muidu venib iga rida mobiilis kolme ritta. */}
                  <div style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                    <span>{u.name}</span>
                    {u.id === currentUserId && <span style={s.meBadge}>sina</span>}
                    {myBadges.map(b => (
                      <span key={b.id} style={s.badgeChip} title={`${b.label} — ${b.desc}`}>{b.emoji}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: "#9B7EC8", marginTop: 3 }}>
                    {u.loggedDays} päeva · ø {formatNumber(u.avg)}
                    {u.streak > 0 && <span style={{ marginLeft: 6 }}><Flame size={11} /> {u.streak}</span>}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
                <div style={s.statValue}>{formatNumber(primary)}</div>
                <div style={{ fontSize: 11, color: "#9B7EC8", marginTop: 2 }}>
                  👟 {formatNumber(u.realSteps)} <span style={{ color: "#2E7D32", fontWeight: 700 }}>+{formatNumber(u.bonusSteps)}</span>
                </div>
                <div style={s.splitTrack}>
                  <div style={{ ...s.splitFill, width: `${100 - bonusPct}%` }} />
                  <div style={{ ...s.splitFillBonus, width: `${bonusPct}%` }} />
                </div>
              </div>
            </div>

            {open && (
              <div className="fadeIn" style={s.expandPanel}>
                <div style={s.breakdownGrid}>
                  <div><span style={s.bdLabel}>Reaalselt tehtud sammud</span><span style={s.bdVal}>{formatNumber(u.realSteps)}</span></div>
                  <div><span style={s.bdLabel}>Streak-boonus</span><span style={{ ...s.bdVal, color: "#2E7D32" }}>+{formatNumber(u.bonus.streakBonus)}</span></div>
                  <div><span style={s.bdLabel}>Loodusboonus</span><span style={{ ...s.bdVal, color: "#2E7D32" }}>+{formatNumber(u.bonus.natureBonus)}</span></div>
                  <div><span style={s.bdLabel}>Punktid kokku</span><span style={{ ...s.bdVal, color: "#7B1FA2" }}>{formatNumber(u.points)}</span></div>
                  <div><span style={s.bdLabel}>Pikim streak</span><span style={s.bdVal}>{u.bonus.longestRun} p</span></div>
                  <div><span style={s.bdLabel}>Rekordipäev</span><span style={s.bdVal}>{formatNumber(u.bestDay)}</span></div>
                </div>

                {u.bonus.awards.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 10 }}>
                    {Object.entries(awardCounts(u.bonus.awards)).map(([days, n]) => {
                      const m = MILESTONES.find(x => x.days === Number(days));
                      return <span key={days} style={s.milestoneChip}>{m.emoji} {days}p{n > 1 ? ` ×${n}` : ""}</span>;
                    })}
                  </div>
                )}

                {u.bonus.natureAll.length > 0 && (
                  <>
                    <div style={s.galleryTitle}>🌲 Loodusrajad</div>
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                      {u.bonus.natureAll.map(e => (
                        <div key={e.day_index} style={{ flexShrink: 0, width: 90 }}>
                          <img src={e.nature_url} alt={e.nature_note || "Loodus"}
                            onClick={ev => { ev.stopPropagation(); setExpandedImg(e.nature_url); }}
                            style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 12, cursor: "pointer", border: "2px solid #A5D6A7" }} />
                          <div style={{ fontSize: 10, color: "#9B7EC8", marginTop: 4, lineHeight: 1.3 }}>{e.nature_note}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {u.entries.some(e => e.screenshot_url) && (
                  <>
                    <div style={s.galleryTitle}>📸 Screenshotid</div>
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                      {u.entries.filter(e => e.screenshot_url).sort((a, b) => a.day_index - b.day_index).map(e => (
                        <div key={e.day_index} style={{ flexShrink: 0, textAlign: "center" }}>
                          <img src={e.screenshot_url} alt={`Päev ${e.day_index + 1}`}
                            onClick={ev => { ev.stopPropagation(); setExpandedImg(e.screenshot_url); }}
                            style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 12, cursor: "pointer", border: "2px solid #E8D5F5" }} />
                          <div style={{ fontSize: 10, color: "#9B7EC8", marginTop: 4, fontWeight: 600 }}>
                            P{e.day_index + 1} · {formatNumber(e.steps)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {users.length === 0 && (
        <div style={s.card}><p style={{ textAlign: "center", color: "#9B7EC8" }}>Pole veel osalejaid. Ole esimene! 🎉</p></div>
      )}

      <div style={{ ...s.card, marginTop: 12 }}>
        <h3 style={s.cardTitle}>🏅 Märgised</h3>
        {BADGES.map(b => {
          const win = badges[b.id];
          const winner = win && users.find(u => u.id === win.userId);
          return (
            <div key={b.id} style={s.milestoneRow}>
              <span style={{ fontSize: 18, width: 26 }}>{b.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{b.label}</div>
                <div style={{ fontSize: 11, color: "#9B7EC8" }}>{b.desc}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                {winner ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#7B1FA2" }}>{winner.name}</div>
                    <div style={{ fontSize: 10, color: "#9B7EC8" }}>{b.fmt(win.value)}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: "#C4A0D9" }}>vaba</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CSS ────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,500;0,9..40,700;1,9..40,400&family=Outfit:wght@400;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { margin: 0; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes slideDown { from { opacity: 0; transform: translate(-50%, -20px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
  .fadeIn { animation: fadeIn 0.4s ease both; }
  .slideDown { animation: slideDown 0.3s ease both; }
  .pulse { animation: pulse 1.5s ease infinite; }
  input:focus, select:focus { outline: none; border-color: #C77DDB !important; box-shadow: 0 0 0 3px rgba(199,125,219,0.2) !important; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: #D4A0E8; border-radius: 3px; }
`;

// ─── STYLES ─────────────────────────────────────────────────
const s = {
  app: { fontFamily: "'DM Sans', sans-serif", background: "linear-gradient(170deg, #F8F0FF 0%, #FFF0F5 40%, #F3E5F5 100%)", minHeight: "100vh", color: "#2D1B4E" },
  loginWrap: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 20 },
  loginCard: { background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", borderRadius: 28, padding: "36px 26px", maxWidth: 420, width: "100%", boxShadow: "0 20px 60px rgba(155,89,182,0.15), 0 1px 0 rgba(255,255,255,0.8) inset", textAlign: "center" },
  logoCircle: { width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg, #E8D5F5, #F8BBD0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 16px", boxShadow: "0 8px 30px rgba(199,125,219,0.3)" },
  title: { fontFamily: "'Outfit', sans-serif", fontSize: 28, fontWeight: 800, background: "linear-gradient(135deg, #9B59B6, #E91E8C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 4 },

  rulesBox: { background: "rgba(243,229,245,0.45)", borderRadius: 16, padding: "12px 14px", marginBottom: 18, textAlign: "left" },
  ruleLine: { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#7B1FA2", lineHeight: 1.5, marginTop: 3 },

  modeToggle: { display: "flex", gap: 4, background: "rgba(243,229,245,0.5)", borderRadius: 14, padding: 3 },
  modeBtn: { flex: 1, fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, padding: "10px 8px", borderRadius: 11, border: "none", background: "transparent", color: "#9B7EC8", cursor: "pointer", transition: "all 0.2s ease" },
  modeBtnActive: { background: "linear-gradient(135deg, #9B59B6, #E91E8C)", color: "#fff", boxShadow: "0 2px 10px rgba(155,89,182,0.3)" },
  nameGrid: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  nameBtn: { fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, padding: "10px 18px", borderRadius: 50, border: "2px solid #E8D5F5", background: "rgba(255,255,255,0.8)", color: "#7B1FA2", cursor: "pointer", transition: "all 0.2s ease" },
  nameBtnActive: { border: "2px solid #9B59B6", background: "linear-gradient(135deg, #F3E5F5, #FCE4EC)", boxShadow: "0 2px 10px rgba(155,89,182,0.2)" },
  errorBox: { background: "rgba(233,30,99,0.08)", border: "1px solid rgba(233,30,99,0.2)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#E91E63", fontWeight: 500, textAlign: "center" },
  input: { fontFamily: "'DM Sans', sans-serif", fontSize: 15, padding: "14px 18px", borderRadius: 16, border: "2px solid #E8D5F5", background: "rgba(255,255,255,0.9)", color: "#2D1B4E", width: "100%", transition: "all 0.2s ease" },
  select: { fontFamily: "'DM Sans', sans-serif", fontSize: 15, padding: "14px 18px", borderRadius: 16, border: "2px solid #E8D5F5", background: "rgba(255,255,255,0.9)", color: "#2D1B4E", width: "100%", transition: "all 0.2s ease", cursor: "pointer" },
  btnPrimary: { fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 700, padding: "14px 24px", borderRadius: 16, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #9B59B6, #E91E8C)", color: "#fff", width: "100%", boxShadow: "0 4px 15px rgba(155,89,182,0.35)", transition: "all 0.2s ease" },
  label: { fontSize: 12, fontWeight: 600, color: "#9B7EC8", marginBottom: 6, display: "block", textAlign: "left" },

  dashWrap: { padding: "16px 16px 80px", maxWidth: 520, margin: "0 auto" },
  headerName: { fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 700, color: "#2D1B4E" },
  logoutBtn: { fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: "8px 14px", borderRadius: 12, border: "1.5px solid #E8D5F5", background: "rgba(255,255,255,0.7)", color: "#9B7EC8", cursor: "pointer" },
  statCard: { flex: 1, background: "rgba(255,255,255,0.8)", backdropFilter: "blur(10px)", borderRadius: 20, padding: "16px 8px", textAlign: "center", boxShadow: "0 4px 15px rgba(155,89,182,0.08)", border: "1px solid rgba(232,213,245,0.5)" },
  statValue: { fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, background: "linear-gradient(135deg, #9B59B6, #E91E8C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  statLabel: { fontSize: 11, color: "#9B7EC8", fontWeight: 500, marginTop: 2 },
  subStats: { fontSize: 12, color: "#9B7EC8", textAlign: "center", marginBottom: 12 },

  myBadgeRow: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 12 },
  badgeChipBig: { fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 50, background: "linear-gradient(135deg, #FFF3E0, #FCE4EC)", color: "#7B1FA2", border: "1px solid #F8BBD0" },
  badgeChip: { fontSize: 11, lineHeight: 1, padding: "3px 4px", borderRadius: 50, background: "linear-gradient(135deg, #FFF3E0, #FCE4EC)", border: "1px solid #F8BBD0", cursor: "help" },

  tabBar: { display: "flex", gap: 3, marginBottom: 16, background: "rgba(255,255,255,0.5)", borderRadius: 16, padding: 4 },
  tab: { flex: 1, fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: "10px 4px", borderRadius: 12, border: "none", background: "transparent", color: "#9B7EC8", cursor: "pointer", transition: "all 0.2s ease", whiteSpace: "nowrap" },
  tabActive: { background: "linear-gradient(135deg, #9B59B6, #E91E8C)", color: "#fff", boxShadow: "0 2px 10px rgba(155,89,182,0.3)" },

  card: { background: "rgba(255,255,255,0.8)", backdropFilter: "blur(10px)", borderRadius: 24, padding: 22, boxShadow: "0 4px 20px rgba(155,89,182,0.08)", border: "1px solid rgba(232,213,245,0.4)" },
  cardTitle: { fontFamily: "'Outfit', sans-serif", fontSize: 17, fontWeight: 700, marginBottom: 14, color: "#2D1B4E" },
  uploadArea: { border: "2px dashed #D4A0E8", borderRadius: 16, padding: 18, textAlign: "center", cursor: "pointer", background: "rgba(243,229,245,0.3)", transition: "all 0.2s ease", minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" },

  natureBox: { marginTop: 18, border: "2px solid #D6E8D7", borderRadius: 18, padding: 14, background: "rgba(232,245,233,0.4)", transition: "all 0.2s ease" },
  checkRow: { display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", textAlign: "left", color: "#2D4A2F" },
  checkbox: { width: 20, height: 20, accentColor: "#4CAF50", cursor: "pointer", flexShrink: 0, marginTop: 1 },
  natureUpload: { border: "2px dashed #A5D6A7", borderRadius: 16, padding: 16, textAlign: "center", cursor: "pointer", background: "rgba(255,255,255,0.6)", minHeight: 70, display: "flex", alignItems: "center", justifyContent: "center" },

  progressTrack: { height: 10, borderRadius: 50, background: "rgba(232,213,245,0.7)", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 50, background: "linear-gradient(90deg, #FF6B35, #E91E8C)", transition: "width 0.4s ease" },

  milestoneRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(232,213,245,0.5)" },
  countChip: { fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 6, marginLeft: 6, background: "#2E7D32", color: "#fff", verticalAlign: "middle" },
  milestoneChip: { fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 50, background: "rgba(255,107,53,0.12)", color: "#D84315" },

  sortToggle: { display: "flex", gap: 4, background: "rgba(255,255,255,0.6)", borderRadius: 14, padding: 3, marginBottom: 12 },
  sortBtn: { flex: 1, fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: "8px 6px", borderRadius: 11, border: "none", background: "transparent", color: "#9B7EC8", cursor: "pointer" },
  sortBtnActive: { background: "rgba(155,89,182,0.12)", color: "#7B1FA2" },

  leaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.8)", backdropFilter: "blur(10px)", borderRadius: 20, padding: "14px 16px", marginBottom: 8, boxShadow: "0 2px 12px rgba(155,89,182,0.06)", border: "1px solid rgba(232,213,245,0.3)", transition: "all 0.2s ease" },
  meBadge: { fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, marginLeft: 6, background: "linear-gradient(135deg, #9B59B6, #E91E8C)", color: "#fff", verticalAlign: "middle" },
  splitTrack: { display: "flex", height: 4, borderRadius: 50, overflow: "hidden", background: "rgba(232,213,245,0.6)", marginTop: 5, width: 110, marginLeft: "auto" },
  splitFill: { background: "linear-gradient(90deg, #9B59B6, #E91E8C)" },
  splitFillBonus: { background: "#66BB6A" },

  expandPanel: { background: "rgba(255,255,255,0.6)", borderBottomLeftRadius: 20, borderBottomRightRadius: 20, padding: "12px 16px 16px", marginBottom: 8, border: "1px solid rgba(232,213,245,0.4)", borderTop: "none" },
  breakdownGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px" },
  bdLabel: { fontSize: 11, color: "#9B7EC8", display: "block" },
  bdVal: { fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, color: "#2D1B4E" },
  galleryTitle: { fontSize: 12, fontWeight: 700, color: "#7B1FA2", margin: "14px 0 8px" },

  historyCard: { background: "rgba(255,255,255,0.8)", backdropFilter: "blur(10px)", borderRadius: 20, padding: "16px 18px", marginBottom: 10, boxShadow: "0 2px 12px rgba(155,89,182,0.06)", border: "1px solid rgba(232,213,245,0.4)" },
  btnSmall: { fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 10, border: "none", background: "rgba(212,160,232,0.15)", color: "#9B59B6", cursor: "pointer" },
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(45,27,78,0.85)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "pointer", backdropFilter: "blur(8px)" },
};



