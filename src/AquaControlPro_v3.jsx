import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const load = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────
const DEFAULT_PARAMS = [
  { id:"KH",  label:"KH",        unit:"°dKH", target:8.0,  mlPer100L:17.8, pump:1, color:"#00d4ff", maxDayMl:100, maxDoseMl:10, stdDayMl:0,  min:6,    max:10,   enabled:true,  doseFrom:6, doseTo:22,
    tolOkLow:7.5,  tolOkHigh:8.5,   tolWarnLow:7.0,  tolWarnHigh:9.0,
    salifert: [ {ml:0.00,value:15.7},{ml:0.02,value:15.3},{ml:0.04,value:15.0},{ml:0.06,value:14.7},{ml:0.08,value:14.4},{ml:0.10,value:14.1},{ml:0.12,value:13.7},{ml:0.14,value:13.4},{ml:0.16,value:13.1},{ml:0.18,value:12.8},{ml:0.20,value:12.5},{ml:0.22,value:12.1},{ml:0.24,value:11.8},{ml:0.26,value:11.5},{ml:0.28,value:11.2},{ml:0.30,value:10.9},{ml:0.32,value:10.5},{ml:0.34,value:10.2},{ml:0.36,value:9.9},{ml:0.38,value:9.6},{ml:0.40,value:9.3},{ml:0.42,value:8.9},{ml:0.44,value:8.6},{ml:0.46,value:8.3},{ml:0.48,value:8.0},{ml:0.50,value:7.7},{ml:0.52,value:7.4},{ml:0.54,value:7.0},{ml:0.56,value:6.7},{ml:0.58,value:6.4},{ml:0.60,value:6.1},{ml:0.62,value:5.7},{ml:0.64,value:5.4},{ml:0.66,value:5.1},{ml:0.68,value:4.8},{ml:0.70,value:4.5},{ml:0.72,value:4.1},{ml:0.74,value:3.8},{ml:0.76,value:3.5},{ml:0.78,value:3.2},{ml:0.80,value:2.9},{ml:0.82,value:2.5},{ml:0.84,value:2.2},{ml:0.86,value:1.9},{ml:0.88,value:1.6},{ml:0.90,value:1.2},{ml:0.92,value:0.9},{ml:0.94,value:0.6},{ml:0.96,value:0.3},{ml:0.98,value:0.0} ] },
  { id:"Ca",  label:"Calcium",   unit:"mg/L",  target:420,  mlPer100L:5.88, pump:2, color:"#00ffb3", maxDayMl:200, maxDoseMl:20, stdDayMl:50, min:380,  max:460,  enabled:true,  doseFrom:7, doseTo:21,
    tolOkLow:400,  tolOkHigh:440,   tolWarnLow:380,  tolWarnHigh:460,  salifert:[] },
  { id:"Mg",  label:"Magnesium", unit:"mg/L",  target:1300, mlPer100L:8.33, pump:3, color:"#a78bfa", maxDayMl:300, maxDoseMl:30, stdDayMl:0,  min:1200, max:1400, enabled:true,  doseFrom:8, doseTo:20,
    tolOkLow:1250, tolOkHigh:1350,  tolWarnLow:1200, tolWarnHigh:1400, salifert:[] },
];

const DEFAULT_SETTINGS = {
  espIp: "192.168.1.100",
  tankVolume: 300,
  mlPerMs: 0.01667,
  haUrl: "http://homeassistant.local:8123",
  haToken: "",
  haTempEntity: "sensor.aquarium_temperature",
  haEntities: [
    { id:"e1", entity:"switch.stromungspumpe_1", label:"Strömungspumpe 1", icon:"🌀", type:"switch" },
    { id:"e2", entity:"switch.stromungspumpe_2", label:"Strömungspumpe 2", icon:"🌀", type:"switch" },
    { id:"e3", entity:"light.aquarium_licht",    label:"Aquarium Licht",   icon:"💡", type:"switch" },
  ],
};

const BESATZ_GROUPS = [
  { id:"fische",     label:"Fische",     icon:"🐠", color:"#ff8c00" },
  { id:"korallen",   label:"Korallen",   icon:"🪸", color:"#00d4ff" },
  { id:"wirbellose", label:"Wirbellose", icon:"🦐", color:"#00ffb3" },
];

const DEMO_BESATZ = [
  { id:1, group:"fische",     name:"Amphiprion ocellaris", type:"Clownfisch",    care:"★☆☆", color:"#ff8c00", emoji:"🐠", note:"Pärchen" },
  { id:2, group:"fische",     name:"Zebrasoma flavescens", type:"Doktorfisch",   care:"★★☆", color:"#ffe600", emoji:"🐡", note:"Frisst Algen" },
  { id:3, group:"korallen",   name:"Acropora millepora",   type:"SPS Koralle",   care:"★★★", color:"#00d4ff", emoji:"🪸", note:"Ableger möglich" },
  { id:4, group:"korallen",   name:"Euphyllia ancora",     type:"LPS Koralle",   care:"★★☆", color:"#a78bfa", emoji:"🌊", note:"Tentakel ausgefahren" },
  { id:5, group:"wirbellose", name:"Tridacna maxima",      type:"Riesenmuschel", care:"★★☆", color:"#00ffb3", emoji:"🐚", note:"Starkes Licht" },
  { id:6, group:"wirbellose", name:"Lysmata amboinensis",  type:"Putzergarnele", care:"★☆☆", color:"#ff6b9d", emoji:"🦐", note:"Putzstation" },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const isAllowedHour = (param) => {
  const h = new Date().getHours();
  if (param.doseFrom <= param.doseTo) return h >= param.doseFrom && h < param.doseTo;
  return h >= param.doseFrom || h < param.doseTo;
};

// Lineare Interpolation aus Lookup-Tabelle [{ml, value}]
function interpolateLookup(table, mlInput) {
  if (!table || table.length === 0) return null;
  const sorted = [...table].sort((a, b) => a.ml - b.ml);
  const ml = parseFloat(mlInput);
  if (isNaN(ml)) return null;
  // Exakter Treffer
  const exact = sorted.find(r => r.ml === ml);
  if (exact) return exact.value;
  // Unterhalb des kleinsten Wertes
  if (ml <= sorted[0].ml) return sorted[0].value;
  // Oberhalb des größten Wertes
  if (ml >= sorted[sorted.length - 1].ml) return sorted[sorted.length - 1].value;
  // Interpolieren zwischen zwei Stützpunkten
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1];
    if (ml >= lo.ml && ml <= hi.ml) {
      const t = (ml - lo.ml) / (hi.ml - lo.ml);
      return +(lo.value + t * (hi.value - lo.value)).toFixed(2);
    }
  }
  return null;
}

// Status basierend auf konfigurierten Toleranzbereichen
function getStatus(param, value) {
  if (value == null) return null;
  const okLow  = param.tolOkLow   ?? param.target * 0.95;
  const okHigh = param.tolOkHigh  ?? param.target * 1.05;
  const wLow   = param.tolWarnLow  ?? param.target * 0.90;
  const wHigh  = param.tolWarnHigh ?? param.target * 1.10;
  if (value >= okLow && value <= okHigh) return "ok";
  if (value >= wLow  && value <= wHigh)  return "warn";
  return "err";
}

function calcCorrectionMl(param, current, tankVolume) {
  const delta = param.target - current;
  if (delta <= 0) return 0;
  return +(delta * (tankVolume / 100) * param.mlPer100L).toFixed(2);
}

function buildSchedule(totalMl, maxDoseMl, param, startHour = new Date().getHours()) {
  if (totalMl <= 0 || maxDoseMl <= 0) return [];
  const steps = []; let rem = totalMl, h = startHour, tries = 0;
  while (rem > 0.01 && tries < 48) {
    const hour = h % 24;
    const allowed = param.doseFrom <= param.doseTo
      ? hour >= param.doseFrom && hour < param.doseTo
      : hour >= param.doseFrom || hour < param.doseTo;
    if (allowed) {
      const d = +Math.min(rem, maxDoseMl).toFixed(2);
      steps.push({ hour, ml: d, status: "pending", id: `${Date.now()}_${tries}` });
      rem -= d;
    }
    h++; tries++;
  }
  return steps;
}

// ─── ESP32 ────────────────────────────────────────────────────────────────────
async function sendDose(ip, pump, ml, mlPerMs) {
  const ms = Math.round(ml / mlPerMs);
  try {
    const r = await fetch(`http://${ip}/dose?pump=${pump}&time=${ms}`, { signal: AbortSignal.timeout(5000) });
    return r.ok ? { ok:true, ms } : { ok:false, error:`HTTP ${r.status}`, ms };
  } catch(e) { return { ok:false, error:e.message, ms }; }
}

// ─── HOME ASSISTANT ───────────────────────────────────────────────────────────
async function haFetch(url, token, path, method="GET", body=null) {
  try {
    const opts = { method, headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, signal: AbortSignal.timeout(5000) };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(`${url}/api/${path}`, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch(e) { return { _error: e.message }; }
}

// ─── CLAUDE SPECIES API ───────────────────────────────────────────────────────
async function fetchSpeciesInfo(name) {
  const prompt = `Du bist ein Meerwasser-Aquaristik-Experte. Erstelle einen deutschen Steckbrief für: "${name}".
Antworte NUR mit JSON ohne Markdown:
{"wissenschaftlichName":"...","deutscherName":"...","familie":"...","herkunft":"...","groesse":"...","beckengroesse":"...","temperatur":"...","salzgehalt":"...","ph":"...","kh":"...","licht":"Niedrig|Mittel|Hoch|Sehr hoch","stroemung":"Niedrig|Mittel|Hoch","ernaehrung":"...","schwierigkeitsgrad":"Anfänger|Fortgeschritten|Experte","vergesellschaftung":"...","besonderheiten":"...","pflegehinweise":"..."}`;
  try {
    const r = await fetch("/api/claude", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1200, messages:[{role:"user",content:prompt}] }),
    });
    const d = await r.json();
    const txt = (d.content||[]).map(c=>c.text||"").join("").replace(/```json|```/g,"").trim();
    return JSON.parse(txt);
  } catch { return null; }
}

// ─── BASE COMPONENTS ──────────────────────────────────────────────────────────
const Spin = () => <div className="spinner"/>;

function BigButton({ children, onClick, color, disabled, className="" }) {
  return (
    <button
      className={`big-btn ${className}`}
      style={color?{"--bc":color}:{}}
      onClick={onClick}
      disabled={disabled}
    >{children}</button>
  );
}

function Card({ children, className="" }) {
  return <div className={`card ${className}`}>{children}</div>;
}

function SectionTitle({ children, color }) {
  return <div className="section-title" style={color?{color}:{}}>{children}</div>;
}

