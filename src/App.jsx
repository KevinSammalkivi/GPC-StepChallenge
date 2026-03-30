import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase.js";

// ─── CONFIG ─────────────────────────────────────────────────
const CHALLENGE_START = new Date("2026-03-30");
const CHALLENGE_DAYS = 14;

function getDayIndex(date = new Date()) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const s = new Date(CHALLENGE_START); s.setHours(0, 0, 0, 0);
  return Math.floor((d - s) / 86400000);
}

function formatDate(dayIdx) {
  const d = new Date(CHALLENGE_START);
  d.setDate(d.getDate() + dayIdx);
  const months = ["jaan","veebr","märts","apr","mai","juuni","juuli","aug","sept","okt","nov","dets"];
  return `${d.getDate()}. ${months[d.getMonth()]}`;
}

function formatNumber(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function calcStreak(entries) {
  let streak = 0;
  let idx = getDayIndex();
  if (idx >= CHALLENGE_DAYS) idx = CHALLENGE_DAYS - 1;
  const daySet = new Set(entries.map(e => e.day_index));
  if (!daySet.has(idx)) idx--;
  while (idx >= 0 && daySet.has(idx)) { streak++; idx--; }
  return streak;
}

// Simple hash for PIN (not crypto-grade, but fine for a casual challenge)
async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "step-challenge-salt-2026");
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

async function upsertSteps(participantId, dayIndex, steps, screenshotUrl) {
  const { data, error } = await supabase
    .from("step_entries")
    .upsert({ participant_id: participantId, day_index: dayIndex, steps, screenshot_url: screenshotUrl, updated_at: new Date().toISOString() }, { onConflict: "participant_id,day_index" })
    .select().single();
  if (error) throw error;
  return data;
}

async function deleteStepEntry(participantId, dayIndex) {
  await supabase.from("step_entries").delete().eq("participant_id", participantId).eq("day_index", dayIndex);
}

