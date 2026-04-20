import { useState, useCallback, useMemo } from "react";

const C = {
  bg:"#060810",card:"#0E1319",card2:"#151C2A",border:"#1A2438",
  g:"#34D399",gd:"#165C40",gg:"rgba(52,211,153,0.08)",
  b:"#60A5FA",bd:"#1E3A5F",bg2:"rgba(96,165,250,0.1)",
  r:"#F87171",rd:"#5C2020",a:"#FBBF24",ad:"#5C4A10",
  t:"#E8ECF4",d:"#7B8BA2",m:"#3D4E66",
};

const STOCKS = [
  "Reliance Industries","TCS","HDFC Bank","Infosys","ITC","ICICI Bank",
  "Hindustan Unilever","SBI","Bharti Airtel","Tata Motors","Wipro",
  "Maruti Suzuki","Sun Pharma","Titan Company","Bajaj Finance",
  "Asian Paints","Axis Bank","L&T","Nestle India","HCL Tech",
  "NTPC","Power Grid","Tata Steel","Coal India","Adani Ports",
  "Kotak Mahindra Bank","Bajaj Finserv","Tata Consumer","Divis Labs","Cipla",
  "Ultratech Cement","Grasim Industries","Tech Mahindra","Mahindra & Mahindra",
  "JSW Steel","Hindalco","IndusInd Bank","ONGC","BPCL","IOC",
];

function fmt(n){if(n==null||isNaN(n))return"—";const a=Math.abs(n);if(a>=1e12)return"₹"+(n/1e12).toFixed(2)+"T";if(a>=1e7)return"₹"+(n/1e7).toFixed(2)+" Cr";if(a>=1e5)return"₹"+(n/1e5).toFixed(2)+" L";return"₹"+n.toFixed(2);}
function fP(n){return n==null||isNaN(n)?"—":(n>0?"+":"")+n.toFixed(1)+"%";}
function fN(n){return n==null||isNaN(n)?"—":n.toFixed(2);}

function extractJSON(text){
  if(!text)return null;
  try{return JSON.parse(text)}catch{}
  let s=text.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  try{return JSON.parse(s)}catch{}
  const i=s.indexOf("{"),j=s.lastIndexOf("}");
  if(i>=0&&j>i){try{return JSON.parse(s.substring(i,j+1))}catch{}}
  // Remove trailing commas before } or ]
  s=s.replace(/,\s*([}\]])/g,"$1");
  try{return JSON.parse(s)}catch{}
  return null;
}

