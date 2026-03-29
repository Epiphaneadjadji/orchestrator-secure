import { useState, useEffect, useRef, useCallback } from 'react'
import { useInstallPrompt } from './useInstallPrompt.js'

// ── Constants ─────────────────────────────────────────────────────────────────
const MODELS = {
  opus:   { id: 'claude-opus-4-5-20251101',   label: 'Opus 4.6',   cost: 'High', color: '#6D28D9', bg: '#EDE9FE', border: '#C4B5FD' },
  sonnet: { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4.6', cost: 'Mid',  color: '#0F766E', bg: '#CCFBF1', border: '#5EEAD4' },
  haiku:  { id: 'claude-haiku-4-5-20251001',  label: 'Haiku 4.5',  cost: 'Low',  color: '#92400E', bg: '#FEF3C7', border: '#FCD34D' },
}

const ROUTING_RULES = [
  { keywords: ['architect','system design','database schema','tech stack','trade-off','scalability','data model'], model: 'opus',   label: 'Architecture & strategy' },
  { keywords: ['strategy','roadmap','investor','pitch','business model','market','competitive'],                   model: 'opus',   label: 'Strategy & planning' },
  { keywords: ['build','implement','feature','component','api','endpoint','debug','fix','refactor','code','develop','screen','page'], model: 'sonnet', label: 'Development' },
  { keywords: ['design','ui','ux','wireframe','layout','interface','user flow','prototype','style'],               model: 'sonnet', label: 'Design' },
  { keywords: ['test','unit test','mock','fixture','boilerplate','generate','bulk','scaffold','stub','template'],  model: 'haiku',  label: 'Bulk / repetitive' },
  { keywords: ['classify','label','tag','sort','summarise','summarize','quick','simple','list','translate'],       model: 'haiku',  label: 'Fast / simple' },
]

const REFINER_SYSTEM = `You are an expert prompt engineer. Transform a rough task description into a precise, well-structured prompt for a large language model.
Rules:
- Output ONLY the refined prompt. No explanation, no preamble.
- Preserve intent exactly. Make task specific: output format, constraints, tech context.
- Under 180 words. Same language as the user (French or English).`

const HANDOFF_PROMPT = `Summarise this session:

## Session summary — ${new Date().toLocaleDateString()}
**Model:** [model name]
**Task:** [one line]

### Decisions
- [each decision]

### State
[what was built / decided]

### Next
[ ] [task 1]
[ ] [task 2]

Under 200 words. Appends to CONTEXT.md.`

const DEFAULT_CTX = `# Project context
Updated: — | Phase: —

## What this app does
[Describe your app, target users, core value]

## Tech stack
Frontend : —
Backend  : —
Database : —
Deploy   : —

## Decisions log
- [Date] First decision

## Current state
Phase       : Planning
Done        : —
In progress : —

## Next session
[ ] First task
`

const C = {
  bg: '#F8FAFC', surface: '#FFFFFF', border: '#E2E8F0',
  text: '#0F172A', muted: '#64748B', hint: '#94A3B8', accent: '#6D28D9',
}

function detectModel(text) {
  const lower = text.toLowerCase()
  for (const rule of ROUTING_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) return rule.model
  }
  return 'sonnet'
}

function fmtTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── SECURE API CALL — calls /api/claude, NOT Anthropic directly ───────────────
async function callClaude({ model, system, messages, stream = false, onChunk }) {
  const res = await fetch('/api/claude', {   // <-- Your Vercel serverless function
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, system, messages, stream, max_tokens: 1000 }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(err.error || `API error ${res.status}`)
  }

  if (!stream) {
    const d = await res.json()
    return d.content?.[0]?.text || ''
  }

  // Streaming
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    for (const line of dec.decode(value).split('\n')) {
      if (!line.startsWith('data:')) continue
      const d = line.slice(5).trim()
      if (d === '[DONE]') continue
      try {
        const j = JSON.parse(d)
        if (j.type === 'content_block_delta' && j.delta?.text) {
          full += j.delta.text; onChunk?.(full)
        }
      } catch {}
    }
  }
  return full
}

