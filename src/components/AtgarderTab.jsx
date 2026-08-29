// ============================================================================
// AtgarderTab.jsx — Åtgärdsloopen
// ----------------------------------------------------------------------------
// Den här fliken är skillnaden mellan "en rapport" och "ett förbättringssystem".
// Du loggar vad du gjort åt en återkommande VNR, och appen mäter själv om
// avvikelserna faktiskt gick ner efteråt. Bevis, inte anekdot.
//
// Två sektioner:
//   1. Loggade åtgärder — var och en med grön/röd effekt (före vs efter).
//   2. Återkommande VNR utan åtgärd — förslagslista, ett klick för att logga.
//
// Effektlogiken bor i lib/actionEffect.js (ren, testad). Här är bara UI.
// ============================================================================
import { useState, useMemo, useEffect } from 'react';
import { useActions } from '../hooks/useActions.js';
import { useDeviationsContext } from '../context/DeviationsContext.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useOrgRole } from '../hooks/useOrgRole.js';
import { withEffects, EFFECT_META } from '../lib/actionEffect.js';
import { classifyLocation } from '../lib/classify.js';
import { fmtKr } from '../lib/dates.js';
import { supabase } from '../lib/supabase.js';

const card = {
  background: '#13131c',
  border: '1px solid #1e1e2e',
  borderRadius: 10,
  padding: 16,
};
const input = {
  background: '#0a0a0f',
  border: '1px solid #2a2a3a',
  borderRadius: 6,
  color: '#f0f0f5',
  padding: '8px 10px',
  fontFamily: 'inherit',
  fontSize: 13,
};

// Räknar ut återkommande VNR (>1 dag) ur deviations — samma idé som AnalysTab.
function computeRecurring(deviations) {
  const byVnr = {};
  for (const r of deviations) {
    if (!r.vnr) continue;
    if (!byVnr[r.vnr]) {
      byVnr[r.vnr] = {
        vnr: r.vnr,
        days: new Set(),
        total: 0,
        orsak: r.orsak,
        location: r.locations?.[0] || '',
        kbana: r.kbana || classifyLocation(r.locations?.[0]) || '',
      };
    }
    byVnr[r.vnr].days.add(r.datum);
    byVnr[r.vnr].total += r.count || 0;
  }
  return Object.values(byVnr)
    .filter((v) => v.days.size > 1)
    .map((v) => ({ ...v, dagar: v.days.size }))
    .sort((a, b) => b.dagar - a.dagar || b.total - a.total);
}

