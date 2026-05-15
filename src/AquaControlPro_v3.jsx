import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || "";
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function supabaseAuth(path, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method:"POST", headers:{"Content-Type":"application/json","apikey":SUPABASE_ANON},
    body: JSON.stringify(body),
  });
  return r.json();
}

async function dbCall(action, table, data=null, filter=null, jwt=null) {
  try {
    const r = await fetch("/.netlify/functions/db", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({action,table,data,filter,jwt}),
    });
    return r.json();
  } catch(e) { return {error:e.message}; }
}

async function claudeCall(messages, system=null, maxTokens=1200) {
  try {
    const body = {model:"claude-sonnet-4-6", max_tokens:maxTokens, messages};
    if (system) body.system = system;
    const r = await fetch("/.netlify/functions/claude", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body),
    });
    const d = await r.json();
    return (d.content||[]).map(c=>c.text||"").join("");
  } catch(e) { return null; }
}

// ─── LOCAL STORAGE ────────────────────────────────────────────────────────────
const ls = {
  get:(k,fb)=>{ try{return JSON.parse(localStorage.getItem(k))??fb;}catch{return fb;} },
  set:(k,v)=>localStorage.setItem(k,JSON.stringify(v)),
  del:(k)=>localStorage.removeItem(k),
};

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────
const DEFAULT_PARAMS = [
  { id:"KH", label:"KH", unit:"°dKH", target:8.0, mlPer100L:17.8, pump:1, color:"#00d4ff",
    maxDayMl:100, maxDoseMl:10, stdDayMl:0, min:6, max:10, enabled:true, doseFrom:6, doseTo:22,
    tolOkLow:7.5, tolOkHigh:8.5, tolWarnLow:7.0, tolWarnHigh:9.0,
    salifert:[{ml:0.00,value:15.7},{ml:0.10,value:14.1},{ml:0.20,value:12.5},{ml:0.30,value:10.9},
              {ml:0.40,value:9.3},{ml:0.50,value:7.7},{ml:0.60,value:6.1},{ml:0.70,value:4.5},
              {ml:0.80,value:2.9},{ml:0.90,value:1.2},{ml:0.98,value:0.0}] },
  { id:"Ca", label:"Calcium", unit:"mg/L", target:420, mlPer100L:5.88, pump:2, color:"#00ffb3",
    maxDayMl:200, maxDoseMl:20, stdDayMl:50, min:380, max:460, enabled:true, doseFrom:7, doseTo:21,
    tolOkLow:400, tolOkHigh:440, tolWarnLow:380, tolWarnHigh:460, salifert:[] },
  { id:"Mg", label:"Magnesium", unit:"mg/L", target:1300, mlPer100L:8.33, pump:3, color:"#a78bfa",
    maxDayMl:300, maxDoseMl:30, stdDayMl:0, min:1200, max:1400, enabled:true, doseFrom:8, doseTo:20,
    tolOkLow:1250, tolOkHigh:1350, tolWarnLow:1200, tolWarnHigh:1400, salifert:[] },
];