async function uploadScreenshot(file) {
  const ext = file.name.split(".").pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("screenshots").upload(fileName, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("screenshots").getPublicUrl(fileName);
  return data.publicUrl;
}

// ─── SESSION (remember login in this browser) ───────────────
function saveSession(user) {
  try { sessionStorage.setItem("sc-user", JSON.stringify(user)); } catch {}
}
function loadSession() {
  try { const d = sessionStorage.getItem("sc-user"); return d ? JSON.parse(d) : null; } catch { return null; }
}
function clearSession() {
  try { sessionStorage.removeItem("sc-user"); } catch {}
}

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
    setTimeout(() => setToast(null), 2500);
  };

  const loadData = useCallback(async () => {
    try {
      const data = await getAllData();
      setParticipants(data.participants);
      setEntries(data.entries);
    } catch (e) { console.error("Load error:", e); }
    setLoading(false);
  }, []);

  // Check for saved session on mount
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setCurrentUser(saved);
      setView("dashboard");
    }
    loadData();
  }, [loadData]);

  // Auto-refresh every 30s
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

  const handleLogSteps = async (dayIdx, steps, file) => {
    try {
      let screenshotUrl = null;
      if (file) screenshotUrl = await uploadScreenshot(file);
      if (!file) {
        const existing = entries.find(e => e.participant_id === currentUser.id && e.day_index === dayIdx);
        screenshotUrl = existing?.screenshot_url || null;
      }
      await upsertSteps(currentUser.id, dayIdx, steps, screenshotUrl);
      await loadData();
      showToast("Sammud salvestatud! ✨");
    } catch (e) {
      showToast("Viga salvestamisel!", "error");
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
          boxShadow: "0 4px 20px rgba(155,89,182,0.4)"
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
  const [mode, setMode] = useState("login"); // "login" or "register"
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
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <div style={s.logoCircle}>👟</div>
          <h1 style={s.title}>Step Challenge</h1>
          <p style={{ fontSize: 14, color: "#9B7EC8", fontWeight: 500, marginBottom: 2 }}>2 Nädala Sammude Väljakutse</p>
          <p style={{ fontSize: 12, color: "#C4A0D9" }}>30. märts – 12. aprill 2026</p>
        </div>

        {/* Mode toggle */}
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
                  onChange={e => { const v = e.target.value.replace(/\D/g, "").slice(0, 4); setPin(v); }}
                  type="tel"
                  inputMode="numeric"
                  maxLength={4}
                  disabled={busy}
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
                        style={selectedUser === p.name_lower
                          ? { ...s.nameBtn, ...s.nameBtnActive }
                          : s.nameBtn}
                        onClick={() => setSelectedUser(p.name_lower)}
                      >{p.name}</button>
                    ))}
                  </div>
                )}
              </div>
              {(selectedUser || participants.length === 0) && participants.length > 0 && (
                <div>
                  <label style={s.label}>PIN-kood</label>
                  <input
                    style={{ ...s.input, letterSpacing: 8, textAlign: "center", fontSize: 22, fontWeight: 700 }}
                    placeholder="• • • •"
                    value={pin}
                    onChange={e => { const v = e.target.value.replace(/\D/g, "").slice(0, 4); setPin(v); }}
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

          {error && (
            <div style={s.errorBox}>{error}</div>
          )}

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

  const myEntries = entries.filter(e => e.participant_id === user.id);
  const total = myEntries.reduce((sum, e) => sum + e.steps, 0);
  const avg = myEntries.length ? Math.round(total / myEntries.length) : 0;
  const streak = calcStreak(myEntries);

  return (
    <div style={s.dashWrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", marginBottom: 8 }}>
        <div>
          <h2 style={s.headerName}>Tere, {user.name}! 👋</h2>
          <p style={{ fontSize: 13, color: "#9B7EC8", marginTop: 2 }}>
            {isActive ? `Päev ${todayIdx + 1} / ${CHALLENGE_DAYS}` : todayIdx < 0 ? "Väljakutse pole veel alanud" : "Väljakutse on läbi! 🎉"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.logoutBtn} onClick={onRefresh}>🔄</button>
          <button style={s.logoutBtn} onClick={onLogout}>Logi välja</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {[
          { val: formatNumber(total), label: "Kokku" },
          { val: formatNumber(avg), label: "Keskmine" },
          { val: streak, label: "Streak", flame: true },
        ].map((st, i) => (
          <div key={i} style={s.statCard}>
            <div style={s.statValue}>{st.val} {st.flame && <Flame size={18} />}</div>
            <div style={s.statLabel}>{st.label}</div>
          </div>
        ))}
      </div>

      <div style={s.tabBar}>
        {[
          { id: "log", label: "Lisa sammud" },
          { id: "history", label: "Ajalugu" },
          { id: "leaderboard", label: "Edetabel" }
        ].map(t => (
          <button key={t.id} style={tab === t.id ? { ...s.tab, ...s.tabActive } : s.tab}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="fadeIn" key={tab}>
        {tab === "log" && <LogSteps myEntries={myEntries} onLogSteps={onLogSteps} todayIdx={todayIdx} isActive={isActive} />}
        {tab === "history" && <History myEntries={myEntries} onDelete={onDelete} />}
        {tab === "leaderboard" && <LeaderboardView participants={participants} entries={entries} currentUserId={user.id} />}
      </div>
    </div>
  );
}

// ─── LOG STEPS ──────────────────────────────────────────────
function LogSteps({ myEntries, onLogSteps, todayIdx, isActive }) {
  const [steps, setSteps] = useState("");
  const [selectedDay, setSelectedDay] = useState(Math.max(0, Math.min(todayIdx, CHALLENGE_DAYS - 1)));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  const existing = myEntries.find(e => e.day_index === selectedDay);

  useEffect(() => {
    if (existing) {
      setSteps(existing.steps.toString());
      setPreview(existing.screenshot_url || null);
    } else {
      setSteps("");
      setPreview(null);
    }
    setFile(null);
  }, [selectedDay, existing?.steps, existing?.screenshot_url]);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { alert("Fail on liiga suur (max 5MB)"); return; }
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    const val = parseInt(steps);
    if (!val || val < 0 || val > 200000 || busy) return;
    setBusy(true);
    await onLogSteps(selectedDay, val, file);
    setBusy(false);
    setFile(null);
  };

  const availableDays = [];
  const maxDay = Math.min(todayIdx, CHALLENGE_DAYS - 1);
  for (let i = Math.max(0, maxDay); i >= 0; i--) availableDays.push(i);

  if (!isActive && todayIdx < 0) {
    return <div style={s.card}><p style={{ textAlign: "center", color: "#9B7EC8", fontSize: 16 }}>Väljakutse algab 30. märtsil! 🚀</p></div>;
  }

  return (
    <div style={s.card}>
      <h3 style={s.cardTitle}>📝 Lisa sammud</h3>

      <label style={s.label}>Päev</label>
      <select style={s.select} value={selectedDay} onChange={e => setSelectedDay(parseInt(e.target.value))}>
        {availableDays.map(d => (
          <option key={d} value={d}>Päev {d + 1} – {formatDate(d)} {myEntries.find(e => e.day_index === d) ? "✅" : ""}</option>
        ))}
      </select>

      <label style={s.label}>Sammude arv</label>
      <input style={s.input} type="number" placeholder="nt. 8500" value={steps}
        onChange={e => setSteps(e.target.value)} min="0" max="200000" />

      <label style={s.label}>Screenshot (tõestus)</label>
      <div style={s.uploadArea} onClick={() => fileRef.current?.click()}>
        {preview ? (
          <img src={preview} alt="Screenshot" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 12, objectFit: "contain" }} />
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📸</div>
            <p style={{ color: "#9B7EC8", fontSize: 13 }}>Kliki pildi üleslaadimiseks</p>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
      </div>

      <button
        style={{ ...s.btnPrimary, marginTop: 16, opacity: steps && parseInt(steps) > 0 && !busy ? 1 : 0.5 }}
        onClick={handleSubmit}
        disabled={!steps || parseInt(steps) <= 0 || busy}
      >{busy ? "Salvestan..." : existing ? "Uuenda 🔄" : "Salvesta 💾"}</button>
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
          <img src={expandedImg} alt="Screenshot" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} />
        </div>
      )}
      {sorted.map(entry => (
        <div key={entry.day_index} className="fadeIn" style={s.historyCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 15, marginRight: 8 }}>Päev {entry.day_index + 1}</span>
              <span style={{ fontSize: 12, color: "#9B7EC8" }}>{formatDate(entry.day_index)}</span>
            </div>
            <div style={s.statValue}>{formatNumber(entry.steps)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {entry.screenshot_url && (
              <button style={s.btnSmall} onClick={() => setExpandedImg(entry.screenshot_url)}>🖼️ Vaata pilti</button>
            )}
            <button
              style={{ ...s.btnSmall, background: "rgba(233,30,99,0.1)", color: "#E91E63" }}
              onClick={() => { if (confirm("Kustuta see sissekanne?")) onDelete(entry.day_index); }}
            >🗑️ Kustuta</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── LEADERBOARD ────────────────────────────────────────────
function LeaderboardView({ participants, entries, currentUserId }) {
  const todayIdx = getDayIndex();
  const users = participants.map(p => {
    const pEntries = entries.filter(e => e.participant_id === p.id);
    const total = pEntries.reduce((sum, e) => sum + e.steps, 0);
    const avg = pEntries.length ? Math.round(total / pEntries.length) : 0;
    const todaySteps = pEntries.find(e => e.day_index === todayIdx)?.steps || 0;
    const streak = calcStreak(pEntries);
    return { ...p, total, avg, todaySteps, streak, loggedDays: pEntries.length };
  });
  users.sort((a, b) => b.total - a.total);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, borderRadius: 20, padding: "14px 12px", textAlign: "center", background: "linear-gradient(135deg, #F3E5F5 0%, #E8D5F5 100%)" }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: "#7B1FA2" }}>{users.length}</div>
          <div style={{ fontSize: 11, color: "#9B7EC8", fontWeight: 500 }}>Osalejat</div>
        </div>
        <div style={{ flex: 1, borderRadius: 20, padding: "14px 12px", textAlign: "center", background: "linear-gradient(135deg, #FCE4EC 0%, #F3E5F5 100%)" }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: "#7B1FA2" }}>{formatNumber(users.reduce((sum, u) => sum + u.total, 0))}</div>
          <div style={{ fontSize: 11, color: "#9B7EC8", fontWeight: 500 }}>Sammud kokku</div>
        </div>
      </div>

      {users.map((u, i) => (
        <div key={u.id} className="fadeIn" style={{
          ...s.leaderRow,
          ...(u.id === currentUserId ? { border: "2px solid #C77DDB", background: "rgba(243,229,245,0.5)" } : {}),
          animationDelay: `${i * 0.05}s`
        }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Trophy rank={i + 1} />
            <div style={{ marginLeft: 10 }}>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 15 }}>
                {u.name}
                {u.id === currentUserId && <span style={s.meBadge}>sina</span>}
              </div>
              <div style={{ fontSize: 11, color: "#9B7EC8", marginTop: 1 }}>
                {u.loggedDays} päeva · keskmine {formatNumber(u.avg)}/päev
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={s.statValue}>{formatNumber(u.total)}</div>
            <div style={{ fontSize: 11, color: "#9B7EC8", marginTop: 2 }}>
              <span>Täna: {formatNumber(u.todaySteps)}</span>
              {u.streak > 0 && <span style={{ marginLeft: 8 }}><Flame size={12} /> {u.streak}</span>}
            </div>
          </div>
        </div>
      ))}

      {users.length === 0 && (
        <div style={s.card}><p style={{ textAlign: "center", color: "#9B7EC8" }}>Pole veel osalejaid. Ole esimene! 🎉</p></div>
      )}
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
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-thumb { background: #D4A0E8; border-radius: 3px; }
`;

// ─── STYLES ─────────────────────────────────────────────────
const s = {
  app: { fontFamily: "'DM Sans', sans-serif", background: "linear-gradient(170deg, #F8F0FF 0%, #FFF0F5 40%, #F3E5F5 100%)", minHeight: "100vh", color: "#2D1B4E" },
  loginWrap: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 20 },
  loginCard: { background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", borderRadius: 28, padding: "40px 28px", maxWidth: 420, width: "100%", boxShadow: "0 20px 60px rgba(155,89,182,0.15), 0 1px 0 rgba(255,255,255,0.8) inset", textAlign: "center" },
  logoCircle: { width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg, #E8D5F5, #F8BBD0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 16px", boxShadow: "0 8px 30px rgba(199,125,219,0.3)" },
  title: { fontFamily: "'Outfit', sans-serif", fontSize: 28, fontWeight: 800, background: "linear-gradient(135deg, #9B59B6, #E91E8C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 4 },
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
  btnGhost: { fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, padding: "8px 16px", borderRadius: 12, border: "1.5px solid #E8D5F5", background: "transparent", color: "#9B7EC8", cursor: "pointer" },
  label: { fontSize: 12, fontWeight: 600, color: "#9B7EC8", marginBottom: 6, display: "block", textAlign: "left" },
  dashWrap: { padding: "16px 16px 80px", maxWidth: 500, margin: "0 auto" },
  headerName: { fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 700, color: "#2D1B4E" },
  logoutBtn: { fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: "8px 14px", borderRadius: 12, border: "1.5px solid #E8D5F5", background: "rgba(255,255,255,0.7)", color: "#9B7EC8", cursor: "pointer" },
  statCard: { flex: 1, background: "rgba(255,255,255,0.8)", backdropFilter: "blur(10px)", borderRadius: 20, padding: "16px 12px", textAlign: "center", boxShadow: "0 4px 15px rgba(155,89,182,0.08)", border: "1px solid rgba(232,213,245,0.5)" },
  statValue: { fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, background: "linear-gradient(135deg, #9B59B6, #E91E8C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  statLabel: { fontSize: 11, color: "#9B7EC8", fontWeight: 500, marginTop: 2 },
  tabBar: { display: "flex", gap: 4, marginBottom: 16, background: "rgba(255,255,255,0.5)", borderRadius: 16, padding: 4 },
  tab: { flex: 1, fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, padding: "10px 8px", borderRadius: 12, border: "none", background: "transparent", color: "#9B7EC8", cursor: "pointer", transition: "all 0.2s ease" },
  tabActive: { background: "linear-gradient(135deg, #9B59B6, #E91E8C)", color: "#fff", boxShadow: "0 2px 10px rgba(155,89,182,0.3)" },
  card: { background: "rgba(255,255,255,0.8)", backdropFilter: "blur(10px)", borderRadius: 24, padding: 24, boxShadow: "0 4px 20px rgba(155,89,182,0.08)", border: "1px solid rgba(232,213,245,0.4)" },
  cardTitle: { fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 16, color: "#2D1B4E" },
  uploadArea: { border: "2px dashed #D4A0E8", borderRadius: 16, padding: 20, textAlign: "center", cursor: "pointer", background: "rgba(243,229,245,0.3)", transition: "all 0.2s ease", minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" },
  historyCard: { background: "rgba(255,255,255,0.8)", backdropFilter: "blur(10px)", borderRadius: 20, padding: "16px 18px", marginBottom: 10, boxShadow: "0 2px 12px rgba(155,89,182,0.06)", border: "1px solid rgba(232,213,245,0.4)" },
  btnSmall: { fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 10, border: "none", background: "rgba(212,160,232,0.15)", color: "#9B59B6", cursor: "pointer" },
  leaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.8)", backdropFilter: "blur(10px)", borderRadius: 20, padding: "14px 16px", marginBottom: 8, boxShadow: "0 2px 12px rgba(155,89,182,0.06)", border: "1px solid rgba(232,213,245,0.3)", transition: "all 0.2s ease" },
  meBadge: { fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, marginLeft: 6, background: "linear-gradient(135deg, #9B59B6, #E91E8C)", color: "#fff", verticalAlign: "middle" },
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(45,27,78,0.85)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "pointer", backdropFilter: "blur(8px)" },
};