export function AtgarderTab() {
  const { deviations: data } = useDeviationsContext();
  const { actions, loading, addAction, deleteAction } = useActions();
  const { settings } = useSettings();
  const { isAdmin } = useOrgRole();
  const cost = parseFloat(settings.cost) || 63;
  const [form, setForm] = useState(null); // { vnr, location, kbana } när man loggar
  const [text, setText] = useState('');
  const [av, setAv] = useState('');
  const [manualVnr, setManualVnr] = useState('');
  const [saveError, setSaveError] = useState(null);
  const [uid, setUid] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data?.user?.id ?? null));
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  function openManual() {
    const vnr = manualVnr.trim().toUpperCase();
    if (!vnr) return;
    const match = data.find((d) => d.vnr === vnr);
    setForm({ vnr, location: match?.locations?.[0] || '', kbana: match?.kbana || '' });
    setText(''); setAv(''); setSaveError(null);
  }

  // Åtgärder berikade med effekt (före/efter).
  const withEff = useMemo(() => withEffects(actions, data), [actions, data]);

  // Återkommande VNR som INTE redan har en åtgärd — förslagslistan.
  const actionedVnrs = new Set(actions.map((a) => a.vnr));
  const suggestions = useMemo(
    () => computeRecurring(data).filter((v) => !actionedVnrs.has(v.vnr)).slice(0, 15),
    [data, actions]
  );

  const submit = async () => {
    if (!form || !text.trim()) return;
    setSaveError(null);
    const saved = await addAction({
      vnr: form.vnr,
      datum: today,
      text: text.trim(),
      av: av.trim() || null,
      location: form.location || null,
      kbana: form.kbana || null,
    });
    if (!saved) {
      setSaveError('Kunde inte spara åtgärden — försök igen.');
      return;
    }
    setForm(null);
    setText('');
    setAv('');
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
        Logga vad du gjort åt en VNR. Appen mäter om avvikelserna gick ner efteråt —{' '}
        <span style={{ color: '#4ade80' }}>grönt</span> = hjälpte,{' '}
        <span style={{ color: '#f97316' }}>orange</span> = ingen effekt.
      </div>

      {/* Manuell loggning — ange valfritt VNR */}
      {!form && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Ange VNR…"
            value={manualVnr}
            onChange={(e) => setManualVnr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && openManual()}
            style={{ ...input, width: 160, textTransform: 'uppercase' }}
          />
          <button
            onClick={openManual}
            disabled={!manualVnr.trim()}
            style={{ ...input, background: manualVnr.trim() ? '#7c6af7' : '#1a1a2e', border: 'none', cursor: manualVnr.trim() ? 'pointer' : 'default', fontWeight: 700, color: '#fff' }}
          >
            + Logga åtgärd
          </button>
          <span style={{ fontSize: 11, color: '#444' }}>— eller välj ur listan nedan</span>
        </div>
      )}

      {/* Lägg-till-formulär (visas när man valt en VNR) */}
      {form && (
        <div style={{ ...card, marginBottom: 20, borderColor: '#7c6af7' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            Ny åtgärd · VNR {form.vnr}
            {form.location ? (
              <span style={{ color: '#666', fontWeight: 400 }}>
                {' '}
                ({form.location}
                {form.kbana ? `, ${form.kbana}` : ''})
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              autoFocus
              placeholder="Vad gjorde du? T.ex. Pratade med påfyllnad"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              style={{ ...input, flex: 1, minWidth: 240 }}
            />
            <input
              placeholder="Av (frivilligt)"
              value={av}
              onChange={(e) => setAv(e.target.value)}
              style={{ ...input, width: 130 }}
            />
            <button
              onClick={submit}
              style={{
                ...input,
                background: '#7c6af7',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              Spara
            </button>
            <button
              onClick={() => { setForm(null); setSaveError(null); }}
              style={{ ...input, cursor: 'pointer', color: '#888' }}
            >
              Avbryt
            </button>
          </div>
          {saveError && (
            <div style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>{saveError}</div>
          )}
          <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>
            Datum sätts till idag ({today}) — det blir mätgränsen för före/efter.
          </div>
        </div>
      )}

      {/* Loggade åtgärder med effekt */}
      <div style={{ fontSize: 11, color: '#555', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
        Loggade åtgärder ({withEff.length})
      </div>
      {loading ? (
        <div style={{ color: '#555', padding: 20 }}>Laddar…</div>
      ) : withEff.length === 0 ? (
        <div style={{ color: '#555', padding: 20, fontSize: 13 }}>
          Inga åtgärder loggade än. Välj en VNR från förslagen nedan.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
          {withEff.map((a) => {
            const m = EFFECT_META[a.effect.status];
            return (
              <div key={a.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    VNR {a.vnr}
                    {a.location ? (
                      <span style={{ color: '#666', fontWeight: 400 }}>
                        {' '}({a.location}{a.kbana ? `, ${a.kbana}` : ''})
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 13, color: '#ccc', marginTop: 2 }}>{a.text}</div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                    {a.datum}
                    {a.av ? ` · ${a.av}` : ''}
                  </div>
                </div>

                {/* Effekt-block */}
                <div style={{ textAlign: 'right', minWidth: 150 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: m.color, fontFamily: 'monospace' }}>
                    {m.label}
                  </div>
                  {a.effect.status !== 'pending' && (
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      {a.effect.beforePerDay.toFixed(1)}/dag → {a.effect.afterPerDay.toFixed(1)}/dag
                      {a.effect.deltaPct !== null && (
                        <> ({a.effect.deltaPct > 0 ? '+' : ''}{Math.round(a.effect.deltaPct)}%)</>
                      )}
                    </div>
                  )}
                  {(a.effect.status === 'improved' || a.effect.status === 'worse') && (
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: m.color }}>
                      {-a.effect.deltaPerDay > 0 ? 'Sparar ' : 'Kostar '}
                      {fmtKr(Math.abs(a.effect.deltaPerDay) * cost)}/dag
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: '#444', marginTop: 1 }}>
                    {a.effect.beforeDays}d före · {a.effect.afterDays}d efter
                  </div>
                </div>

                {(a.user_id === uid || isAdmin) && (
                  <button
                    onClick={() => deleteAction(a.id)}
                    title="Ta bort"
                    style={{ ...input, cursor: 'pointer', color: '#666', padding: '4px 8px' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Förslag: återkommande VNR utan åtgärd */}
      <div style={{ fontSize: 11, color: '#555', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
        Återkommande utan åtgärd ({suggestions.length})
      </div>
      {suggestions.length === 0 ? (
        <div style={{ color: '#555', padding: 20, fontSize: 13 }}>
          Inga återkommande VNR utan åtgärd. 👍
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {suggestions.map((v) => (
            <div key={v.vnr} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
              <div style={{ flex: 1, fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>VNR {v.vnr}</span>
                {v.location ? <span style={{ color: '#666' }}> · {v.location}{v.kbana ? `, ${v.kbana}` : ''}</span> : null}
                <span style={{ color: '#888' }}> · {v.dagar} dagar · ×{v.total} totalt · {v.orsak || 'okänd orsak'}</span>
              </div>
              <button
                onClick={() => { setForm({ vnr: v.vnr, location: v.location, kbana: v.kbana }); setText(''); setAv(''); setSaveError(null); }}
                style={{ ...input, background: '#1a1a2e', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
              >
                + Logga åtgärd
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