const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}

function Badge({ mk, size = 'sm' }) {
  const m = MODELS[mk]
  return (
    <span style={{
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      borderRadius: 20, padding: size === 'lg' ? '5px 12px' : '2px 9px',
      fontSize: size === 'lg' ? 13 : 11, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color }} />
      {m.label}
    </span>
  )
}

function Toggle({ on, onChange, label, accent = C.accent }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
      <div onClick={onChange} style={{
        width: 34, height: 18, borderRadius: 9, background: on ? accent : '#CBD5E1',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: 2, left: on ? 16 : 2,
          width: 14, height: 14, borderRadius: '50%', background: 'white',
          transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: on ? accent : C.muted }}>{label}</span>
    </label>
  )
}

function Msg({ msg }) {
  if (msg.role === 'divider') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', fontSize: 11, color: C.hint }}>
      <span style={{ flex: 1, height: 1, background: C.border }} />
      {msg.content}
      <span style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  )
  const isUser = msg.role === 'user'
  return (
    <div style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: 10, marginBottom: 14 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: isUser ? '#0EA5E9' : C.accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: 'white', fontWeight: 700,
      }}>{isUser ? 'You' : 'AI'}</div>
      <div style={{ maxWidth: '78%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexDirection: isUser ? 'row-reverse' : 'row' }}>
          {!isUser && msg.model && <Badge mk={msg.model} />}
          {msg.wasRefined && (
            <span style={{ fontSize: 10, color: '#6D28D9', background: '#EDE9FE', border: '1px solid #C4B5FD', borderRadius: 20, padding: '1px 7px', fontWeight: 600 }}>✦ refined</span>
          )}
          <span style={{ fontSize: 11, color: C.hint }}>{msg.time}</span>
        </div>
        <div style={{
          background: isUser ? '#0EA5E9' : C.surface, color: isUser ? 'white' : C.text,
          borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
          padding: '10px 14px', fontSize: 13.5, lineHeight: 1.65,
          border: isUser ? 'none' : `1px solid ${C.border}`,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {msg.content || <span style={{ opacity: 0.35 }}>▌</span>}
        </div>
        {msg.originalPrompt && (
          <div style={{ fontSize: 11, color: C.hint, marginTop: 4, fontStyle: 'italic', paddingLeft: 4 }}>
            Original: "{msg.originalPrompt.slice(0, 72)}{msg.originalPrompt.length > 72 ? '…' : ''}"
          </div>
        )}
      </div>
    </div>
  )
}

function RefinerPanel({ raw, refined, loading, chosenModel, onApprove, onRegenerate, onDiscard }) {
  const [edited, setEdited] = useState(refined)
  useEffect(() => setEdited(refined), [refined])
  const words = raw.trim().split(/\s+/).length
  const quality = words < 4
    ? { label: 'Very vague', color: '#DC2626', tip: 'Add: what feature, what output, what constraint' }
    : words < 10
      ? { label: 'Needs context', color: '#D97706', tip: 'Specify feature name, output format, or stack hint' }
      : { label: 'Ready to refine', color: '#059669', tip: 'Refiner will sharpen structure' }
  return (
    <div style={{ background: C.surface, border: `1.5px solid ${C.accent}44`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, color: C.accent }}>✦</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Prompt refiner</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: quality.color }}>{quality.label}</span>
        {chosenModel && <Badge mk={chosenModel} />}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ padding: 14, borderRight: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.hint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Your rough prompt</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, background: '#F8FAFC', borderRadius: 8, padding: '10px 12px', minHeight: 80, border: `1px solid ${C.border}` }}>{raw}</div>
          <div style={{ fontSize: 11, color: C.hint, marginTop: 6, lineHeight: 1.5 }}>💡 {quality.tip}</div>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            {loading ? 'Optimising…' : 'Refined — edit if needed'}
          </div>
          {loading
            ? <div style={{ fontSize: 13, color: C.muted, background: '#FAFFFE', borderRadius: 8, padding: '10px 12px', minHeight: 80, border: `1.5px solid ${C.accent}33`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Haiku refining…
              </div>
            : <textarea value={edited} onChange={e => setEdited(e.target.value)} style={{ width: '100%', minHeight: 92, border: `1.5px solid ${C.accent}55`, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: C.text, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', background: '#FAFFFE', outline: 'none', boxSizing: 'border-box' }} />
          }
        </div>
      </div>
      {!loading && (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, background: '#FAFAFA', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onRegenerate} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, cursor: 'pointer' }}>↺ Re-refine</button>
          <button onClick={onDiscard}    style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, cursor: 'pointer' }}>✕ Use original</button>
          <div style={{ marginLeft: 'auto' }}>
            <button onClick={() => onApprove(edited)} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: C.accent, color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Send ↑</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState('chat')
  const [contextMd, setContextMd] = useState(() => store.get('ctx') || DEFAULT_CTX)
  const [savedCtx, setSavedCtx]   = useState(() => store.get('ctx') || DEFAULT_CTX)
  const [projectName, setProjectName] = useState(() => store.get('pname') || 'My App')
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [autoRoute, setAutoRoute] = useState(true)
  const [modelOverride, setModelOverride] = useState(null)
  const [refinerOn, setRefinerOn] = useState(true)
  const [refiner, setRefiner]     = useState(null)
  const [busy, setBusy]           = useState(false)
  const [sessionModel, setSessionModel] = useState(null)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [apiError, setApiError]   = useState(null)
  const bottomRef = useRef(null)
  const { canInstall, install, isInstalled } = useInstallPrompt()

  useEffect(() => {
    const on = () => setIsOffline(false)
    const off = () => setIsOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, refiner])

  const sysPrompt = useCallback((mk) =>
    `You are a senior AI development assistant for "${projectName}".\n\nProject context:\n---\n${savedCtx}\n---\n\nRules: Concise, direct. No preamble. Follow tech stack above. Model: ${MODELS[mk].label}.`,
    [projectName, savedCtx])

  const submit = useCallback(async () => {
    if (!input.trim() || busy || refiner) return
    setApiError(null)
    const raw = input.trim()
    const chosen = modelOverride || detectModel(raw)
    setInput('')
    if (!refinerOn) { await sendMsg(raw, raw, chosen, false); return }
    setRefiner({ raw, refined: '', loading: true, chosenModel: chosen })
    try {
      const refined = await callClaude({
        model: MODELS.haiku.id, system: REFINER_SYSTEM, stream: false,
        messages: [{ role: 'user', content: `Context:\n${savedCtx.slice(0, 300)}\n\nTask:\n${raw}` }],
      })
      setRefiner(p => ({ ...p, refined, loading: false }))
    } catch (err) {
      setApiError(err.message)
      setRefiner(p => ({ ...p, refined: raw, loading: false }))
    }
  }, [input, busy, refiner, refinerOn, modelOverride, savedCtx])

  const sendMsg = useCallback(async (prompt, original, mk, wasRefined) => {
    setRefiner(null); setBusy(true); setSessionModel(mk); setApiError(null)
    const rule = ROUTING_RULES.find(r => r.model === mk)
    setMessages(p => [...p,
      { role: 'user', content: prompt, time: fmtTime(), wasRefined, originalPrompt: wasRefined ? original : null },
      { role: 'divider', content: `${MODELS[mk].label} · ${rule?.label || 'General'}${wasRefined ? ' · ✦ refined' : ''}` },
      { role: 'assistant', content: '', model: mk, time: fmtTime() },
    ])
    const hist = messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }))
    try {
      await callClaude({
        model: MODELS[mk].id, system: sysPrompt(mk), stream: true,
        messages: [...hist, { role: 'user', content: prompt }],
        onChunk: (partial) => setMessages(p => { const c=[...p]; c[c.length-1]={...c[c.length-1],content:partial}; return c }),
      })
    } catch (err) {
      setApiError(err.message)
      setMessages(p => { const c=[...p]; c[c.length-1]={...c[c.length-1],content:`Error: ${err.message}`}; return c })
    }
    setBusy(false)
  }, [messages, sysPrompt])

  const handleApprove   = useCallback((e) => { if (refiner) sendMsg(e, refiner.raw, refiner.chosenModel, true) }, [refiner, sendMsg])
  const handleDiscard   = useCallback(() => { if (refiner) sendMsg(refiner.raw, refiner.raw, refiner.chosenModel, false) }, [refiner, sendMsg])
  const handleRegen     = useCallback(async () => {
    if (!refiner) return
    setRefiner(p => ({ ...p, loading: true }))
    try {
      const refined = await callClaude({ model: MODELS.haiku.id, system: REFINER_SYSTEM, stream: false, messages: [{ role: 'user', content: `Context:\n${savedCtx.slice(0,300)}\n\nTask:\n${refiner.raw}` }] })
      setRefiner(p => ({ ...p, refined, loading: false }))
    } catch { setRefiner(p => ({ ...p, loading: false })) }
  }, [refiner, savedCtx])

  const endSession = useCallback(async () => {
    if (!messages.length || busy) return
    setBusy(true)
    const mk = sessionModel || 'sonnet'
    setMessages(p => [...p, { role: 'divider', content: 'Generating session handoff…' }, { role: 'assistant', content: '', model: mk, time: fmtTime() }])
    const hist = messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }))
    try {
      let summary = ''
      await callClaude({ model: MODELS[mk].id, system: sysPrompt(mk), stream: true,
        messages: [...hist, { role: 'user', content: HANDOFF_PROMPT }],
        onChunk: (p) => { summary=p; setMessages(prev => { const c=[...prev]; c[c.length-1]={...c[c.length-1],content:p}; return c }) }
      })
      const updated = savedCtx.trimEnd() + '\n\n---\n' + summary
      setContextMd(updated); setSavedCtx(updated); store.set('ctx', updated)
      setMessages(p => [...p, { role: 'divider', content: '✓ Handoff saved to CONTEXT.md' }])
    } catch (e) { console.error(e) }
    setBusy(false)
  }, [messages, busy, sessionModel, sysPrompt, savedCtx])

  const saveCtx = () => { setSavedCtx(contextMd); store.set('ctx', contextMd); store.set('pname', projectName) }

  return (
    <div style={{ fontFamily: "'IBM Plex Sans','Segoe UI',sans-serif", background: C.bg, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}`}</style>

      {isOffline && <div style={{ background:'#FEF3C7', borderBottom:'1px solid #FCD34D', padding:'8px 16px', fontSize:12, color:'#92400E', textAlign:'center', fontWeight:500 }}>Offline — AI calls need internet connection</div>}
      {apiError  && <div style={{ background:'#FCEBEB', borderBottom:'1px solid #F09595', padding:'8px 16px', fontSize:12, color:'#A32D2D', textAlign:'center' }}>{apiError} <button onClick={()=>setApiError(null)} style={{marginLeft:8,border:'none',background:'none',color:'#A32D2D',cursor:'pointer',fontWeight:700}}>✕</button></div>}

      {/* Top bar */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'0 16px', height:52, display:'flex', alignItems:'center', gap:12, position:'sticky', top:0, zIndex:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <div style={{ width:30, height:30, borderRadius:9, background:'linear-gradient(135deg,#6D28D9,#0F766E)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, color:'white', fontWeight:900 }}>⚡</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, lineHeight:1 }}>{projectName}</div>
            <div style={{ fontSize:10, color:C.hint, marginTop:1 }}>AI Orchestrator{isInstalled ? ' · Installed' : ''}</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:2, background:'#F1F5F9', borderRadius:8, padding:3, marginLeft:6 }}>
          {[['chat','💬 Chat'],['context','📄 Context'],['settings','⚙️ Settings']].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{ padding:'4px 10px', borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontWeight:500, background:tab===k?C.surface:'transparent', color:tab===k?C.text:C.muted, boxShadow:tab===k?'0 1px 2px rgba(0,0,0,0.06)':'none' }}>{l}</button>
          ))}
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          {canInstall && !isInstalled && <button onClick={install} style={{ padding:'5px 12px', borderRadius:8, border:`1px solid ${C.accent}`, background:'#EDE9FE', color:C.accent, fontSize:11, fontWeight:700, cursor:'pointer' }}>↓ Install</button>}
          {sessionModel && <Badge mk={sessionModel} />}
          {messages.length>0 && !busy && <button onClick={endSession} style={{ padding:'5px 12px', borderRadius:8, border:'none', background:C.accent, color:'white', fontSize:12, fontWeight:600, cursor:'pointer' }}>End →</button>}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1, padding:'12px 16px', paddingBottom:'calc(12px + env(safe-area-inset-bottom))', display:'flex', flexDirection:'column', gap:10, maxWidth:860, width:'100%', margin:'0 auto' }}>

        {tab==='chat' && <>
          <div style={{ background:C.surface, borderRadius:12, padding:'9px 14px', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <Toggle on={refinerOn} onChange={()=>setRefinerOn(p=>!p)} label={`✦ Refiner ${refinerOn?'ON':'OFF'}`} />
            <div style={{ width:1, height:18, background:C.border }} />
            <Toggle on={autoRoute} onChange={()=>{setAutoRoute(p=>!p);setModelOverride(null)}} label="Auto-route" accent="#0F766E" />
            {!autoRoute && <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>{Object.keys(MODELS).map(k=>(
              <button key={k} onClick={()=>setModelOverride(k)} style={{ padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer', border:`1.5px solid ${modelOverride===k?MODELS[k].color:C.border}`, background:modelOverride===k?MODELS[k].bg:C.surface, color:modelOverride===k?MODELS[k].color:C.muted }}>{MODELS[k].label}</button>
            ))}</div>}
            {autoRoute && input && !refiner && (()=>{ const mk=detectModel(input); const m=MODELS[mk]; const rule=ROUTING_RULES.find(r=>r.model===mk); return <div style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:20, background:m.bg, border:`1px solid ${m.border}`, fontSize:11, color:m.color, fontWeight:500 }}>⚡ {rule?.label} → <Badge mk={mk} /></div> })()}
            {messages.length>0 && <button onClick={()=>{setMessages([]);setSessionModel(null);setRefiner(null)}} style={{ marginLeft:'auto', padding:'3px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:C.surface, color:C.hint, fontSize:11, cursor:'pointer' }}>Clear</button>}
          </div>

          <div style={{ flex:1, minHeight:240, maxHeight:420, overflowY:'auto', padding:'2px 0', WebkitOverflowScrolling:'touch' }}>
            {messages.length===0 && !refiner
              ? <div style={{ textAlign:'center', padding:'40px 16px', color:C.hint }}>
                  <div style={{ fontSize:32, marginBottom:10 }}>✦</div>
                  <div style={{ fontSize:14, fontWeight:700, color:C.muted, marginBottom:6 }}>Type any task — rough notes welcome</div>
                  <div style={{ fontSize:12, lineHeight:1.7, maxWidth:360, margin:'0 auto 14px' }}>The refiner turns rough notes into a precise prompt, routes to the right model, and injects your project context automatically.</div>
                  <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>
                    {['design quiz scoring','build auth flow','generate tests','ASO keywords'].map(s=>(
                      <button key={s} onClick={()=>setInput(s)} style={{ padding:'6px 14px', borderRadius:20, border:`1px solid ${C.border}`, background:C.surface, color:C.muted, fontSize:12, cursor:'pointer' }}>{s}</button>
                    ))}
                  </div>
                </div>
              : messages.map((m,i)=><Msg key={i} msg={m} />)}
            <div ref={bottomRef} />
          </div>

          {refiner && <RefinerPanel raw={refiner.raw} refined={refiner.refined} loading={refiner.loading} chosenModel={refiner.chosenModel} onApprove={handleApprove} onRegenerate={handleRegen} onDiscard={handleDiscard} />}

          {!refiner && <div style={{ background:C.surface, borderRadius:14, border:`2px solid ${busy?C.accent+'55':C.border}`, padding:'10px 14px', display:'flex', gap:10, alignItems:'flex-end', transition:'border-color .2s' }}>
            <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit()}}} placeholder={refinerOn?'Type rough notes — refiner optimises before sending…':'Describe your task (Enter to send)'} rows={2} style={{ flex:1, border:'none', outline:'none', resize:'none', fontSize:14, color:C.text, lineHeight:1.5, background:'transparent', fontFamily:'inherit' }} />
            <button onClick={submit} disabled={busy||!input.trim()} style={{ width:38, height:38, borderRadius:10, border:'none', background:busy?C.border:C.accent, color:busy?C.hint:'white', cursor:busy||!input.trim()?'not-allowed':'pointer', fontSize:refinerOn?15:16, flexShrink:0 }}>{busy?'…':refinerOn?'✦':'↑'}</button>
          </div>}
        </>}

        {tab==='context' && <div style={{ display:'flex', flexDirection:'column', gap:10, flex:1 }}>
          <div style={{ background:'#EDE9FE', borderRadius:10, padding:'10px 14px', fontSize:12, color:'#5B21B6', lineHeight:1.6, border:'1px solid #C4B5FD' }}>
            <strong>Auto-injected into every session.</strong> Edit here or click "End →" to auto-append handoff summaries. Saved to device storage.
          </div>
          <textarea value={contextMd} onChange={e=>setContextMd(e.target.value)} style={{ flex:1, minHeight:380, border:`1px solid ${C.border}`, borderRadius:12, padding:'14px 16px', fontSize:13, lineHeight:1.7, fontFamily:'monospace', color:C.text, background:C.surface, resize:'none', outline:'none' }} />
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button onClick={()=>setContextMd(DEFAULT_CTX)} style={{ padding:'7px 14px', borderRadius:8, border:`1px solid ${C.border}`, background:C.surface, color:C.muted, fontSize:12, cursor:'pointer' }}>Reset</button>
            <button onClick={saveCtx} style={{ padding:'7px 20px', borderRadius:8, border:'none', background:C.accent, color:'white', fontSize:13, fontWeight:600, cursor:'pointer' }}>Save &amp; apply</button>
          </div>
        </div>}

        {tab==='settings' && <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ background:C.surface, borderRadius:12, padding:16, border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:8 }}>Project name</div>
            <input value={projectName} onChange={e=>setProjectName(e.target.value)} style={{ width:'100%', padding:'8px 12px', borderRadius:8, border:`1px solid ${C.border}`, fontSize:13, color:C.text, outline:'none' }} />
          </div>
          <div style={{ background:'#CCFBF1', borderRadius:12, padding:14, border:'1px solid #5EEAD4', fontSize:12, color:'#0F766E', lineHeight:1.7 }}>
            <strong>Security:</strong> This version uses a server-side API proxy. Your Anthropic key is stored as a Vercel environment variable — never in the browser. Rate limiting: 10 requests/minute per IP.
          </div>
          {canInstall && !isInstalled && <div style={{ background:'#EDE9FE', borderRadius:12, padding:16, border:'1px solid #C4B5FD', display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:700, color:'#5B21B6', marginBottom:2 }}>Install on this device</div><div style={{ fontSize:12, color:'#7C3AED' }}>Adds to home screen — works like a native app</div></div>
            <button onClick={install} style={{ padding:'8px 16px', borderRadius:8, border:'none', background:C.accent, color:'white', fontSize:13, fontWeight:600, cursor:'pointer' }}>Install ↓</button>
          </div>}
          {isInstalled && <div style={{ background:'#CCFBF1', borderRadius:12, padding:14, border:'1px solid #5EEAD4', fontSize:12, color:'#0F766E', fontWeight:500 }}>✓ Running as installed PWA</div>}
          <button onClick={saveCtx} style={{ padding:'9px 20px', borderRadius:10, border:'none', background:C.accent, color:'white', fontSize:13, fontWeight:600, cursor:'pointer' }}>Save settings</button>
        </div>}
      </div>
    </div>
  )
}