const BESATZ_GROUPS = [
  {id:"fische",     label:"Fische",     icon:"🐠", color:"#ff8c00"},
  {id:"korallen",   label:"Korallen",   icon:"🪸", color:"#00d4ff"},
  {id:"wirbellose", label:"Wirbellose", icon:"🦐", color:"#00ffb3"},
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getStatus(p,v) {
  if(v==null) return null;
  const okL=p.tolOkLow??p.target*.95, okH=p.tolOkHigh??p.target*1.05;
  const wL=p.tolWarnLow??p.target*.90, wH=p.tolWarnHigh??p.target*1.10;
  if(v>=okL&&v<=okH) return "ok";
  if(v>=wL&&v<=wH)   return "warn";
  return "err";
}

function calcCorr(p, cur, vol) {
  const d=p.target-cur; if(d<=0) return 0;
  return +((d*(vol/100)*p.mlPer100L).toFixed(2));
}

function interpolate(table, mlInput) {
  if(!table?.length) return null;
  const s=[...table].sort((a,b)=>a.ml-b.ml);
  const ml=parseFloat(mlInput); if(isNaN(ml)) return null;
  if(ml<=s[0].ml) return s[0].value;
  if(ml>=s[s.length-1].ml) return s[s.length-1].value;
  for(let i=0;i<s.length-1;i++){
    const lo=s[i],hi=s[i+1];
    if(ml>=lo.ml&&ml<=hi.ml){
      const t=(ml-lo.ml)/(hi.ml-lo.ml);
      return +(lo.value+t*(hi.value-lo.value)).toFixed(2);
    }
  }
  return null;
}

// ─── BASE UI ──────────────────────────────────────────────────────────────────
const Spin = ()=><div className="spinner"/>;
const Card = ({children,className=""})=><div className={`card ${className}`}>{children}</div>;
const Sect = ({children,color})=><div className="sect-title" style={color?{color}:{}}>{children}</div>;

function Btn({children,onClick,color,disabled,ghost,className=""}) {
  return (
    <button className={`btn ${ghost?"btn-ghost":""} ${className}`}
      style={color&&!ghost?{"--bc":color}:{}} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthScreen({onLogin}) {
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [name,setName]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [msg,setMsg]=useState(null);

  const submit = async()=>{
    if(!email||!pass){setError("Email und Passwort eingeben");return;}
    setLoading(true);setError(null);setMsg(null);
    if(mode==="login"){
      const r=await supabaseAuth("token?grant_type=password",{email,password:pass});
      if(r.access_token){ls.set("session",r);onLogin(r);}
      else setError(r.error_description||r.msg||"Anmeldung fehlgeschlagen");
    } else {
      const r=await supabaseAuth("signup",{email,password:pass,data:{name}});
      if(r.id||r.user){setMsg("✓ Registrierung erfolgreich! Email bestätigen, dann einloggen.");setMode("login");}
      else setError(r.msg||r.error_description||"Registrierung fehlgeschlagen");
    }
    setLoading(false);
  };

  return (
    <div className="auth-bg">
      <div className="auth-box">
        <div className="auth-logo">⬡</div>
        <div className="auth-title">AquaControl <span style={{color:"var(--cyan)"}}>PRO</span></div>
        <div className="auth-sub">Meerwasseraquarium Management</div>
        <div className="auth-tabs">
          <button className={`at-btn ${mode==="login"?"at-active":""}`} onClick={()=>setMode("login")}>Anmelden</button>
          <button className={`at-btn ${mode==="register"?"at-active":""}`} onClick={()=>setMode("register")}>Registrieren</button>
        </div>
        {mode==="register"&&<div className="af"><label>Name</label><input className="ai" placeholder="Dein Name" value={name} onChange={e=>setName(e.target.value)}/></div>}
        <div className="af"><label>Email</label><input className="ai" type="email" placeholder="email@example.de" value={email} onChange={e=>setEmail(e.target.value)}/></div>
        <div className="af"><label>Passwort</label><input className="ai" type="password" placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
        {error&&<div className="auth-err">{error}</div>}
        {msg&&<div className="auth-ok">{msg}</div>}
        <Btn onClick={submit} color="#00d4ff" disabled={loading}>{loading?<Spin/>:mode==="login"?"Anmelden":"Konto erstellen"}</Btn>
      </div>
    </div>
  );
}

// ─── AQUARIUM SELECTOR ────────────────────────────────────────────────────────
function AquariumSelector({session,onSelect,onGlobal,onLogout}) {
  const [aquariums,setAquariums]=useState([]);
  const [loading,setLoading]=useState(true);
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState({name:"",volume:300,description:""});
  const jwt=session.access_token;
  const userName=session.user?.user_metadata?.name||session.user?.email?.split("@")[0]||"Benutzer";

  useEffect(()=>{load();},[]);

  const load=async()=>{
    setLoading(true);
    const d=await dbCall("select","aquariums",{order:"created_at.asc"},null,jwt);
    setAquariums(Array.isArray(d)?d:[]);
    setLoading(false);
  };

  const create=async()=>{
    if(!form.name) return;
    const r=await dbCall("insert","aquariums",{
      name:form.name,volume:form.volume||300,description:form.description,
      user_id:session.user.id,params:DEFAULT_PARAMS,
      esp_ip:"192.168.1.100",ml_per_ms:0.01667,ha_entities:[]
    },null,jwt);
    console.log("Create result:", r);
    if(Array.isArray(r)&&r[0]){
      setCreating(false);setForm({name:"",volume:300,description:""});load();
    } else {
      alert("Fehler: " + JSON.stringify(r));
    }
  };

  const del=async(e,id)=>{
    e.stopPropagation();
    if(!confirm("Aquarium und ALLE Daten löschen?")) return;
    await dbCall("delete","aquariums",null,{id},jwt);
    load();
  };

  return (
    <div className="selector-wrap">
      <div className="sel-header">
        <div>
          <div className="sel-title">⬡ AquaControl PRO</div>
          <div className="sel-user">Hallo, {userName}</div>
        </div>
        <button className="logout-btn" onClick={onLogout}>Abmelden</button>
      </div>

      <button className="global-btn" onClick={onGlobal}>
        <span style={{fontSize:28}}>🌊</span>
        <div style={{flex:1,textAlign:"left"}}>
          <div className="global-btn-title">Gesamtübersicht Besatz</div>
          <div className="global-btn-sub">Alle Tiere aus allen Aquarien</div>
        </div>
        <span style={{color:"var(--muted)"}}>→</span>
      </button>

      <div className="sel-section">Meine Aquarien</div>

      {loading&&<div className="loading-row"><Spin/><span>Lade...</span></div>}

      {!loading&&aquariums.map(aq=>(
        <div key={aq.id} className="aq-card" onClick={()=>onSelect(aq)}>
          <div style={{fontSize:32}}>🐠</div>
          <div style={{flex:1}}>
            <div className="aq-name">{aq.name}</div>
            <div className="aq-meta">{aq.volume}L{aq.description?` · ${aq.description}`:""}</div>
          </div>
          <span style={{color:"var(--muted)",marginRight:8}}>→</span>
          <button className="del-btn" onClick={e=>del(e,aq.id)}>🗑</button>
        </div>
      ))}

      {!loading&&!aquariums.length&&(
        <div className="empty-state"><div>🐠</div><p>Noch kein Aquarium angelegt</p></div>
      )}

      {creating?(
        <Card>
          <Sect>Neues Aquarium</Sect>
          <div className="af"><label>Name</label><input className="sett-inp" placeholder="z.B. Riffbecken Wohnzimmer" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
          <div className="af"><label>Volumen (Liter)</label><input className="sett-inp" type="number" value={form.volume} onChange={e=>setForm(f=>({...f,volume:+e.target.value}))}/></div>
          <div className="af"><label>Beschreibung (optional)</label><input className="sett-inp" placeholder="z.B. SPS Becken" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          <div style={{display:"flex",gap:10}}>
            <Btn color="#00ffb3" onClick={create}>Erstellen</Btn>
            <Btn ghost onClick={()=>setCreating(false)}>Abbrechen</Btn>
          </div>
        </Card>
      ):(
        <Btn color="#00d4ff" onClick={()=>setCreating(true)}>+ Neues Aquarium</Btn>
      )}
    </div>
  );
}

// ─── GLOBAL BESATZ ────────────────────────────────────────────────────────────
function GlobalBesatz({session,onBack}) {
  const [animals,setAnimals]=useState([]);
  const [aquariums,setAquariums]=useState([]);
  const [loading,setLoading]=useState(true);
  const [activeGroup,setActiveGroup]=useState("all");
  const [search,setSearch]=useState("");
  const jwt=session.access_token;

  useEffect(()=>{
    Promise.all([
      dbCall("select","aquariums",null,null,jwt),
      dbCall("select","animals",null,null,jwt),
    ]).then(([aqs,ans])=>{
      setAquariums(Array.isArray(aqs)?aqs:[]);
      setAnimals(Array.isArray(ans)?ans:[]);
      setLoading(false);
    });
  },[]);

  const getAqName=id=>aquariums.find(a=>a.id===id)?.name||"?";
  const filtered=animals.filter(a=>{
    const gOk=activeGroup==="all"||a.group_id===activeGroup;
    const sOk=!search||a.name.toLowerCase().includes(search.toLowerCase());
    return gOk&&sOk;
  });
  const counts=BESATZ_GROUPS.reduce((acc,g)=>({...acc,[g.id]:animals.filter(a=>a.group_id===g.id).length}),{});

  return (
    <div className="tab-scroll">
      <button className="back-btn" onClick={onBack}>← Zurück zu Aquarien</button>
      <div className="page-title" style={{fontSize:22}}>🌊 Gesamtbesatz</div>
      <div style={{display:"flex",gap:8}}>
        <div className="count-chip">{animals.length} Tiere</div>
        <div className="count-chip">{aquariums.length} Aquarien</div>
      </div>
      <input className="search-inp" placeholder="🔍 Suchen…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="group-chips">
        <button className={`grp-chip ${activeGroup==="all"?"grp-active":""}`} onClick={()=>setActiveGroup("all")}>Alle <span className="grp-cnt">{animals.length}</span></button>
        {BESATZ_GROUPS.map(g=>(
          <button key={g.id} className={`grp-chip ${activeGroup===g.id?"grp-active":""}`} style={{"--gc":g.color}} onClick={()=>setActiveGroup(g.id)}>
            {g.icon} {g.label} <span className="grp-cnt">{counts[g.id]||0}</span>
          </button>
        ))}
      </div>
      {loading&&<Card><div className="loading-row"><Spin/><span>Lädt...</span></div></Card>}
      {!loading&&BESATZ_GROUPS.filter(g=>activeGroup==="all"||g.id===activeGroup).map(grp=>{
        const items=filtered.filter(a=>a.group_id===grp.id);
        if(!items.length) return null;
        return (
          <div key={grp.id}>
            <div className="grp-hdr"><span style={{color:grp.color,fontSize:18}}>{grp.icon}</span><span style={{color:grp.color,fontFamily:"var(--fm)",fontSize:11,fontWeight:700,textTransform:"uppercase",flex:1}}>{grp.label}</span><span className="grp-cnt-badge">{items.length}</span></div>
            <div className="besatz-list">
              {items.map(a=>(
                <div key={a.id} className="bitem">
                  <div className="bemoji">{a.photo?<img src={a.photo} className="bphoto" alt={a.name}/>:(a.emoji||"🐠")}</div>
                  <div className="binfo">
                    <div className="bname" style={{color:a.color||"#00d4ff"}}>{a.name}</div>
                    <div className="btype">{a.type}{a.count>1?` · ${a.count}×`:""}</div>
                    <div style={{fontSize:10,color:"var(--muted)",marginTop:2}}>📦 {getAqName(a.aquarium_id)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!loading&&!filtered.length&&<div className="empty-state"><div>🐠</div><p>Keine Tiere</p></div>}
    </div>
  );
}

// ─── MESSUNG POPUP ────────────────────────────────────────────────────────────
function MeasPopup({param,lastValue,volume,onSave,onClose}) {
  const [mode,setMode]=useState(param.salifert?.length>0?"salifert":"direct");
  const [mlInput,setMlInput]=useState("");
  const [directInput,setDirectInput]=useState("");
  const [isIcp,setIsIcp]=useState(false);
  const [icpDate,setIcpDate]=useState(()=>new Date().toISOString().split("T")[0]);
  const hs=param.salifert?.length>0;

  const resolved=useMemo(()=>{
    if(mode==="salifert") return interpolate(param.salifert,mlInput);
    const v=parseFloat(directInput); return isNaN(v)?null:v;
  },[mode,mlInput,directInput]);

  const delta=resolved!=null?resolved-param.target:null;
  const corrMl=resolved!=null?calcCorr(param,resolved,volume||300):null;
  const st=getStatus(param,resolved);

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="popup-box" onClick={e=>e.stopPropagation()}>
        <div className="popup-hdr" style={{borderBottomColor:param.color+"44"}}>
          <div className="pop-dot" style={{background:param.color}}/><div><div className="pop-title" style={{color:param.color}}>{param.label}</div><div className="pop-sub">Ziel: {param.target} {param.unit}</div></div>
          <button className="pop-close" onClick={onClose}>✕</button>
        </div>
        {lastValue!=null&&<div className="pop-last"><span style={{fontSize:12,color:"var(--muted)"}}>Letzter Wert</span><span style={{fontFamily:"var(--fm)",fontSize:18,fontWeight:700,color:param.color}}>{lastValue} {param.unit}</span></div>}
        {hs&&(
          <div className="mode-row">
            <button className={`mode-btn ${mode==="salifert"?"mode-on":""}`} style={mode==="salifert"?{"--mc":param.color}:{}} onClick={()=>setMode("salifert")}>💉 Salifert</button>
            <button className={`mode-btn ${mode==="direct"?"mode-on":""}`} style={mode==="direct"?{"--mc":param.color}:{}} onClick={()=>setMode("direct")}>✏ Direkteingabe</button>
          </div>
        )}
        {mode==="salifert"&&hs&&(
          <div className="pop-section">
            <div style={{fontSize:13,color:"var(--muted)",marginBottom:8}}>ml-Stand der Spritze</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input autoFocus type="number" step="0.02" placeholder="z.B. 0.40" value={mlInput} onChange={e=>setMlInput(e.target.value)} className="big-input" style={{"--ac":param.color}}/>
              <span style={{fontFamily:"var(--fm)",color:"var(--muted)"}}>ml</span>
            </div>
            {mlInput!==""&&(
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                {[...param.salifert].sort((a,b)=>a.ml-b.ml).filter(r=>Math.abs(r.ml-parseFloat(mlInput))<=0.06).map(r=>(
                  <button key={r.ml} onClick={()=>setMlInput(String(r.ml))} className="lookup-chip" style={parseFloat(mlInput)===r.ml?{borderColor:param.color,color:param.color}:{}}>{r.ml.toFixed(2)}ml → {r.value}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {mode==="direct"&&(
          <div className="pop-section">
            <div style={{fontSize:13,color:"var(--muted)",marginBottom:8}}>Messwert in {param.unit}</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input autoFocus type="number" step="0.1" placeholder={`Wert in ${param.unit}`} value={directInput} onChange={e=>setDirectInput(e.target.value)} className="big-input" style={{"--ac":param.color}}/>
              <span style={{fontFamily:"var(--fm)",color:"var(--muted)"}}>{param.unit}</span>
            </div>
          </div>
        )}
        {resolved!=null&&(
          <div className="pop-result" style={{borderColor:param.color+"33",background:param.color+"0d"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
              <div style={{fontFamily:"var(--fm)",fontSize:32,fontWeight:700,color:param.color}}>{resolved} <span style={{fontSize:14}}>{param.unit}</span></div>
              <div className={`status-pill ${st==="ok"?"sp-ok":st==="warn"?"sp-warn":"sp-err"}`}>{st==="ok"?"✓ Optimal":st==="warn"?"△ Grenzwertig":delta>0?"▲ Zu hoch":"▼ Zu niedrig"}</div>
            </div>
            {st!=="ok"&&delta<0&&corrMl>0&&(
              <div className="analysis-box"><div style={{fontFamily:"var(--fm)",fontSize:12,fontWeight:700,marginBottom:4}}>💊 Dosierungsvorschlag</div><div style={{fontSize:13}}>Fehlend: <b>{Math.abs(delta).toFixed(2)} {param.unit}</b></div><div style={{fontSize:13}}>Benötigt: <b style={{color:param.color}}>{corrMl} ml</b> via Pumpe {param.pump}</div></div>
            )}
            {st!=="ok"&&delta>0&&(
              <div className="analysis-box" style={{borderColor:"rgba(255,68,68,.2)"}}><div style={{fontFamily:"var(--fm)",fontSize:12,fontWeight:700,marginBottom:4}}>⬇ Zu hoher Wert</div><div style={{fontSize:13}}>Überschuss: <b>{delta.toFixed(2)} {param.unit}</b> – Dosierung pausieren</div></div>
            )}
          </div>
        )}
        <div className="icp-row">
          <label className="icp-label"><input type="checkbox" checked={isIcp} onChange={e=>setIsIcp(e.target.checked)} style={{width:20,height:20,accentColor:"var(--cyan)"}}/><span>🧪 ICP-Laborwert</span></label>
          {isIcp&&<div style={{display:"flex",flexDirection:"column",gap:5}}><span style={{fontSize:11,color:"var(--muted)"}}>Datum der Probeentnahme</span><input type="date" className="big-input" style={{fontSize:16,padding:"10px 14px"}} value={icpDate} onChange={e=>setIcpDate(e.target.value)}/></div>}
        </div>
        <div className="pop-actions">
          <button className="pop-cancel" onClick={onClose}>Abbrechen</button>
          <button className="pop-save" style={{background:param.color,opacity:resolved==null?0.4:1}} disabled={resolved==null} onClick={()=>{onSave(param.id,resolved,isIcp?icpDate:null);onClose();}}>Speichern</button>
        </div>
      </div>
    </div>
  );
}

// ─── MESSUNG TAB ──────────────────────────────────────────────────────────────
function MessungTab({aquarium,session,params}) {
  const [popup,setPopup]=useState(null);
  const [measurements,setMeasurements]=useState([]);
  const [flash,setFlash]=useState(null);
  const [loading,setLoading]=useState(true);
  const [subTab,setSubTab]=useState("aktuell"); // "aktuell" | "verlauf"
  const [activeCharts,setActiveCharts]=useState(null); // null = alle
  const jwt=session.access_token;
  const enabled=params.filter(p=>p.enabled);

  useEffect(()=>{
    setActiveCharts(enabled.map(p=>p.id));
    dbCall("select","measurements",{order:"measured_at.desc",limit:300},{aquarium_id:aquarium.id},jwt)
      .then(d=>{setMeasurements(Array.isArray(d)?d:[]);setLoading(false);});
  },[aquarium.id]);

  const lastValues=useMemo(()=>{
    const m={};
    for(const p of enabled){
      const f=measurements.find(e=>e.values?.[p.id]!=null);
      m[p.id]=f?f.values[p.id]:null;
    }
    return m;
  },[measurements,enabled]);

  const chartData=useMemo(()=>[...measurements].reverse().map(m=>({
    ts:new Date(m.measured_at).getTime(),
    ...Object.fromEntries(enabled.map(p=>[p.id,m.values?.[p.id]??null]))
  })),[measurements,enabled]);

  const save=async(paramId,value,icpDate=null)=>{
    const entry={aquarium_id:aquarium.id,user_id:session.user.id,
      measured_at:icpDate?new Date(icpDate).toISOString():new Date().toISOString(),
      values:{[paramId]:value},is_icp:!!icpDate,icp_date:icpDate||null};
    const r=await dbCall("insert","measurements",entry,null,jwt);
    if(Array.isArray(r)&&r[0]){
      setMeasurements(prev=>[r[0],...prev]);
      setFlash(paramId); setTimeout(()=>setFlash(null),2000);
    }
  };

  const CTT=({active:a,payload,label})=>{
    if(!a||!payload?.length) return null;
    return <div className="chart-tt"><div style={{fontSize:10,color:"var(--muted)",marginBottom:4}}>{new Date(label).toLocaleDateString("de-DE")}</div>{payload.map(p=>p.value!=null&&<div key={p.dataKey} style={{color:p.color,fontFamily:"var(--fm)",fontSize:11}}>{p.dataKey}: <b>{p.value}</b></div>)}</div>;
  };

  if(loading) return <div className="tab-scroll"><Card><div className="loading-row"><Spin/><span>Lade...</span></div></Card></div>;

  return (
    <>
      <div className="tab-scroll">
        {/* Sub-Tab Toggle */}
        <div className="sub-tab-row">
          <button className={`sub-tab ${subTab==="aktuell"?"sub-tab-on":""}`} onClick={()=>setSubTab("aktuell")}>📊 Messung</button>
          <button className={`sub-tab ${subTab==="verlauf"?"sub-tab-on":""}`} onClick={()=>setSubTab("verlauf")}>📈 Verlauf</button>
        </div>

        {/* MESSUNG */}
        {subTab==="aktuell" && enabled.map(p=>{
          const cur=lastValues[p.id];
          const st=getStatus(p,cur);
          const ok=st==="ok",warn=st==="warn";
          const pct=cur!=null?Math.min(100,Math.max(0,((cur-p.min)/(p.max-p.min))*100)):null;
          const tpct=((p.target-p.min)/(p.max-p.min))*100;
          return (
            <div key={p.id} className={`mcard ${flash===p.id?"mcard-saved":""}`} style={{"--pc":p.color}} onClick={()=>setPopup(p)}>
              <div className="mcard-top">
                <div className="mdot" style={{background:p.color}}/><span className="mname" style={{color:p.color}}>{p.label}</span><span className="munit">{p.unit}</span>
                {cur!=null&&<span className={`pill ${ok?"p-ok":warn?"p-warn":"p-err"}`}>{ok?"✓ OK":warn?"△":cur<p.target?"▼ Tief":"▲ Hoch"}</span>}
                <span style={{color:"var(--muted)",marginLeft:"auto"}}>→</span>
              </div>
              <div className="mvals">
                <div><div className="mlbl">Aktuell</div><div className="mval" style={{color:cur!=null?p.color:"#4a7080"}}>{cur??""}<span className="mvunit">{cur!=null?" "+p.unit:" tippen"}</span></div></div>
                <div><div className="mlbl">Ziel</div><div className="mval">{p.target}<span className="mvunit"> {p.unit}</span></div></div>
                {cur!=null&&<div><div className="mlbl">{cur<p.target?"Fehlend":"Überschuss"}</div><div className="mval" style={{color:cur<p.target?"#ff8c00":"#00ffb3"}}>{cur<p.target?"+":""}{(p.target-cur).toFixed(1)}<span className="mvunit"> {p.unit}</span></div></div>}
              </div>
              {pct!=null&&<div className="mbar"><div className="mbar-fill" style={{width:`${pct}%`,background:p.color}}/><div className="mbar-tgt" style={{left:`${tpct}%`}}/></div>}
              {flash===p.id&&<div className="save-flash" style={{color:p.color}}>✓ Gespeichert!</div>}
            </div>
          );
        })}

        {/* VERLAUF */}
        {subTab==="verlauf" && (<>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {enabled.map(p=>(
              <button key={p.id} className={`toggle-chip ${(activeCharts||[]).includes(p.id)?"tc-on":""}`}
                style={{"--c":p.color}}
                onClick={()=>setActiveCharts(a=>(a||[]).includes(p.id)?(a||[]).filter(x=>x!==p.id):[...(a||[]),p.id])}>
                {p.label}
              </button>
            ))}
          </div>
          {!chartData.length&&<div className="empty-state"><div>📈</div><p>Noch keine Messwerte</p></div>}
          {enabled.filter(p=>(activeCharts||[]).includes(p.id)).map(p=>(
            <Card key={p.id}>
              <div style={{fontFamily:"var(--fm)",fontSize:11,textTransform:"uppercase",letterSpacing:".07em",color:p.color,marginBottom:6}}>{p.label} <span style={{color:"#4a6472"}}>({p.unit})</span></div>
              <ResponsiveContainer width="100%" height={170}>
                <LineChart data={chartData} margin={{top:8,right:8,left:-20,bottom:0}}>
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
        </>)}
      </div>
      {popup&&<MeasPopup param={popup} lastValue={lastValues[popup.id]} volume={aquarium.volume} onSave={save} onClose={()=>setPopup(null)}/>}
    </>
  );
}

// ─── DOSIERUNG TAB ────────────────────────────────────────────────────────────
function DosierungTab({aquarium,session,params}) {
  const [dayPlans,setDayPlans]=useState({});
  const [todayDone,setTodayDone]=useState(()=>{
    const s=JSON.parse(localStorage.getItem("todayDone_"+aquarium.id)||"{}");
    return s?.date===new Date().toDateString()?(s.data||{}):{};
  });
  const [todayDosed,setTodayDosed]=useState(()=>{
    const s=JSON.parse(localStorage.getItem("todayDosed_"+aquarium.id)||"{}");
    return s?.date===new Date().toDateString()?(s.data||{}):{};
  });
  const [activeParam,setActiveParam]=useState(params.filter(p=>p.enabled)[0]?.id||null);
  const [loading,setLoading]=useState(true);
  const [dosingId,setDosingId]=useState(null);
  const [addingStep,setAddingStep]=useState(null);
  const [newH,setNewH]=useState("8");
  const [newMl,setNewMl]=useState("");
  const [editStep,setEditStep]=useState(null);
  const jwt=session.access_token;
  const enabled=params.filter(p=>p.enabled);
  const nowH=new Date().getHours();

  // Lade Dosierpläne aus DB
  useEffect(()=>{
    dbCall("select","dosing_plans",null,{aquarium_id:aquarium.id},jwt).then(d=>{
      if(Array.isArray(d)){
        const plans={};
        d.forEach(p=>plans[p.param_id]=p);
        setDayPlans(plans);
      }
      setLoading(false);
    });
  },[aquarium.id]);

  const saveTodayDone=(td)=>{
    setTodayDone(td);
    localStorage.setItem("todayDone_"+aquarium.id,JSON.stringify({date:new Date().toDateString(),data:td}));
  };

  const saveTodayDosed=(td)=>{
    setTodayDosed(td);
    localStorage.setItem("todayDosed_"+aquarium.id,JSON.stringify({date:new Date().toDateString(),data:td}));
  };

  const savePlan=async(paramId,steps)=>{
    const existing=dayPlans[paramId];
    let r;
    if(existing?.id){
      r=await dbCall("update","dosing_plans",{steps},{id:existing.id},jwt);
    } else {
      r=await dbCall("insert","dosing_plans",{aquarium_id:aquarium.id,user_id:session.user.id,param_id:paramId,steps},null,jwt);
    }
    if(Array.isArray(r)&&r[0]){
      setDayPlans(prev=>({...prev,[paramId]:r[0]}));
    }
  };

  const generatePlan=async(param)=>{
    const hours=[];
    for(let h=0;h<24;h++){
      const inW=param.doseFrom<=param.doseTo?h>=param.doseFrom&&h<param.doseTo:h>=param.doseFrom||h<param.doseTo;
      if(inW) hours.push(h);
    }
    if(!hours.length) return;
    const total=Math.max(param.stdDayMl||0,0);
    if(total<=0){
      // Leerer Plan – nur Standarddosis
      alert("Bitte zuerst einen Messwert eingeben oder Standard-Tagesdosis setzen");
      return;
    }
    const steps=[];
    let rem=total, hi=0;
    const interval=Math.max(1,Math.floor(hours.length/Math.ceil(total/param.maxDoseMl)));
    while(rem>0.01&&hi<hours.length){
      const ml=+Math.min(rem,param.maxDoseMl).toFixed(2);
      steps.push({id:`${param.id}_${hours[hi]}_${Date.now()}`,hour:hours[hi],ml,status:"pending"});
      rem-=ml; hi+=interval;
      if(hi>=hours.length&&rem>0.01) hi=hours.length-1;
    }
    await savePlan(param.id,steps);
    const td={...todayDone}; delete td[param.id]; saveTodayDone(td);
  };

  const updateStep=async(paramId,stepId,changes)=>{
    const plan=dayPlans[paramId]; if(!plan) return;
    const steps=plan.steps.map(s=>s.id===stepId?{...s,...changes}:s);
    await savePlan(paramId,steps);
  };

  const deleteStep=async(paramId,stepId)=>{
    const plan=dayPlans[paramId]; if(!plan) return;
    await savePlan(paramId,plan.steps.filter(s=>s.id!==stepId));
  };

  const addStep=async(paramId)=>{
    const h=parseInt(newH),ml=parseFloat(newMl);
    if(isNaN(h)||isNaN(ml)||ml<=0) return;
    const plan=dayPlans[paramId];
    const steps=[...(plan?.steps||[]),{id:`${paramId}_${h}_${Date.now()}`,hour:h,ml:+ml.toFixed(2),status:"pending"}].sort((a,b)=>a.hour-b.hour);
    await savePlan(paramId,steps);
    setAddingStep(null);setNewMl("");
  };

  const executeDose=async(param,step)=>{
    setDosingId(step.id);
    const ms=Math.round(step.ml/(aquarium.ml_per_ms||0.01667));
    try {
      await fetch(`http://${aquarium.esp_ip}/dose?pump=${param.pump}&time=${ms}`,{signal:AbortSignal.timeout(5000)});
    } catch(e){}
    setDosingId(null);
    const td={...todayDone,[param.id]:[...(todayDone[param.id]||[]),step.id]};
    saveTodayDone(td);
    const dosed={...todayDosed,[param.id]:(todayDosed[param.id]||0)+step.ml};
    saveTodayDosed(dosed);
  };

  if(loading) return <div className="tab-scroll"><Card><div className="loading-row"><Spin/><span>Lade...</span></div></Card></div>;

  return (
    <div className="tab-scroll">
      {/* Param Chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {enabled.map(p=>{
          const plan=dayPlans[p.id];
          const doneIds=todayDone[p.id]||[];
          const pending=plan?.steps?.filter(s=>!doneIds.includes(s.id)&&s.status!=="paused").length||0;
          return (
            <button key={p.id} className={`param-chip ${activeParam===p.id?"param-chip-on":""}`}
              style={{"--c":p.color}} onClick={()=>setActiveParam(p.id)}>
              {p.label} {pending>0&&<span className="pc-badge">{pending}</span>}
            </button>
          );
        })}
      </div>

      {/* Aktiver Plan */}
      {enabled.filter(p=>p.id===activeParam).map(p=>{
        const plan=dayPlans[p.id];
        const dosed=todayDosed[p.id]||0;
        const doneIds=todayDone[p.id]||[];
        return (
          <Card key={p.id}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <div className="mdot" style={{background:p.color}}/><span style={{fontFamily:"var(--fm)",fontSize:15,fontWeight:700,color:p.color}}>{p.label}</span>
              <span style={{fontSize:11,color:"var(--muted)",marginLeft:"auto"}}>🕐 {String(p.doseFrom).padStart(2,"0")}–{String(p.doseTo).padStart(2,"0")} Uhr</span>
            </div>

            {/* Stats */}
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              <div><div className="mlbl">Heute dosiert</div><div style={{fontFamily:"var(--fm)",fontSize:18,fontWeight:700,color:p.color}}>{dosed.toFixed(1)} ml</div></div>
              <div><div className="mlbl">Max/Tag</div><div style={{fontFamily:"var(--fm)",fontSize:18,fontWeight:700}}>{p.maxDayMl} ml</div></div>
              {p.stdDayMl>0&&<div><div className="mlbl">Standard</div><div style={{fontFamily:"var(--fm)",fontSize:18,fontWeight:700}}>{p.stdDayMl} ml</div></div>}
            </div>

            {/* Progress */}
            <div className="mbar" style={{marginTop:4}}>
              <div className="mbar-fill" style={{width:`${Math.min(100,(dosed/p.maxDayMl)*100)}%`,background:p.color}}/>
            </div>

            <Btn color={p.color} onClick={()=>generatePlan(p)}>{plan?"🔄 Plan neu generieren":"✨ Tagesplan erstellen"}</Btn>

            {/* Steps */}
            {plan?.steps?.length>0&&(
              <div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontFamily:"var(--fm)",fontSize:10,textTransform:"uppercase",letterSpacing:".06em",color:"var(--muted)"}}>
                    Tagesplan · {plan.steps.length} Vorgänge · täglich
                  </span>
                  <button className="step-add-btn" onClick={()=>setAddingStep(p.id)}>+ Hinzufügen</button>
                </div>

                {addingStep===p.id&&(
                  <div style={{display:"flex",gap:6,alignItems:"center",padding:"8px",background:"rgba(0,0,0,.2)",borderRadius:10,marginBottom:8,flexWrap:"wrap"}}>
                    <select className="sett-inp" style={{flex:1,minWidth:80}} value={newH} onChange={e=>setNewH(e.target.value)}>
                      {Array.from({length:24},(_,i)=>i).map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
                    </select>
                    <input type="number" step="0.5" placeholder="ml" className="sett-inp" style={{width:80}} value={newMl} onChange={e=>setNewMl(e.target.value)}/>
                    <button style={{background:"var(--green)",border:"none",borderRadius:8,color:"#000",width:36,height:36,fontSize:16,cursor:"pointer",fontWeight:700}} onClick={()=>addStep(p.id)}>✓</button>
                    <button style={{background:"rgba(255,68,68,.15)",border:"1px solid rgba(255,68,68,.3)",borderRadius:8,color:"#ff4444",width:36,height:36,fontSize:16,cursor:"pointer"}} onClick={()=>setAddingStep(null)}>✕</button>
                  </div>
                )}

                {[...plan.steps].sort((a,b)=>a.hour-b.hour).map(step=>{
                  const isDone=doneIds.includes(step.id);
                  const isCur=step.hour===nowH;
                  const isLoad=dosingId===step.id;
                  const isEdit=editStep===step.id;
                  return (
                    <div key={step.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.04)",opacity:isDone?0.45:1}}>
                      <span style={{fontFamily:"var(--fm)",fontSize:13,fontWeight:700,minWidth:44,color:isCur?"var(--cyan)":"var(--text)"}}>
                        {String(step.hour).padStart(2,"0")}:00{isCur&&<span style={{fontSize:8,display:"block",color:"var(--cyan)"}}>JETZT</span>}
                      </span>

                      {isEdit?(
                        <input type="number" step="0.5" autoFocus defaultValue={step.ml}
                          style={{flex:1,background:"rgba(0,212,255,.1)",border:"1px solid var(--cyan)",borderRadius:6,color:"var(--cyan)",padding:"4px 8px",fontFamily:"var(--fm)",fontSize:15,fontWeight:700,width:70,outline:"none"}}
                          onBlur={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)&&v>0)updateStep(p.id,step.id,{ml:+v.toFixed(2)});setEditStep(null);}}
                          onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape")setEditStep(null);}}
                        />
                      ):(
                        <span style={{flex:1,fontFamily:"var(--fm)",fontSize:15,fontWeight:700,cursor:"pointer",color:p.color}} onClick={()=>setEditStep(step.id)}>{step.ml} <span style={{fontSize:11,color:"var(--muted)",fontWeight:400}}>ml ✏</span></span>
                      )}

                      {isDone&&<span style={{fontSize:12,color:"var(--green)"}}>✓</span>}
                      {step.status==="paused"&&<span style={{fontSize:12,color:"var(--yellow)"}}>⏸</span>}

                      <div style={{display:"flex",gap:4}}>
                        {!isDone&&<button style={{background:p.color,border:"none",borderRadius:8,color:"#000",padding:"5px 10px",fontFamily:"var(--fm)",fontSize:11,fontWeight:700,cursor:"pointer"}} onClick={()=>executeDose(p,step)} disabled={isLoad}>{isLoad?<Spin/>:`P${p.pump}`}</button>}
                        <button style={{background:"rgba(255,255,255,.06)",border:"none",borderRadius:8,color:"var(--muted)",padding:"5px 8px",fontSize:11,cursor:"pointer"}} onClick={()=>updateStep(p.id,step.id,{status:step.status==="paused"?"pending":"paused"})}>{step.status==="paused"?"▶":"⏸"}</button>
                        <button style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.25)",borderRadius:8,color:"#ff4444",padding:"5px 8px",fontSize:11,cursor:"pointer"}} onClick={()=>deleteStep(p.id,step.id)}>✕</button>
                      </div>
                    </div>
                  );
                })}
                <div style={{fontSize:11,color:"var(--muted)",marginTop:8,textAlign:"right"}}>
                  {plan.steps.reduce((a,s)=>a+s.ml,0).toFixed(1)} ml/Tag · {doneIds.length}/{plan.steps.length} heute erledigt
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── BESATZ TAB ───────────────────────────────────────────────────────────────
function BesatzTab({aquarium,session}) {
  const [animals,setAnimals]=useState([]);
  const [loading,setLoading]=useState(true);
  const [activeGroup,setActiveGroup]=useState("all");
  const [search,setSearch]=useState("");
  const [adding,setAdding]=useState(false);
  const [form,setForm]=useState({name:"",type:"",care:"★☆☆",note:"",emoji:"🪸",color:"#00d4ff",group_id:"korallen",count:1});
  const jwt=session.access_token;

  useEffect(()=>{
    dbCall("select","animals",null,{aquarium_id:aquarium.id},jwt)
      .then(d=>{setAnimals(Array.isArray(d)?d:[]);setLoading(false);});
  },[aquarium.id]);

  const addAnimal=async(a)=>{
    const r=await dbCall("insert","animals",{...a,aquarium_id:aquarium.id,user_id:session.user.id},null,jwt);
    if(Array.isArray(r)&&r[0]) setAnimals(prev=>[...prev,r[0]]);
  };

  const removeAnimal=async(e,id)=>{
    e.stopPropagation();e.preventDefault();
    await dbCall("delete","animals",null,{id},jwt);
    setAnimals(prev=>prev.filter(a=>a.id!==id));
  };

  const addManual=async()=>{
    if(!form.name) return;
    await addAnimal(form);
    setAdding(false);
    setForm({name:"",type:"",care:"★☆☆",note:"",emoji:"🪸",color:"#00d4ff",group_id:"korallen",count:1});
  };

  const filtered=useMemo(()=>animals.filter(a=>{
    const gOk=activeGroup==="all"||a.group_id===activeGroup;
    const sOk=!search||a.name.toLowerCase().includes(search.toLowerCase());
    return gOk&&sOk;
  }),[animals,activeGroup,search]);

  const counts=BESATZ_GROUPS.reduce((acc,g)=>({...acc,[g.id]:animals.filter(a=>a.group_id===g.id).length}),{});

  return (
    <div className="tab-scroll">
      <div className="group-chips">
        <button className={`grp-chip ${activeGroup==="all"?"grp-active":""}`} onClick={()=>setActiveGroup("all")}>Alle <span className="grp-cnt">{animals.length}</span></button>
        {BESATZ_GROUPS.map(g=>(
          <button key={g.id} className={`grp-chip ${activeGroup===g.id?"grp-active":""}`} style={{"--gc":g.color}} onClick={()=>setActiveGroup(g.id)}>
            {g.icon} {g.label} <span className="grp-cnt">{counts[g.id]||0}</span>
          </button>
        ))}
      </div>
      <input className="search-inp" placeholder="🔍 Suchen…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <Btn color="#00d4ff" onClick={()=>setAdding(a=>!a)}>{adding?"✕ Abbrechen":"+ Tier hinzufügen"}</Btn>
      {adding&&(
        <Card>
          <div className="pe-grid">
            <div className="pe-f pe-wide"><label>Wissenschaftl. Name</label><input className="pe-inp" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
            <div className="pe-f"><label>Typ</label><input className="pe-inp" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}/></div>
            <div className="pe-f"><label>Gruppe</label><select className="pe-inp" value={form.group_id} onChange={e=>setForm(f=>({...f,group_id:e.target.value}))}>{BESATZ_GROUPS.map(g=><option key={g.id} value={g.id}>{g.icon} {g.label}</option>)}</select></div>
            <div className="pe-f"><label>Emoji</label><input className="pe-inp" value={form.emoji} onChange={e=>setForm(f=>({...f,emoji:e.target.value}))}/></div>
            <div className="pe-f"><label>Anzahl</label><input className="pe-inp" type="number" min="1" value={form.count} onChange={e=>setForm(f=>({...f,count:+e.target.value}))}/></div>
            <div className="pe-f"><label>Pflege</label><select className="pe-inp" value={form.care} onChange={e=>setForm(f=>({...f,care:e.target.value}))}><option>★☆☆</option><option>★★☆</option><option>★★★</option></select></div>
            <div className="pe-f pe-wide"><label>Notiz</label><input className="pe-inp" value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/></div>
          </div>
          <Btn color="#00ffb3" onClick={addManual}>Speichern</Btn>
        </Card>
      )}
      {loading&&<Card><div className="loading-row"><Spin/><span>Lade...</span></div></Card>}
      {!loading&&BESATZ_GROUPS.filter(g=>activeGroup==="all"||g.id===activeGroup).map(grp=>{
        const items=filtered.filter(a=>a.group_id===grp.id);
        if(!items.length) return null;
        return (
          <div key={grp.id}>
            <div className="grp-hdr"><span style={{color:grp.color,fontSize:18}}>{grp.icon}</span><span className="grp-hdr-title" style={{color:grp.color}}>{grp.label}</span><span className="grp-cnt-badge">{items.length}</span></div>
            <div className="besatz-list">
              {items.map(a=>(
                <div key={a.id} className="bitem" style={{"--ac":a.color||"#00d4ff"}}>
                  <div className="bemoji">{a.photo?<img src={a.photo} className="bphoto" alt={a.name}/>:(a.emoji||"🐠")}</div>
                  <div className="binfo">
                    <div className="bname" style={{color:a.color||"#00d4ff"}}>{a.name}</div>
                    <div className="btype">{a.type} · {a.care}{a.count>1?` · ${a.count}×`:""}</div>
                    {a.note&&<div style={{fontSize:11,color:"var(--muted)"}}>{a.note}</div>}
                  </div>
                  <button className="del-btn" onClick={e=>removeAnimal(e,a.id)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!loading&&!filtered.length&&<div className="empty-state"><div>🐠</div><p>Keine Tiere</p></div>}
    </div>
  );
}

// ─── SALIFERT EDITOR ─────────────────────────────────────────────────────────
function SalifertEditor({param, updateParam}) {
  const [newMl, setNewMl] = useState("");
  const [newVal, setNewVal] = useState("");
  const [expanded, setExpanded] = useState(false);
  const table = param.salifert || [];

  const addRow = () => {
    const ml = parseFloat(newMl), val = parseFloat(newVal);
    if (isNaN(ml) || isNaN(val)) return;
    const exists = table.find(r => r.ml === ml);
    if (exists) {
      updateParam("salifert")(table.map(r => r.ml===ml ? {ml,value:val} : r));
    } else {
      updateParam("salifert")([...table, {ml,value:val}].sort((a,b)=>a.ml-b.ml));
    }
    setNewMl(""); setNewVal("");
  };

  const removeRow = (ml) => {
    updateParam("salifert")(table.filter(r => r.ml !== ml));
  };

  const importSalifertKH = () => {
    updateParam("salifert")([
      {ml:0.00,value:15.7},{ml:0.02,value:15.3},{ml:0.04,value:15.0},{ml:0.06,value:14.7},
      {ml:0.08,value:14.4},{ml:0.10,value:14.1},{ml:0.12,value:13.7},{ml:0.14,value:13.4},
      {ml:0.16,value:13.1},{ml:0.18,value:12.8},{ml:0.20,value:12.5},{ml:0.22,value:12.1},
      {ml:0.24,value:11.8},{ml:0.26,value:11.5},{ml:0.28,value:11.2},{ml:0.30,value:10.9},
      {ml:0.32,value:10.5},{ml:0.34,value:10.2},{ml:0.36,value:9.9},{ml:0.38,value:9.6},
      {ml:0.40,value:9.3},{ml:0.42,value:8.9},{ml:0.44,value:8.6},{ml:0.46,value:8.3},
      {ml:0.48,value:8.0},{ml:0.50,value:7.7},{ml:0.52,value:7.4},{ml:0.54,value:7.0},
      {ml:0.56,value:6.7},{ml:0.58,value:6.4},{ml:0.60,value:6.1},{ml:0.62,value:5.7},
      {ml:0.64,value:5.4},{ml:0.66,value:5.1},{ml:0.68,value:4.8},{ml:0.70,value:4.5},
      {ml:0.72,value:4.1},{ml:0.74,value:3.8},{ml:0.76,value:3.5},{ml:0.78,value:3.2},
      {ml:0.80,value:2.9},{ml:0.82,value:2.5},{ml:0.84,value:2.2},{ml:0.86,value:1.9},
      {ml:0.88,value:1.6},{ml:0.90,value:1.2},{ml:0.92,value:0.9},{ml:0.94,value:0.6},
      {ml:0.96,value:0.3},{ml:0.98,value:0.0},
    ]);
  };

  const sorted = [...table].sort((a,b)=>a.ml-b.ml);

  return (
    <Card>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <Sect color={param.color}>💉 Testkit-Umrechnung (Salifert)</Sect>
        <button
          style={{background:"none",border:"none",color:"var(--cyan)",fontFamily:"var(--fm)",fontSize:11,cursor:"pointer"}}
          onClick={()=>setExpanded(e=>!e)}
        >{expanded?"▲ Einklappen":"▼ Ausklappen"} ({table.length} Werte)</button>
      </div>

      <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.6}}>
        Hinterlege für jeden ml-Stand der Spritze den entsprechenden Messwert in {param.unit}. 
        Beim Messen wird der Wert dann automatisch interpoliert.
      </div>

      {/* Salifert KH Schnellimport */}
      {param.id==="KH"&&(
        <button
          style={{background:"rgba(0,212,255,.1)",border:"1px solid rgba(0,212,255,.25)",borderRadius:10,color:"var(--cyan)",fontFamily:"var(--fm)",fontSize:12,fontWeight:700,padding:"10px 14px",cursor:"pointer",width:"100%"}}
          onClick={importSalifertKH}
        >⬇ Salifert KH Tabelle importieren (Standard)</button>
      )}

      {/* Neue Zeile hinzufügen */}
      <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
        <div className="af" style={{flex:1}}>
          <label>ml-Stand Spritze</label>
          <input className="sett-inp" type="number" step="0.02" placeholder="0.40" value={newMl} onChange={e=>setNewMl(e.target.value)}/>
        </div>
        <div className="af" style={{flex:1}}>
          <label>= Wert ({param.unit})</label>
          <input className="sett-inp" type="number" step="0.1" placeholder="9.3" value={newVal} onChange={e=>setNewVal(e.target.value)}/>
        </div>
        <button
          style={{background:param.color,border:"none",borderRadius:10,color:"#000",fontFamily:"var(--fm)",fontSize:13,fontWeight:700,padding:"12px 16px",cursor:"pointer",flexShrink:0}}
          onClick={addRow}
        >+ Eintrag</button>
      </div>

      {/* Tabelle anzeigen */}
      {table.length > 0 && (
        <>
          {/* Mini Vorschau – immer sichtbar */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {sorted.slice(0,6).map(r=>(
              <div key={r.ml} style={{background:"rgba(0,0,0,.3)",borderRadius:8,padding:"4px 10px",fontSize:11,fontFamily:"var(--fm)"}}>
                <span style={{color:"var(--muted)"}}>{r.ml.toFixed(2)}ml</span>
                <span style={{color:param.color}}> → {r.value}</span>
              </div>
            ))}
            {sorted.length > 6 && <span style={{fontSize:11,color:"var(--muted)",padding:"4px 6px"}}>+{sorted.length-6} weitere</span>}
          </div>

          {/* Vollständige Tabelle ausklappbar */}
          {expanded && (
            <div className="salifert-table">
              <div className="salifert-table-hdr">
                <span>ml-Stand</span><span>= {param.unit}</span><span/>
              </div>
              {sorted.map(r=>(
                <div key={r.ml} className="salifert-table-row">
                  <span style={{fontFamily:"var(--fm)",fontSize:13}}>{r.ml.toFixed(2)} ml</span>
                  <span style={{fontFamily:"var(--fm)",fontSize:13,color:param.color}}>→ {r.value} {param.unit}</span>
                  <button
                    style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.25)",borderRadius:6,color:"#ff4444",fontSize:11,padding:"3px 8px",cursor:"pointer"}}
                    onClick={()=>removeRow(r.ml)}
                  >✕</button>
                </div>
              ))}
              <button
                style={{background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.2)",borderRadius:10,color:"#ff4444",fontFamily:"var(--fm)",fontSize:11,fontWeight:700,padding:"8px",cursor:"pointer",width:"100%",marginTop:4}}
                onClick={()=>updateParam("salifert")([])}
              >Alle Einträge löschen</button>
            </div>
          )}
        </>
      )}

      {table.length===0&&(
        <div style={{fontSize:12,color:"var(--muted)",textAlign:"center",padding:"8px 0"}}>
          Noch keine Einträge – füge ml-Werte manuell hinzu oder importiere die Salifert-Tabelle
        </div>
      )}
    </Card>
  );
}

// ─── EINSTELLUNGEN ────────────────────────────────────────────────────────────
function EinstellungenTab({aquarium,session,params,setParams,onUpdateAquarium}) {
  const [loc,setLoc]=useState({name:aquarium.name,volume:aquarium.volume||300,esp_ip:aquarium.esp_ip||"192.168.1.100",ml_per_ms:aquarium.ml_per_ms||0.01667,ha_url:aquarium.ha_url||"",ha_token:aquarium.ha_token||""});
  const [sec,setSec]=useState("system");
  const [selParam,setSelParam]=useState(params[0]?.id||null);
  const [msg,setMsg]=useState("");
  const jwt=session.access_token;
  const param=params.find(p=>p.id===selParam);
  const hours=Array.from({length:24},(_,i)=>i);
  const COLORS=["#00d4ff","#00ffb3","#a78bfa","#ff8c00","#ffe600","#ff6b9d","#ff4444","#4ade80"];

  const up=f=>v=>{const u=params.map(p=>p.id===selParam?{...p,[f]:v}:p);setParams(u);};

  const saveSystem=async()=>{
    const r=await dbCall("update","aquariums",{...loc,params},{id:aquarium.id},jwt);
    if(Array.isArray(r)&&r[0]){onUpdateAquarium(r[0]);setMsg("✓ Gespeichert");setTimeout(()=>setMsg(""),2000);}
  };

  const saveParams=async()=>{
    await dbCall("update","aquariums",{params},{id:aquarium.id},jwt);
    setMsg("✓ Gespeichert");setTimeout(()=>setMsg(""),2000);
  };

  return (
    <div className="tab-scroll">
      <div className="stt-row">
        <button className={`stt-btn ${sec==="system"?"stt-on":""}`} onClick={()=>setSec("system")}>⚙ System</button>
        <button className={`stt-btn ${sec==="params"?"stt-on":""}`} onClick={()=>setSec("params")}>⬡ Parameter</button>
        <button className={`stt-btn ${sec==="ha"?"stt-on":""}`} onClick={()=>setSec("ha")}>🏠 HA</button>
      </div>

      {sec==="system"&&<>
        <Card><Sect>Aquarium</Sect>
          <div className="af"><label>Name</label><input className="sett-inp" value={loc.name} onChange={e=>setLoc(l=>({...l,name:e.target.value}))}/></div>
          <div className="af"><label>Volumen (L)</label><input className="sett-inp" type="number" value={loc.volume} onChange={e=>setLoc(l=>({...l,volume:+e.target.value}))}/></div>
        </Card>
        <Card><Sect>ESP32</Sect>
          <div className="af"><label>IP-Adresse</label><input className="sett-inp" value={loc.esp_ip} onChange={e=>setLoc(l=>({...l,esp_ip:e.target.value}))}/></div>
          <div className="af"><label>ml/ms</label><input className="sett-inp" type="number" step="0.00001" value={loc.ml_per_ms} onChange={e=>setLoc(l=>({...l,ml_per_ms:+e.target.value}))}/></div>
        </Card>
        <Btn color="#00d4ff" onClick={saveSystem}>{msg||"Speichern"}</Btn>
      </>}

      {sec==="params"&&<>
        <Card><Sect>Parameter</Sect>
          <select className="sett-inp" value={selParam||""} onChange={e=>setSelParam(e.target.value)}>
            {params.map(p=><option key={p.id} value={p.id}>{p.enabled?"✓":"○"} {p.label} ({p.unit})</option>)}
          </select>
        </Card>
        {param&&<>
          <Card><Sect color={param.color}>Grundeinstellungen – {param.label}</Sect>
            <div className="af"><label>Aktiv</label><label className="switch"><input type="checkbox" checked={param.enabled} onChange={e=>up("enabled")(e.target.checked)}/><span className="sw-track"/></label></div>
            <div className="af"><label>Zielwert ({param.unit})</label><input className="sett-inp" type="number" value={param.target} onChange={e=>up("target")(+e.target.value)}/></div>
            <div className="af"><label>Pumpe Nr.</label><input className="sett-inp" type="number" min="1" max="6" value={param.pump} onChange={e=>up("pump")(+e.target.value)}/></div>
            <div className="af"><label>ml/100L pro 1 {param.unit}</label><input className="sett-inp" type="number" step="0.01" value={param.mlPer100L} onChange={e=>up("mlPer100L")(+e.target.value)}/></div>
            <div className="af"><label>Farbe</label><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{COLORS.map(c=><button key={c} style={{width:22,height:22,borderRadius:"50%",background:c,border:param.color===c?"2px solid #fff":"2px solid transparent",cursor:"pointer"}} onClick={()=>up("color")(c)}/>)}</div></div>
          </Card>
          <Card><Sect color={param.color}>🎯 Zielbereiche</Sect>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,alignItems:"end"}}>
              <div className="af"><label style={{color:"#00ffb3"}}>OK von</label><input className="sett-inp" type="number" step="0.1" value={param.tolOkLow??""} onChange={e=>up("tolOkLow")(+e.target.value)}/></div>
              <span style={{color:"var(--muted)",paddingBottom:10}}>–</span>
              <div className="af"><label style={{color:"#00ffb3"}}>OK bis</label><input className="sett-inp" type="number" step="0.1" value={param.tolOkHigh??""} onChange={e=>up("tolOkHigh")(+e.target.value)}/></div>
              <div className="af"><label style={{color:"#ffe600"}}>Warn von</label><input className="sett-inp" type="number" step="0.1" value={param.tolWarnLow??""} onChange={e=>up("tolWarnLow")(+e.target.value)}/></div>
              <span style={{color:"var(--muted)",paddingBottom:10}}>–</span>
              <div className="af"><label style={{color:"#ffe600"}}>Warn bis</label><input className="sett-inp" type="number" step="0.1" value={param.tolWarnHigh??""} onChange={e=>up("tolWarnHigh")(+e.target.value)}/></div>
            </div>
          </Card>
          <Card><Sect color={param.color}>⏱ Dosierung</Sect>
            <div className="af"><label>Max/Tag (ml)</label><input className="sett-inp" type="number" value={param.maxDayMl} onChange={e=>up("maxDayMl")(+e.target.value)}/></div>
            <div className="af"><label>Max/Vorgang (ml)</label><input className="sett-inp" type="number" value={param.maxDoseMl} onChange={e=>up("maxDoseMl")(+e.target.value)}/></div>
            <div className="af"><label>Standard-Tagesdosis (ml)</label><input className="sett-inp" type="number" value={param.stdDayMl} onChange={e=>up("stdDayMl")(+e.target.value)}/></div>
            <div style={{display:"flex",gap:12,alignItems:"flex-end"}}>
              <div className="af" style={{flex:1}}><label>Von</label><select className="sett-inp" value={param.doseFrom} onChange={e=>up("doseFrom")(+e.target.value)}>{hours.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}</select></div>
              <span style={{color:"var(--muted)",paddingBottom:10}}>bis</span>
              <div className="af" style={{flex:1}}><label>Bis</label><select className="sett-inp" value={param.doseTo} onChange={e=>up("doseTo")(+e.target.value)}>{hours.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}</select></div>
            </div>
          </Card>

          <SalifertEditor param={param} updateParam={up}/>
        </>}
        <Btn color="#00d4ff" onClick={saveParams}>{msg||"Parameter speichern"}</Btn>
      </>}

      {sec==="ha"&&<>
        <Card><Sect>🏠 Home Assistant</Sect>
          <div className="af"><label>URL</label><input className="sett-inp" value={loc.ha_url} onChange={e=>setLoc(l=>({...l,ha_url:e.target.value}))} placeholder="http://homeassistant.local:8123"/></div>
          <div className="af"><label>Token</label><input className="sett-inp" type="password" value={loc.ha_token} onChange={e=>setLoc(l=>({...l,ha_token:e.target.value}))} placeholder="eyJ…"/></div>
        </Card>
        <Btn color="#00d4ff" onClick={saveSystem}>{msg||"Speichern"}</Btn>
      </>}
    </div>
  );
}

// ─── AQUARIUM APP ─────────────────────────────────────────────────────────────
const AQ_TABS=[
  {id:"messung",   label:"Messung",   icon:"📊"},
  {id:"dosierung", label:"Dosierung", icon:"💊"},
  {id:"besatz",    label:"Besatz",    icon:"🪸"},
  {id:"settings",  label:"Einst.",    icon:"⚙️"},
];

function AquariumApp({aquarium:initAq,session,onBack}) {
  const [tab,setTab]=useState("messung");
  const [aquarium,setAquarium]=useState(initAq);
  const [params,setParams]=useState(initAq.params||DEFAULT_PARAMS);

  return (
    <div className="app">
      <div className="top-bar">
        <button className="back-hdr" onClick={onBack}>← Aquarien</button>
        <div className="top-title">{aquarium.name}</div>
        <div className="top-meta">{aquarium.volume}L</div>
      </div>
      <div className="content-area">
        {tab==="messung"   &&<MessungTab      aquarium={aquarium} session={session} params={params}/>}
        {tab==="dosierung" &&<DosierungTab    aquarium={aquarium} session={session} params={params}/>}
        {tab==="besatz"    &&<BesatzTab       aquarium={aquarium} session={session}/>}
        {tab==="settings"  &&<EinstellungenTab aquarium={aquarium} session={session} params={params} setParams={setParams} onUpdateAquarium={aq=>{setAquarium(aq);setParams(aq.params||params);}}/>}
      </div>
      <nav className="tab-bar">
        {AQ_TABS.map(t=>(
          <button key={t.id} className={`tab-item ${tab===t.id?"tab-active":""}`} onClick={()=>setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-lbl">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session,setSession]=useState(()=>ls.get("session",null));
  const [view,setView]=useState("selector");
  const [selAq,setSelAq]=useState(null);

  // Token-Refresh
  useEffect(()=>{
    if(!session) return;
    const exp=session.expires_at||0;
    if(Date.now()/1000>exp-300){
      supabaseAuth("token?grant_type=refresh_token",{refresh_token:session.refresh_token})
        .then(r=>{if(r.access_token){ls.set("session",r);setSession(r);}else{ls.del("session");setSession(null);}});
    }
  },[]);

  const logout=()=>{ls.del("session");setSession(null);setView("selector");};

  if(!session) return (<><style>{CSS}</style><AuthScreen onLogin={s=>{setSession(s);}}/></>);

  if(view==="aquarium"&&selAq) return (<><style>{CSS}</style><AquariumApp aquarium={selAq} session={session} onBack={()=>setView("selector")}/></>);

  if(view==="global") return (
    <><style>{CSS}</style>
    <div className="app">
      <div className="top-bar"><div className="top-title">🌊 Gesamtbesatz</div></div>
      <div className="content-area"><GlobalBesatz session={session} onBack={()=>setView("selector")}/></div>
    </div></>
  );

  return (
    <><style>{CSS}</style>
    <div className="app" style={{overflowY:"auto"}}>
      <div style={{flex:1,overflowY:"auto"}}>
        <AquariumSelector session={session} onSelect={aq=>{setSelAq(aq);setView("aquarium");}} onGlobal={()=>setView("global")} onLogout={logout}/>
      </div>
    </div></>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#030d12;--surface:#0a1e28;--card:#0d2535;
  --border:rgba(0,212,255,0.12);--text:#d0eaf5;--muted:#4a7080;
  --cyan:#00d4ff;--green:#00ffb3;--red:#ff4444;--yellow:#ffe600;
  --fm:'Space Mono',monospace;--fb:'DM Sans',sans-serif;--r:16px;
}
body{background:var(--bg);color:var(--text);font-family:var(--fb);-webkit-tap-highlight-color:transparent;}

/* SHELL */
.app{height:100vh;display:flex;flex-direction:column;overflow:hidden;}
.top-bar{flex:0 0 auto;background:#040f17;border-bottom:2px solid rgba(0,212,255,.2);padding:12px 16px;display:flex;align-items:center;gap:10px;min-height:52px;}
.back-hdr{background:none;border:none;color:var(--cyan);font-family:var(--fm);font-size:11px;cursor:pointer;flex-shrink:0;white-space:nowrap;}
.top-title{font-family:var(--fm);font-size:15px;font-weight:700;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.top-meta{font-size:11px;color:var(--muted);font-family:var(--fm);flex-shrink:0;}
.content-area{flex:1;overflow:hidden;min-height:0;}
.tab-scroll{height:100%;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;}
.tab-scroll::-webkit-scrollbar{display:none;}

/* TAB BAR */
.tab-bar{flex:0 0 60px;display:flex;background:#040f17;border-top:2px solid rgba(0,212,255,.2);}
.tab-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:none;border:none;cursor:pointer;flex:1;padding:6px 2px;}
.tab-item:active{background:rgba(0,212,255,.08);}
.tab-active{background:rgba(0,212,255,.12)!important;border-top:2px solid var(--cyan);}
.tab-icon{font-size:19px;line-height:1;}
.tab-lbl{font-size:9px;font-weight:700;color:#7a9aaa;white-space:nowrap;font-family:var(--fb);}
.tab-active .tab-lbl{color:var(--cyan)!important;}

/* CARDS & BUTTONS */
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:16px;display:flex;flex-direction:column;gap:12px;}
.sect-title{font-family:var(--fm);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--cyan);}
.btn{width:100%;padding:15px;border-radius:14px;border:none;cursor:pointer;font-family:var(--fm);font-size:14px;font-weight:700;color:#000;background:var(--bc,var(--cyan));transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px;}
.btn:active:not(:disabled){transform:scale(.97);}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.btn-ghost{background:rgba(255,255,255,.07)!important;color:var(--text)!important;border:1.5px solid rgba(255,255,255,.15);}

/* AUTH */
.auth-bg{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(0,212,255,.1),transparent),var(--bg);}
.auth-box{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:32px;width:100%;max-width:400px;display:flex;flex-direction:column;gap:16px;}
.auth-logo{font-size:40px;text-align:center;color:var(--cyan);}
.auth-title{font-family:var(--fm);font-size:22px;font-weight:700;text-align:center;}
.auth-sub{font-size:13px;color:var(--muted);text-align:center;margin-top:-8px;}
.auth-tabs{display:flex;background:rgba(0,0,0,.3);border-radius:12px;padding:4px;gap:4px;}
.at-btn{flex:1;padding:10px;background:none;border:none;color:var(--muted);font-family:var(--fm);font-size:12px;font-weight:700;cursor:pointer;border-radius:8px;transition:all .2s;}
.at-active{background:rgba(0,212,255,.15);color:var(--cyan);}
.af{display:flex;flex-direction:column;gap:5px;}
.af label{font-size:12px;color:var(--muted);}
.ai{background:rgba(0,0,0,.4);border:1.5px solid var(--border);border-radius:12px;color:var(--text);padding:13px 16px;font-family:var(--fm);font-size:14px;width:100%;outline:none;transition:border-color .2s;}
.ai:focus{border-color:var(--cyan);}
.auth-err{background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.3);border-radius:10px;padding:10px;font-size:13px;color:#ff4444;text-align:center;}
.auth-ok{background:rgba(0,255,179,.1);border:1px solid rgba(0,255,179,.3);border-radius:10px;padding:10px;font-size:13px;color:#00ffb3;text-align:center;}

/* SELECTOR */
.selector-wrap{padding:20px;display:flex;flex-direction:column;gap:14px;max-width:600px;margin:0 auto;min-height:100vh;}
.sel-header{display:flex;align-items:center;justify-content:space-between;padding:8px 0;}
.sel-title{font-family:var(--fm);font-size:20px;font-weight:700;color:var(--cyan);}
.sel-user{font-size:13px;color:var(--muted);margin-top:3px;}
.logout-btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:20px;color:var(--muted);font-size:12px;padding:6px 14px;cursor:pointer;}
.global-btn{display:flex;align-items:center;gap:14px;background:rgba(0,212,255,.06);border:1.5px solid rgba(0,212,255,.2);border-radius:16px;padding:16px;cursor:pointer;width:100%;transition:all .2s;text-align:left;}
.global-btn:active{transform:scale(.98);}
.global-btn-title{font-family:var(--fm);font-size:14px;font-weight:700;color:var(--cyan);margin-bottom:3px;}
.global-btn-sub{font-size:12px;color:var(--muted);}
.sel-section{font-family:var(--fm);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);}
.aq-card{display:flex;align-items:center;gap:14px;background:var(--card);border:1.5px solid var(--border);border-radius:16px;padding:16px;cursor:pointer;transition:all .2s;}
.aq-card:active{border-color:var(--cyan);transform:scale(.98);}
.aq-name{font-family:var(--fm);font-size:15px;font-weight:700;margin-bottom:3px;}
.aq-meta{font-size:12px;color:var(--muted);}
.del-btn{background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.25);border-radius:8px;color:#ff4444;font-size:13px;padding:6px 10px;cursor:pointer;}

/* MESSUNG */
.mcard{background:var(--card);border:2px solid rgba(255,255,255,.08);border-radius:18px;padding:18px;cursor:pointer;display:flex;flex-direction:column;gap:12px;position:relative;transition:border-color .2s;}
.mcard:active{transform:scale(.98);}
.mcard-saved{border-color:var(--pc,var(--cyan))!important;}
.mcard-top{display:flex;align-items:center;gap:8px;}
.mdot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.mname{font-family:var(--fm);font-size:17px;font-weight:700;flex:1;}
.munit{font-size:12px;color:var(--muted);}
.mvals{display:flex;gap:16px;flex-wrap:wrap;}
.mlbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;}
.mval{font-family:var(--fm);font-size:22px;font-weight:700;}
.mvunit{font-size:11px;color:var(--muted);font-weight:400;}
.mbar{position:relative;height:5px;background:rgba(255,255,255,.06);border-radius:3px;}
.mbar-fill{height:100%;border-radius:3px;opacity:.8;transition:width .5s;}
.mbar-tgt{position:absolute;top:-4px;width:2px;height:13px;background:rgba(255,255,255,.35);border-radius:1px;transform:translateX(-50%);}
.save-flash{position:absolute;top:14px;right:14px;font-family:var(--fm);font-size:12px;font-weight:700;}
.pill{font-size:10px;padding:3px 9px;border-radius:20px;font-family:var(--fm);font-weight:700;}
.p-ok{background:rgba(0,255,179,.12);color:#00ffb3;border:1px solid rgba(0,255,179,.2);}
.p-warn{background:rgba(255,230,0,.1);color:#ffe600;border:1px solid rgba(255,230,0,.2);}
.p-err{background:rgba(255,68,68,.1);color:#ff4444;border:1px solid rgba(255,68,68,.2);}

/* POPUP */
.popup-overlay{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.78);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;}
.popup-box{background:#0a1e28;border:1px solid rgba(0,212,255,.2);border-radius:24px 24px 0 0;width:100%;max-width:600px;max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;padding-bottom:calc(20px + env(safe-area-inset-bottom,0px));animation:slideUp .25s ease;}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.popup-hdr{display:flex;align-items:center;gap:12px;padding:20px 20px 16px;border-bottom:1px solid;position:sticky;top:0;background:#0a1e28;z-index:1;}
.pop-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;}
.pop-title{font-family:var(--fm);font-size:20px;font-weight:700;}
.pop-sub{font-size:12px;color:var(--muted);margin-top:2px;}
.pop-close{background:rgba(255,255,255,.08);border:none;color:var(--text);width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:16px;margin-left:auto;flex-shrink:0;}
.pop-last{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:rgba(0,0,0,.2);}
.mode-row{display:flex;gap:8px;padding:14px 20px 6px;}
.mode-btn{flex:1;padding:12px;border-radius:12px;border:1.5px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#8ab0c0;font-family:var(--fm);font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;}
.mode-on{border-color:var(--mc,var(--cyan))!important;color:var(--mc,var(--cyan))!important;background:color-mix(in srgb,var(--mc,var(--cyan)) 15%,transparent)!important;}
.pop-section{padding:14px 20px;display:flex;flex-direction:column;gap:8px;}
.big-input{flex:1;background:rgba(0,0,0,.5);border:2px solid rgba(0,212,255,.25);border-radius:14px;color:var(--text);padding:16px 18px;font-family:var(--fm);font-size:26px;font-weight:700;outline:none;transition:border-color .2s;min-width:0;}
.big-input:focus{border-color:var(--ac,var(--cyan));}
.lookup-chip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px 12px;font-family:var(--fm);font-size:11px;color:var(--muted);cursor:pointer;}
.pop-result{margin:8px 20px;border-radius:14px;border:1px solid;padding:16px;display:flex;flex-direction:column;gap:12px;}
.status-pill{padding:7px 14px;border-radius:20px;font-family:var(--fm);font-size:12px;font-weight:700;flex-shrink:0;}
.sp-ok{background:rgba(0,255,179,.12);color:#00ffb3;border:1px solid rgba(0,255,179,.25);}
.sp-warn{background:rgba(255,230,0,.1);color:#ffe600;border:1px solid rgba(255,230,0,.2);}
.sp-err{background:rgba(255,68,68,.1);color:#ff4444;border:1px solid rgba(255,68,68,.2);}
.analysis-box{background:rgba(0,0,0,.3);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px;}
.icp-row{padding:0 20px 4px;display:flex;flex-direction:column;gap:10px;margin-top:8px;}
.icp-label{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;cursor:pointer;padding:12px 14px;background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.15);border-radius:12px;}
.pop-actions{display:flex;gap:10px;padding:16px 20px 0;}
.pop-cancel{flex:1;padding:15px;border-radius:14px;border:1.5px solid rgba(255,255,255,.15);background:none;color:var(--text);font-family:var(--fm);font-size:14px;font-weight:700;cursor:pointer;}
.pop-save{flex:2;padding:15px;border-radius:14px;border:none;color:#000;font-family:var(--fm);font-size:14px;font-weight:700;cursor:pointer;}
.pop-save:disabled{cursor:not-allowed;filter:brightness(.5);}

/* BESATZ */
.search-inp{width:100%;background:rgba(0,0,0,.4);border:1.5px solid rgba(255,255,255,.18);border-radius:12px;color:var(--text);padding:13px 16px;font-family:var(--fb);font-size:14px;outline:none;}
.search-inp:focus{border-color:var(--cyan);}
.group-chips{display:flex;gap:6px;flex-wrap:wrap;}
.grp-chip{background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.2);border-radius:10px;padding:8px 10px;font-size:11px;font-family:var(--fm);font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;flex:1;min-width:0;justify-content:center;color:#b0ccd8;white-space:nowrap;transition:all .2s;}
.grp-chip:active{transform:scale(.96);}
.grp-active{border-color:var(--gc,var(--cyan))!important;color:var(--gc,var(--cyan))!important;background:color-mix(in srgb,var(--gc,var(--cyan)) 18%,transparent)!important;}
.grp-cnt{background:rgba(255,255,255,.12);border-radius:8px;padding:1px 5px;font-size:9px;}
.grp-hdr{display:flex;align-items:center;gap:8px;padding:8px 2px 6px;}
.grp-hdr-title{font-family:var(--fm);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;flex:1;}
.grp-cnt-badge{font-family:var(--fm);font-size:11px;color:var(--muted);background:rgba(255,255,255,.08);padding:2px 8px;border-radius:10px;}
.besatz-list{display:flex;flex-direction:column;gap:10px;margin-bottom:8px;}
.bitem{display:flex;align-items:center;gap:12px;background:var(--card);border:1.5px solid var(--border);border-radius:16px;padding:14px;transition:border-color .2s;}
.bemoji{font-size:32px;flex-shrink:0;line-height:1;}
.bphoto{width:44px;height:44px;border-radius:10px;object-fit:cover;border:1px solid var(--border);}
.binfo{flex:1;min-width:0;}
.bname{font-family:var(--fm);font-size:13px;font-weight:700;font-style:italic;margin-bottom:2px;}
.btype{font-size:12px;color:var(--muted);}

/* VERLAUF */
.toggle-chip{padding:10px 16px;border-radius:14px;font-family:var(--fm);font-size:12px;font-weight:700;cursor:pointer;border:2px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#b0ccd8;transition:all .2s;}
.tc-on{border-color:var(--c,var(--cyan));color:var(--c,var(--cyan));background:color-mix(in srgb,var(--c,var(--cyan)) 15%,transparent);}
.chart-tt{background:rgba(5,20,30,.95);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-family:var(--fm);}

/* EINSTELLUNGEN */
.stt-row{display:flex;background:rgba(0,0,0,.4);border:1.5px solid rgba(255,255,255,.14);border-radius:12px;padding:4px;flex-shrink:0;}
.stt-btn{flex:1;padding:11px 4px;background:none;border:none;color:#6a8898;font-family:var(--fm);font-size:11px;font-weight:700;cursor:pointer;border-radius:8px;white-space:nowrap;transition:all .2s;}
.stt-on{background:rgba(0,212,255,.18)!important;color:var(--cyan)!important;}
.sett-inp{background:rgba(0,0,0,.45);border:1.5px solid var(--border);border-radius:10px;color:var(--text);padding:12px 14px;font-family:var(--fm);font-size:13px;width:100%;outline:none;transition:border-color .2s;}
.sett-inp:focus{border-color:var(--cyan);}
.switch{position:relative;display:inline-block;width:44px;height:26px;}
.switch input{opacity:0;width:0;height:0;}
.sw-track{position:absolute;cursor:pointer;inset:0;background:rgba(255,255,255,.1);border-radius:13px;transition:.3s;border:1px solid var(--border);}
.sw-track:before{content:"";position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:var(--muted);border-radius:50%;transition:.3s;}
input:checked+.sw-track{background:rgba(0,212,255,.3);border-color:var(--cyan);}
input:checked+.sw-track:before{transform:translateX(18px);background:var(--cyan);}

/* GLOBAL BESATZ */
.count-chip{background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);border-radius:20px;padding:5px 14px;font-family:var(--fm);font-size:12px;color:var(--cyan);}

/* MISC */
.pe-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;}
.pe-f{display:flex;flex-direction:column;gap:4px;}
.pe-f label{font-size:10px;color:var(--muted);}
.pe-wide{grid-column:span 2;}
.pe-inp{background:rgba(0,0,0,.4);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px 12px;font-family:var(--fm);font-size:13px;width:100%;outline:none;}
.back-btn{background:none;border:none;color:var(--cyan);cursor:pointer;font-family:var(--fm);font-size:12px;padding:0;align-self:flex-start;}
.page-title{font-family:var(--fm);font-size:20px;font-weight:700;}
.loading-row{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted);}
.empty-state{text-align:center;padding:48px 20px;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:12px;}
.empty-state div{font-size:44px;opacity:.5;}
.empty-state p{font-size:14px;}
.sub-tab-row{display:flex;background:rgba(0,0,0,.35);border:1.5px solid rgba(255,255,255,.12);border-radius:12px;padding:3px;gap:3px;}
.sub-tab{flex:1;padding:10px;background:none;border:none;color:#6a8898;font-family:var(--fm);font-size:12px;font-weight:700;cursor:pointer;border-radius:9px;transition:all .2s;}
.sub-tab-on{background:rgba(0,212,255,.18)!important;color:var(--cyan)!important;}
.param-chip{padding:10px 14px;border-radius:12px;font-family:var(--fm);font-size:12px;font-weight:700;cursor:pointer;border:2px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#b0ccd8;transition:all .2s;display:flex;align-items:center;gap:6px;}
.param-chip-on{border-color:var(--c,var(--cyan))!important;color:var(--c,var(--cyan))!important;background:color-mix(in srgb,var(--c,var(--cyan)) 15%,transparent)!important;}
.pc-badge{background:var(--red);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;}
.step-add-btn{background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.3);border-radius:8px;color:var(--cyan);font-family:var(--fm);font-size:11px;font-weight:700;padding:5px 11px;cursor:pointer;}
.salifert-table{display:flex;flex-direction:column;gap:4px;max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:8px;}
.salifert-table-hdr{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;padding:4px 6px;font-size:10px;color:var(--muted);font-family:var(--fm);text-transform:uppercase;letter-spacing:.06em;}
.salifert-table-row{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center;padding:6px 8px;background:rgba(0,0,0,.2);border-radius:8px;}
.spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.15);border-top-color:currentColor;border-radius:50%;animation:spin .6s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
::-webkit-scrollbar{width:0;height:0;}
`;