// ─── MEASUREMENT POPUP ───────────────────────────────────────────────────────
function MeasurementPopup({ param, lastValue, settings, onSave, onClose }) {
  const [mode, setMode] = useState(param.salifert?.length > 0 ? "salifert" : "direct");
  const [mlInput, setMlInput] = useState("");
  const [directInput, setDirectInput] = useState("");
  const [isIcp, setIsIcp] = useState(false);
  const [icpDate, setIcpDate] = useState(() => new Date().toISOString().split("T")[0]);
  const hasSalifert = param.salifert?.length > 0;

  const resolvedValue = useMemo(() => {
    if (mode === "salifert") return interpolateLookup(param.salifert, mlInput);
    const v = parseFloat(directInput);
    return isNaN(v) ? null : v;
  }, [mode, mlInput, directInput, param]);

  const delta = resolvedValue != null ? resolvedValue - param.target : null;
  const corrMl = resolvedValue != null ? calcCorrectionMl(param, resolvedValue, settings.tankVolume) : null;
  const steps = corrMl > 0 ? buildSchedule(corrMl, param.maxDoseMl, param).length : 0;
  const status = getStatus(param, resolvedValue);
  const statusOk   = status === "ok";
  const statusWarn = status === "warn";

  const handleSave = () => {
    if (resolvedValue == null) return;
    onSave(param.id, resolvedValue, isIcp ? icpDate : null);
    onClose();
  };

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="popup-box" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="popup-header" style={{ borderBottomColor: param.color + "44" }}>
          <div className="popup-param-dot" style={{ background: param.color }}/>
          <div>
            <div className="popup-title" style={{ color: param.color }}>{param.label}</div>
            <div className="popup-subtitle">Zielwert: {param.target} {param.unit}</div>
          </div>
          <button className="popup-close" onClick={onClose}>✕</button>
        </div>

        {/* Letzter Wert */}
        {lastValue != null && (
          <div className="popup-last">
            <span className="popup-last-label">Letzter Messwert</span>
            <span className="popup-last-val" style={{ color: param.color }}>
              {lastValue} {param.unit}
            </span>
          </div>
        )}

        {/* Mode Toggle */}
        {hasSalifert && (
          <div className="popup-mode-toggle">
            <button
              className={`popup-mode-btn ${mode==="salifert"?"popup-mode-active":""}`}
              style={mode==="salifert"?{"--mc":param.color}:{}}
              onClick={() => setMode("salifert")}
            >💉 Salifert ml-Stand</button>
            <button
              className={`popup-mode-btn ${mode==="direct"?"popup-mode-active":""}`}
              style={mode==="direct"?{"--mc":param.color}:{}}
              onClick={() => setMode("direct")}
            >✏ Direkteingabe</button>
          </div>
        )}

        {/* Salifert Eingabe */}
        {mode === "salifert" && hasSalifert && (
          <div className="popup-input-section">
            <label className="popup-input-label">ml-Stand der Spritze nach dem Test</label>
            <div className="popup-input-row">
              <input
                autoFocus
                type="number" step="0.02" min="0"
                placeholder="z.B. 0.40"
                value={mlInput}
                onChange={e => setMlInput(e.target.value)}
                className="popup-input"
                style={{"--ac": param.color}}
              />
              <span className="popup-input-unit">ml</span>
            </div>
            {/* Nahe Tabellenwerte */}
            {mlInput !== "" && (
              <div className="popup-lookup-row">
                {[...param.salifert]
                  .sort((a,b) => a.ml - b.ml)
                  .filter(r => Math.abs(r.ml - parseFloat(mlInput)) <= 0.06)
                  .slice(0,5)
                  .map(r => (
                    <button
                      key={r.ml}
                      className={`popup-lookup-chip ${parseFloat(mlInput)===r.ml?"popup-lookup-exact":""}`}
                      style={parseFloat(mlInput)===r.ml?{borderColor:param.color,color:param.color}:{}}
                      onClick={() => setMlInput(String(r.ml))}
                    >
                      {r.ml.toFixed(2)}ml → {r.value}
                    </button>
                  ))
                }
              </div>
            )}
          </div>
        )}

        {/* Direkte Eingabe */}
        {mode === "direct" && (
          <div className="popup-input-section">
            <label className="popup-input-label">Messwert eingeben</label>
            <div className="popup-input-row">
              <input
                autoFocus
                type="number" step="0.1"
                placeholder={`Wert in ${param.unit}`}
                value={directInput}
                onChange={e => setDirectInput(e.target.value)}
                className="popup-input"
                style={{"--ac": param.color}}
              />
              <span className="popup-input-unit">{param.unit}</span>
            </div>
          </div>
        )}

        {/* Ergebnis & Analyse */}
        {resolvedValue != null && (
          <div className="popup-result" style={{ borderColor: param.color + "33", background: param.color + "0d" }}>
            <div className="popup-result-row">
              <div className="popup-result-val" style={{ color: param.color }}>
                {resolvedValue} <span className="popup-result-unit">{param.unit}</span>
              </div>
              <div className={`popup-status-pill ${statusOk?"ps-ok":statusWarn?"ps-warn":"ps-err"}`}>
                {statusOk ? "✓ Optimal" : statusWarn ? "△ Grenzwertig" : delta > 0 ? "▲ Zu hoch" : "▼ Zu niedrig"}
              </div>
            </div>

            {/* Analyse */}
            <div className="popup-analysis">
              {statusOk && (
                <div className="popup-analysis-ok">
                  ✓ Kein Handlungsbedarf. Wert liegt im Zielbereich.
                </div>
              )}
              {!statusOk && delta < 0 && corrMl > 0 && (
                <div className="popup-analysis-box">
                  <div className="popup-analysis-title">💊 Dosierungsvorschlag</div>
                  <div className="popup-analysis-line">
                    Fehlend: <b>{Math.abs(delta).toFixed(2)} {param.unit}</b>
                  </div>
                  <div className="popup-analysis-line">
                    Benötigt: <b style={{color:param.color}}>{corrMl} ml</b> über Pumpe {param.pump}
                  </div>
                  <div className="popup-analysis-line">
                    Aufgeteilt in: <b>{steps} Vorgänge</b> à max. {param.maxDoseMl} ml
                  </div>
                  {corrMl > param.maxDayMl && (
                    <div className="popup-analysis-warn">
                      ⚠ Über Tageslimit ({param.maxDayMl} ml) – wird auf mehrere Tage verteilt
                    </div>
                  )}
                </div>
              )}
              {!statusOk && delta > 0 && (
                <div className="popup-analysis-box popup-analysis-high">
                  <div className="popup-analysis-title">⬇ Zu hoher Wert</div>
                  <div className="popup-analysis-line">
                    Überschuss: <b>{delta.toFixed(2)} {param.unit}</b>
                  </div>
                  <div className="popup-analysis-line">
                    Empfehlung: Dosierung pausieren bis Wert sinkt.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ICP Toggle */}
        <div className="popup-icp-row">
          <label className="popup-icp-label">
            <input
              type="checkbox"
              checked={isIcp}
              onChange={e => setIsIcp(e.target.checked)}
              className="popup-icp-check"
            />
            <span>🧪 ICP-Laborwert</span>
          </label>
          {isIcp && (
            <div className="popup-icp-date">
              <span className="popup-icp-date-label">Datum der Probeentnahme</span>
              <input
                type="date"
                className="popup-input"
                style={{fontSize:16, padding:"10px 14px"}}
                value={icpDate}
                onChange={e => setIcpDate(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="popup-actions">
          <button className="popup-btn-cancel" onClick={onClose}>Abbrechen</button>
          <button
            className="popup-btn-save"
            style={{ background: param.color, opacity: resolvedValue == null ? 0.4 : 1 }}
            disabled={resolvedValue == null}
            onClick={handleSave}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MESSUNG TAB ──────────────────────────────────────────────────────────────
function MessungTab({ params, settings, measurements, setMeasurements, addLog }) {
  const [popup, setPopup] = useState(null); // param object
  const [savedFlash, setSavedFlash] = useState(null);
  const enabled = params.filter(p => p.enabled);

  const lastValues = useMemo(() => {
    const m = {};
    for (const p of enabled) {
      const f = [...measurements].reverse().find(e => e[p.id] != null);
      m[p.id] = f ? f[p.id] : null;
    }
    return m;
  }, [measurements, enabled]);

  const handleSave = (paramId, value, icpDate = null) => {
    const entry = { ts: Date.now(), [paramId]: value, ...(icpDate ? {icp: true, icpDate} : {}) };
    const updated = [...measurements, entry].slice(-500);
    setMeasurements(updated);
    save("measurements", updated);
    addLog(`${icpDate?"[ICP] ":""}Messwert: ${paramId} = ${value}${icpDate?" ("+icpDate+")":""}`);
    setSavedFlash(paramId);
    setTimeout(() => setSavedFlash(null), 2000);
  };

  return (
    <>
      <div className="tab-scroll">
        {/* Param Karten – anklickbar */}
        {enabled.map(p => {
          const cur = lastValues[p.id];
          const status = getStatus(p, cur);
          const ok   = status === "ok";
          const warn = status === "warn";
          const pct  = cur != null ? Math.min(100, Math.max(0, ((cur - p.min) / (p.max - p.min)) * 100)) : null;
          const tpct = ((p.target - p.min) / (p.max - p.min)) * 100;

          return (
            <div
              key={p.id}
              className={`meas-tap-card ${savedFlash===p.id?"meas-saved":""}`}
              style={{ "--pc": p.color }}
              onClick={() => setPopup(p)}
            >
              {/* Top row */}
              <div className="meas-tap-top">
                <div className="meas-tap-dot" style={{ background: p.color }}/>
                <span className="meas-tap-name" style={{ color: p.color }}>{p.label}</span>
                <span className="meas-tap-unit">{p.unit}</span>
                {cur != null && (
                  <span className={`pill ${ok?"pill-ok":warn?"pill-warn":"pill-err"}`}>
                    {ok ? "✓ OK" : warn ? "△" : "✗"}
                  </span>
                )}
                <span className="meas-tap-chevron">→</span>
              </div>

              {/* Value */}
              <div className="meas-tap-vals">
                <div>
                  <div className="meas-tap-label">Aktuell</div>
                  <div className="meas-tap-val" style={{ color: cur != null ? p.color : "#4a7080" }}>
                    {cur != null ? cur : "–"} <span className="meas-tap-vunit">{cur != null ? p.unit : "tippen zum Messen"}</span>
                  </div>
                </div>
                <div>
                  <div className="meas-tap-label">Ziel</div>
                  <div className="meas-tap-val">{p.target} <span className="meas-tap-vunit">{p.unit}</span></div>
                </div>
                {cur != null && (
                  <div>
                    <div className="meas-tap-label">{cur < p.target ? "Fehlend" : "Überschuss"}</div>
                    <div className="meas-tap-val" style={{ color: cur < p.target ? "#ff8c00" : "#00ffb3" }}>
                      {cur < p.target ? "+" : ""}{(p.target - cur).toFixed(1)} <span className="meas-tap-vunit">{p.unit}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Bar */}
              {cur != null && (
                <div className="meas-tap-bar">
                  <div className="meas-tap-bar-fill" style={{ width:`${pct}%`, background: p.color }}/>
                  <div className="meas-tap-bar-target" style={{ left:`${tpct}%` }}/>
                </div>
              )}

              {savedFlash === p.id && (
                <div className="meas-saved-badge" style={{ color: p.color }}>✓ Gespeichert!</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Popup */}
      {popup && (
        <MeasurementPopup
          param={popup}
          lastValue={lastValues[popup.id]}
          settings={settings}
          onSave={handleSave}
          onClose={() => setPopup(null)}
        />
      )}
    </>
  );
}

// ─── DOSIERUNG TAB ────────────────────────────────────────────────────────────
function DosierungTab({ params, settings, measurements, todayDosed, setTodayDosed, addLog }) {
  const enabled = params.filter(p => p.enabled);
  const [activeParam, setActiveParam] = useState(() => enabled[0]?.id || null);
  // Dauerhafter Tagesplan (wiederholt sich täglich)
  const [dayPlans, setDayPlans] = useState(() => load("dayPlans", {}));
  // Heutiger Fortschritt (welche Schritte wurden heute ausgeführt)
  const [todayDone, setTodayDone] = useState(() => {
    const s = load("todayDone", {});
    return s?.date === new Date().toDateString() ? (s.data||{}) : {};
  });
  const [dosingId, setDosingId] = useState(null);
  const [editStep, setEditStep] = useState(null); // {paramId, step}
  const [addingStep, setAddingStep] = useState(null); // paramId
  const [newStepHour, setNewStepHour] = useState("8");
  const [newStepMl, setNewStepMl] = useState("");

  const lastValues = useMemo(() => {
    const m = {};
    for (const p of enabled) {
      const f = [...measurements].reverse().find(e => e[p.id] != null);
      m[p.id] = f ? f[p.id] : null;
    }
    return m;
  }, [measurements, enabled]);

  const saveDayPlans = (dp) => { setDayPlans(dp); save("dayPlans", dp); };

  const saveTodayDone = (td) => {
    setTodayDone(td);
    save("todayDone", { date: new Date().toDateString(), data: td });
  };

  // Generiere Tagesplan ab 00:00 gleichmäßig verteilt
  const generatePlan = (param) => {
    const cur = lastValues[param.id];
    const corr = cur != null ? calcCorrectionMl(param, cur, settings.tankVolume) : 0;
    const total = Math.max(corr, param.stdDayMl || 0);
    if (total <= 0) return;

    // Verteile gleichmäßig über erlaubte Stunden von 0-23
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const inWindow = param.doseFrom <= param.doseTo
        ? h >= param.doseFrom && h < param.doseTo
        : h >= param.doseFrom || h < param.doseTo;
      if (inWindow) hours.push(h);
    }
    if (!hours.length) return;

    // Maximal so viele Schritte wie nötig
    const steps = [];
    let rem = total;
    let hi = 0;
    while (rem > 0.01 && hi < hours.length) {
      const ml = +Math.min(rem, param.maxDoseMl).toFixed(2);
      steps.push({ id: `${param.id}_${hours[hi]}_${Date.now()}`, hour: hours[hi], ml, status:"pending" });
      rem -= ml;
      // Nächste Stunde – gleichmäßig verteilen
      hi += Math.max(1, Math.floor(hours.length / Math.ceil(total / param.maxDoseMl)));
      if (hi >= hours.length && rem > 0.01) hi = hours.length - 1;
    }

    const updated = { ...dayPlans, [param.id]: { generated: Date.now(), steps, totalMl: total } };
    saveDayPlans(updated);
    // Fortschritt zurücksetzen
    const td = { ...todayDone }; delete td[param.id];
    saveTodayDone(td);
  };

  const updateStepInPlan = (paramId, stepId, changes) => {
    const plan = dayPlans[paramId];
    if (!plan) return;
    const steps = plan.steps.map(s => s.id === stepId ? {...s, ...changes} : s);
    saveDayPlans({ ...dayPlans, [paramId]: { ...plan, steps } });
  };

  const deleteStepFromPlan = (paramId, stepId) => {
    const plan = dayPlans[paramId];
    if (!plan) return;
    saveDayPlans({ ...dayPlans, [paramId]: { ...plan, steps: plan.steps.filter(s => s.id !== stepId) } });
  };

  const addStepToPlan = (paramId) => {
    const plan = dayPlans[paramId];
    const h = parseInt(newStepHour);
    const ml = parseFloat(newStepMl);
    if (isNaN(h) || isNaN(ml) || ml <= 0) return;
    const newStep = { id: `${paramId}_${h}_${Date.now()}`, hour: h, ml: +ml.toFixed(2), status:"pending" };
    const steps = [...(plan?.steps||[]), newStep].sort((a,b) => a.hour - b.hour);
    saveDayPlans({ ...dayPlans, [paramId]: { ...(plan||{}), steps } });
    setAddingStep(null); setNewStepMl("");
  };

  const executeDose = async (param, step) => {
    setDosingId(step.id);
    const res = await sendDose(settings.espIp, param.pump, step.ml, settings.mlPerMs);
    setDosingId(null);
    if (res.ok) {
      // Merke als heute erledigt
      const td = { ...todayDone, [param.id]: [...(todayDone[param.id]||[]), step.id] };
      saveTodayDone(td);
      setTodayDosed(d => {
        const u = { ...d, [param.id]: (d[param.id]||0) + step.ml };
        save("todayDosed", { date: new Date().toDateString(), data: u });
        return u;
      });
      addLog(`Dosiert: ${param.label} ${step.ml}ml via Pumpe ${param.pump}`);
    }
  };

  const nowH = new Date().getHours();

  return (
    <div className="tab-scroll">
      <div className="page-title">Dosierplan</div>

      {/* Param Chips */}
      <div className="param-chip-row">
        {enabled.map(p => {
          const plan = dayPlans[p.id];
          const doneIds = todayDone[p.id] || [];
          const pending = plan?.steps?.filter(s => !doneIds.includes(s.id) && s.status !== "paused").length || 0;
          return (
            <button key={p.id}
              className={`param-chip ${activeParam===p.id?"param-chip-active":""}`}
              style={{"--c":p.color}}
              onClick={() => setActiveParam(p.id)}
            >
              <span>{p.label}</span>
              {pending > 0 && <span className="pc-badge">{pending}</span>}
              {!isAllowedHour(p) && <span>🌙</span>}
            </button>
          );
        })}
      </div>

      {/* Active Plan */}
      {enabled.filter(p => p.id === activeParam).map(p => {
        const plan = dayPlans[p.id];
        const dosed = todayDosed[p.id] || 0;
        const doneIds = todayDone[p.id] || [];
        const corrMl = lastValues[p.id] != null ? calcCorrectionMl(p, lastValues[p.id], settings.tankVolume) : 0;

        return (
          <Card key={p.id}>
            {/* Header */}
            <div className="dos-card-header">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div className="meas-dot" style={{background:p.color}}/>
                <span className="dos-param-name" style={{color:p.color}}>{p.label}</span>
              </div>
              <div className="dos-time-badge">
                🕐 {String(p.doseFrom).padStart(2,"0")}:00–{String(p.doseTo).padStart(2,"0")}:00
                {!isAllowedHour(p) && <span className="dos-blocked"> Gesperrt</span>}
              </div>
            </div>

            {/* Stats */}
            <div className="dos-stats">
              <div className="dos-stat"><div className="dos-stat-label">Korrekturbedarf</div><div className="dos-stat-val" style={{color:p.color}}>{corrMl>0?corrMl+" ml":"–"}</div></div>
              <div className="dos-stat"><div className="dos-stat-label">Heute dosiert</div><div className="dos-stat-val">{dosed.toFixed(1)} ml</div></div>
              <div className="dos-stat"><div className="dos-stat-label">Max/Tag</div><div className="dos-stat-val">{p.maxDayMl} ml</div></div>
              {p.stdDayMl>0&&<div className="dos-stat"><div className="dos-stat-label">Standarddosis</div><div className="dos-stat-val">{p.stdDayMl} ml</div></div>}
            </div>

            {/* Progress bar */}
            <div className="dos-day-bar-track">
              <div className="dos-day-bar-fill" style={{width:`${Math.min(100,(dosed/p.maxDayMl)*100)}%`,background:p.color}}/>
            </div>

            {/* Generate */}
            <BigButton color={p.color} onClick={() => generatePlan(p)}>
              {plan ? "🔄 Plan neu generieren" : "✨ Tagesplan erstellen"}
            </BigButton>

            {/* Plan anzeigen */}
            {plan && plan.steps.length > 0 && (
              <div className="step-list">
                <div className="step-list-header">
                  <span className="step-list-title">Tagesplan ({plan.steps.length} Vorgänge) · wiederholt täglich</span>
                  <button className="step-add-btn" onClick={() => setAddingStep(p.id)}>+ Hinzufügen</button>
                </div>

                {/* Neuen Schritt hinzufügen */}
                {addingStep === p.id && (
                  <div className="step-add-form">
                    <select className="step-add-inp" value={newStepHour} onChange={e=>setNewStepHour(e.target.value)}>
                      {Array.from({length:24},(_,i)=>i).map(h=>(
                        <option key={h} value={h}>{String(h).padStart(2,"0")}:00 Uhr</option>
                      ))}
                    </select>
                    <input type="number" step="0.5" placeholder="ml" className="step-add-inp"
                      value={newStepMl} onChange={e=>setNewStepMl(e.target.value)} style={{width:80}}/>
                    <button className="step-add-ok" style={{background:p.color}} onClick={()=>addStepToPlan(p.id)}>✓</button>
                    <button className="step-add-cancel" onClick={()=>setAddingStep(null)}>✕</button>
                  </div>
                )}

                {plan.steps.sort((a,b)=>a.hour-b.hour).map(step => {
                  const isDone = doneIds.includes(step.id);
                  const isCur = step.hour === nowH;
                  const isPast = step.hour < nowH;
                  const isLoading = dosingId === step.id;
                  const isEditing = editStep?.stepId === step.id;

                  return (
                    <div key={step.id}
                      className={`step-row ${isDone?"step-done-row":""} ${isCur?"step-current":""} ${isPast&&!isDone?"step-past":""} ${step.status==="paused"?"step-paused-row":""}`}>

                      {/* Zeit */}
                      <div className="step-time">
                        {String(step.hour).padStart(2,"0")}:00
                        {isCur && <span className="step-now">JETZT</span>}
                      </div>

                      {/* Menge – inline editierbar */}
                      {isEditing ? (
                        <div className="step-edit-inline">
                          <input type="number" step="0.5" className="step-edit-inp"
                            defaultValue={step.ml} autoFocus
                            onBlur={e=>{
                              const v=parseFloat(e.target.value);
                              if(!isNaN(v)&&v>0) updateStepInPlan(p.id,step.id,{ml:+v.toFixed(2)});
                              setEditStep(null);
                            }}
                            onKeyDown={e=>{
                              if(e.key==="Enter"){e.target.blur();}
                              if(e.key==="Escape") setEditStep(null);
                            }}
                          />
                          <span className="step-unit">ml</span>
                        </div>
                      ) : (
                        <div className="step-ml-wrap" onClick={()=>setEditStep({stepId:step.id})} style={{cursor:"pointer"}}>
                          <span className="step-ml">{step.ml}</span>
                          <span className="step-unit"> ml ✏</span>
                        </div>
                      )}

                      <div className="step-dur">{(step.ml/settings.mlPerMs/1000).toFixed(1)}s</div>

                      {/* Status badge */}
                      {isDone && <span className="step-badge step-done">✓</span>}
                      {step.status==="paused" && <span className="step-badge step-paused">⏸</span>}

                      {/* Actions */}
                      <div className="step-actions">
                        {!isDone && (
                          <button className="step-btn step-run" style={{"--c":p.color}}
                            onClick={()=>executeDose(p,step)} disabled={isLoading||!isAllowedHour(p)}>
                            {isLoading?<Spin/>:`P${p.pump}`}
                          </button>
                        )}
                        <button className="step-btn step-pause"
                          onClick={()=>updateStepInPlan(p.id,step.id,{status:step.status==="paused"?"pending":"paused"})}>
                          {step.status==="paused"?"▶":"⏸"}
                        </button>
                        <button className="step-btn step-del" onClick={()=>deleteStepFromPlan(p.id,step.id)}>✕</button>
                      </div>
                    </div>
                  );
                })}

                <div className="step-total">
                  Plan: {plan.steps.reduce((a,s)=>a+s.ml,0).toFixed(1)} ml/Tag
                  · Heute: {dosed.toFixed(1)} ml dosiert
                  · {doneIds.length}/{plan.steps.length} Vorgänge erledigt
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── SMART HOME TAB ───────────────────────────────────────────────────────────
function SmartHomeTab({ settings }) {
  const [states, setStates] = useState({});
  const [loading, setLoading] = useState({});
  const [temp, setTemp] = useState(null);
  const [online, setOnline] = useState(null);
  const [feedingCountdown, setFeedingCountdown] = useState(null);
  const entities = settings.haEntities || [];

  const poll = useCallback(async () => {
    if (!settings.haToken) return;
    const ping = await haFetch(settings.haUrl, settings.haToken, "");
    setOnline(!ping._error);
    if (ping._error) return;
    if (settings.haTempEntity) {
      const ts = await haFetch(settings.haUrl, settings.haToken, `states/${settings.haTempEntity}`);
      if (ts.state) setTemp({ val: parseFloat(ts.state), unit: ts.attributes?.unit_of_measurement || "°C" });
    }
    const ns = {};
    for (const e of entities) {
      const st = await haFetch(settings.haUrl, settings.haToken, `states/${e.entity}`);
      if (!st._error) ns[e.id] = st.state;
    }
    setStates(ns);
  }, [settings, entities]);

  useEffect(() => { poll(); const t = setInterval(poll, 15000); return () => clearInterval(t); }, [poll]);

  useEffect(() => {
    if (feedingCountdown === null || feedingCountdown <= 0) { if (feedingCountdown === 0) poll(); return; }
    const t = setTimeout(() => setFeedingCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [feedingCountdown]);

  const toggle = async (e) => {
    setLoading(l => ({...l,[e.id]:true}));
    const isOn = states[e.id] === "on";
    await haFetch(settings.haUrl, settings.haToken, `services/homeassistant/${isOn?"turn_off":"turn_on"}`, "POST", {entity_id:e.entity});
    await poll();
    setLoading(l => ({...l,[e.id]:false}));
  };

  const startFeeding = async () => {
    const pumps = entities.filter(e => /strom|pump|flow/i.test(e.entity));
    for (const e of pumps) await haFetch(settings.haUrl, settings.haToken, `services/homeassistant/turn_off`, "POST", {entity_id:e.entity});
    setFeedingCountdown(600);
    setTimeout(async () => {
      for (const e of pumps) await haFetch(settings.haUrl, settings.haToken, `services/homeassistant/turn_on`, "POST", {entity_id:e.entity});
      setFeedingCountdown(0);
    }, 600000);
  };

  const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  const tempColor = temp ? (temp.val > 27 ? "#ff4444" : temp.val < 23 ? "#00d4ff" : "#00ffb3") : "#00ffb3";

  return (
    <div className="tab-scroll">
      <div className="page-title">Smart Home</div>

      {!settings.haToken ? (
        <Card>
          <div className="ha-empty">
            <div className="ha-empty-icon">🏠</div>
            <div className="ha-empty-title">Nicht konfiguriert</div>
            <div className="ha-empty-sub">HA-URL und Token in den Einstellungen hinterlegen</div>
          </div>
        </Card>
      ) : (
        <>
          {/* Connection + Temp */}
          <Card>
            <div className="ha-status-bar">
              <div className={`ha-conn-dot ${online===true?"ha-online":online===false?"ha-offline":"ha-pending"}`}/>
              <span className="ha-conn-label">{online===true?"Verbunden":online===false?"Nicht erreichbar":"Verbinde…"}</span>
            </div>
            {temp && (
              <div className="ha-temp-big">
                <span className="ha-temp-icon">🌡</span>
                <span className="ha-temp-number" style={{color:tempColor}}>{temp.val.toFixed(1)}</span>
                <span className="ha-temp-unit">{temp.unit}</span>
                <span className="ha-temp-label">Wassertemperatur</span>
              </div>
            )}
          </Card>

          {/* Feeding */}
          <Card className="feeding-card">
            <div className="feeding-top">
              <div>
                <div className="feeding-title">🐟 Fütterungsmodus</div>
                <div className="feeding-sub">Strömungspumpen für 10 Minuten deaktivieren</div>
              </div>
              {feedingCountdown !== null && feedingCountdown > 0 ? (
                <div className="feeding-countdown">{fmt(feedingCountdown)}</div>
              ) : (
                <BigButton color="#ffaa00" onClick={startFeeding} disabled={!online}>Starten</BigButton>
              )}
            </div>
          </Card>

          {/* Entity Grid */}
          {entities.length > 0 && (
            <>
              <SectionTitle>Geräte</SectionTitle>
              <div className="ha-entity-grid">
                {entities.map(e => {
                  const isOn = states[e.id] === "on";
                  const isLoading = loading[e.id];
                  return (
                    <Card key={e.id} className={`ha-entity-card ${isOn?"ha-on":""}`}>
                      <div className="ha-entity-icon">{e.icon}</div>
                      <div className="ha-entity-name">{e.label}</div>
                      <div className="ha-entity-state">{isLoading?"…":(states[e.id]||"–")}</div>
                      <button
                        className={`ha-toggle-btn ${isOn?"ha-toggle-on":""}`}
                        disabled={isLoading||!online}
                        onClick={() => toggle(e)}
                      >{isLoading?<Spin/>:isOn?"AN":"AUS"}</button>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── BESATZ TAB ───────────────────────────────────────────────────────────────
const DIFF_C = {Anfänger:"#00ffb3",Fortgeschritten:"#ffe600",Experte:"#ff4444"};

// Steckbrief-Cache: einmal laden, dann aus localStorage
function getCachedSpecies(name) {
  try { return JSON.parse(localStorage.getItem("species_" + name)); } catch { return null; }
}
function setCachedSpecies(name, data) {
  try { localStorage.setItem("species_" + name, JSON.stringify(data)); } catch {}
}

function SpeciesDetail({ animal, onUpdate, onBack }) {
  const [info, setInfo] = useState(() => getCachedSpecies(animal.name));
  const [loading, setLoading] = useState(!getCachedSpecies(animal.name));
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    note: animal.note || "",
    count: animal.count || 1,
    ownNotes: animal.ownNotes || "",
    photo: animal.photo || null,
  });
  const group = BESATZ_GROUPS.find(g => g.id === animal.group);

  useEffect(() => {
    if (info) return; // bereits gecacht
    let ok = true;
    fetchSpeciesInfo(animal.name).then(d => {
      if (!ok) return;
      if (d) {
        setInfo(d);
        setCachedSpecies(animal.name, d);
      }
      setLoading(false);
    });
    return () => { ok = false; };
  }, [animal.name]);

  const saveEdit = () => {
    onUpdate(animal.id, editData);
    setEditing(false);
  };

  const Row = ({label,value}) => value ? (
    <div className="info-row"><span className="info-lbl">{label}</span><span className="info-val">{value}</span></div>
  ) : null;

  return (
    <div className="tab-scroll">
      <button className="back-btn" onClick={onBack}>← Zurück</button>

      {/* Hero */}
      <div className="detail-hero" style={{"--ac":animal.color}}>
        {/* Foto oder Emoji */}
        <div className="detail-photo-wrap">
          {animal.photo ? (
            <img src={animal.photo} className="detail-photo" alt={animal.name}/>
          ) : (
            <div className="detail-emoji">{animal.emoji}</div>
          )}
        </div>
        <div style={{flex:1}}>
          {group && <div style={{color:group.color,fontSize:12,marginBottom:4}}>{group.icon} {group.label}</div>}
          <div className="detail-sci">{animal.name}</div>
          <div className="detail-type-line">{animal.type} · {animal.care}</div>
          <div className="detail-count-badge">
            {animal.count > 1 ? `${animal.count}× Tiere` : "1 Tier"}
          </div>
        </div>
        <button className="detail-edit-btn" onClick={() => setEditing(e=>!e)}>
          {editing ? "✕" : "✏"}
        </button>
      </div>

      {/* Edit Panel */}
      {editing && (
        <Card>
          <SectionTitle color={animal.color}>Bearbeiten</SectionTitle>
          <div className="sett-field">
            <label>Foto</label>
            <div className="photo-edit-row">
              {(editData.photo||animal.photo) && (
                <img src={editData.photo||animal.photo} className="photo-edit-preview" alt="Tier"/>
              )}
              <label className="photo-upload-btn">
                📷 {animal.photo?"Foto ändern":"Foto hochladen"}
                <input type="file" accept="image/*" style={{display:"none"}}
                  onChange={e=>{
                    const file=e.target.files[0]; if(!file) return;
                    const reader=new FileReader();
                    reader.onload=ev=>{
                      const canvas=document.createElement("canvas");
                      const img=new Image();
                      img.onload=()=>{
                        const maxW=400, ratio=Math.min(1,maxW/img.width);
                        canvas.width=img.width*ratio; canvas.height=img.height*ratio;
                        canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
                        setEditData(d=>({...d,photo:canvas.toDataURL("image/jpeg",0.7)}));
                      };
                      img.src=ev.target.result;
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {(editData.photo||animal.photo) && (
                <button className="photo-remove-btn" onClick={()=>setEditData(d=>({...d,photo:null}))}>✕ Entfernen</button>
              )}
            </div>
          </div>
          <div className="sett-field">
            <label>Anzahl</label>
            <input type="number" min="1" className="sett-inp" value={editData.count}
              onChange={e=>setEditData(d=>({...d,count:+e.target.value}))}/>
          </div>
          <div className="sett-field">
            <label>Kurz-Notiz (in der Liste sichtbar)</label>
            <input className="sett-inp" value={editData.note}
              onChange={e=>setEditData(d=>({...d,note:e.target.value}))}/>
          </div>
          <div className="sett-field">
            <label>Eigene Beobachtungen & Infos</label>
            <textarea className="sett-inp" rows={4} value={editData.ownNotes}
              style={{resize:"vertical",fontSize:13,lineHeight:1.6}}
              placeholder="z.B. frisst gut, laicht seit März..."
              onChange={e=>setEditData(d=>({...d,ownNotes:e.target.value}))}/>
          </div>
          <BigButton color={animal.color} onClick={saveEdit}>Speichern</BigButton>
        </Card>
      )}

      {/* Eigene Notizen anzeigen */}
      {animal.ownNotes && !editing && (
        <Card>
          <SectionTitle color={animal.color}>Meine Beobachtungen</SectionTitle>
          <div style={{fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{animal.ownNotes}</div>
        </Card>
      )}

      {/* Steckbrief */}
      {loading && <Card><div className="loading-row"><Spin/><span>Lade Steckbrief…</span></div></Card>}
      {!loading && !info && <Card><span style={{color:"#ff4444"}}>Keine Daten verfügbar</span></Card>}
      {info && !loading && (<>
        <Card>
          <SectionTitle color={animal.color}>Steckbrief</SectionTitle>
          <Row label="Wiss. Name" value={info.wissenschaftlichName}/>
          <Row label="Deutscher Name" value={info.deutscherName}/>
          <Row label="Familie" value={info.familie}/>
          <Row label="Herkunft" value={info.herkunft}/>
          <Row label="Maximalgröße" value={info.groesse}/>
          <Row label="Mindestbecken" value={info.beckengroesse}/>
        </Card>
        <Card>
          <SectionTitle color={animal.color}>Wasserwerte</SectionTitle>
          <div className="wert-grid">
            {[["🌡","Temp.",info.temperatur],["🧂","Salz",info.salzgehalt],["⚗","pH",info.ph],["💧","KH",info.kh]].filter(w=>w[2]).map(([ic,lb,vl])=>(
              <div key={lb} className="wert-tile"><span className="wert-ic">{ic}</span><span className="wert-lb">{lb}</span><span className="wert-vl">{vl}</span></div>
            ))}
          </div>
          <Row label="Licht" value={info.licht}/><Row label="Strömung" value={info.stroemung}/>
        </Card>
        <Card>
          <SectionTitle color={animal.color}>Pflege</SectionTitle>
          {info.schwierigkeitsgrad && (
            <div className="diff-row">
              <span className="info-lbl">Schwierigkeit</span>
              <span className="diff-pill" style={{background:DIFF_C[info.schwierigkeitsgrad]+"22",color:DIFF_C[info.schwierigkeitsgrad],border:`1px solid ${DIFF_C[info.schwierigkeitsgrad]}44`}}>{info.schwierigkeitsgrad}</span>
            </div>
          )}
          <Row label="Ernährung" value={info.ernaehrung}/>
          <Row label="Vergesellschaftung" value={info.vergesellschaftung}/>
          <Row label="Besonderheiten" value={info.besonderheiten}/>
          <Row label="Pflegehinweise" value={info.pflegehinweise}/>
        </Card>
        <div className="lexikon-wrap">
          <div className="lexikon-note">Steckbrief generiert von Claude KI · ohne Gewähr</div>
          <a className="lexikon-link" href={`https://www.meerwasser-lexikon.de/tiere/${animal.name.toLowerCase().replace(/ /g,"_")}.htm`} target="_blank" rel="noopener noreferrer">
            Auf Meerwasser-Lexikon.de nachschlagen ↗
          </a>
        </div>
      </>)}
    </div>
  );
}

// ─── FOTO-ERKENNUNG ───────────────────────────────────────────────────────────
async function recognizeAnimalPhoto(base64, mime) {
  const prompt = `Du bist ein Experte für Meerwasseraquaristik mit tiefem Wissen über Riffaquarien.

Analysiere dieses Foto eines Aquarientieres und gib bis zu 3 mögliche Arten an, sortiert nach Wahrscheinlichkeit.

Antworte NUR mit einem JSON-Objekt ohne Markdown:
{
  "sicher": true/false,
  "kandidaten": [
    {
      "wissenschaftlichName": "...",
      "deutscherName": "...",
      "gruppe": "fische|korallen|wirbellose",
      "typ": "z.B. Clownfisch / SPS Koralle / Garnele",
      "emoji": "passendes Emoji",
      "color": "z.B. #ff8c00",
      "konfidenz": 95,
      "merkmale": "Sichtbare Merkmale die zu dieser Art passen",
      "pflege": "Anfänger|Fortgeschritten|Experte",
      "care": "★☆☆ oder ★★☆ oder ★★★"
    }
  ],
  "bildqualitaet": "gut|mittel|schlecht",
  "hinweis": "Optionaler Hinweis wenn Bild unklar ist"
}

Wichtig:
- Wenn du dir sehr sicher bist (>85%): sicher=true, nur 1 Kandidat
- Bei mittlerer Sicherheit (50-85%): sicher=false, 2-3 Kandidaten
- Bei schlechtem Bild: bildqualitaet=schlecht und entsprechenden hinweis
- Gruppe MUSS einer von: fische, korallen, wirbellose sein
- Emoji soll zum Tier passen (🐠🐡🦈 für Fische, 🪸🌊🌺 für Korallen, 🦐🐚🦀 für Wirbellose)`;

  try {
    const r = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });
    const d = await r.json();
    const txt = (d.content||[]).map(c=>c.text||"").join("").replace(/```json|```/g,"").trim();
    return JSON.parse(txt);
  } catch(e) {
    return null;
  }
}

// Foto → Base64
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(",")[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// ─── PHOTO RECOGNIZER COMPONENT ───────────────────────────────────────────────
function PhotoRecognizer({ onAdd, onClose }) {
  const [phase, setPhase] = useState("select"); // select | analyzing | results | confirm
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setPreview(URL.createObjectURL(file));
    setPhase("analyzing");
    setError(null);

    try {
      const base64 = await fileToBase64(file);
      const res = await recognizeAnimalPhoto(base64, file.type);
      if (!res || !res.kandidaten?.length) {
        setError("Tier konnte nicht erkannt werden. Bitte ein klareres Foto versuchen.");
        setPhase("select");
        return;
      }
      setResult(res);
      setSelected(res.kandidaten[0]);
      setPhase("results");
    } catch(e) {
      setError("Fehler bei der Analyse. Bitte erneut versuchen.");
      setPhase("select");
    }
  };

  const handleConfirm = () => {
    if (!selected) return;
    // Resize photo for storage (max 400px wide)
    const canvas = document.createElement("canvas");
    const img = new Image();
    img.onload = () => {
      const maxW = 400;
      const ratio = Math.min(1, maxW / img.width);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const photoData = canvas.toDataURL("image/jpeg", 0.7);
      onAdd({
        name: selected.wissenschaftlichName,
        type: selected.typ,
        group: selected.gruppe,
        emoji: selected.emoji,
        color: selected.color || "#00d4ff",
        care: selected.care || "★☆☆",
        note: selected.merkmale || "",
        count: 1,
        photo: photoData,
        ownNotes: "",
      });
      onClose();
    };
    img.src = preview;
  };

  const CONF_COLOR = (k) => k >= 85 ? "#00ffb3" : k >= 60 ? "#ffe600" : "#ff8c00";
  const CONF_LABEL = (k) => k >= 85 ? "Sehr sicher" : k >= 60 ? "Wahrscheinlich" : "Möglich";

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="popup-box" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="popup-header" style={{borderBottomColor:"rgba(0,212,255,0.2)"}}>
          <div className="popup-param-dot" style={{background:"#00d4ff"}}/>
          <div>
            <div className="popup-title" style={{color:"#00d4ff"}}>📸 Tier fotografieren</div>
            <div className="popup-subtitle">KI erkennt die Art automatisch</div>
          </div>
          <button className="popup-close" onClick={onClose}>✕</button>
        </div>

        {/* SELECT PHASE */}
        {phase === "select" && (
          <div className="recog-select">
            {error && (
              <div className="recog-error">{error}</div>
            )}

            {/* Foto Preview wenn vorhanden */}
            {preview && (
              <img src={preview} className="recog-preview" alt="Vorschau"/>
            )}

            {/* Kamera / Galerie Buttons */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{display:"none"}}
              onChange={e => handleFile(e.target.files[0])}
            />
            <input
              ref={e => { if(e) e.id="gallery-pick"; }}
              id="gallery-pick"
              type="file"
              accept="image/*"
              style={{display:"none"}}
              onChange={e => handleFile(e.target.files[0])}
            />

            <BigButton color="#00d4ff" onClick={() => fileRef.current.click()}>
              📷 Foto aufnehmen
            </BigButton>
            <button
              className="recog-gallery-btn"
              onClick={() => document.getElementById("gallery-pick").click()}
            >
              🖼 Aus Galerie wählen
            </button>

            <div className="recog-tip">
              💡 Tipp: Gut beleuchtetes, scharfes Foto direkt auf das Tier – je besser das Foto, desto genauer die Erkennung
            </div>
          </div>
        )}

        {/* ANALYZING PHASE */}
        {phase === "analyzing" && (
          <div className="recog-analyzing">
            {preview && <img src={preview} className="recog-preview" alt="Analyse"/>}
            <div className="recog-spinner-wrap">
              <Spin/>
              <div className="recog-analyzing-text">KI analysiert das Foto…</div>
              <div className="recog-analyzing-sub">Suche in Meerwasser-Datenbank</div>
            </div>
          </div>
        )}

        {/* RESULTS PHASE */}
        {phase === "results" && result && (
          <div className="recog-results">
            {preview && <img src={preview} className="recog-preview-small" alt="Erkannt"/>}

            {/* Bildqualität Warnung */}
            {result.bildqualitaet === "schlecht" && (
              <div className="recog-quality-warn">
                ⚠ Bildqualität niedrig – Ergebnis möglicherweise ungenau
              </div>
            )}

            {/* Sicher erkannt */}
            {result.sicher && result.kandidaten.length === 1 && (
              <div className="recog-sure-badge">✓ Sicher erkannt</div>
            )}

            {/* Mehrere Kandidaten */}
            {!result.sicher && (
              <div className="recog-unsure-label">
                Welches Tier ist das? Bitte auswählen:
              </div>
            )}

            {/* Kandidaten Liste */}
            <div className="recog-candidates">
              {result.kandidaten.map((k, i) => (
                <div
                  key={i}
                  className={`recog-candidate ${selected===k?"recog-candidate-selected":""}`}
                  style={selected===k?{borderColor:k.color||"#00d4ff",background:(k.color||"#00d4ff")+"15"}:{}}
                  onClick={() => setSelected(k)}
                >
                  <div className="recog-cand-top">
                    <span className="recog-cand-emoji">{k.emoji}</span>
                    <div className="recog-cand-names">
                      <div className="recog-cand-sci" style={{color:k.color||"#00d4ff"}}>{k.wissenschaftlichName}</div>
                      <div className="recog-cand-de">{k.deutscherName}</div>
                      <div className="recog-cand-typ">{k.typ} · {k.care}</div>
                    </div>
                    <div className="recog-cand-right">
                      <div className="recog-conf" style={{color:CONF_COLOR(k.konfidenz)}}>
                        {k.konfidenz}%
                      </div>
                      <div className="recog-conf-label" style={{color:CONF_COLOR(k.konfidenz)}}>
                        {CONF_LABEL(k.konfidenz)}
                      </div>
                      {selected===k && <div className="recog-check">✓</div>}
                    </div>
                  </div>
                  {k.merkmale && (
                    <div className="recog-cand-merkmale">🔍 {k.merkmale}</div>
                  )}
                  {/* Konfidenz-Balken */}
                  <div className="recog-conf-bar">
                    <div className="recog-conf-fill" style={{width:`${k.konfidenz}%`, background:CONF_COLOR(k.konfidenz)}}/>
                  </div>
                </div>
              ))}
            </div>

            {result.hinweis && (
              <div className="recog-hinweis">ℹ {result.hinweis}</div>
            )}

            {/* Anderes Foto */}
            <button className="recog-retry-btn" onClick={() => {setPhase("select");setResult(null);setSelected(null);}}>
              ↩ Anderes Foto verwenden
            </button>
          </div>
        )}

        {/* ACTION BUTTONS */}
        {phase === "results" && (
          <div className="popup-actions">
            <button className="popup-btn-cancel" onClick={onClose}>Abbrechen</button>
            <button
              className="popup-btn-save"
              style={{background: selected?.color || "#00d4ff", opacity: selected ? 1 : 0.4}}
              disabled={!selected}
              onClick={handleConfirm}
            >
              {selected?.emoji} Zum Besatz hinzufügen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── WASSEREMPFEHLUNG ────────────────────────────────────────────────────────
async function fetchWaterRecommendation(besatzList) {
  if (!besatzList.length) return null;
  const names = besatzList.map(b=>b.name).slice(0,8).join(", ");
  try {
    const r = await fetch("/api/claude", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        model:"claude-sonnet-4-20250514",
        max_tokens:1200,
        system:"Du bist ein Meerwasseraquaristik-Experte. Antworte ausschließlich mit validem JSON, ohne Markdown-Formatierung, ohne Erklärungen davor oder danach.",
        messages:[{
          role:"user",
          content:`Optimale Wasserwerte für ein Meerwasseraquarium mit diesem Besatz: ${names}

Gib ein JSON-Objekt zurück mit exakt dieser Struktur:
{
  "zusammenfassung": "Ein Satz zur Besatzkombination",
  "werte": [
    {"parameter": "Temperatur", "ideal": "24-26 °C", "hinweis": "Kurzer Hinweis"},
    {"parameter": "Salzgehalt", "ideal": "1.023-1.025", "hinweis": "Kurzer Hinweis"},
    {"parameter": "pH", "ideal": "8.1-8.3", "hinweis": "Kurzer Hinweis"},
    {"parameter": "KH", "ideal": "7-9 °dKH", "hinweis": "Kurzer Hinweis"},
    {"parameter": "Calcium", "ideal": "400-440 mg/L", "hinweis": "Kurzer Hinweis"},
    {"parameter": "Magnesium", "ideal": "1250-1350 mg/L", "hinweis": "Kurzer Hinweis"},
    {"parameter": "Nitrat", "ideal": "Wert", "hinweis": "Kurzer Hinweis"},
    {"parameter": "Phosphat", "ideal": "Wert", "hinweis": "Kurzer Hinweis"}
  ],
  "besonderheiten": "Wichtige Hinweise zur Haltung",
  "konflikte": ""
}`
        }]
      })
    });
    if (!r.ok) { console.error("API Error:", r.status); return null; }
    const d = await r.json();
    if (d.error) { console.error("API Error:", d.error); return null; }
    const txt = (d.content||[]).map(c=>c.text||"").join("").trim();
    // Extrahiere JSON - suche von erstem { bis letztem }
    const start = txt.indexOf("{");
    const end = txt.lastIndexOf("}");
    if (start === -1 || end === -1) { console.error("Kein JSON in Antwort:", txt.substring(0,200)); return null; }
    const jsonStr = txt.substring(start, end+1);
    const parsed = JSON.parse(jsonStr);
    if (!parsed.werte || !Array.isArray(parsed.werte) || parsed.werte.length < 3) {
      console.error("Ungültiges Format:", parsed); return null;
    }
    return parsed;
  } catch(e) { console.error("fetchWaterRec Fehler:", e); return null; }
}

function WaterRecommendation({ besatz, showInSettings=false }) {
  const [rec, setRec] = useState(() => load("waterRec", null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadRec = async () => {
    if (loading || !besatz.length) return;
    setLoading(true); setError(null);
    const r = await fetchWaterRecommendation(besatz);
    if (r && r.werte && r.werte.length > 0) {
      setRec(r);
      save("waterRec", r);
      setError(null);
    } else {
      setError("Empfehlung konnte nicht geladen werden – bitte erneut versuchen");
    }
    setLoading(false);
  };

  if (!besatz.length) return null;

  // In Einstellungen: nur die Werte-Tabelle als Referenz
  if (showInSettings) {
    if (!rec) return (
      <div className="water-rec-sett-empty">
        <span>Noch keine Empfehlung – im Besatz-Tab laden</span>
      </div>
    );
    return (
      <div className="water-rec-sett">
        <div className="water-rec-sett-title">💧 Empfehlung aus Besatz-Analyse</div>
        {rec.werte?.map((w,i) => (
          <div key={i} className="water-rec-sett-row">
            <span className="water-rec-sett-param">{w.parameter}</span>
            <span className="water-rec-sett-val">{w.ideal}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="water-rec-section">
      {/* Header */}
      <div className="water-rec-header">
        <div className="water-rec-title">💧 Wasserempfehlung für deinen Besatz</div>
        <div style={{display:"flex",gap:6}}>
          {rec && (
            <button className="water-rec-refresh" onClick={loadRec} disabled={loading} title="Neu berechnen">↻</button>
          )}
          <button className="water-rec-btn" onClick={loadRec} disabled={loading}>
            {loading ? <><Spin/>&nbsp;Lädt…</> : rec ? "Aktualisieren" : "Empfehlung laden"}
          </button>
        </div>
      </div>

      {/* Hint wenn noch keine */}
      {!rec && !loading && !error && (
        <div className="water-rec-hint">
          KI analysiert deine {besatz.length} Tiere und berechnet optimale Kompromisswerte
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="water-rec-error">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="water-rec-loading"><Spin/> <span>Analysiere {besatz.length} Tiere…</span></div>
      )}

      {/* Ergebnis */}
      {rec && !loading && (<>
        {rec.zusammenfassung && (
          <div className="water-rec-summary">{rec.zusammenfassung}</div>
        )}

        <div className="water-rec-grid">
          {rec.werte?.map((w,i) => (
            <div key={i} className="water-rec-item">
              <div className="water-rec-param">{w.parameter}</div>
              <div className="water-rec-ideal">{w.ideal}</div>
              {w.hinweis && <div className="water-rec-note">{w.hinweis}</div>}
            </div>
          ))}
        </div>

        {rec.besonderheiten && (
          <div className="water-rec-special">
            <span className="water-rec-special-icon">ℹ</span>
            <span>{rec.besonderheiten}</span>
          </div>
        )}
        {rec.konflikte && rec.konflikte.length > 3 && (
          <div className="water-rec-conflict">
            <span>⚠</span> <span>{rec.konflikte}</span>
          </div>
        )}
        <div className="water-rec-footer">Claude KI · ohne Gewähr · {besatz.length} Tiere analysiert</div>
      </>)}
    </div>
  );
}

function BesatzTab() {
  const [besatz, setBesatz] = useState(() => load("besatz", DEMO_BESATZ));
  const [detail, setDetail] = useState(null);
  const [activeGroup, setActiveGroup] = useState("all");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [form, setForm] = useState({name:"",type:"",care:"★☆☆",note:"",emoji:"🪸",color:"#00d4ff",group:"korallen"});

  const addAnimal = (animal) => {
    const u = [...besatz, {...animal, id:Date.now()}];
    setBesatz(u); save("besatz", u);
  };

  const add = () => {
    if(!form.name) return;
    addAnimal(form);
    setAdding(false);
    setForm({name:"",type:"",care:"★☆☆",note:"",emoji:"🪸",color:"#00d4ff",group:"korallen"});
  };
  const remove = (e, id) => {
    e.stopPropagation(); e.preventDefault();
    const u=besatz.filter(b=>b.id!==id); setBesatz(u); save("besatz",u);
  };

  const filtered = useMemo(() => besatz.filter(b => {
    const gOk = activeGroup==="all" || b.group===activeGroup;
    const sOk = !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.type?.toLowerCase().includes(search.toLowerCase());
    return gOk && sOk;
  }), [besatz, activeGroup, search]);

  const counts = BESATZ_GROUPS.reduce((a,g) => ({...a,[g.id]:besatz.filter(b=>b.group===g.id).length}), {});

  const updateAnimal = (id, changes) => {
    const u = besatz.map(b => b.id===id ? {...b,...changes} : b);
    setBesatz(u); save("besatz", u);
  };

  if (detail) return <SpeciesDetail animal={detail} onUpdate={(id,changes)=>{updateAnimal(id,changes);setDetail(d=>({...d,...changes}));}} onBack={() => setDetail(null)}/>;

  const visibleGroups = activeGroup==="all" ? BESATZ_GROUPS : BESATZ_GROUPS.filter(g=>g.id===activeGroup);

  return (
    <>
    <div className="tab-scroll">
      <div className="page-title">Besatz</div>

      {/* Group Filter Chips */}
      <div className="group-chips">
        <button className={`grp-chip ${activeGroup==="all"?"grp-active":""}`} onClick={()=>setActiveGroup("all")}>
          Alle <span className="grp-cnt">{besatz.length}</span>
        </button>
        {BESATZ_GROUPS.map(g=>(
          <button key={g.id} className={`grp-chip ${activeGroup===g.id?"grp-active":""}`} style={{"--gc":g.color}} onClick={()=>setActiveGroup(g.id)}>
            {g.icon} {g.label} <span className="grp-cnt">{counts[g.id]||0}</span>
          </button>
        ))}
      </div>

      <input className="search-inp" placeholder="🔍 Suchen…" value={search} onChange={e=>setSearch(e.target.value)}/>

      {/* Action Buttons */}
      <div className="besatz-action-row">
        <BigButton color="#00d4ff" onClick={() => setShowCamera(true)} className="flex1">
          📸 Tier fotografieren
        </BigButton>
        <button
          className={`besatz-manual-btn ${adding?"besatz-manual-active":""}`}
          onClick={() => setAdding(a=>!a)}
        >
          {adding ? "✕" : "+ Manuell"}
        </button>
      </div>

      {adding && (
        <Card>
          <div className="add-grid">
            <div className="add-field full"><label>Wissenschaftl. Name</label><input className="add-inp" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
            <div className="add-field"><label>Typ</label><input className="add-inp" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}/></div>
            <div className="add-field"><label>Gruppe</label>
              <select className="add-inp" value={form.group} onChange={e=>setForm(f=>({...f,group:e.target.value}))}>
                {BESATZ_GROUPS.map(g=><option key={g.id} value={g.id}>{g.icon} {g.label}</option>)}
              </select>
            </div>
            <div className="add-field"><label>Emoji</label><input className="add-inp" value={form.emoji} onChange={e=>setForm(f=>({...f,emoji:e.target.value}))}/></div>
            <div className="add-field"><label>Pflege</label>
              <select className="add-inp" value={form.care} onChange={e=>setForm(f=>({...f,care:e.target.value}))}>
                <option>★☆☆</option><option>★★☆</option><option>★★★</option>
              </select>
            </div>
            <div className="add-field full"><label>Notiz</label><input className="add-inp" value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/></div>
          </div>
          <BigButton color="#00ffb3" onClick={add}>Speichern</BigButton>
        </Card>
      )}

      {visibleGroups.map(group => {
        const items = filtered.filter(b => b.group === group.id);
        if (!items.length) return null;
        return (
          <div key={group.id}>
            <div className="group-header">
              <span style={{color:group.color,fontSize:18}}>{group.icon}</span>
              <span className="group-header-title" style={{color:group.color}}>{group.label}</span>
              <span className="group-header-cnt">{items.length}</span>
            </div>
            <div className="besatz-list">
              {items.map(b => (
                <div
                  key={b.id}
                  className="besatz-item-wrapper"
                  style={{"--ac": b.color}}
                  onClick={() => setDetail(b)}
                >
                  <div className="besatz-emoji-big">
                    {b.photo
                      ? <img src={b.photo} className="besatz-photo-thumb" alt={b.name}/>
                      : b.emoji
                    }
                  </div>
                  <div className="besatz-info">
                    <div className="besatz-name" style={{color:b.color}}>{b.name}</div>
                    <div className="besatz-type">{b.type} · {b.care}{b.count>1?` · ${b.count}×`:""}</div>
                    {b.note && <div className="besatz-note">{b.note}</div>}
                  </div>
                  <div className="besatz-right">
                    <span className="besatz-detail-btn">Details →</span>
                    <button
                      className="besatz-del-btn"
                      onClick={(e) => remove(e, b.id)}
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {!filtered.length && (
        <div className="empty-state"><div>🐠</div><p>Keine Tiere gefunden</p></div>
      )}

      {/* Wasserempfehlung */}
      <WaterRecommendation besatz={besatz}/>

    </div>

    {/* Photo Recognizer Popup */}
    {showCamera && (
      <PhotoRecognizer
        onAdd={addAnimal}
        onClose={() => setShowCamera(false)}
      />
    )}
    </>
  );
}

// ─── VERLAUF TAB ─────────────────────────────────────────────────────────────
function VerlaufTab({ params, measurements }) {
  const enabled = params.filter(p => p.enabled);
  const [active, setActive] = useState(enabled.map(p => p.id));
  const data = useMemo(() => measurements.map(m => ({ts:m.ts,...Object.fromEntries(enabled.map(p=>[p.id,m[p.id]??null]))})), [measurements, enabled]);
  const CTT = ({active:a,payload,label}) => {
    if(!a||!payload?.length) return null;
    return <div className="chart-tt"><div className="tt-date">{new Date(label).toLocaleDateString("de-DE")}</div>{payload.map(p=>p.value!=null&&<div key={p.dataKey} style={{color:p.color}}>{p.dataKey}: <b>{p.value}</b></div>)}</div>;
  };
  if (!data.length) return (
    <div className="tab-scroll"><div className="empty-state" style={{padding:"80px 20px"}}><div style={{fontSize:48,marginBottom:16}}>📈</div><p>Noch keine Messwerte</p></div></div>
  );
  return (
    <div className="tab-scroll">
      <div className="page-title">Verlauf</div>
      <div className="toggle-chips">
        {enabled.map(p => (
          <button key={p.id} className={`toggle-chip ${active.includes(p.id)?"toggle-active":""}`} style={{"--c":p.color}} onClick={()=>setActive(a=>a.includes(p.id)?a.filter(x=>x!==p.id):[...a,p.id])}>
            {p.label}
          </button>
        ))}
      </div>
      {enabled.filter(p => active.includes(p.id)).map(p => (
        <Card key={p.id}>
          <div className="chart-label" style={{color:p.color}}>{p.label} <span style={{color:"#4a6472"}}>({p.unit})</span></div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{top:8,right:8,left:-20,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
              <XAxis dataKey="ts" tickFormatter={v=>new Date(v).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})} stroke="#444" tick={{fontSize:10}}/>
              <YAxis domain={[p.min,p.max]} stroke="#444" tick={{fontSize:10}}/>
              <Tooltip content={<CTT/>}/>
              <ReferenceLine y={p.target} stroke={p.color} strokeDasharray="4 4" opacity={0.4}/>
              <Line type="monotone" dataKey={p.id} stroke={p.color} strokeWidth={2.5} dot={{r:3,fill:p.color}} connectNulls/>
            </LineChart>
          </ResponsiveContainer>
        </Card>
      ))}
    </div>
  );
}

// ─── SALIFERT LOOKUP TABLE EDITOR ────────────────────────────────────────────
function SalifertEditor({ param, updateParam }) {
  const table = param.salifert || [];
  const [newMl, setNewMl] = useState("");
  const [newVal, setNewVal] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const sorted = [...table].sort((a, b) => a.ml - b.ml);

  const addRow = () => {
    const ml = parseFloat(newMl), value = parseFloat(newVal);
    if (isNaN(ml) || isNaN(value)) return;
    const existing = table.filter(r => r.ml !== ml);
    updateParam("salifert", [...existing, { ml: +ml.toFixed(4), value: +value.toFixed(4) }].sort((a,b)=>a.ml-b.ml));
    setNewMl(""); setNewVal("");
  };

  const deleteRow = (ml) => {
    updateParam("salifert", table.filter(r => r.ml !== ml));
  };

  const importBulk = () => {
    // Erkennt Zeilen wie: "0.40   9.3" oder "0,40;9,3" oder "0.40 → 9.3"
    const lines = bulkText.split("\n").filter(l => l.trim());
    const rows = [];
    for (const line of lines) {
      const nums = line.replace(/,/g, ".").match(/[\d.]+/g);
      if (nums && nums.length >= 2) {
        const ml = parseFloat(nums[0]), value = parseFloat(nums[1]);
        if (!isNaN(ml) && !isNaN(value)) rows.push({ ml: +ml.toFixed(4), value: +value.toFixed(4) });
      }
    }
    if (rows.length > 0) {
      updateParam("salifert", rows.sort((a,b)=>a.ml-b.ml));
      setBulkText(""); setShowBulk(false);
    }
  };

  return (
    <Card>
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8}}>
        <SectionTitle color={param.color}>💉 Salifert Test-Tabelle</SectionTitle>
        <span style={{fontSize:11, color:"#4a7080"}}>{sorted.length} Einträge</span>
      </div>
      <div className="sett-hint">ml-Stand der Spritze → Messwert in {param.unit}. Im Messung-Tab wird automatisch interpoliert.</div>

      {/* Bulk Import Toggle */}
      <button
        className="salifert-bulk-btn"
        style={{borderColor: param.color+"44", color: param.color}}
        onClick={() => setShowBulk(s => !s)}
      >
        {showBulk ? "✕ Abbrechen" : "📋 Tabelle einfügen (aus Bild/PDF kopieren)"}
      </button>

      {showBulk && (
        <div className="salifert-bulk-area">
          <div className="sett-hint" style={{marginBottom:6}}>
            Einfach die Zeilen aus der Tabelle kopieren und hier einfügen.<br/>
            Format: <code>0.40  9.3</code> (Tab, Leerzeichen oder Semikolon als Trenner)
          </div>
          <textarea
            className="sett-inp icp-ta"
            rows={8}
            placeholder={"0.00\t15.7\n0.02\t15.3\n0.04\t15.0\n..."}
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
          />
          <BigButton color={param.color} onClick={importBulk}>
            Tabelle importieren ({bulkText.split("\n").filter(l=>l.trim()).length} Zeilen)
          </BigButton>
        </div>
      )}

      {/* Einzelne Zeile hinzufügen */}
      <div className="salifert-add-row">
        <div className="sett-field" style={{flex:1}}>
          <label>ml-Stand</label>
          <input className="sett-inp" type="number" step="0.02" placeholder="0.40" value={newMl} onChange={e=>setNewMl(e.target.value)}/>
        </div>
        <div className="salifert-add-arrow">→</div>
        <div className="sett-field" style={{flex:1}}>
          <label>Wert ({param.unit})</label>
          <input className="sett-inp" type="number" step="0.1" placeholder="9.3" value={newVal} onChange={e=>setNewVal(e.target.value)}/>
        </div>
        <button className="salifert-add-btn" style={{background:param.color}} onClick={addRow}>+</button>
      </div>

      {/* Tabelle anzeigen */}
      {sorted.length > 0 && (
        <div className="salifert-table-wrap">
          <div className="salifert-table-header">
            <span>ml-Stand</span>
            <span></span>
            <span>{param.unit}</span>
            <span></span>
          </div>
          <div className="salifert-table-body">
            {sorted.map((r, i) => (
              <div key={r.ml} className="salifert-table-row" style={i%2===0?{background:"rgba(0,0,0,0.15)"}:{}}>
                <span className="salf-ml">{r.ml.toFixed(2)} ml</span>
                <span className="salf-arrow" style={{color:param.color}}>→</span>
                <span className="salf-val" style={{color:param.color}}>{r.value} {param.unit}</span>
                <button className="salf-del" onClick={()=>deleteRow(r.ml)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 && (
        <div style={{textAlign:"center", padding:"16px 0", color:"#4a7080", fontSize:13}}>
          Noch keine Einträge – Tabelle importieren oder einzeln hinzufügen
        </div>
      )}
    </Card>
  );
}

// ─── EINSTELLUNGEN TAB ────────────────────────────────────────────────────────
function EinstellungenTab({ params, setParams, settings, setSettings, besatz }) {
  const [selectedParam, setSelectedParam] = useState(params[0]?.id || null);
  const [settingsSection, setSettingsSection] = useState("system");
  const [localSettings, setLocalSettings] = useState({...settings});
  const [haEntities, setHaEntities] = useState(settings.haEntities || []);
  const [saveMsg, setSaveMsg] = useState("");

  const param = params.find(p => p.id === selectedParam);

  const updateParam = (field, value) => {
    const updated = params.map(p => p.id === selectedParam ? {...p, [field]: value} : p);
    setParams(updated); save("params", updated);
  };

  const addParam = () => {
    const id = `P${Date.now()}`;
    const newParam = { id, label:"Neu", unit:"mg/L", target:0, mlPer100L:1, pump:1, color:"#00d4ff", maxDayMl:100, maxDoseMl:10, stdDayMl:0, min:0, max:100, enabled:true, doseFrom:6, doseTo:22 };
    const updated = [...params, newParam];
    setParams(updated); save("params", updated); setSelectedParam(id);
  };

  const deleteParam = () => {
    if (!confirm(`${param.label} wirklich löschen?`)) return;
    const updated = params.filter(p => p.id !== selectedParam);
    setParams(updated); save("params", updated);
    setSelectedParam(updated[0]?.id || null);
  };

  const saveSystemSettings = () => {
    const s = {...localSettings, haEntities};
    setSettings(s); save("settings", s);
    setSaveMsg("✓ Gespeichert"); setTimeout(() => setSaveMsg(""), 2000);
  };

  const COLORS = ["#00d4ff","#00ffb3","#a78bfa","#ff8c00","#ffe600","#ff6b9d","#ff4444","#4ade80"];
  const hours = Array.from({length:24}, (_,i) => i);

  return (
    <div className="tab-scroll">
      <div className="page-title">Einstellungen</div>

      {/* Section Toggle */}
      <div className="settings-section-toggle">
        <button className={`sst-btn ${settingsSection==="system"?"sst-active":""}`} onClick={()=>setSettingsSection("system")}>⚙ System</button>
        <button className={`sst-btn ${settingsSection==="params"?"sst-active":""}`} onClick={()=>setSettingsSection("params")}>⬡ Parameter</button>
        <button className={`sst-btn ${settingsSection==="ha"?"sst-active":""}`} onClick={()=>setSettingsSection("ha")}>🏠 HA</button>
      </div>

      {/* ── SYSTEM ── */}
      {settingsSection === "system" && (
        <>
          <Card>
            <SectionTitle>ESP32 Pumpensteuerung</SectionTitle>
            <div className="sett-field"><label>IP-Adresse</label><input className="sett-inp" value={localSettings.espIp} onChange={e=>setLocalSettings(l=>({...l,espIp:e.target.value}))} placeholder="192.168.1.100"/></div>
            <div className="sett-field"><label>Beckenvolumen (Liter)</label><input className="sett-inp" type="number" value={localSettings.tankVolume} onChange={e=>setLocalSettings(l=>({...l,tankVolume:+e.target.value}))}/></div>
            <div className="sett-field">
              <label>Pumpengeschwindigkeit (ml/ms)</label>
              <input className="sett-inp" type="number" step="0.00001" value={localSettings.mlPerMs} onChange={e=>setLocalSettings(l=>({...l,mlPerMs:+e.target.value}))}/>
              <span className="sett-hint">z.B. 0.01667 ≈ 1 ml/s</span>
            </div>
          </Card>
          <BigButton color="#00d4ff" onClick={saveSystemSettings}>{saveMsg || "Einstellungen speichern"}</BigButton>
        </>
      )}

      {/* ── PARAMETER ── */}
      {settingsSection === "params" && (
        <>
          {/* Wasserempfehlung als Referenz */}
          {besatz?.length > 0 && (
            <WaterRecommendation besatz={besatz} showInSettings={true}/>
          )}

          {/* Dropdown Selector */}
          <Card>
            <SectionTitle>Parameter auswählen</SectionTitle>
            <select className="sett-inp" value={selectedParam||""} onChange={e=>setSelectedParam(e.target.value)}>
              {params.map(p => <option key={p.id} value={p.id}>{p.enabled?"✓":"○"} {p.label} ({p.unit})</option>)}
            </select>
          </Card>

          {param && (
            <>
              <Card>
                <SectionTitle color={param.color}>Grundeinstellungen – {param.label}</SectionTitle>
                <div className="sett-field">
                  <label>Aktiv</label>
                  <div className="toggle-row-sett">
                    <label className="switch">
                      <input type="checkbox" checked={param.enabled} onChange={e=>updateParam("enabled",e.target.checked)}/>
                      <span className="sw-slider"/>
                    </label>
                    <span>{param.enabled?"Aktiv":"Deaktiviert"}</span>
                  </div>
                </div>
                <div className="sett-field"><label>Bezeichnung</label><input className="sett-inp" value={param.label} onChange={e=>updateParam("label",e.target.value)}/></div>
                <div className="sett-field"><label>Einheit</label><input className="sett-inp" value={param.unit} onChange={e=>updateParam("unit",e.target.value)}/></div>
                <div className="sett-field"><label>Zielwert</label><input className="sett-inp" type="number" value={param.target} onChange={e=>updateParam("target",+e.target.value)}/></div>
                <div className="sett-field"><label>Pumpe (1–6)</label><input className="sett-inp" type="number" min="1" max="6" value={param.pump} onChange={e=>updateParam("pump",+e.target.value)}/></div>
                <div className="sett-field">
                  <label>Farbe</label>
                  <div className="color-swatches">
                    {COLORS.map(c => <button key={c} className={`swatch ${param.color===c?"swatch-on":""}`} style={{background:c}} onClick={()=>updateParam("color",c)}/>)}
                  </div>
                </div>
                <div className="sett-field"><label>Skala min</label><input className="sett-inp" type="number" value={param.min} onChange={e=>updateParam("min",+e.target.value)}/></div>
                <div className="sett-field"><label>Skala max</label><input className="sett-inp" type="number" value={param.max} onChange={e=>updateParam("max",+e.target.value)}/></div>
              </Card>

              <Card>
                <SectionTitle color={param.color}>Produktfaktor</SectionTitle>
                <div className="sett-field">
                  <label>ml Produkt pro 100L um 1 {param.unit} zu erhöhen</label>
                  <input className="sett-inp" type="number" step="0.01" value={param.mlPer100L} onChange={e=>updateParam("mlPer100L",+e.target.value)}/>
                  <span className="sett-hint">Steht auf dem Produktetikett · z.B. KH = 17.8</span>
                </div>
              </Card>

              <Card>
                <SectionTitle color={param.color}>Dosierplan-Limits</SectionTitle>
                <div className="sett-field"><label>Max. Tagesdosis (ml)</label><input className="sett-inp" type="number" value={param.maxDayMl} onChange={e=>updateParam("maxDayMl",+e.target.value)}/></div>
                <div className="sett-field"><label>Max. pro Vorgang (ml)</label><input className="sett-inp" type="number" value={param.maxDoseMl} onChange={e=>updateParam("maxDoseMl",+e.target.value)}/></div>
                <div className="sett-field">
                  <label>Standard-Tagesdosis (ml)</label>
                  <input className="sett-inp" type="number" value={param.stdDayMl} onChange={e=>updateParam("stdDayMl",+e.target.value)}/>
                  <span className="sett-hint">Feste Basisdosierung täglich · 0 = deaktiviert</span>
                </div>
              </Card>

              <Card>
                <SectionTitle color={param.color}>🎯 Zielbereiche & Toleranz</SectionTitle>
                <div className="sett-hint" style={{marginBottom:12}}>
                  Legt fest wann ✓ OK, △ Grenzwertig oder ✗ Korrigieren angezeigt wird
                </div>

                {/* Visual range preview */}
                <div className="tol-preview" style={{"--pc": param.color}}>
                  <div className="tol-zone tol-err-low"  style={{flex: (param.tolWarnLow??0)  - param.min}}/>
                  <div className="tol-zone tol-warn-low" style={{flex: (param.tolOkLow??param.target)  - (param.tolWarnLow??0)}}/>
                  <div className="tol-zone tol-ok"       style={{flex: (param.tolOkHigh??param.target) - (param.tolOkLow??param.target)}}/>
                  <div className="tol-zone tol-warn-high"style={{flex: (param.tolWarnHigh??param.max)  - (param.tolOkHigh??param.target)}}/>
                  <div className="tol-zone tol-err-high" style={{flex: param.max - (param.tolWarnHigh??param.max)}}/>
                </div>
                <div className="tol-labels">
                  <span style={{color:"#ff4444"}}>✗ Zu niedrig</span>
                  <span style={{color:"#ffe600"}}>△ Warn</span>
                  <span style={{color:param.color}}>✓ OK</span>
                  <span style={{color:"#ffe600"}}>△ Warn</span>
                  <span style={{color:"#ff4444"}}>✗ Zu hoch</span>
                </div>

                <div className="tol-grid">
                  <div className="tol-section">
                    <div className="tol-section-label" style={{color:"#00ffb3"}}>✓ OK-Bereich</div>
                    <div className="tol-row">
                      <div className="sett-field">
                        <label>von ({param.unit})</label>
                        <input className="sett-inp tol-inp" type="number" step="0.1"
                          value={param.tolOkLow ?? ""} placeholder="z.B. 7.5"
                          onChange={e=>updateParam("tolOkLow", +e.target.value)}/>
                      </div>
                      <div className="tol-to">–</div>
                      <div className="sett-field">
                        <label>bis ({param.unit})</label>
                        <input className="sett-inp tol-inp" type="number" step="0.1"
                          value={param.tolOkHigh ?? ""} placeholder="z.B. 8.5"
                          onChange={e=>updateParam("tolOkHigh", +e.target.value)}/>
                      </div>
                    </div>
                  </div>
                  <div className="tol-section">
                    <div className="tol-section-label" style={{color:"#ffe600"}}>△ Grenzwertig</div>
                    <div className="tol-row">
                      <div className="sett-field">
                        <label>von ({param.unit})</label>
                        <input className="sett-inp tol-inp" type="number" step="0.1"
                          value={param.tolWarnLow ?? ""} placeholder="z.B. 7.0"
                          onChange={e=>updateParam("tolWarnLow", +e.target.value)}/>
                      </div>
                      <div className="tol-to">–</div>
                      <div className="sett-field">
                        <label>bis ({param.unit})</label>
                        <input className="sett-inp tol-inp" type="number" step="0.1"
                          value={param.tolWarnHigh ?? ""} placeholder="z.B. 9.0"
                          onChange={e=>updateParam("tolWarnHigh", +e.target.value)}/>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="sett-hint">Alles außerhalb der Grenzwertig-Zone = ✗ Korrigieren</div>
              </Card>

              <Card>
                <SectionTitle color={param.color}>🕐 Dosierzeitfenster</SectionTitle>
                <div className="sett-hint" style={{marginBottom:12}}>Außerhalb dieser Zeiten werden keine Dosierungen eingeplant</div>
                <div className="time-window-row">
                  <div className="sett-field" style={{flex:1}}>
                    <label>Von (Uhr)</label>
                    <select className="sett-inp" value={param.doseFrom} onChange={e=>updateParam("doseFrom",+e.target.value)}>
                      {hours.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
                    </select>
                  </div>
                  <div className="time-sep">bis</div>
                  <div className="sett-field" style={{flex:1}}>
                    <label>Bis (Uhr)</label>
                    <select className="sett-inp" value={param.doseTo} onChange={e=>updateParam("doseTo",+e.target.value)}>
                      {hours.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
                    </select>
                  </div>
                </div>
                <div className="time-preview" style={{borderColor:param.color+"44",color:param.color}}>
                  {param.label} dosiert von {String(param.doseFrom).padStart(2,"0")}:00 bis {String(param.doseTo).padStart(2,"0")}:00 Uhr
                  {param.id==="Mg" || (param.doseTo <= param.doseFrom && param.doseTo > 0) ? " (über Mitternacht)" : ""}
                </div>
              </Card>

              {/* ── SALIFERT LOOKUP TABLE ── */}
              <SalifertEditor param={param} updateParam={updateParam}/>

              <div style={{display:"flex",gap:12}}>
                <BigButton color="#ff4444" onClick={deleteParam} className="flex1">Parameter löschen</BigButton>
              </div>
            </>
          )}

          <BigButton color="#00ffb3" onClick={addParam}>+ Parameter hinzufügen</BigButton>
        </>
      )}

      {/* ── HOME ASSISTANT ── */}
      {settingsSection === "ha" && (
        <>
          <Card>
            <SectionTitle>Verbindung</SectionTitle>
            <div className="sett-field"><label>HA URL</label><input className="sett-inp" value={localSettings.haUrl} onChange={e=>setLocalSettings(l=>({...l,haUrl:e.target.value}))} placeholder="http://homeassistant.local:8123"/></div>
            <div className="sett-field">
              <label>Access Token</label>
              <input className="sett-inp" type="password" value={localSettings.haToken} onChange={e=>setLocalSettings(l=>({...l,haToken:e.target.value}))} placeholder="eyJ…"/>
              <span className="sett-hint">HA → Profil → Sicherheit → Langlebige Zugriffstoken</span>
            </div>
            <div className="sett-field"><label>Temperatur-Entität</label><input className="sett-inp" value={localSettings.haTempEntity} onChange={e=>setLocalSettings(l=>({...l,haTempEntity:e.target.value}))} placeholder="sensor.aquarium_temperature"/></div>
          </Card>
          <Card>
            <SectionTitle>Entitäten</SectionTitle>
            {haEntities.map((e,i) => (
              <div key={e.id} className="ha-ent-editor-row">
                <div className="sett-field"><label>Entity ID</label><input className="sett-inp" value={e.entity} onChange={ev=>setHaEntities(l=>l.map((x,j)=>j===i?{...x,entity:ev.target.value}:x))} placeholder="switch.pumpe_1"/></div>
                <div className="ha-ent-mini-row">
                  <div className="sett-field" style={{flex:1}}><label>Label</label><input className="sett-inp" value={e.label} onChange={ev=>setHaEntities(l=>l.map((x,j)=>j===i?{...x,label:ev.target.value}:x))}/></div>
                  <div className="sett-field" style={{width:64}}><label>Icon</label><input className="sett-inp" value={e.icon} onChange={ev=>setHaEntities(l=>l.map((x,j)=>j===i?{...x,icon:ev.target.value}:x))}/></div>
                  <button className="del-ent-btn" onClick={()=>setHaEntities(l=>l.filter((_,j)=>j!==i))}>✕</button>
                </div>
              </div>
            ))}
            <BigButton color="#4a6472" onClick={()=>setHaEntities(l=>[...l,{id:`e${Date.now()}`,entity:"",label:"Neu",icon:"💡",type:"switch"}])}>+ Entität hinzufügen</BigButton>
          </Card>
          <BigButton color="#00d4ff" onClick={saveSystemSettings}>{saveMsg || "Einstellungen speichern"}</BigButton>
        </>
      )}
    </div>
  );
}

// ─── ICP TAB (in Einstellungen integrierbar, eigener Reiter) ─────────────────
function IcpTab({ addLog }) {
  const [entries, setEntries] = useState(() => load("icp", []));
  const [text, setText] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const add = () => {
    if(!text.trim()) return;
    const e={id:Date.now(),date,text:text.trim()};
    const u=[e,...entries]; setEntries(u); save("icp",u); addLog(`ICP: ${date}`); setText("");
  };
  return (
    <div className="tab-scroll">
      <div className="page-title">ICP-Archiv</div>
      <Card>
        <input type="date" className="sett-inp" value={date} onChange={e=>setDate(e.target.value)}/>
        <textarea className="sett-inp icp-ta" placeholder="Laborwerte einfügen…" value={text} onChange={e=>setText(e.target.value)} rows={6}/>
        <BigButton color="#00d4ff" onClick={add}>Eintrag speichern</BigButton>
      </Card>
      {entries.map(e=>(
        <Card key={e.id}>
          <div className="icp-date">{new Date(e.date).toLocaleDateString("de-DE",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
          <pre className="icp-txt">{e.text}</pre>
        </Card>
      ))}
      {!entries.length && <div className="empty-state"><div>🧪</div><p>Noch keine Einträge</p></div>}
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
const TABS = [
  { id:"messung",    label:"Messung",       icon:"📊" },
  { id:"dosierung",  label:"Dosierung",     icon:"💊" },
  { id:"smarthome",  label:"Smart Home",    icon:"🏠" },
  { id:"besatz",     label:"Besatz",        icon:"🪸" },
  { id:"verlauf",    label:"Verlauf",       icon:"📈" },
  { id:"settings",   label:"Einstellungen", icon:"⚙️" },
];

export default function App() {
  const [tab, setTab] = useState("messung");
  const [params, setParams] = useState(() => load("params", DEFAULT_PARAMS));
  const [settings, setSettings] = useState(() => load("settings", DEFAULT_SETTINGS));
  const [measurements, setMeasurements] = useState(() => load("measurements", []));
  const [logs, setLogs] = useState(() => load("logs", []));
  const [todayDosed, setTodayDosed] = useState(() => {
    const s = load("todayDosed", {});
    return s?.date === new Date().toDateString() ? (s.data||{}) : {};
  });

  const addLog = useCallback((msg) => {
    setLogs(l => { const u = [...l, {ts:Date.now(),msg}].slice(-500); save("logs",u); return u; });
  }, []);

  const TAB_TITLES = {
    messung:"📊 Messung", dosierung:"💊 Dosierung", smarthome:"🏠 Smart Home",
    besatz:"🪸 Besatz", verlauf:"📈 Verlauf", settings:"⚙️ Einstellungen"
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className="app-top-bar">
          <div className="app-top-title">{TAB_TITLES[tab]}</div>
        </div>
        <div className="content-area">
          {tab==="messung"    && <MessungTab params={params} settings={settings} measurements={measurements} setMeasurements={setMeasurements} addLog={addLog}/>}
          {tab==="dosierung"  && <DosierungTab params={params} settings={settings} measurements={measurements} todayDosed={todayDosed} setTodayDosed={setTodayDosed} addLog={addLog}/>}
          {tab==="smarthome"  && <SmartHomeTab settings={settings}/>}
          {tab==="besatz"     && <BesatzTab/>}
          {tab==="verlauf"    && <VerlaufTab params={params} measurements={measurements}/>}
          {tab==="settings"   && <EinstellungenTab params={params} setParams={setParams} settings={settings} setSettings={setSettings} besatz={load("besatz", DEMO_BESATZ)}/>}
        </div>
        <nav className="tab-bar">
          {TABS.map(t => (
            <button key={t.id} className={`tab-item ${tab===t.id?"tab-active":""}`} onClick={() => setTab(t.id)}>
              <span className="tab-icon-big">{t.icon}</span>
              <span className="tab-label-big">{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#030d12;--surface:#0a1e28;--card:#0d2535;--border:rgba(0,212,255,0.1);
  --text:#d0eaf5;--muted:#4a7080;--cyan:#00d4ff;--green:#00ffb3;--red:#ff4444;--yellow:#ffe600;--orange:#ff8c00;
  --fm:'Space Mono',monospace;--fb:'DM Sans',sans-serif;--r:16px;
}
body{background:var(--bg);color:var(--text);font-family:var(--fb);-webkit-tap-highlight-color:transparent;}

.app{height:100vh;display:flex;flex-direction:column;overflow:hidden;background:var(--bg);}
.app-top-bar{flex-shrink:0;background:#040f17;border-bottom:2px solid rgba(0,212,255,0.22);padding:14px 18px 12px;padding-top:calc(14px + env(safe-area-inset-top,0px));}
.app-top-title{font-family:var(--fm);font-size:20px;font-weight:700;color:var(--text);}
.content-area{flex:1;overflow:hidden;min-height:0;}
.tab-scroll{height:100%;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;-webkit-overflow-scrolling:touch;}
.tab-scroll::-webkit-scrollbar{display:none;}
.page-title{display:none;}

/* ── TAB BAR – absolut feste Höhe ── */
.tab-bar{
  flex:0 0 auto;
  display:flex;
  background:#040f17;
  border-top:2px solid rgba(0,212,255,0.22);
  min-height:64px;
  max-height:64px;
  height:64px;
  padding-bottom:env(safe-area-inset-bottom,0px);
  overflow-x:auto;
  overflow-y:hidden;
}
.tab-bar::-webkit-scrollbar{display:none;}
.tab-item{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:3px;background:none;border:none;cursor:pointer;
  padding:4px 2px;
  flex:1;min-width:48px;flex-shrink:0;
  min-height:0;max-height:64px;
}
.tab-item:active{background:rgba(0,212,255,0.1);}
.tab-active{background:rgba(0,212,255,0.12)!important;border-top:2px solid var(--cyan);}
.tab-icon-big{font-size:20px;line-height:1;flex-shrink:0;}
.tab-label-big{font-size:9px;font-weight:700;color:#7a9aaa;white-space:nowrap;font-family:var(--fb);line-height:1;flex-shrink:0;}
.tab-active .tab-label-big{color:var(--cyan)!important;}

/* ── CARDS ── */
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:16px;display:flex;flex-direction:column;gap:12px;}
.section-title{font-family:var(--fm);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--cyan);margin-bottom:2px;}

/* ── BIG BUTTON ── */
.big-btn{width:100%;padding:16px;border-radius:14px;border:none;cursor:pointer;font-family:var(--fm);font-size:14px;font-weight:700;color:#000;background:var(--bc,var(--cyan));transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px;}
.big-btn:active:not(:disabled){transform:scale(0.97);}
.big-btn:disabled{opacity:.4;cursor:not-allowed;}
.flex1{flex:1;}

/* ── MESSUNG TAP CARDS ── */
.meas-tap-card{background:var(--card);border:2px solid rgba(255,255,255,0.08);border-radius:18px;padding:18px;cursor:pointer;display:flex;flex-direction:column;gap:12px;transition:all .2s;position:relative;-webkit-tap-highlight-color:rgba(0,212,255,0.08);}
.meas-tap-card:active{transform:scale(0.98);}
.meas-saved{border-color:var(--pc,var(--cyan))!important;}
.meas-tap-top{display:flex;align-items:center;gap:8px;}
.meas-tap-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.meas-tap-name{font-family:var(--fm);font-size:17px;font-weight:700;flex:1;}
.meas-tap-unit{font-size:12px;color:var(--muted);}
.meas-tap-chevron{font-size:18px;color:var(--muted);margin-left:4px;}
.meas-tap-vals{display:flex;gap:16px;flex-wrap:wrap;}
.meas-tap-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;}
.meas-tap-val{font-family:var(--fm);font-size:22px;font-weight:700;}
.meas-tap-vunit{font-size:11px;color:var(--muted);font-weight:400;}
.meas-tap-bar{position:relative;height:5px;background:rgba(255,255,255,.06);border-radius:3px;}
.meas-tap-bar-fill{height:100%;border-radius:3px;opacity:.8;transition:width .5s;}
.meas-tap-bar-target{position:absolute;top:-4px;width:2px;height:13px;background:rgba(255,255,255,.35);border-radius:1px;transform:translateX(-50%);}
.meas-saved-badge{position:absolute;top:14px;right:14px;font-family:var(--fm);font-size:12px;font-weight:700;}

/* ── PILLS ── */
.pill{font-size:10px;padding:3px 9px;border-radius:20px;font-family:var(--fm);font-weight:700;}
.pill-ok{background:rgba(0,255,179,.12);color:#00ffb3;border:1px solid rgba(0,255,179,.2);}
.pill-warn{background:rgba(255,230,0,.1);color:#ffe600;border:1px solid rgba(255,230,0,.2);}
.pill-err{background:rgba(255,68,68,.1);color:#ff4444;border:1px solid rgba(255,68,68,.2);}

/* ── MEASUREMENT POPUP ── */
.popup-overlay{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.78);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;}
.popup-box{background:#0a1e28;border:1px solid rgba(0,212,255,0.2);border-radius:24px 24px 0 0;width:100%;max-width:600px;max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;padding-bottom:calc(24px + env(safe-area-inset-bottom,0px));animation:slideUp .25s ease;}
@keyframes slideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
.popup-header{display:flex;align-items:center;gap:12px;padding:20px 20px 16px;border-bottom:1px solid;position:sticky;top:0;background:#0a1e28;z-index:1;}
.popup-param-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;}
.popup-title{font-family:var(--fm);font-size:20px;font-weight:700;}
.popup-subtitle{font-size:12px;color:var(--muted);margin-top:2px;}
.popup-close{background:rgba(255,255,255,.08);border:none;color:var(--text);width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:16px;margin-left:auto;flex-shrink:0;}
.popup-last{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:rgba(0,0,0,.2);}
.popup-last-label{font-size:12px;color:var(--muted);}
.popup-last-val{font-family:var(--fm);font-size:18px;font-weight:700;}
.popup-mode-toggle{display:flex;gap:8px;padding:14px 20px 6px;}
.popup-mode-btn{flex:1;padding:12px;border-radius:12px;border:1.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,.05);color:#8ab0c0;font-family:var(--fm);font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;}
.popup-mode-active{border-color:var(--mc,var(--cyan))!important;color:var(--mc,var(--cyan))!important;background:color-mix(in srgb,var(--mc,var(--cyan)) 15%,transparent)!important;}
.popup-input-section{padding:14px 20px;display:flex;flex-direction:column;gap:10px;}
.popup-input-label{font-size:13px;color:var(--muted);}
.popup-input-row{display:flex;align-items:center;gap:10px;}
.popup-input{flex:1;background:rgba(0,0,0,.5);border:2px solid rgba(0,212,255,.25);border-radius:14px;color:var(--text);padding:16px 18px;font-family:var(--fm);font-size:26px;font-weight:700;outline:none;transition:border-color .2s;}
.popup-input:focus{border-color:var(--ac,var(--cyan));}
.popup-input-unit{font-family:var(--fm);font-size:16px;color:var(--muted);flex-shrink:0;}
.popup-lookup-row{display:flex;gap:6px;flex-wrap:wrap;}
.popup-lookup-chip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px 12px;font-family:var(--fm);font-size:11px;color:var(--muted);cursor:pointer;transition:all .2s;}
.popup-lookup-chip:active{transform:scale(0.95);}
.popup-lookup-exact{font-weight:700;}
.popup-result{margin:8px 20px;border-radius:14px;border:1px solid;padding:16px;display:flex;flex-direction:column;gap:12px;}
.popup-result-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.popup-result-val{font-family:var(--fm);font-size:32px;font-weight:700;}
.popup-result-unit{font-size:14px;}
.popup-status-pill{padding:7px 14px;border-radius:20px;font-family:var(--fm);font-size:12px;font-weight:700;flex-shrink:0;}
.ps-ok{background:rgba(0,255,179,.12);color:#00ffb3;border:1px solid rgba(0,255,179,.25);}
.ps-warn{background:rgba(255,230,0,.1);color:#ffe600;border:1px solid rgba(255,230,0,.2);}
.ps-err{background:rgba(255,68,68,.1);color:#ff4444;border:1px solid rgba(255,68,68,.2);}
.popup-analysis{display:flex;flex-direction:column;gap:8px;}
.popup-analysis-ok{font-size:13px;color:#00ffb3;padding:10px 12px;background:rgba(0,255,179,.08);border-radius:10px;}
.popup-analysis-box{background:rgba(0,0,0,.3);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px;}
.popup-analysis-high{border:1px solid rgba(255,68,68,.2);}
.popup-analysis-title{font-family:var(--fm);font-size:12px;font-weight:700;margin-bottom:4px;}
.popup-analysis-line{font-size:13px;}
.popup-analysis-warn{font-size:12px;color:#ff8c00;margin-top:4px;}
.popup-actions{display:flex;gap:10px;padding:16px 20px 0;}
.popup-btn-cancel{flex:1;padding:15px;border-radius:14px;border:1.5px solid rgba(255,255,255,.15);background:none;color:var(--text);font-family:var(--fm);font-size:14px;font-weight:700;cursor:pointer;}
.popup-btn-save{flex:2;padding:15px;border-radius:14px;border:none;color:#000;font-family:var(--fm);font-size:14px;font-weight:700;cursor:pointer;}
.popup-btn-save:active{transform:scale(0.97);}
.popup-btn-save:disabled{cursor:not-allowed;filter:brightness(0.5);}

/* DOSIERUNG */
.param-chip-row{display:flex;gap:10px;padding:4px 0 8px;overflow-x:auto;}
.param-chip-row::-webkit-scrollbar{display:none;}
.param-chip{
  background:rgba(255,255,255,0.08);
  border:2px solid rgba(255,255,255,0.25);
  border-radius:14px;
  padding:12px 20px;
  font-family:var(--fm);
  font-size:14px;
  font-weight:700;
  cursor:pointer;
  transition:all .2s;
  display:flex;align-items:center;gap:8px;
  flex-shrink:0;
  color:#b0ccd8;
  letter-spacing:0.02em;
}
.param-chip:hover{color:#fff;border-color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.12);}
.param-chip-active{
  border-color:var(--c,var(--cyan))!important;
  color:var(--c,var(--cyan))!important;
  background:color-mix(in srgb,var(--c,var(--cyan)) 18%,transparent)!important;
  box-shadow:0 0 12px color-mix(in srgb,var(--c,var(--cyan)) 30%,transparent);
}
.pc-badge{background:var(--c,var(--cyan));color:#000;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;}
.pc-time-block{font-size:16px;}
.dos-card-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;}
.dos-param-name{font-family:var(--fm);font-size:16px;font-weight:700;}
.dos-time-badge{font-family:var(--fm);font-size:11px;color:var(--muted);background:rgba(0,0,0,.3);padding:4px 10px;border-radius:20px;display:flex;align-items:center;gap:4px;}
.dos-blocked{color:#ff4444;font-weight:700;}
.dos-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}
.dos-stat{background:rgba(0,0,0,.3);border-radius:10px;padding:10px 12px;}
.dos-stat-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;}
.dos-stat-val{font-family:var(--fm);font-size:16px;font-weight:700;}
.dos-day-bar-track{height:4px;background:rgba(255,255,255,.06);border-radius:2px;}
.dos-day-bar-fill{height:100%;border-radius:2px;opacity:.8;transition:width .5s;}
.step-list{display:flex;flex-direction:column;gap:6px;margin-top:4px;}
.step-list-title{font-family:var(--fm);font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px;}
.step-row{display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(0,0,0,.25);border-radius:10px;border:1px solid rgba(255,255,255,.04);flex-wrap:wrap;}
.step-row.done{opacity:.5;}
.step-row.step-current{border-color:var(--cyan);background:rgba(0,212,255,.05);}
.step-row.step-past{opacity:.4;}
.step-row.paused{border-color:rgba(255,230,0,.3);}
.step-time{font-family:var(--fm);font-size:13px;font-weight:700;min-width:50px;display:flex;align-items:center;gap:5px;}
.step-now{font-size:9px;background:var(--cyan);color:#000;border-radius:4px;padding:1px 5px;font-weight:700;}
.step-ml{font-family:var(--fm);font-size:15px;font-weight:700;}
.step-unit{font-size:10px;color:var(--muted);}
.step-ml-wrap{min-width:52px;}
.step-dur{font-size:10px;color:var(--muted);font-family:var(--fm);min-width:30px;}
.step-badge{font-size:10px;padding:2px 8px;border-radius:20px;font-family:var(--fm);font-weight:700;}
.step-done{background:rgba(0,255,179,.1);color:#00ffb3;}
.step-paused{background:rgba(255,230,0,.1);color:#ffe600;}
.step-error{background:rgba(255,68,68,.1);color:#ff4444;}
.step-actions{display:flex;gap:4px;margin-left:auto;}
.step-btn{background:none;border:1px solid var(--border);border-radius:7px;color:var(--muted);cursor:pointer;padding:5px 9px;font-size:11px;transition:all .2s;}
.step-run{background:color-mix(in srgb,var(--c,#00d4ff) 15%,transparent);border-color:color-mix(in srgb,var(--c,#00d4ff) 40%,transparent);color:var(--c,#00d4ff);font-family:var(--fm);font-weight:700;}
.step-run:disabled{opacity:.4;cursor:not-allowed;}
.step-edit:hover{color:#ffe600;border-color:#ffe600;}
.step-pause:hover{color:#ffe600;border-color:#ffe600;}
.step-del:hover{color:#ff4444;border-color:#ff4444;}
.step-total{font-size:11px;color:var(--muted);font-family:var(--fm);text-align:center;padding:6px 0;}

/* SMART HOME */
.ha-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px 0;text-align:center;}
.ha-empty-icon{font-size:44px;opacity:.4;}
.ha-empty-title{font-size:16px;font-weight:600;}
.ha-empty-sub{font-size:13px;color:var(--muted);}
.ha-status-bar{display:flex;align-items:center;gap:8px;}
.ha-conn-dot{width:10px;height:10px;border-radius:50%;}
.ha-online{background:#00ffb3;box-shadow:0 0 6px #00ffb3;}
.ha-offline{background:#ff4444;}
.ha-pending{background:var(--muted);}
.ha-conn-label{font-family:var(--fm);font-size:12px;}
.ha-temp-big{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);}
.ha-temp-icon{font-size:28px;}
.ha-temp-number{font-family:var(--fm);font-size:36px;font-weight:700;}
.ha-temp-unit{font-size:16px;color:var(--muted);align-self:flex-end;margin-bottom:4px;}
.ha-temp-label{font-size:12px;color:var(--muted);align-self:flex-end;margin-bottom:4px;}
.feeding-card{} .feeding-top{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.feeding-title{font-size:16px;font-weight:600;margin-bottom:4px;}
.feeding-sub{font-size:12px;color:var(--muted);}
.feeding-countdown{font-family:var(--fm);font-size:26px;font-weight:700;color:#ffaa00;}
.ha-entity-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
.ha-entity-card{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;text-align:center;}
.ha-on{background:rgba(0,255,179,.07);border-color:rgba(0,255,179,.2);}
.ha-entity-icon{font-size:26px;}
.ha-entity-name{font-size:12px;font-weight:500;line-height:1.3;}
.ha-entity-state{font-family:var(--fm);font-size:10px;color:var(--muted);}
.ha-toggle-btn{background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--muted);border-radius:20px;padding:6px 16px;font-family:var(--fm);font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;min-width:60px;}
.ha-toggle-on{background:rgba(0,255,179,.15);border-color:rgba(0,255,179,.4);color:#00ffb3;}
.ha-toggle-btn:disabled{opacity:.4;cursor:not-allowed;}

/* BESATZ */
.search-inp{width:100%;background:rgba(0,0,0,.4);border:1.5px solid rgba(255,255,255,0.2);border-radius:12px;color:var(--text);padding:13px 16px;font-family:var(--fb);font-size:14px;outline:none;}
.search-inp:focus{border-color:var(--cyan);}
.group-chips{display:flex;gap:6px;flex-wrap:wrap;padding:4px 0 4px;}
.grp-chip{
  background:rgba(255,255,255,0.08);
  border:2px solid rgba(255,255,255,0.22);
  border-radius:10px;
  padding:8px 10px;
  font-size:11px;
  font-family:var(--fm);
  font-weight:700;
  cursor:pointer;
  transition:all .2s;
  display:flex;align-items:center;gap:4px;
  flex:1;
  min-width:0;
  justify-content:center;
  color:#b0ccd8;
  white-space:nowrap;
}
.grp-chip:active{transform:scale(0.96);}
.grp-active{
  border-color:var(--gc,var(--cyan))!important;
  color:var(--gc,var(--cyan))!important;
  background:color-mix(in srgb,var(--gc,var(--cyan)) 18%,transparent)!important;
}
.grp-cnt{background:rgba(255,255,255,0.12);border-radius:8px;padding:1px 5px;font-size:9px;}
.group-header{display:flex;align-items:center;gap:10px;padding:10px 2px 8px;}
.group-header-title{font-family:var(--fm);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;flex:1;}
.group-header-cnt{font-family:var(--fm);font-size:12px;color:var(--muted);background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:10px;}
.besatz-list{display:flex;flex-direction:column;gap:10px;margin-bottom:8px;}
.besatz-item-wrapper{display:flex;align-items:center;gap:14px;background:var(--card);border:1.5px solid var(--border);border-radius:16px;padding:14px 16px;cursor:pointer;transition:border-color .2s,transform .15s;-webkit-tap-highlight-color:rgba(0,212,255,0.1);}
.besatz-item-wrapper:hover{border-color:var(--ac,var(--cyan));transform:translateY(-1px);}
.besatz-item-wrapper:active{transform:scale(0.99);border-color:var(--ac,var(--cyan));}
.besatz-emoji-big{font-size:36px;flex-shrink:0;line-height:1;}
.besatz-info{flex:1;min-width:0;}
.besatz-name{font-family:var(--fm);font-size:13px;font-weight:700;font-style:italic;margin-bottom:3px;line-height:1.3;}
.besatz-type{font-size:12px;color:var(--muted);margin-bottom:3px;}
.besatz-note{font-size:11px;color:var(--muted);line-height:1.4;}
.besatz-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;}
.besatz-detail-btn{font-family:var(--fm);font-size:12px;color:var(--cyan);white-space:nowrap;}
.besatz-del-btn{background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.3);border-radius:8px;color:#ff4444;cursor:pointer;padding:5px 10px;font-size:12px;font-weight:700;transition:all .2s;}
.besatz-del-btn:hover{background:rgba(255,68,68,0.25);}
.add-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.add-field{display:flex;flex-direction:column;gap:4px;} .add-field label{font-size:11px;color:var(--muted);}
.full{grid-column:span 2;}
.add-inp{background:rgba(0,0,0,.4);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px 12px;font-family:var(--fm);font-size:13px;width:100%;outline:none;}

/* DETAIL */
.detail-hero{display:flex;align-items:center;gap:16px;padding:18px;background:linear-gradient(135deg,color-mix(in srgb,var(--ac,#00d4ff) 8%,transparent),transparent);border:1px solid color-mix(in srgb,var(--ac,#00d4ff) 18%,transparent);border-radius:var(--r);}
.detail-emoji{font-size:56px;}
.detail-sci{font-family:var(--fm);font-size:16px;font-weight:700;font-style:italic;margin-bottom:3px;line-height:1.3;}
.detail-type-line{font-size:12px;color:var(--muted);margin-bottom:3px;}
.detail-note{font-size:11px;color:var(--muted);}
.back-btn{background:none;border:none;color:var(--cyan);cursor:pointer;font-family:var(--fm);font-size:13px;padding:0;align-self:flex-start;}
.loading-row{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--muted);}
.info-row{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04);align-items:baseline;}
.info-row:last-child{border-bottom:none;}
.info-lbl{font-size:10px;color:var(--muted);min-width:120px;flex-shrink:0;font-family:var(--fm);}
.info-val{font-size:13px;line-height:1.5;}
.wert-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:8px;}
.wert-tile{background:rgba(0,0,0,.28);border-radius:10px;padding:10px;display:flex;flex-direction:column;align-items:center;gap:3px;}
.wert-ic{font-size:18px;}.wert-lb{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;}
.wert-vl{font-family:var(--fm);font-size:12px;font-weight:700;text-align:center;line-height:1.3;}
.diff-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04);}
.diff-pill{font-family:var(--fm);font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;}
.lexikon-wrap{display:flex;flex-direction:column;gap:6px;}
.lexikon-note{font-size:10px;color:var(--muted);text-align:center;font-style:italic;}
.lexikon-link{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.16);border-radius:12px;color:var(--cyan);font-size:13px;text-decoration:none;transition:all .2s;}
.lexikon-link:hover{background:rgba(0,212,255,.1);}

/* VERLAUF */
.toggle-chips{display:flex;gap:10px;flex-wrap:wrap;padding:4px 0 4px;}
.toggle-chip{
  padding:12px 20px;
  border-radius:14px;
  font-family:var(--fm);font-size:13px;font-weight:700;
  cursor:pointer;
  border:2px solid rgba(255,255,255,0.25);
  background:rgba(255,255,255,0.08);
  color:#b0ccd8;
  transition:all .2s;
}
.toggle-chip:hover{color:#fff;border-color:rgba(255,255,255,0.45);}
.toggle-chip.toggle-active{
  border-color:var(--c,var(--cyan));
  color:var(--c,var(--cyan));
  background:color-mix(in srgb,var(--c,var(--cyan)) 18%,transparent);
  box-shadow:0 0 12px color-mix(in srgb,var(--c,var(--cyan)) 30%,transparent);
}
.chart-label{font-family:var(--fm);font-size:11px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;}
.chart-tt{background:rgba(5,20,30,.96);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-family:var(--fm);font-size:11px;}
.tt-date{color:var(--muted);font-size:10px;margin-bottom:3px;}

/* SETTINGS */
.settings-section-toggle{display:flex;gap:0;background:rgba(0,0,0,0.4);border:1.5px solid rgba(255,255,255,0.12);border-radius:12px;padding:4px;flex-shrink:0;}
.sst-btn{flex:1;padding:11px 4px;background:none;border:none;color:#6a8898;font-family:var(--fm);font-size:11px;font-weight:700;cursor:pointer;border-radius:8px;transition:all .2s;white-space:nowrap;}
.sst-btn:hover{color:var(--text);}
.sst-active{background:rgba(0,212,255,0.18)!important;color:var(--cyan)!important;}
.sett-field{display:flex;flex-direction:column;gap:5px;}
.sett-field label{font-size:12px;color:var(--muted);}
.sett-inp{background:rgba(0,0,0,.4);border:1.5px solid var(--border);border-radius:10px;color:var(--text);padding:12px 14px;font-family:var(--fm);font-size:13px;width:100%;outline:none;transition:border-color .2s;}
.sett-inp:focus{border-color:var(--cyan);}
.sett-hint{font-size:11px;color:var(--muted);font-style:italic;}
.icp-ta{resize:vertical;font-size:12px;line-height:1.6;}
.icp-date{font-family:var(--fm);font-size:10px;color:var(--cyan);text-transform:uppercase;letter-spacing:.05em;}
.icp-txt{font-family:var(--fm);font-size:12px;white-space:pre-wrap;line-height:1.6;}
.color-swatches{display:flex;gap:6px;flex-wrap:wrap;}
.swatch{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;transition:transform .15s;}
.swatch:hover{transform:scale(1.2);}
.swatch-on{border-color:#fff;transform:scale(1.15);}
.time-window-row{display:flex;align-items:flex-end;gap:12px;}
.time-sep{font-family:var(--fm);font-size:12px;color:var(--muted);padding-bottom:12px;flex-shrink:0;}
.time-preview{padding:12px 14px;border-radius:10px;border:1px solid;font-family:var(--fm);font-size:12px;text-align:center;}
.toggle-row-sett{display:flex;align-items:center;gap:10px;font-size:13px;}
.switch{position:relative;display:inline-block;width:44px;height:26px;}
.switch input{opacity:0;width:0;height:0;}
.sw-slider{position:absolute;cursor:pointer;inset:0;background:rgba(255,255,255,.1);border-radius:13px;transition:.3s;border:1px solid var(--border);}
.sw-slider:before{content:"";position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:var(--muted);border-radius:50%;transition:.3s;}
input:checked + .sw-slider{background:rgba(0,212,255,.3);border-color:var(--cyan);}
input:checked + .sw-slider:before{transform:translateX(18px);background:var(--cyan);}
.ha-ent-editor-row{display:flex;flex-direction:column;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--border);}
.ha-ent-editor-row:last-of-type{border-bottom:none;}
.ha-ent-mini-row{display:flex;gap:8px;align-items:flex-end;}
.del-ent-btn{background:none;border:1px solid var(--border);border-radius:8px;color:var(--muted);cursor:pointer;padding:8px;font-size:14px;align-self:flex-end;}
.del-ent-btn:hover{color:#ff4444;border-color:#ff4444;}

.tol-preview{display:flex;height:20px;border-radius:10px;overflow:hidden;margin-bottom:8px;}
.tol-zone{min-width:4px;}
.tol-err-low,.tol-err-high{background:rgba(255,68,68,0.35);}
.tol-warn-low,.tol-warn-high{background:rgba(255,230,0,0.35);}
.tol-ok{background:rgba(0,255,179,0.45);}
.tol-labels{display:flex;justify-content:space-between;font-size:10px;font-family:var(--fm);margin-bottom:14px;}
.tol-grid{display:flex;flex-direction:column;gap:14px;}
.tol-section{display:flex;flex-direction:column;gap:8px;}
.tol-section-label{font-family:var(--fm);font-size:11px;font-weight:700;}
.tol-row{display:flex;align-items:flex-end;gap:8px;}
.tol-row .sett-field{flex:1;}
.tol-to{font-family:var(--fm);font-size:16px;color:var(--muted);padding-bottom:10px;flex-shrink:0;}
.tol-inp{font-size:15px!important;padding:10px 12px!important;}

/* FOTO-ERKENNUNG */
.besatz-action-row{display:flex;gap:10px;align-items:stretch;}
.besatz-manual-btn{background:rgba(255,255,255,0.07);border:2px solid rgba(255,255,255,0.18);border-radius:14px;color:#b0ccd8;font-family:var(--fm);font-size:13px;font-weight:700;padding:0 18px;cursor:pointer;transition:all .2s;white-space:nowrap;flex-shrink:0;}
.besatz-manual-active{border-color:var(--red)!important;color:var(--red)!important;}
.recog-select{display:flex;flex-direction:column;gap:12px;padding:16px 20px;}
.recog-error{background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.25);border-radius:12px;padding:12px;font-size:13px;color:#ff4444;text-align:center;}
.recog-preview{width:100%;max-height:220px;object-fit:cover;border-radius:14px;border:1px solid var(--border);}
.recog-preview-small{width:calc(100% - 40px);max-height:140px;object-fit:cover;border-radius:12px;border:1px solid var(--border);margin:0 20px;}
.recog-gallery-btn{width:100%;padding:14px;border-radius:14px;border:2px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.05);color:#b0ccd8;font-family:var(--fm);font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;}
.recog-tip{font-size:12px;color:var(--muted);text-align:center;line-height:1.6;padding:4px 8px;}
.recog-analyzing{display:flex;flex-direction:column;gap:16px;padding:16px 20px;align-items:center;}
.recog-spinner-wrap{display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px;}
.recog-analyzing-text{font-family:var(--fm);font-size:15px;font-weight:700;color:var(--cyan);}
.recog-analyzing-sub{font-size:12px;color:var(--muted);}
.recog-results{display:flex;flex-direction:column;gap:10px;padding:12px 20px;}
.recog-sure-badge{background:rgba(0,255,179,0.12);border:1px solid rgba(0,255,179,0.25);border-radius:20px;padding:6px 16px;font-family:var(--fm);font-size:12px;font-weight:700;color:#00ffb3;text-align:center;}
.recog-unsure-label{font-family:var(--fm);font-size:13px;font-weight:700;color:var(--text);text-align:center;padding:4px 0;}
.recog-quality-warn{background:rgba(255,140,0,0.1);border:1px solid rgba(255,140,0,0.25);border-radius:10px;padding:10px;font-size:12px;color:#ff8c00;text-align:center;}
.recog-hinweis{font-size:12px;color:var(--muted);text-align:center;padding:4px 0;font-style:italic;}
.recog-candidates{display:flex;flex-direction:column;gap:10px;}
.recog-candidate{background:rgba(0,0,0,0.25);border:2px solid rgba(255,255,255,0.1);border-radius:16px;padding:14px;cursor:pointer;transition:all .2s;}
.recog-candidate:active{transform:scale(0.98);}
.recog-cand-top{display:flex;align-items:center;gap:12px;margin-bottom:8px;}
.recog-cand-emoji{font-size:36px;flex-shrink:0;line-height:1;}
.recog-cand-names{flex:1;min-width:0;}
.recog-cand-sci{font-family:var(--fm);font-size:13px;font-weight:700;font-style:italic;margin-bottom:2px;}
.recog-cand-de{font-size:12px;color:var(--text);margin-bottom:2px;}
.recog-cand-typ{font-size:11px;color:var(--muted);}
.recog-cand-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;}
.recog-conf{font-family:var(--fm);font-size:20px;font-weight:700;}
.recog-conf-label{font-size:10px;font-family:var(--fm);}
.recog-check{font-size:16px;color:#00ffb3;font-weight:700;}
.recog-cand-merkmale{font-size:11px;color:var(--muted);line-height:1.4;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);margin-top:4px;}
.recog-conf-bar{height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:8px;}
.recog-conf-fill{height:100%;border-radius:2px;transition:width .5s;}
.recog-retry-btn{background:none;border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:var(--muted);font-family:var(--fm);font-size:12px;padding:10px;cursor:pointer;width:100%;}

/* ICP CHECKBOX */
.popup-icp-row{padding:0 20px 4px;display:flex;flex-direction:column;gap:10px;}
.popup-icp-label{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;cursor:pointer;padding:12px 14px;background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.15);border-radius:12px;}
.popup-icp-check{width:20px;height:20px;accent-color:var(--cyan);cursor:pointer;flex-shrink:0;}
.popup-icp-date{display:flex;flex-direction:column;gap:6px;}
.popup-icp-date-label{font-size:11px;color:var(--muted);}

/* WASSEREMPFEHLUNG */
.water-rec-section{background:rgba(0,0,0,0.2);border:1px solid rgba(0,212,255,0.12);border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:12px;margin-top:4px;}
.water-rec-header{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.water-rec-title{font-family:var(--fm);font-size:12px;font-weight:700;color:var(--cyan);}
.water-rec-btn{background:rgba(0,212,255,0.12);border:1px solid rgba(0,212,255,0.3);border-radius:20px;color:var(--cyan);font-family:var(--fm);font-size:11px;font-weight:700;padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .2s;}
.water-rec-btn:hover{background:rgba(0,212,255,0.2);}
.water-rec-btn:disabled{opacity:.5;cursor:not-allowed;}
.water-rec-refresh{background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:20px;color:var(--muted);font-size:14px;padding:5px 12px;cursor:pointer;}
.water-rec-hint{font-size:12px;color:var(--muted);line-height:1.6;}
.water-rec-loading{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted);}
.water-rec-summary{font-size:13px;color:var(--text);line-height:1.6;padding:10px 12px;background:rgba(0,212,255,0.06);border-radius:10px;border-left:3px solid var(--cyan);}
.water-rec-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}
.water-rec-item{background:rgba(0,0,0,0.25);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:3px;}
.water-rec-param{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-family:var(--fm);}
.water-rec-ideal{font-family:var(--fm);font-size:13px;font-weight:700;color:var(--cyan);}
.water-rec-note{font-size:10px;color:var(--muted);line-height:1.4;margin-top:2px;}
.water-rec-special{font-size:12px;color:var(--text);line-height:1.6;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:10px;display:flex;gap:8px;}
.water-rec-special-icon{flex-shrink:0;color:var(--cyan);}
.water-rec-conflict{font-size:12px;color:#ff8c00;line-height:1.6;padding:10px 12px;background:rgba(255,140,0,0.08);border-radius:10px;border:1px solid rgba(255,140,0,0.2);display:flex;gap:8px;}
.water-rec-footer{font-size:10px;color:var(--muted);text-align:center;font-style:italic;}

.water-rec-error{background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.2);border-radius:10px;padding:10px;font-size:12px;color:#ff4444;text-align:center;}
.water-rec-sett-empty{font-size:12px;color:var(--muted);font-style:italic;padding:8px 0;}
.water-rec-sett{display:flex;flex-direction:column;gap:6px;}
.water-rec-sett-title{font-family:var(--fm);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--cyan);margin-bottom:4px;}
.water-rec-sett-row{display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid rgba(0,212,255,0.08);}
.water-rec-sett-param{font-size:12px;color:var(--muted);}
.water-rec-sett-val{font-family:var(--fm);font-size:13px;font-weight:700;color:var(--cyan);}

.besatz-photo-thumb{width:44px;height:44px;border-radius:10px;object-fit:cover;border:1px solid var(--border);}
.detail-photo-wrap{flex-shrink:0;}
.detail-photo{width:80px;height:80px;border-radius:14px;object-fit:cover;border:2px solid color-mix(in srgb,var(--ac,#00d4ff) 30%,transparent);}
.detail-count-badge{font-family:var(--fm);font-size:11px;color:var(--muted);margin-top:4px;}
.detail-edit-btn{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:50%;width:36px;height:36px;color:var(--text);font-size:16px;cursor:pointer;flex-shrink:0;align-self:flex-start;}

.step-list-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.step-list-title{font-family:var(--fm);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
.step-add-btn{background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.3);border-radius:8px;color:var(--cyan);font-family:var(--fm);font-size:11px;font-weight:700;padding:5px 11px;cursor:pointer;}
.step-add-form{display:flex;gap:6px;align-items:center;padding:8px;background:rgba(0,0,0,0.2);border-radius:10px;margin-bottom:6px;flex-wrap:wrap;}
.step-add-inp{background:rgba(0,0,0,0.4);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 10px;font-family:var(--fm);font-size:13px;outline:none;flex:1;min-width:80px;}
.step-add-ok{background:var(--green);border:none;border-radius:8px;color:#000;width:36px;height:36px;font-size:16px;cursor:pointer;font-weight:700;flex-shrink:0;}
.step-add-cancel{background:rgba(255,68,68,0.15);border:1px solid rgba(255,68,68,0.3);border-radius:8px;color:#ff4444;width:36px;height:36px;font-size:16px;cursor:pointer;flex-shrink:0;}
.step-done-row{opacity:0.5;}
.step-paused-row{border-color:rgba(255,230,0,0.3)!important;}
.step-edit-inline{display:flex;align-items:center;gap:4px;min-width:80px;}
.step-edit-inp{background:rgba(0,212,255,0.1);border:1px solid var(--cyan);border-radius:6px;color:var(--cyan);padding:4px 8px;font-family:var(--fm);font-size:15px;font-weight:700;width:70px;outline:none;}

/* PHOTO UPLOAD */
.photo-edit-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.photo-edit-preview{width:60px;height:60px;border-radius:10px;object-fit:cover;border:1px solid var(--border);}
.photo-upload-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.3);border-radius:10px;color:var(--cyan);font-family:var(--fm);font-size:12px;font-weight:700;padding:9px 14px;cursor:pointer;transition:all .2s;}
.photo-upload-btn:hover{background:rgba(0,212,255,0.18);}
.photo-remove-btn{background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.25);border-radius:8px;color:#ff4444;font-size:11px;padding:6px 10px;cursor:pointer;}

/* SPINNER */
.spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.15);border-top-color:currentColor;border-radius:50%;animation:spin .6s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.empty-state{text-align:center;padding:48px 20px;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:12px;}
.empty-state div{font-size:44px;opacity:.5;}
.empty-state p{font-size:14px;}
::-webkit-scrollbar{width:0;height:0;}

/* SALIFERT – Messung */
.mode-toggle{display:flex;gap:8px;background:rgba(0,0,0,.3);border-radius:12px;padding:4px;}
.mode-btn{flex:1;padding:9px 12px;border-radius:9px;border:none;background:none;color:var(--muted);font-family:var(--fm);font-size:11px;cursor:pointer;transition:all .2s;font-weight:700;}
.mode-active{background:color-mix(in srgb,var(--mc,var(--cyan)) 20%,transparent);color:var(--mc,var(--cyan));border:1px solid color-mix(in srgb,var(--mc,var(--cyan)) 40%,transparent);}
.salifert-box{display:flex;flex-direction:column;gap:10px;}
.salifert-label{font-size:12px;color:var(--muted);font-family:var(--fm);}
.salifert-input-row{display:flex;align-items:center;gap:10px;}
.salifert-ml-input{flex:1;}
.salifert-unit-label{font-family:var(--fm);font-size:14px;color:var(--muted);flex-shrink:0;}
.salifert-result{border-radius:12px;padding:14px 16px;border:1px solid;display:flex;flex-direction:column;gap:4px;}
.salifert-result-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;}
.salifert-result-val{font-family:var(--fm);font-size:28px;font-weight:700;}
.salifert-result-unit{font-size:14px;}
.salifert-result-sub{font-size:12px;opacity:.7;}
.salifert-neighbors{display:flex;flex-direction:column;gap:4px;}
.salifert-neighbor{display:flex;gap:10px;align-items:center;padding:5px 10px;border-radius:7px;border:1px solid var(--border);font-family:var(--fm);font-size:11px;color:var(--muted);justify-content:space-between;}
.salifert-neighbor-exact{font-weight:700;}

/* SALIFERT – Einstellungen */
.salifert-bulk-btn{width:100%;padding:12px;border-radius:10px;border:1px dashed;background:none;font-family:var(--fm);font-size:12px;cursor:pointer;transition:all .2s;}
.salifert-bulk-area{display:flex;flex-direction:column;gap:8px;background:rgba(0,0,0,.2);border-radius:10px;padding:12px;}
.salifert-bulk-area code{font-family:var(--fm);background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;font-size:11px;}
.salifert-add-row{display:flex;align-items:flex-end;gap:8px;}
.salifert-add-arrow{font-family:var(--fm);color:var(--muted);font-size:16px;padding-bottom:10px;flex-shrink:0;}
.salifert-add-btn{width:42px;height:42px;border-radius:10px;border:none;color:#000;font-size:20px;font-weight:700;cursor:pointer;flex-shrink:0;align-self:flex-end;}
.salifert-table-wrap{border:1px solid var(--border);border-radius:10px;overflow:hidden;max-height:320px;overflow-y:auto;}
.salifert-table-header{display:grid;grid-template-columns:1fr 20px 1fr 30px;gap:8px;padding:8px 12px;background:rgba(0,0,0,.3);font-size:10px;color:var(--muted);font-family:var(--fm);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);}
.salifert-table-body{display:flex;flex-direction:column;}
.salifert-table-row{display:grid;grid-template-columns:1fr 20px 1fr 30px;gap:8px;padding:7px 12px;align-items:center;border-bottom:1px solid rgba(255,255,255,.03);}
.salifert-table-row:last-child{border-bottom:none;}
.salf-ml{font-family:var(--fm);font-size:12px;}.salf-arrow{font-size:12px;text-align:center;}
.salf-val{font-family:var(--fm);font-size:12px;font-weight:700;}
.salf-del{background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;opacity:.3;padding:2px 4px;}
.salf-del:hover{color:var(--red);opacity:1;}
.dot-empty{background:var(--muted);}
`;