async function fetchStockData(name){
  const prompt=`You are a financial data API. Return the latest known financial data for "${name}" (NSE India listed company).

Use your most recent training data. All monetary values must be in INR as raw numbers. Percentages as plain numbers (e.g. ROE of 42% = 42, profit margin of 18% = 18). Market cap, revenue, etc as raw numbers in INR (e.g. 1350000000000 for ₹1.35T).

Respond with ONLY this JSON object filled with real data. No explanation, no markdown, no backticks. Just the JSON:

{"companyName":"full name","ticker":"NSE_SYMBOL","sector":"sector","industry":"industry","currentPrice":0,"marketCap":0,"sharesOutstanding":0,"eps":0,"bookValuePerShare":0,"dividendPerShare":0,"dividendYield":0,"peRatio":0,"pbRatio":0,"debtToEquity":0,"currentRatio":0,"roe":0,"roa":0,"profitMargin":0,"operatingMargin":0,"grossMargin":0,"revenueGrowth":0,"earningsGrowth":0,"freeCashFlow":0,"operatingCashFlow":0,"totalRevenue":0,"ebit":0,"netIncome":0,"totalAssets":0,"totalLiabilities":0,"totalCurrentAssets":0,"totalCurrentLiabilities":0,"totalStockholderEquity":0,"longTermDebt":0,"capex":0,"depreciation":0,"targetMeanPrice":0,"targetHighPrice":0,"targetLowPrice":0,"fiftyTwoWeekHigh":0,"fiftyTwoWeekLow":0,"beta":0,"recommendationKey":"buy","numberOfAnalysts":0}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:2000,
      messages:[{role:"user",content:prompt}]
    })
  });

  if(!resp.ok){
    const t=await resp.text().catch(()=>"");
    throw new Error(`API error ${resp.status}: ${t.substring(0,150)}`);
  }

  const data=await resp.json();
  if(data.type==="error") throw new Error(data.error?.message||"API error");

  const text=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
  if(!text||text.length<20) throw new Error("Empty response from AI. Please retry.");

  const parsed=extractJSON(text);
  if(!parsed) throw new Error("Could not parse response. Please retry.");
  if(!parsed.currentPrice&&!parsed.eps&&!parsed.marketCap) throw new Error("No valid data found. Check the stock name.");
  return parsed;
}

// ═══════════════════════════════════════════
// FINE-TUNED VALUATION MODELS (India-calibrated)
// ═══════════════════════════════════════════

function runModels(d){
  const R={},p=d.currentPrice,sh=d.sharesOutstanding;
  if(!p)return R;

  // ── 1. DCF (Discounted Cash Flow) ──
  // India WACC: Risk-free 7% + equity premium 5% = ~12%
  // Terminal growth: India long-run nominal GDP ~10%, real ~6%, use 5% (conservative)
  const fcf=d.freeCashFlow||(d.operatingCashFlow&&d.capex?d.operatingCashFlow-d.capex:null)
    ||(d.netIncome&&d.capex&&d.depreciation?d.netIncome+d.depreciation-d.capex:null);
  if(fcf&&fcf>0&&sh){
    const gRaw=d.revenueGrowth||d.earningsGrowth||10;
    // Fade growth: use reported growth but cap & fade toward terminal
    const g=Math.min(Math.max(gRaw/100,0.04),0.22);
    const tg=0.05,wacc=0.12;
    let pvFcf=0,yearG=g;
    // 10-year projection with growth fade
    for(let i=1;i<=10;i++){
      yearG=g-(g-tg)*(i/12); // linear fade toward terminal
      const cf=fcf*Math.pow(1+yearG,i);
      pvFcf+=cf/Math.pow(1+wacc,i);
    }
    const termCf=fcf*Math.pow(1+tg,10)*(1+tg);
    const tv=termCf/(wacc-tg);
    const pvTv=tv/Math.pow(1+wacc,10);
    const ev=pvFcf+pvTv;
    // Subtract net debt if available
    const netDebt=(d.longTermDebt||0)-(d.totalCurrentAssets?Math.min(d.totalCurrentAssets*0.2,d.longTermDebt||0):0);
    const equity=ev-Math.max(netDebt,0);
    R.dcf={ps:Math.max(equity/sh,0),ev,pvFcf,pvTv,tv,fcf,g:g*100,tp:ev>0?pvTv/ev*100:0};
  }

  // ── 2. Graham Formula (India-adjusted) ──
  // V = EPS × (7 + 1.5g) × 4.4 / Y
  // Using 7 instead of 8.5 (more conservative for India valuations)
  // Y = India AAA bond yield ~7.5%
  if(d.eps&&d.eps>0){
    const gRaw=d.earningsGrowth||d.revenueGrowth||8;
    const g=Math.min(Math.max(gRaw,2),20); // cap at 20%
    const y=7.5; // India AAA corporate bond
    const v=(d.eps*(7+1.5*g)*4.4)/y;
    // Apply Graham's margin of safety: use 2/3 of value
    R.graham={ps:v,psSafe:v*0.667,pe:7+1.5*g,eps:d.eps,g,y};
  }

  // ── 3. EPV (Earnings Power Value - Greenwald) ──
  // Values company on sustainable earnings, zero growth
  const ebit=d.ebit
    ||(d.netIncome&&d.operatingMargin&&d.profitMargin&&d.profitMargin>0?d.netIncome*(d.operatingMargin/d.profitMargin):null)
    ||(d.totalRevenue&&d.operatingMargin?d.totalRevenue*d.operatingMargin/100:null);
  if(ebit&&ebit>0&&sh){
    const taxRate=0.252; // India effective corporate tax
    const nopat=ebit*(1-taxRate);
    // Maintenance capex = depreciation (or 70% of total capex)
    const mCapex=d.depreciation||Math.abs(d.capex||0)*0.7||nopat*0.12;
    const adjEarn=nopat-mCapex;
    if(adjEarn>0){
      const coc=0.12;
      const epv=adjEarn/coc;
      R.epv={ps:epv/sh,ev:epv,nopat,adj:adjEarn,mc:mCapex};
    }
  }

  // ── 4. DDM (Gordon Growth Dividend Discount Model) ──
  if(d.dividendPerShare&&d.dividendPerShare>0){
    const gRaw=(d.earningsGrowth||d.revenueGrowth||6)/100;
    const g=Math.min(Math.max(gRaw,0.02),0.09); // cap growth below required return
    const r=0.12; // required return
    if(r>g+0.01){ // ensure meaningful spread
      const d1=d.dividendPerShare*(1+g);
      const v=d1/(r-g);
      R.ddm={ps:v,div:d.dividendPerShare,g:g*100,iy:d.dividendPerShare/v*100};
    }
  }

  // ── 5. Residual Income (Edwards-Bell-Ohlson) ──
  const bvps=d.bookValuePerShare||(d.totalStockholderEquity&&sh?d.totalStockholderEquity/sh:null);
  if(bvps&&bvps>0&&d.roe&&d.roe>0){
    const roe=d.roe/100;
    const coe=0.12; // cost of equity
    const fadeG=0.04; // residual income growth (fades)
    if(roe>0&&coe>fadeG){
      const ri=bvps*(roe-coe); // excess return per share
      // PV of residual income stream
      const pvRI=ri>0?ri/(coe-fadeG):ri/(coe-fadeG)*0.5; // discount negative RI more
      R.residual={ps:bvps+pvRI,bv:bvps,ri,roe:d.roe,spread:(roe-coe)*100};
    }
  }

  // ── 6. NCAV (Net Current Asset Value - Graham Net-Net) ──
  if(d.totalCurrentAssets&&d.totalLiabilities&&sh){
    const ncav=d.totalCurrentAssets-d.totalLiabilities;
    R.ncav={ps:ncav/sh,ncav,ca:d.totalCurrentAssets,tl:d.totalLiabilities};
  }

  // ── 7. Howard Marks Risk-Adjusted Value ──
  const baseMods=["dcf","graham","epv","residual"].filter(k=>R[k]&&R[k].ps>0);
  if(baseMods.length>=2){
    // Weighted average of base models (exclude extreme outliers)
    const vals=baseMods.map(k=>R[k].ps).sort((a,b)=>a-b);
    // Trim top and bottom if 4+ models
    const trimmed=vals.length>=4?vals.slice(1,-1):vals;
    const avg=trimmed.reduce((s,v)=>s+v,0)/trimmed.length;

    // Auto-derive cycle signals
    const h=d.fiftyTwoWeekHigh||p,l=d.fiftyTwoWeekLow||p;
    const cyclePos=h!==l?((p-l)/(h-l))*100:50; // 0=trough, 100=peak

    // PE-based sentiment (India avg PE ~22)
    const pe=d.peRatio||22;
    const sentPE=Math.min(100,Math.max(0,(pe/45)*100));

    // Credit risk proxy from D/E
    const de=d.debtToEquity||30;
    const creditSpread=Math.min(8,Math.max(1,1.5+de/40));

    // Volatility from beta
    const vol=d.beta||1;

    // Quality composite: ROE, margins, consistency
    const qual=Math.min(100,Math.max(5,
      (Math.min(d.roe||0,40))*1.2 +
      (Math.min(d.profitMargin||0,30))*0.8 +
      (Math.min(d.currentRatio||0,3))*8 +
      (d.debtToEquity&&d.debtToEquity<50?10:0)
    ));

    // Factor adjustments (contrarian: fear=opportunity, greed=danger)
    const cycleAdj=(50-cyclePos)/50*0.14;
    const sentAdj=(50-sentPE)/50*0.10;
    const spreadAdj=(creditSpread-4)/4*0.08;
    const volAdj=(vol-1)*0.06;

    // Quality multiplier (good quality amplifies positive, dampens negative)
    const qMul=0.75+(qual/100)*0.5;

    const rawAdj=(cycleAdj+sentAdj+spreadAdj+volAdj)*qMul;
    const adj=Math.max(-0.35,Math.min(0.35,rawAdj)); // cap at ±35%

    const adjVal=avg*(1+adj);

    // Pendulum
    const pend=Math.round(Math.max(0,Math.min(100,
      cyclePos*0.4+sentPE*0.35+(1-creditSpread/10)*100*0.15+(1/Math.max(vol,0.2))*100*0.1
    )));
    const pL=pend>72?"Extreme Greed":pend>58?"Greed":pend>42?"Neutral":pend>28?"Fear":"Extreme Fear";
    const asym=adj>0?Math.min(10,adj*28):Math.max(-10,adj*28);

    R.marks={ps:adjVal,base:avg,adj:adj*100,
      cA:cycleAdj*100,sA:sentAdj*100,spA:spreadAdj*100,vA:volAdj*100,
      qM:qMul,asym,pend,pL,qual,cyclePos};
  }

  return R;
}

function getComposite(R){
  // Weighted composite with model reliability weights
  const w={dcf:0.28,graham:0.14,epv:0.16,ddm:0.07,residual:0.13,ncav:0.02,marks:0.20};
  let s=0,tw=0;
  Object.entries(R).forEach(([k,v])=>{
    if(v&&v.ps>0){s+=v.ps*(w[k]||0.05);tw+=w[k]||0.05;}
  });
  return tw>0?s/tw:null;
}

// ═══ UI Components ═══
function St({l,v,c}){
  return <div style={{padding:"4px 0",display:"flex",justifyContent:"space-between",borderBottom:`1px solid ${C.border}33`}}>
    <span style={{fontSize:11,color:C.d}}>{l}</span>
    <span style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:c||C.t,fontWeight:500}}>{v}</span>
  </div>;
}

function Pend({v,l}){
  const a=((v-50)/50)*55;
  const co=v>70?C.r:v>55?C.a:v>42?C.d:v>28?C.b:C.g;
  const x2=100+Math.sin(a*Math.PI/180)*64,y2=110-Math.cos(a*Math.PI/180)*64;
  return <div style={{textAlign:"center"}}>
    <svg width="160" height="95" viewBox="0 0 200 120">
      <path d="M 20 110 A 80 80 0 0 1 180 110" fill="none" stroke={C.border} strokeWidth="3"/>
      <path d="M 20 110 A 80 80 0 0 1 55 50" fill="none" stroke={C.g} strokeWidth="3" opacity=".5"/>
      <path d="M 145 50 A 80 80 0 0 1 180 110" fill="none" stroke={C.r} strokeWidth="3" opacity=".5"/>
      <line x1="100" y1="110" x2={x2} y2={y2} stroke={co} strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx={x2} cy={y2} r="5" fill={co}/><circle cx="100" cy="110" r="2.5" fill={C.d}/>
      <text x="6" y="107" fill={C.g} fontSize="7" fontWeight="600">FEAR</text>
      <text x="155" y="107" fill={C.r} fontSize="7" fontWeight="600">GREED</text>
    </svg>
    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:co,fontWeight:600}}>{l} ({v})</div>
  </div>;
}

function Factor({l,v}){
  const co=v>0?C.b:C.r;
  const left=v>=0?"50%":`${50+v/20*50}%`;
  const w=`${Math.abs(v)/20*50}%`;
  return <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
    <span style={{fontSize:10,color:C.d,width:90,flexShrink:0}}>{l}</span>
    <div style={{flex:1,height:5,background:C.card2,borderRadius:3,position:"relative"}}>
      <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:C.m}}/>
      <div style={{position:"absolute",left,width:w,top:0,bottom:0,borderRadius:3,background:co}}/>
    </div>
    <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:v>0?C.b:v<0?C.r:C.d,width:42,textAlign:"right"}}>{fP(v)}</span>
  </div>;
}

function ModelCard({name,val,color,children}){
  return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <span style={{fontSize:12,fontWeight:700,color:color||C.g}}>{name}</span>
      <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:700,color:color||C.g}}>₹{val}</span>
    </div>
    {children}
  </div>;
}

// ═══ MAIN APP ═══
export default function App(){
  const [q,setQ]=useState("");
  const [phase,setPhase]=useState("idle");
  const [status,setStatus]=useState("");
  const [stk,setStk]=useState(null);
  const [mdl,setMdl]=useState(null);
  const [comp,setComp]=useState(null);
  const [err,setErr]=useState("");
  const [showS,setShowS]=useState(false);

  const filt=useMemo(()=>{
    if(!q)return STOCKS;
    const x=q.toLowerCase();
    return STOCKS.filter(s=>s.toLowerCase().includes(x));
  },[q]);

  const go=useCallback(async(name)=>{
    const n=name||q.trim();
    if(!n)return;
    setQ(n);setPhase("fetching");setErr("");setStk(null);setMdl(null);setComp(null);setShowS(false);
    setStatus("Fetching financial data...");
    try{
      const d=await fetchStockData(n);
      setStk(d);
      setStatus("Computing valuations...");
      const r=runModels(d);
      setMdl(r);
      setComp(getComposite(r));
      setPhase("done");
    }catch(e){
      console.error("Error:",e);
      setErr(e.message);
      setPhase("error");
    }
  },[q]);

  const reset=useCallback(()=>{
    setPhase("idle");setQ("");setStk(null);setMdl(null);setComp(null);setErr("");setShowS(false);
  },[]);

  const price=stk?.currentPrice;
  const margin=comp&&price?((comp-price)/comp*100):null;
  const MN={dcf:"DCF",graham:"Graham",epv:"EPV",ddm:"DDM",residual:"Residual",ncav:"NCAV",marks:"Marks"};
  const MO=["dcf","graham","epv","ddm","residual","ncav","marks"];
  const valid=mdl?MO.filter(k=>mdl[k]&&mdl[k].ps>0):[];
  const maxV=valid.length?Math.max(...valid.map(k=>mdl[k].ps),price||0)*1.15:0;

  return <div style={{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"'Outfit',system-ui,sans-serif"}}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
      *{box-sizing:border-box;margin:0;padding:0}input:focus{outline:none}
      ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
      @keyframes glow{0%,100%{box-shadow:0 0 30px ${C.gg}}50%{box-shadow:0 0 60px ${C.gg}}}
      .fu{animation:fadeUp .45s ease-out both}.sg:hover{background:${C.card2}!important}
    `}</style>

    <div style={{maxWidth:1000,margin:"0 auto",padding:"32px 18px"}}>
      {/* Header */}
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{fontSize:9,letterSpacing:6,color:C.g,fontWeight:600,textTransform:"uppercase",marginBottom:8}}>
          Indian Stock Market · AI-Powered · 7 Valuation Models
        </div>
        <h1 style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:38,fontWeight:700,
          background:`linear-gradient(135deg,${C.t} 20%,${C.g})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",lineHeight:1.15}}>
          Intrinsic Value Engine
        </h1>
        <p style={{color:C.d,fontSize:13,marginTop:8,fontWeight:300}}>
          Type any NSE stock — AI fetches financials & computes all valuations instantly
        </p>
      </div>

      {/* Search */}
      <div style={{position:"relative",maxWidth:600,margin:"0 auto 32px"}}>
        <div style={{display:"flex",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
          <div style={{padding:"14px 15px",color:C.d,fontSize:18}}>🔍</div>
          <input type="text" value={q} placeholder="Search stock... e.g. Reliance, TCS, Infosys"
            onChange={e=>{setQ(e.target.value);setShowS(true);}}
            onFocus={()=>{if(phase!=="done")setShowS(true);}}
            onKeyDown={e=>{if(e.key==="Enter")go();}}
            style={{flex:1,background:"transparent",border:"none",color:C.t,fontSize:15,padding:"14px 0",fontFamily:"inherit"}}/>
          <button onClick={()=>go()} disabled={phase==="fetching"}
            style={{background:phase==="fetching"?C.m:C.g,color:phase==="fetching"?C.d:C.bg,
              border:"none",padding:"0 24px",fontWeight:700,fontSize:12,cursor:phase==="fetching"?"wait":"pointer",
              fontFamily:"inherit",letterSpacing:.8}}>
            {phase==="fetching"?"LOADING...":"ANALYZE"}
          </button>
        </div>
        {showS&&phase!=="fetching"&&phase!=="done"&&<div style={{
          position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:C.card,
          border:`1px solid ${C.border}`,borderRadius:"0 0 14px 14px",maxHeight:320,overflowY:"auto"}}>
          <div style={{padding:"8px 15px",fontSize:9,color:C.m,fontWeight:700,letterSpacing:2.5,textTransform:"uppercase"}}>
            {q?"Matching Stocks":"Popular NSE Stocks"}
          </div>
          {filt.slice(0,15).map(s=><div key={s} className="sg" onClick={()=>go(s)}
            style={{padding:"9px 15px",cursor:"pointer",fontSize:13,color:C.t,transition:".15s"}}>{s}</div>)}
        </div>}
      </div>

      {/* Loading */}
      {phase==="fetching"&&<div style={{textAlign:"center",padding:55}} className="fu">
        <div style={{width:46,height:46,border:`3px solid ${C.border}`,borderTopColor:C.g,borderRadius:"50%",animation:"spin .7s linear infinite",margin:"0 auto 18px"}}/>
        <div style={{color:C.g,fontSize:14,fontWeight:600,marginBottom:6}}>{status}</div>
        <div style={{color:C.d,fontSize:12,animation:"pulse 2s infinite"}}>Takes 3-5 seconds...</div>
      </div>}

      {/* Error */}
      {phase==="error"&&<div className="fu" style={{background:C.card,border:`1px solid ${C.rd}`,borderRadius:12,padding:26,textAlign:"center",maxWidth:520,margin:"0 auto"}}>
        <div style={{fontSize:15,color:C.r,fontWeight:700,marginBottom:8}}>Analysis Failed</div>
        <div style={{fontSize:12,color:C.d,marginBottom:16,lineHeight:1.6}}>{err}</div>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button onClick={()=>go(q)} style={{background:C.g,color:C.bg,border:"none",padding:"9px 22px",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:600,fontFamily:"inherit"}}>Retry</button>
          <button onClick={reset} style={{background:C.card2,color:C.t,border:`1px solid ${C.border}`,padding:"9px 22px",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Try Different</button>
        </div>
      </div>}

      {/* ═══ RESULTS ═══ */}
      {phase==="done"&&stk&&mdl&&<div className="fu">
        {/* Company */}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{fontSize:22,fontWeight:700}}>{stk.companyName||q}</div>
            <div style={{fontSize:12,color:C.d,marginTop:3}}>{stk.ticker} · NSE · {stk.sector} · {stk.industry}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:28,fontWeight:700}}>₹{price?.toFixed(2)||"—"}</div>
            <div style={{fontSize:11,color:C.d}}>Mkt Cap: {fmt(stk.marketCap)}</div>
          </div>
        </div>

        {/* Composite */}
        {comp&&<div style={{background:`linear-gradient(135deg,${C.card},rgba(52,211,153,0.04))`,
          border:`1px solid ${C.gd}`,borderRadius:12,padding:24,marginBottom:14,animation:"glow 4s ease-in-out infinite"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:14}}>
            <div>
              <div style={{fontSize:9,color:C.d,fontWeight:700,letterSpacing:2.5,textTransform:"uppercase",marginBottom:5}}>
                Composite Intrinsic Value ({valid.length} models)
              </div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:38,fontWeight:700,color:C.g,lineHeight:1}}>₹{comp.toFixed(2)}</div>
            </div>
            {margin!==null&&<div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:C.d,fontWeight:700,letterSpacing:2.5,textTransform:"uppercase",marginBottom:5}}>Margin of Safety</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:28,fontWeight:700,lineHeight:1,
                color:margin>25?C.g:margin>0?C.a:C.r}}>{margin.toFixed(1)}%</div>
              <div style={{fontSize:11,marginTop:5,padding:"2px 12px",borderRadius:20,display:"inline-block",fontWeight:600,
                background:margin>30?C.gg:margin>10?C.ad:C.rd,
                color:margin>30?C.g:margin>10?C.a:C.r}}>
                {margin>30?"Deep Value":margin>20?"Strong Buy":margin>10?"Value":margin>0?"Fair":"Overvalued"}
              </div>
            </div>}
          </div>
          {/* Model bars */}
          <div style={{marginTop:18}}>
            {valid.map(k=>{
              const v=mdl[k].ps,iM=k==="marks";
              const bw=maxV>0?Math.min(v/maxV*100,100):0;
              const pw=price>0&&maxV>0?Math.min(price/maxV*100,99):0;
              return <div key={k} style={{display:"flex",alignItems:"center",gap:9,marginBottom:5}}>
                <div style={{width:54,fontSize:9,color:iM?C.b:C.d,fontWeight:700,textTransform:"uppercase",flexShrink:0}}>{MN[k]}</div>
                <div style={{flex:1,height:17,background:C.bg,borderRadius:4,position:"relative",overflow:"hidden"}}>
                  <div style={{height:"100%",width:bw+"%",borderRadius:4,transition:"width .6s",
                    background:iM?`linear-gradient(90deg,${C.bd},${C.b})`:v>0?`linear-gradient(90deg,${C.gd},${C.g})`:C.rd}}/>
                  {pw>0&&<div style={{position:"absolute",left:pw+"%",top:0,bottom:0,width:2,background:C.r,opacity:.7}}/>}
                </div>
                <div style={{width:76,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:iM?C.b:C.t,textAlign:"right",flexShrink:0}}>₹{v.toFixed(0)}</div>
              </div>;
            })}
            {price>0&&<div style={{display:"flex",alignItems:"center",gap:4,marginTop:3,justifyContent:"flex-end"}}>
              <div style={{width:8,height:2,background:C.r}}/><span style={{fontSize:9,color:C.d}}>CMP ₹{price.toFixed(2)}</span>
            </div>}
          </div>
        </div>}

        {/* Financials */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
            <div style={{fontSize:9,fontWeight:700,color:C.m,letterSpacing:2.5,textTransform:"uppercase",marginBottom:8}}>Key Financials</div>
            <St l="EPS (TTM)" v={"₹"+fN(stk.eps)}/><St l="P/E Ratio" v={fN(stk.peRatio)}/>
            <St l="P/B Ratio" v={fN(stk.pbRatio)}/><St l="Book Value" v={"₹"+fN(stk.bookValuePerShare)}/>
            <St l="Div Yield" v={stk.dividendYield?fN(stk.dividendYield)+"%":"—"}/>
            <St l="FCF" v={fmt(stk.freeCashFlow)}/><St l="Revenue" v={fmt(stk.totalRevenue)}/>
            <St l="EBIT" v={fmt(stk.ebit)}/><St l="Net Income" v={fmt(stk.netIncome)}/>
          </div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
            <div style={{fontSize:9,fontWeight:700,color:C.m,letterSpacing:2.5,textTransform:"uppercase",marginBottom:8}}>Returns & Health</div>
            <St l="ROE" v={fP(stk.roe)} c={stk.roe>15?C.g:undefined}/>
            <St l="ROA" v={fP(stk.roa)}/><St l="Profit Margin" v={fP(stk.profitMargin)}/>
            <St l="Op Margin" v={fP(stk.operatingMargin)}/><St l="Gross Margin" v={fP(stk.grossMargin)}/>
            <St l="Rev Growth" v={fP(stk.revenueGrowth)} c={stk.revenueGrowth>0?C.g:C.r}/>
            <St l="Earn Growth" v={fP(stk.earningsGrowth)} c={stk.earningsGrowth>0?C.g:C.r}/>
            <St l="D/E Ratio" v={fN(stk.debtToEquity)} c={stk.debtToEquity>100?C.r:undefined}/>
            <St l="Current Ratio" v={fN(stk.currentRatio)}/>
          </div>
        </div>

        {/* Model Cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(285px,1fr))",gap:14,marginBottom:14}}>
          {mdl.dcf&&<ModelCard name="DCF (Buffett)" val={mdl.dcf.ps.toFixed(2)}>
            <St l="FCF Used" v={fmt(mdl.dcf.fcf)}/><St l="Growth (fading)" v={mdl.dcf.g.toFixed(1)+"%"}/>
            <St l="WACC" v="12%"/><St l="Terminal Growth" v="5%"/>
            <St l="Terminal % of EV" v={mdl.dcf.tp.toFixed(1)+"%"} c={mdl.dcf.tp>75?C.a:undefined}/>
          </ModelCard>}
          {mdl.graham&&<ModelCard name="Graham Formula" val={mdl.graham.ps.toFixed(2)}>
            <St l="EPS" v={"₹"+mdl.graham.eps.toFixed(2)}/><St l="Growth" v={mdl.graham.g.toFixed(1)+"%"}/>
            <St l="AAA Yield (India)" v={mdl.graham.y+"%"}/><St l="Implied P/E" v={mdl.graham.pe.toFixed(1)+"x"}/>
            <St l="With 33% MoS" v={"₹"+mdl.graham.psSafe.toFixed(2)} c={C.a}/>
          </ModelCard>}
          {mdl.epv&&<ModelCard name="EPV (Greenwald)" val={mdl.epv.ps.toFixed(2)}>
            <St l="NOPAT" v={fmt(mdl.epv.nopat)}/><St l="Maint. CapEx" v={fmt(mdl.epv.mc)}/>
            <St l="Adj. Earnings" v={fmt(mdl.epv.adj)}/><St l="Cost of Capital" v="12%"/>
          </ModelCard>}
          {mdl.ddm&&<ModelCard name="DDM (Gordon)" val={mdl.ddm.ps.toFixed(2)}>
            <St l="Dividend/Share" v={"₹"+mdl.ddm.div.toFixed(2)}/><St l="Growth" v={mdl.ddm.g.toFixed(1)+"%"}/>
            <St l="Required Return" v="12%"/><St l="Implied Yield" v={mdl.ddm.iy.toFixed(2)+"%"}/>
          </ModelCard>}
          {mdl.residual&&<ModelCard name="Residual Income" val={mdl.residual.ps.toFixed(2)}>
            <St l="Book Value" v={"₹"+mdl.residual.bv.toFixed(2)}/><St l="ROE" v={mdl.residual.roe.toFixed(1)+"%"}/>
            <St l="Cost of Equity" v="12%"/><St l="ROE-COE Spread" v={fP(mdl.residual.spread)} c={mdl.residual.spread>0?C.g:C.r}/>
          </ModelCard>}
          {mdl.ncav&&<ModelCard name="NCAV (Net-Net)" val={mdl.ncav.ps.toFixed(2)} color={mdl.ncav.ps>0?C.g:C.r}>
            <St l="Current Assets" v={fmt(mdl.ncav.ca)}/><St l="Total Liabilities" v={fmt(mdl.ncav.tl)}/>
            <St l="NCAV" v={fmt(mdl.ncav.ncav)} c={mdl.ncav.ncav>0?C.g:C.r}/>
          </ModelCard>}
        </div>

        {/* Marks */}
        {mdl.marks&&<div style={{background:C.card,border:`1px solid ${C.bd}`,borderRadius:12,padding:20,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:C.b}}>Howard Marks Risk-Adjusted Value</div>
              <div style={{fontSize:11,color:C.d}}>Auto-derived from market signals · Second-level thinking</div>
            </div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700,color:C.b}}>₹{mdl.marks.ps.toFixed(2)}</div>
          </div>
          <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
            <div style={{flex:"0 0 160px"}}><Pend v={mdl.marks.pend} l={mdl.marks.pL}/></div>
            <div style={{flex:1,minWidth:210}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                <St l="Base (Avg)" v={"₹"+mdl.marks.base.toFixed(2)}/>
                <St l="Adjusted" v={"₹"+mdl.marks.ps.toFixed(2)} c={C.b}/>
                <St l="Adjustment" v={fP(mdl.marks.adj)} c={mdl.marks.adj>0?C.b:C.r}/>
                <St l="Quality ×" v={mdl.marks.qM.toFixed(2)}/>
              </div>
              <div style={{marginTop:8,fontSize:9,color:C.m,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:5}}>Factor Contributions</div>
              <Factor l="Cycle (52w)" v={mdl.marks.cA}/>
              <Factor l="Sentiment (PE)" v={mdl.marks.sA}/>
              <Factor l="Credit (D/E)" v={mdl.marks.spA}/>
              <Factor l="Volatility (β)" v={mdl.marks.vA}/>
              <div style={{marginTop:8,display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:10,color:C.d,fontWeight:600}}>Risk/Reward</span>
                <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",fontWeight:600,
                  color:mdl.marks.asym>3?C.g:mdl.marks.asym>0?C.b:C.r}}>
                  {mdl.marks.asym.toFixed(1)} — {mdl.marks.asym>3?"Favorable":mdl.marks.asym>0?"Slight Edge":"Unfavorable"}
                </span>
              </div>
            </div>
          </div>
        </div>}

        {/* Analyst */}
        {stk.targetMeanPrice>0&&<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:9,fontWeight:700,color:C.m,letterSpacing:2.5,textTransform:"uppercase",marginBottom:8}}>
            Analyst · {(stk.recommendationKey||"").toUpperCase()} · {stk.numberOfAnalysts||"—"} analysts
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(115px,1fr))",gap:4}}>
            <St l="Low" v={"₹"+fN(stk.targetLowPrice)}/><St l="Mean" v={"₹"+fN(stk.targetMeanPrice)} c={C.a}/>
            <St l="High" v={"₹"+fN(stk.targetHighPrice)}/><St l="52W Low" v={"₹"+fN(stk.fiftyTwoWeekLow)}/>
            <St l="52W High" v={"₹"+fN(stk.fiftyTwoWeekHigh)}/>
          </div>
        </div>}

        <div style={{textAlign:"center",marginTop:20}}>
          <button onClick={reset} style={{background:C.card,border:`1px solid ${C.border}`,color:C.d,padding:"10px 30px",
            borderRadius:10,fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>← Analyze Another Stock</button>
        </div>
      </div>}

      <div style={{textAlign:"center",marginTop:40,padding:"16px 0",borderTop:`1px solid ${C.border}`}}>
        <p style={{fontSize:9,color:C.m,lineHeight:1.8}}>
          Educational only · Not financial advice · India-calibrated (WACC 12%, AAA 7.5%, Terminal 5%, Tax 25.2%)
          <br/>Graham · Buffett DCF · Greenwald EPV · Gordon DDM · Ohlson RI · Graham NCAV · Howard Marks Risk-Adjusted
        </p>
      </div>
    </div>
  </div>;
}
