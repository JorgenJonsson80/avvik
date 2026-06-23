import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase.js";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login"); // "login" | "magic"
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) setMsg("Fel: " + error.message);
      else setMsg("Kolla din e-post för inloggningslänken.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg("Fel: " + error.message);
    }
    setLoading(false);
  }

  return (
    <div style={styles.center}>
      <div style={styles.card}>
        <h1 style={styles.title}>AvvikelseLive</h1>
        <p style={styles.sub}>Logga in för att fortsätta</p>
        <form onSubmit={handleLogin} style={styles.form}>
          <input
            style={styles.input}
            type="email"
            placeholder="E-postadress"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {mode === "login" && (
            <input
              style={styles.input}
              type="password"
              placeholder="Lösenord"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? "Loggar in…" : mode === "magic" ? "Skicka magisk länk" : "Logga in"}
          </button>
        </form>
        <button
          style={styles.link}
          onClick={() => { setMode(mode === "login" ? "magic" : "login"); setMsg(""); }}
        >
          {mode === "login" ? "Använd magisk länk istället" : "Använd lösenord istället"}
        </button>
        {msg && <p style={styles.msg}>{msg}</p>}
      </div>
    </div>
  );
}

const TABS = ["Importera", "Historik", "Statistik", "Vecka", "Analys"];

function Shell({ session }) {
  const [tab, setTab] = useState("Historik");

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <span style={styles.appName}>AvvikelseLive</span>
        <nav style={styles.nav}>
          {TABS.map((t) => (
            <button
              key={t}
              style={{ ...styles.tabBtn, ...(tab === t ? styles.tabActive : {}) }}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <button style={styles.link} onClick={handleLogout}>Logga ut</button>
      </header>
      <main style={styles.main}>
        <p style={{ color: "#888", textAlign: "center", paddingTop: 60 }}>
          Inloggad som <strong>{session.user.email}</strong>.
          <br />
          Tab <em>{tab}</em> byggs snart.
        </p>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = laddar

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div style={styles.center}>Laddar…</div>;
  if (!session) return <Login />;
  return <Shell session={session} />;
}

const styles = {
  center: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f5f5f5", fontFamily: "system-ui, sans-serif" },
  card: { background: "#fff", borderRadius: 8, padding: "2rem 2.5rem", boxShadow: "0 2px 12px rgba(0,0,0,.12)", minWidth: 320, maxWidth: 400, width: "100%" },
  title: { margin: "0 0 4px", fontSize: 24, fontWeight: 700 },
  sub: { margin: "0 0 1.5rem", color: "#666", fontSize: 14 },
  form: { display: "flex", flexDirection: "column", gap: 10 },
  input: { padding: "8px 10px", fontSize: 15, border: "1px solid #ccc", borderRadius: 5, outline: "none" },
  btn: { padding: "10px", fontSize: 15, background: "#1a73e8", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 600 },
  link: { background: "none", border: "none", color: "#1a73e8", cursor: "pointer", fontSize: 13, marginTop: 10, padding: 0 },
  msg: { marginTop: 10, fontSize: 13, color: "#c00" },
  shell: { display: "flex", flexDirection: "column", minHeight: "100vh", fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", alignItems: "center", gap: 16, padding: "0 20px", background: "#1a73e8", color: "#fff", height: 52 },
  appName: { fontWeight: 700, fontSize: 17, marginRight: 8 },
  nav: { display: "flex", gap: 4, flex: 1 },
  tabBtn: { background: "none", border: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer", padding: "6px 12px", borderRadius: 4, fontSize: 14 },
  tabActive: { background: "rgba(255,255,255,0.2)", color: "#fff", fontWeight: 600 },
  main: { flex: 1, padding: 20 },
};
