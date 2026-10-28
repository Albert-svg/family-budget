/* Home Log — home & car maintenance, history and renewals. Data stays in this browser (localStorage). */
(function(){
"use strict";
const KEY="homelog:v1", DAY=864e5, P=window.HOME_PRESETS||[];
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const pad=n=>String(n).padStart(2,"0");
const dkey=(d=new Date())=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const pkey=k=>{const[a,b,c]=String(k).split("-").map(Number);return new Date(a,b-1,c)};
const validKey=k=>/^\d{4}-\d{2}-\d{2}$/.test(k||"")&&!isNaN(pkey(k));
const sod=()=>{const d=new Date();d.setHours(0,0,0,0);return d.getTime()};
const diff=k=>Math.round((pkey(k).getTime()-sod())/DAY);
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const nice=k=>{if(!validKey(k))return"";const d=pkey(k);return d.getDate()+" "+MON[d.getMonth()]+(d.getFullYear()!==new Date().getFullYear()?" "+d.getFullYear():"")};
function addN(k,n,u){const d=pkey(k);n=+n||0;if(u==="day")d.setDate(d.getDate()+n);else if(u==="week")d.setDate(d.getDate()+7*n);
  else{const m=u==="year"?12*n:n,day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+m);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last))}return dkey(d)}
const UNITS={day:["day","days"],week:["week","weeks"],month:["month","months"],year:["year","years"]};
const every=t=>!(t.n>0)?"one-off":t.n===1?"every "+UNITS[t.u][0]:"every "+t.n+" "+UNITS[t.u][1];
const CATS={home:"Home",car:"Vehicle",appliance:"Appliances",garden:"Garden",other:"Other"};
const ICON={home:'<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M10 21v-6h4v6"/>',
  car:'<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3h-3M6 19H3"/><circle cx="7.5" cy="16" r="1.6"/><circle cx="16.5" cy="16" r="1.6"/><path d="M5 11h14"/>',
  appliance:'<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 6.5h.01M11 6.5h5"/>',
  garden:'<path d="M12 21v-8"/><path d="M12 13c-4 0-7-3-7-8 4 0 7 3 7 8zM12 13c4 0 7-3 7-8-4 0-7 3-7 8z"/>',
  other:'<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>'};
const num=v=>{const n=parseFloat(String(v).replace(/[^\d.]/g,""));return isFinite(n)?n:0};
const km=n=>Math.round(n).toLocaleString("en-US")+" km";

/* ---------- state ---------- */
const CP=window.CLEAN_PRESETS||[];
const cleanDefaults=()=>CP.map((p,i)=>({id:"plan"+i,t:p.t,f:p.f,day:p.day==null?"":p.day,min:p.min||0,tip:p.tip||"",who:"",role:p.role||"",focus:p.focus?1:0,rot:p.rot?1:0}));
const PLAN_V=3;
/* One-time switch to the A/B cleaning plan: the cleaning list becomes exactly the plan.
   Tasks added afterwards with "Add task" are kept from then on. */
function migrateClean(cl){if(cl.planV>=PLAN_V)return;cl.tasks=cleanDefaults();
  const ids=new Set(cl.tasks.map(c=>c.id));for(const k in cl.done)if(!ids.has(k))delete cl.done[k];cl.days={};cl.planV=PLAN_V;migrateClean.did=true}
function fresh(){return{v:1,setup:false,items:[],tasks:[],log:[],provs:[],clean:{tasks:cleanDefaults(),done:{},days:{},planV:PLAN_V},set:{cur:"Rs",lead:3,theme:"auto",kmday:40,people:"Albert, Ruth",abRotate:true,abFlip:false},tab:"due"}}
function sanitize(s){const f=fresh();for(const k in f)if(s[k]==null)s[k]=f[k];s.set=Object.assign({},f.set,s.set);
  ["items","tasks","log","provs"].forEach(k=>{if(!Array.isArray(s[k]))s[k]=[]});
  s.tasks.forEach(t=>{if(!UNITS[t.u])t.u="month";t.n=+t.n||0;if(t.due&&!validKey(t.due))t.due=""});
  if(!s.clean||!Array.isArray(s.clean.tasks))s.clean=f.clean;s.clean.done=s.clean.done||{};s.clean.by=s.clean.by||{};s.clean.days=s.clean.days||{};s.clean.tasks.forEach(c=>{c.role=c.role==="A"||c.role==="B"?c.role:""});migrateClean(s.clean);
  if(!["due","clean","items","log","more"].includes(s.tab))s.tab="due";return s}
function load(){try{const s=JSON.parse(localStorage.getItem(KEY));if(s&&s.v===1)return sanitize(s)}catch(e){}return fresh()}
let S=load(), itemView=null, logF={year:String(new Date().getFullYear()),item:""};
if(migrateClean.did)setTimeout(()=>{save();if(typeof toast==="function")toast("Cleaning plan updated: Person A / Person B")},0);
function saveLocal(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){toast("Couldn't save. Is storage full?")}}
function save(){saveLocal();stage()}

/* ---------- sync with the other phone (Cloudflare D1 via /api/home) ----------
   The log is split into small records (each item, task, log entry, provider, cleaning task, tick, setting).
   save() compares them with the last known copy and uploads what changed; the other phone pulls it.
   Last write wins per record. Nothing is uploaded until this phone has fetched the shared copy once. */
const YKEY="homelog:sync:v1",LOCAL_SET=["theme"];
function freshY(){return{recs:{},rev:0,out:{},first:false,me:null,last:0}}
let Y=(()=>{try{const y=JSON.parse(localStorage.getItem(YKEY));if(y&&y.recs)return Object.assign(freshY(),y)}catch(e){}return freshY()})();
let syncState="idle",syncing=false,again=false,syncT=null;
const saveY=()=>{try{localStorage.setItem(YKEY,JSON.stringify(Y))}catch(e){}};
const canon=o=>JSON.stringify(o,(k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.keys(v).sort().reduce((a,x)=>(a[x]=v[x],a),{}):v);
const myName=()=>Y.me&&Y.me.name||"";
function toRecs(s){const m={},put=(id,kind,data)=>{m[id]={kind,data}};
  put("meta","meta",{setup:!!s.setup,planV:s.clean.planV||0});
  const set=Object.assign({},s.set);LOCAL_SET.forEach(k=>delete set[k]);put("set","set",set);
  s.items.forEach((x,i)=>put("i_"+x.id,"item",Object.assign({},x,{_o:i})));
  s.tasks.forEach((x,i)=>put("t_"+x.id,"task",Object.assign({},x,{_o:i})));
  s.log.forEach(x=>put("l_"+x.id,"log",x));
  s.provs.forEach((x,i)=>put("p_"+x.id,"prov",Object.assign({},x,{_o:i})));
  s.clean.tasks.forEach((x,i)=>put("c_"+x.id,"ctask",Object.assign({},x,{_o:i})));
  for(const k in s.clean.done)put("d_"+k,"cdone",{p:s.clean.done[k],by:s.clean.by[k]||""});
  for(const k in s.clean.days)put("y_"+k,"cday",{v:s.clean.days[k]});
  return m}
function fromRecs(base){const live=Object.entries(Y.recs).filter(([,r])=>!r.deleted&&r.data);
  const of=k=>live.filter(([,r])=>r.kind===k).map(([,r])=>Object.assign({},r.data));
  const ord=a=>a.sort((x,y)=>(x._o||0)-(y._o||0)).map(x=>{delete x._o;return x});
  const meta=(Y.recs.meta&&!Y.recs.meta.deleted&&Y.recs.meta.data)||{},set=(Y.recs.set&&!Y.recs.set.deleted&&Y.recs.set.data)||{};
  const s={v:1,setup:!!meta.setup,items:ord(of("item")),tasks:ord(of("task")),log:of("log").sort((a,b)=>(a.ts||0)-(b.ts||0)),provs:ord(of("prov")),
    clean:{tasks:ord(of("ctask")),done:{},by:{},days:{},planV:meta.planV||0},set:Object.assign({},base.set,set,{theme:base.set.theme}),tab:base.tab};
  live.forEach(([id,r])=>{if(r.kind==="cdone"){s.clean.done[id.slice(2)]=r.data.p;if(r.data.by)s.clean.by[id.slice(2)]=r.data.by}if(r.kind==="cday")s.clean.days[id.slice(2)]=r.data.v});
  return s}
function mark(id,kind,data,del){const prev=Y.recs[id],rec={id,kind,data,deleted:del?1:0,mtime:Math.max(Date.now(),((prev&&prev.mtime)||0)+1)};Y.recs[id]=rec;Y.out[id]=rec}
function stage(){if(!Y.first)return;const now=toRecs(S);let n=0;
  for(const id in now){const cur=Y.recs[id];if(!cur||cur.deleted||canon(cur.data)!==canon(now[id].data)){mark(id,now[id].kind,now[id].data,0);n++}}
  for(const id in Y.recs)if(!Y.recs[id].deleted&&!now[id]){mark(id,Y.recs[id].kind,{},1);n++}
  if(n){saveY();queueSync()}}
function queueSync(){clearTimeout(syncT);syncT=setTimeout(sync,600)}
async function api(path,opts){const o=Object.assign({credentials:"same-origin",redirect:"manual",cache:"no-store"},opts||{});if(o.body)o.headers={"content-type":"application/json"};
  let r;try{r=await fetch("/api/"+path,o)}catch(e){throw{offline:true}}
  if(r.type==="opaqueredirect"||r.status===401)throw{auth:true};if(r.status===403)throw{forbidden:true};if(!r.ok)throw{status:r.status};return r.json()}
async function pull(){let more=true,changed=false;
  while(more){const j=await api("home/sync?since="+Y.rev);
    j.records.forEach(r=>{const mine=Y.out[r.id];if(mine&&mine.mtime>r.mtime)return;const cur=Y.recs[r.id];
      if(!cur||cur.mtime<=r.mtime){if(!cur||cur.deleted!==r.deleted||canon(cur.data)!==canon(r.data))changed=true;Y.recs[r.id]={id:r.id,kind:r.kind,data:r.data,mtime:r.mtime,deleted:r.deleted?1:0,by:r.author}}});
    Y.rev=j.rev;more=j.more}
  return changed}
function adopt(){const keep=S;S=sanitize(fromRecs(keep));saveLocal()}
async function sync(){if(syncing){again=true;return}syncing=true;setSync("syncing");
  try{if(!Y.me)Y.me=await api("me");
    if(!Y.first){await pull();const shared=Y.recs.meta&&!Y.recs.meta.deleted&&Y.recs.meta.data&&Y.recs.meta.data.setup;
      if(shared)adopt();Y.first=true;saveY();stage();render()}
    const outs=Object.values(Y.out);
    for(let i=0;i<outs.length;i+=200){const chunk=outs.slice(i,i+200);
      await api("home/sync",{method:"POST",body:JSON.stringify({changes:chunk.map(c=>({id:c.id,kind:c.kind,data:c.data,mtime:c.mtime,deleted:c.deleted}))})});
      chunk.forEach(c=>{if(Y.out[c.id]&&Y.out[c.id].mtime===c.mtime)delete Y.out[c.id]})}
    if(await pull()){adopt();if($("#modal").hidden)render()}
    Y.last=Date.now();saveY();setSync(Object.keys(Y.out).length?"syncing":"ok")}
  catch(e){const prev=syncState;setSync(e.auth?"auth":e.forbidden?"forbidden":"offline");saveY();if(prev!==syncState&&(!Y.first||S.tab==="more"))render()}
  finally{syncing=false;if(again){again=false;queueSync()}}}
function setSync(st){syncState=st;const d=$("#sdot");if(d){d.className="sdot "+st;d.title=syncLabel()}}
function syncLabel(){return syncState==="ok"?"Synced":syncState==="syncing"?"Syncing…":syncState==="auth"?"Sign in needed":syncState==="forbidden"?"No access":"Offline: changes will upload later"}
function connectHTML(){const s=syncState;return`<section class="card hero"><div class="eyebrow">Home Log</div><h1>${s==="auth"?"Sign in to continue":s==="forbidden"?"No access for this email":s==="offline"?"You're offline":"Connecting…"}</h1>
  <p class="small muted">${s==="offline"?"The first time, Home Log needs a connection to fetch your shared log. After that it works offline too.":s==="auth"?"You'll get a one-time code by email.":"Fetching your shared log…"}</p>
  ${s==="auth"?'<div class="actions"><button class="btn primary" data-act="signin">Sign in</button></div>':s==="offline"?'<div class="actions"><button class="btn" data-act="syncnow">Try again</button></div>':""}</section>`}
const item=id=>S.items.find(i=>i.id===id);
const prov=id=>S.provs.find(p=>p.id===id);
const money=n=>S.set.cur+" "+Math.round(n).toLocaleString("en-US");

/* ---------- status ---------- */
function status(t){const it=item(t.item)||{};let days=t.due?diff(t.due):null,kmLeft=null;
  if(t.km>0&&it.vehicle&&it.odo>0&&t.lastKm!=null&&t.lastKm!=="")kmLeft=(+t.lastKm)+(+t.km)-it.odo;
  const rank=(d,k)=>{if(d==null&&k==null)return 4;const e=Math.min(d==null?1e9:d,k==null?1e9:k/Math.max(1,S.set.kmday));return e<0?0:e<=7?1:e<=30?2:3};
  const r=rank(days,kmLeft),level=["over","week","soon","later","nodate"][r];
  const eff=Math.min(days==null?1e9:days,kmLeft==null?1e9:kmLeft/Math.max(1,S.set.kmday));
  let label="";if(days==null&&kmLeft==null)label="needs a date";
  else{const dl=days==null?"":days<0?(-days)+"d overdue":days===0?"today":days===1?"tomorrow":days<=45?"in "+days+"d":nice(t.due);
    const kl=kmLeft==null?"":kmLeft<=0?km(-kmLeft)+" over":km(kmLeft)+" left";
    label=kmLeft!=null&&(days==null||kmLeft/Math.max(1,S.set.kmday)<days)?kl+(dl?" · "+dl:""):dl+(kl?" · "+kl:"")}
  return{level,days,kmLeft,eff,label}}
const active=()=>S.tasks.filter(t=>!t.archived);
function overdueN(){return active().filter(t=>status(t).level==="over").length}

/* ---------- ui helpers ---------- */
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(toast.h);toast.h=setTimeout(()=>t.classList.remove("show"),2400)}
function applyDyn(r){$$("[data-w]",r).forEach(el=>el.style.width=el.dataset.w+"%")}
function applyTheme(){const t=S.set.theme;if(t==="auto")document.documentElement.removeAttribute("data-theme");else document.documentElement.dataset.theme=t}
const CHECK='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const itemOpts=sel=>S.items.map(i=>`<option value="${esc(i.id)}"${i.id===sel?" selected":""}>${esc(i.name)}</option>`).join("");
const provOpts=sel=>`<option value="">None</option>`+S.provs.map(p=>`<option value="${esc(p.id)}"${p.id===sel?" selected":""}>${esc(p.name)}${p.trade?" ("+esc(p.trade)+")":""}</option>`).join("");
const catOpts=sel=>Object.keys(CATS).map(c=>`<option value="${c}"${c===sel?" selected":""}>${CATS[c]}</option>`).join("");
function openModal(html){const m=$("#modal");m.innerHTML=`<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;m.hidden=false;const f=$("input,select,textarea",m);if(f&&matchMedia("(hover:hover)").matches)f.focus()}
function closeModal(){const m=$("#modal");m.hidden=true;m.innerHTML=""}
function gcal(t){if(!t.due)return"";const it=item(t.item),s=t.due.replace(/-/g,""),e=addN(t.due,1,"day").replace(/-/g,"");
  const det=[it?it.name:"",every(t),t.tip||"","Logged in Home Log."].filter(Boolean).join("\n");
  return"https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(t.title+(it?" · "+it.name:""))+"&dates="+s+"/"+e+"&details="+encodeURIComponent(det)}
function waLink(ph){let d=String(ph||"").replace(/\D/g,"");if(!d)return"";if(d.length<=8)d="230"+d;return"https://wa.me/"+d}

/* ---------- views ---------- */
const V={};
function trow(t){const it=item(t.item)||{cat:"other",name:"?"},st=status(t);
  return`<div class="trow cat-${esc(it.cat)} st-${st.level}"><span class="dot"></span>
    <button class="main" data-act="task" data-id="${esc(t.id)}"><div class="t">${esc(t.title)}</div><div class="s"><span class="when">${esc(st.label)}</span> · ${esc(it.name)}${t.kind==="r"?' · <span class="chip acc">renewal</span>':""}</div></button>
    ${st.level==="nodate"?`<button class="btn sm" data-act="edittask" data-id="${esc(t.id)}">Set date</button>`:`<button class="donebtn" data-act="done" data-id="${esc(t.id)}" aria-label="Mark ${esc(t.title)} done">${CHECK}</button>`}</div>`}
function yearSpend(y){return S.log.filter(l=>String(l.date).slice(0,4)===String(y)).reduce((a,l)=>a+(+l.cost||0),0)}

V.due=function(){
  if(!S.setup)return setupHTML();
  const ts=active().map(t=>({t,s:status(t)})).sort((a,b)=>a.s.eff-b.s.eff);
  const g=l=>ts.filter(x=>x.s.level===l).map(x=>x.t);
  const over=g("over"),week=g("week"),soon=g("soon"),later=g("later"),nod=g("nodate");
  const warr=S.items.filter(i=>validKey(i.warranty)&&diff(i.warranty)>=0&&diff(i.warranty)<=60);
  let h=`<section class="grid3"><div class="tile${over.length?" bad":""}"><div class="n">${over.length}</div><div class="l">overdue</div></div>
    <div class="tile${week.length?" warn":""}"><div class="n">${week.length+soon.length}</div><div class="l">next 30 days</div></div>
    <div class="tile"><div class="n sm">${esc(money(yearSpend(new Date().getFullYear())))}</div><div class="l">spent this year</div></div></section>`;
  {const ct=cleanToday();if(ct.list.length)h+=`<button class="card crow-link" data-tab="clean"><span><span class="eyebrow">Cleaning today</span><br><b>${ct.done===ct.list.length?"All done":ct.done+" of "+ct.list.length+" done"}</b></span><span class="bar"><i class="cat-home" data-w="${Math.round(100*ct.done/ct.list.length)}"></i></span><span class="chev">›</span></button>`}
  if(!over.length&&!week.length)h+=`<section class="card allclear"><div class="eyebrow">All clear</div><h1>Nothing due this week</h1><p class="muted small">${soon.length?"Next up: "+esc(soon[0].title)+" ("+esc(status(soon[0]).label)+")":"Enjoy the quiet."}</p></section>`;
  const grp=(title,list,extra)=>list.length?`<div class="group-h"><h2>${title}</h2>${extra||""}</div><div class="list">${list.map(trow).join("")}</div>`:"";
  h+=grp("Needs a date",nod,'<span class="small muted">renewals & new tasks</span>')+grp("Overdue",over)+grp("This week",week)+grp("Next 30 days",soon);
  if(warr.length)h+=`<div class="group-h"><h2>Warranties ending</h2></div><div class="list">${warr.map(i=>`<div class="trow cat-${esc(i.cat)} st-soon"><span class="dot"></span><button class="main" data-act="openitem" data-id="${esc(i.id)}"><div class="t">${esc(i.name)} warranty</div><div class="s"><span class="when">ends ${esc(nice(i.warranty))}</span> · ${diff(i.warranty)} days left</div></button><span></span></div>`).join("")}</div>`;
  if(later.length)h+=`<details class="fold card" id="later"><summary>Later (${later.length})</summary><div class="list">${later.map(trow).join("")}</div></details>`;
  h+=`<div class="actions"><button class="btn primary" data-act="newtask">Add task</button><button class="btn" data-act="ics">Export to calendar</button><button class="btn ghost" data-act="newlog">Log a repair</button></div>`;
  return h};

function setupHTML(){const groups=["home","car","appliance","garden"];
  return`<section class="card hero"><div class="eyebrow">Welcome</div><h1>Set up your home log</h1><p class="small muted">This log is shared between both phones. Only one of you needs to set it up.</p></section>
  <section class="card stack"><h2>Already using Home Log?</h2><p class="small muted">In the old Home Log app, go to More → Export backup. Then import that file here, and it becomes the shared log for both of you.</p>
    <div class="actions"><label class="btn primary">Import backup<input type="file" id="imp" accept="application/json,.json" hidden></label><button class="btn ghost" data-act="syncnow">Check again</button></div>
    <p class="small muted">If the other person has already set it up, tap Check again.</p></section>
  <section class="card"><h2>Or start a new log</h2><p class="small muted">Pick what applies. You can rename, add or remove anything later.</p></section>
  <section class="card stack"><h2>Your places and things</h2>
    <label class="f">Home<input type="text" id="su-home" value="Home" maxlength="60"></label>
    <label class="check"><input type="checkbox" id="su-hascar" checked> I have a car</label>
    <div class="fgrid" id="su-car"><label class="f">Car name<input type="text" id="su-carname" placeholder="e.g. Toyota Yaris" maxlength="60"></label><label class="f">Current odometer (km)<input type="number" id="su-odo" inputmode="numeric" min="0" placeholder="e.g. 84200"></label></div></section>
  <section class="card"><h2>Suggested tasks</h2><p class="small muted">Tuned for a Mauritian home: cyclone season prep in November, water tanks, aircon, termites.</p>
  ${groups.map(c=>`<div class="pgroup" data-pg="${c}"><h3 class="eyebrow">${CATS[c]}</h3>${P.map((p,i)=>p.c!==c?"":`<label class="prow"><input type="checkbox" data-preset="${i}"${p.def?" checked":""}><span><span class="t">${esc(p.t)}</span><br><span class="s">${esc(every(p))}${p.km?" or "+km(p.km):""}${p.k==="r"?" · renewal":""}${p.mon?" · each "+MON[p.mon-1]:""}</span></span></label>`).join("")}</div>`).join("")}
  <div class="actions"><button class="btn primary big" data-act="setup">Create my log</button></div></section>`}

function firstDue(p,i){const today=dkey();if(p.k==="r")return"";
  if(p.mon){const y=new Date().getFullYear(),m=new Date().getMonth()+1;return dkey(new Date(m<=p.mon?y:y+1,p.mon-1,1))}
  const span=Math.round((pkey(addN(today,p.n,p.u))-pkey(today))/DAY);return addN(today,Math.min(span,5+i*3),"day")}
function presetTask(p,i,itemId,odo){return{id:uid(),item:itemId,title:p.t,kind:p.k,n:p.n,u:p.u,due:firstDue(p,i),km:p.km||0,lastKm:p.km&&odo?odo:"",tip:p.tip||"",cost:"",prov:"",lastDone:""}}

/* ---------- cleaning schedule ---------- */
const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const todayIdx=()=>(new Date().getDay()+6)%7;
const period=f=>{const d=new Date();if(f==="o")return"once";if(f==="d")return dkey(d);if(f==="w"){d.setDate(d.getDate()-todayIdx());return dkey(d)}return dkey(d).slice(0,7)};
const isDone=c=>S.clean.done[c.id]===period(c.f);
const people=()=>String(S.set.people||"").split(",").map(x=>x.trim()).filter(Boolean);
let cleanWho="";
const THEMES=window.CLEAN_THEMES||[],ROT=window.CLEAN_ROTATION||[];
/* Person A / B for this week. Roles swap every week (unless turned off); "Swap" flips them. */
function weekNo(){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-todayIdx());return Math.round(d.getTime()/(7*DAY))}
function roles(){const p=people(),a=p[0]||"Person A",b=p[1]||"Person B",flip=((S.set.abRotate?weekNo():0)+(S.set.abFlip?1:0))%2===1;return flip?{A:b,B:a}:{A:a,B:b}}
const whoOf=c=>c.role?roles()[c.role]:c.who;
const forWho=c=>!cleanWho||!whoOf(c)||whoOf(c)===cleanWho;
/* Rotating Saturday deep clean: week 1–5 of the month, by this week's Saturday. */
function rotIdx(){const d=new Date();d.setDate(d.getDate()-todayIdx()+5);return Math.min(ROT.length,Math.ceil(d.getDate()/7))-1}
const rotTask=()=>ROT[rotIdx()]||"";
const ctitle=c=>c.rot&&rotTask()?"Deep clean: "+rotTask():c.t;
function todayAll(){const t=todayIdx();return S.clean.tasks.filter(c=>c.f==="d"||(c.f==="w"&&c.day!==""&&+c.day===t))}
function cleanStreak(){let n=0;const d=new Date();const full=k=>S.clean.days[k]===true;if(!full(dkey(d)))d.setDate(d.getDate()-1);while(full(dkey(d))){n++;d.setDate(d.getDate()-1)}return n}
function cleanToday(){const list=todayAll().filter(forWho);return{list,done:list.filter(isDone).length}}
function crow(c,extra){const d=isDone(c);
  return`<div class="crow${d?" done":""}"><button class="cbox" data-act="ctick" data-id="${esc(c.id)}" aria-pressed="${d}" aria-label="${d?"Untick":"Tick"} ${esc(c.t)}">${CHECK}</button>
  <button class="main" data-act="cedit" data-id="${esc(c.id)}"><div class="t">${esc(ctitle(c))}${c.focus?' <span class="chip focus">focus</span>':""}</div><div class="s">${[extra,c.role&&extra!=="role"?"Person "+c.role+" ("+whoOf(c)+")":c.role?"":c.who,c.min?"~"+c.min+" min":"",d&&S.clean.by[c.id]?"✓ "+S.clean.by[c.id]:""].filter(x=>x&&x!=="role").map(esc).join(" · ")}</div></button></div>`}
V.clean=function(){
  const t=todayIdx(),R=roles(),ppl=people(),td=cleanToday(),left=td.list.filter(c=>!isDone(c)).reduce((a,c)=>a+(+c.min||0),0);
  const ct=S.clean.tasks.filter(forWho),pct=td.list.length?Math.round(100*td.done/td.list.length):100;
  const daily=ct.filter(c=>c.f==="d"),todayW=ct.filter(c=>c.f==="w"&&c.day!==""&&+c.day===t);
  const byFocus=(a,b)=>(a.focus||0)-(b.focus||0);
  const roleA=todayW.filter(c=>c.role==="A").sort(byFocus),roleB=todayW.filter(c=>c.role==="B").sort(byFocus),other=todayW.filter(c=>!c.role);
  /* missed main jobs from earlier this week (daily essentials don't carry over) */
  const missed=ct.filter(c=>c.f==="w"&&c.day!==""&&+c.day<t&&!isDone(c)&&(c.focus||!c.role)).sort((a,b)=>+a.day-+b.day);
  const anyDay=ct.filter(c=>c.f==="w"&&c.day==="");
  const month=ct.filter(c=>c.f==="m"),mDone=month.filter(isDone).length,once=ct.filter(c=>c.f==="o");
  const wk=ct.filter(c=>c.f==="w"&&(c.focus||!c.role)),wDone=wk.filter(isDone).length;
  const sec=(role,list)=>list.length?`<div class="group-h"><h2>Person ${role} · ${esc(R[role])}</h2><span class="small muted">${list.filter(isDone).length}/${list.length} · ~${list.reduce((a,c)=>a+(+c.min||0),0)} min</span></div><div class="list">${list.map(c=>crow(c,"role")).join("")}</div>`:"";
  const theme=THEMES[t]||"";
  return`<section class="card hero"><div class="eyebrow">${DAYS[t]}${theme?" · "+esc(theme):""}</div><h1>${td.done===td.list.length&&td.list.length?"All done for today":td.done+" of "+td.list.length+" done"}</h1>
    <div class="bar lg"><i class="cat-home" data-w="${pct}"></i></div>
    <p class="small muted">${left?"About "+left+" min left today":"Nice work."} · ${cleanStreak()} day streak · main jobs this week ${wDone}/${wk.length}</p>
    <div class="roles"><span>This week: <b>Person A</b> ${esc(R.A)} · <b>Person B</b> ${esc(R.B)}</span><button class="btn sm ghost" data-act="cswap">Swap</button></div>
    ${ppl.length?`<div class="seg">${["",...ppl].map(p=>`<button class="${cleanWho===p?"on":""}" data-act="cwho" data-p="${esc(p)}">${p?esc(p):"Everyone"}</button>`).join("")}</div>`:""}
    <div class="actions"><button class="btn sm" data-act="cnew">+ Add task</button></div></section>
  ${once.length?`<div class="group-h"><h2>Extra tasks</h2><span class="small muted">tick to clear</span></div><div class="list">${once.map(c=>crow(c,"one-off")).join("")}</div>`:""}
  ${t===5&&rotTask()?`<section class="card note"><div class="eyebrow">Rotating deep clean · week ${rotIdx()+1}</div><b>${esc(rotTask())}</b></section>`:""}
  ${sec("A",roleA)}${sec("B",roleB)}
  ${other.length?`<div class="group-h"><h2>Also today</h2></div><div class="list">${other.map(c=>crow(c,DAYS[t].slice(0,3))).join("")}</div>`:""}
  ${daily.length?`<div class="group-h"><h2>Every day</h2><span class="small muted">${daily.filter(isDone).length}/${daily.length}</span></div><div class="list">${daily.map(c=>crow(c)).join("")}</div>`:""}
  ${!todayW.length&&!daily.length?'<p class="empty">Nothing on the plan for you today.</p>':""}
  ${missed.length?`<details class="fold card" id="missed"><summary class="small">Missed earlier this week (${missed.length})</summary><div class="list">${missed.map(c=>crow(c,DAYS[c.day].slice(0,3)+" (catch up)")).join("")}</div></details>`:""}
  ${anyDay.length?`<div class="group-h"><h2>Any day this week</h2></div><div class="list">${anyDay.map(c=>crow(c,"any day")).join("")}</div>`:""}
  ${month.length?`<div class="group-h"><h2>This month</h2><span class="small muted">${mDone}/${month.length}</span></div><div class="list">${month.map(c=>crow(c,"monthly")).join("")}</div>`:""}
  <section class="card"><h2>Weekly plan</h2><p class="small muted">20–30 minutes each, working at the same time (Sunday 5–10). Main jobs shown; the daily essentials repeat every day.</p><div class="wplan">${DAYS.map((d,i)=>{
    const js=S.clean.tasks.filter(c=>c.f==="w"&&c.day!==""&&+c.day===i),fa=js.filter(c=>c.role==="A"&&c.focus),fb=js.filter(c=>c.role==="B"&&c.focus),fo=js.filter(c=>!c.role);
    const ln=(lab,l)=>l.length?`<span><b class="pl">${lab}</b> ${l.map(c=>esc(ctitle(c))).join("; ")}</span>`:"";
    return`<div class="wday${i===t?" today":""}"><b>${d.slice(0,3)}</b><span><span class="th">${esc(THEMES[i]||"")}</span>${ln("A",fa)}${ln("B",fb)}${ln("•",fo)}${!fa.length&&!fb.length&&!fo.length?'<span class="muted">Light reset</span>':""}</span></div>`}).join("")}</div>
  <details class="fold"><summary class="small">Rotating Saturday deep clean</summary><ol class="rotlist">${ROT.map((r,i)=>`<li${i===rotIdx()?' class="cur"':""}>Week ${i+1}${i===4?" (if applicable)":""}: ${esc(r)}</li>`).join("")}</ol></details>
  ${window.CLEAN_NOTES?`<p class="small muted">${esc(window.CLEAN_NOTES)}</p>`:""}
  <div class="actions"><button class="btn primary" data-act="cnew">Add cleaning task</button><button class="btn ghost" data-act="crestore">Restore the plan</button></div>
  <p class="small muted">Tap a task to change its day, who does it or the time it takes. Names are set under More → Settings.</p></section>`};
function cleanEditor(c){const isNew=!c;c=c||{id:"",t:"",f:"o",day:"",min:15,tip:"",who:""};
  openModal(`<div class="card-h"><h2>${isNew?"New cleaning task":"Edit cleaning task"}</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <div class="fgrid"><label class="f full">Task<input type="text" id="ce-t" value="${esc(c.t)}" maxlength="90" placeholder="e.g. Clean the balcony"></label>
  <label class="f">How often<select id="ce-f"><option value="o"${c.f==="o"?" selected":""}>Just once</option><option value="d"${c.f==="d"?" selected":""}>Daily</option><option value="w"${c.f==="w"?" selected":""}>Weekly</option><option value="m"${c.f==="m"?" selected":""}>Monthly</option></select></label>
  <label class="f" id="ce-daybox"${c.f==="w"?"":" hidden"}>Day<select id="ce-day"><option value="">Any day</option>${DAYS.map((d,i)=>`<option value="${i}"${c.day!==""&&+c.day===i?" selected":""}>${d}</option>`).join("")}</select></label>
  <label class="f">Who<select id="ce-who"><option value="">Anyone</option><option value="@A"${c.role==="A"?" selected":""}>Person A (swaps weekly)</option><option value="@B"${c.role==="B"?" selected":""}>Person B (swaps weekly)</option>${people().map(p=>`<option${!c.role&&c.who===p?" selected":""}>${esc(p)}</option>`).join("")}</select></label>
  <label class="f">Minutes<input type="number" id="ce-min" min="0" max="300" inputmode="numeric" value="${esc(c.min)}"></label>
  <label class="f full">Tip / how-to<textarea id="ce-tip">${esc(c.tip)}</textarea></label></div>
  <div class="actions"><button class="btn primary" data-act="csave" data-id="${esc(c.id)}">Save</button>${isNew?"":`<button class="btn danger" data-act="cdel" data-id="${esc(c.id)}">Delete</button>`}</div>`)}

V.items=function(){
  if(itemView&&item(itemView))return itemHTML(item(itemView));itemView=null;
  const h=S.items.map(i=>{const ts=active().filter(t=>t.item===i.id).sort((a,b)=>status(a).eff-status(b).eff),nx=ts[0],st=nx&&status(nx);
    return`<button class="itile cat-${esc(i.cat)}" data-act="openitem" data-id="${esc(i.id)}"><span class="ibadge"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[i.cat]||ICON.other}</svg></span>
    <span><span class="t"><b>${esc(i.name)}</b></span><br><span class="small muted">${ts.length} task${ts.length===1?"":"s"}${nx?" · next: "+esc(nx.title)+" ("+esc(st.label)+")":""}${i.vehicle&&i.odo?" · "+km(i.odo):""}</span></span>
    ${st&&st.level==="over"?'<span class="chip bad">overdue</span>':st&&st.level==="week"?'<span class="chip warn">soon</span>':"<span></span>"}</button>`}).join("");
  return`<section class="stack">${h||'<p class="empty">No items yet.</p>'}</section><div class="actions"><button class="btn primary" data-act="newitem">Add item</button></div>
  <p class="small muted">Items are the things you look after: the house, a car, the aircon, the pool pump, the water heater.</p>`};
function itemHTML(i){const ts=active().filter(t=>t.item===i.id).sort((a,b)=>status(a).eff-status(b).eff),lg=S.log.filter(l=>l.item===i.id).sort((a,b)=>b.date.localeCompare(a.date));
  const tot=lg.reduce((a,l)=>a+(+l.cost||0),0);
  const kv=[["Make / model",i.model],["Serial / plate",i.serial],["Bought",nice(i.bought)],["Warranty until",i.warranty?nice(i.warranty)+(diff(i.warranty)<0?" (ended)":""):""],["Location",i.location]].filter(x=>x[1]);
  return`<div class="row"><button class="btn sm ghost" data-act="backitems">‹ All items</button></div>
  <section class="card hero cat-${esc(i.cat)}"><div class="card-h"><div><div class="eyebrow">${CATS[i.cat]||"Other"}</div><h1>${esc(i.name)}</h1></div><button class="btn sm" data-act="edititem" data-id="${esc(i.id)}">Edit</button></div>
    ${kv.length?`<dl class="kv">${kv.map(x=>`<dt>${x[0]}</dt><dd>${esc(x[1])}</dd>`).join("")}</dl>`:'<p class="small muted">Add make, model, serial and warranty with Edit.</p>'}
    ${i.notes?`<p class="small" >${esc(i.notes)}</p>`:""}</section>
  ${i.vehicle?`<section class="card"><h2>Odometer</h2><div class="odo"><span class="n">${i.odo?km(i.odo):"–"}</span><span class="small muted">${i.odoDate?"as of "+esc(nice(i.odoDate)):""}</span></div>
    <div class="odo-in"><input type="number" id="odo-in" inputmode="numeric" min="0" placeholder="New reading (km)" aria-label="New odometer reading"><button class="btn primary" data-act="odo" data-id="${esc(i.id)}">Update</button></div>
    <p class="small muted">Update it every month or so and kilometre-based tasks will come due on time.</p></section>`:""}
  <div class="group-h"><h2>Tasks</h2><button class="link" data-act="newtask" data-item="${esc(i.id)}">+ Add task</button></div>
  <div class="list">${ts.length?ts.map(trow).join(""):'<p class="empty trow">No tasks for this item.</p>'}</div>
  <div class="group-h"><h2>History</h2><span class="mono small">${esc(money(tot))}</span></div>
  <div class="list">${lg.length?lg.map(lrow).join(""):'<p class="empty lrow">Nothing logged yet.</p>'}</div>
  <div class="actions"><button class="btn ghost" data-act="newlog" data-item="${esc(i.id)}">Log a repair or purchase</button></div>`}

function lrow(l){const it=item(l.item),p=prov(l.prov);
  return`<button class="lrow" data-act="editlog" data-id="${esc(l.id)}"><span class="t">${esc(l.title)}</span><span class="c">${l.cost?esc(money(l.cost)):"–"}</span>
  <span class="s">${esc(nice(l.date))} · ${esc(it?it.name:"(deleted item)")}${p?" · "+esc(p.name):""}${l.km?" · "+km(l.km):""}</span><span></span>${l.notes?`<span class="n">${esc(l.notes)}</span>`:""}</button>`}
V.log=function(){
  const years=[...new Set(S.log.map(l=>String(l.date).slice(0,4)).concat([String(new Date().getFullYear())]))].sort().reverse();
  const L=S.log.filter(l=>(!logF.year||String(l.date).slice(0,4)===logF.year)&&(!logF.item||l.item===logF.item)).sort((a,b)=>b.date.localeCompare(a.date)||b.ts-a.ts);
  const tot=L.reduce((a,l)=>a+(+l.cost||0),0),by={};L.forEach(l=>{const c=(item(l.item)||{}).cat||"other";by[c]=(by[c]||0)+(+l.cost||0)});
  const mx=Math.max(1,...Object.values(by));
  return`<section class="card hero"><div class="eyebrow">Service history</div><h1>${esc(money(tot))}</h1><p class="small muted">${L.length} entr${L.length===1?"y":"ies"}${logF.year?" in "+logF.year:""}</p>
    ${Object.keys(by).length?`<div class="bars">${Object.keys(by).sort((a,b)=>by[b]-by[a]).map(c=>`<div class="brow"><span>${CATS[c]}</span><div class="bar"><i class="cat-${c}" data-w="${Math.round(100*by[c]/mx)}"></i></div><span class="mono small">${esc(money(by[c]))}</span></div>`).join("")}</div>`:""}</section>
  <div class="filters"><select id="lf-year" aria-label="Year"><option value="">All years</option>${years.map(y=>`<option${y===logF.year?" selected":""}>${y}</option>`).join("")}</select>
  <select id="lf-item" aria-label="Item"><option value="">All items</option>${itemOpts(logF.item)}</select></div>
  <div class="list">${L.length?L.map(lrow).join(""):'<p class="empty lrow">Nothing logged for this filter. Ticking a task done adds it here.</p>'}</div>
  <div class="actions"><button class="btn primary" data-act="newlog">Log a repair or purchase</button></div>`};

V.more=function(){const n=Object.keys(Y.out).length;
  return`<section class="card"><h2>Sharing & sync</h2>
    <div class="sumrow"><span>Signed in as</span><b>${esc(Y.me?Y.me.name+" ("+Y.me.email+")":"not connected")}</b></div>
    <div class="sumrow"><span>Status</span><b>${esc(syncLabel())}</b></div>
    <div class="sumrow"><span>Last synced</span><b>${Y.last?esc(new Date(Y.last).toTimeString().slice(0,5)+(dkey(new Date(Y.last))===dkey()?" today":" · "+nice(dkey(new Date(Y.last))))):"never"}</b></div>
    ${n?`<div class="sumrow"><span>Waiting to upload</span><b>${n}</b></div>`:""}
    <p class="small muted">Your log is shared between both phones. Ticks, tasks and history show up on the other phone within about 30 seconds, or straight away when it's opened.</p>
    <div class="actions"><button class="btn primary" data-act="syncnow">Sync now</button><a class="btn ghost" href="/cdn-cgi/access/logout">Sign out</a></div></section>
  <section class="card"><div class="card-h"><h2>Service providers</h2><button class="link" data-act="newprov">+ Add</button></div>
  ${S.provs.length?`<div class="list">${S.provs.map(p=>`<div class="trow"><span class="dot"></span><button class="main" data-act="editprov" data-id="${esc(p.id)}"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.trade||"")}${p.phone?" · "+esc(p.phone):""}</div></button>
    <span class="actions">${p.phone?`<a class="btn sm" href="tel:${esc(p.phone.replace(/[^\d+]/g,""))}">Call</a><a class="btn sm" href="${esc(waLink(p.phone))}" target="_blank" rel="noopener">WhatsApp</a>`:""}</span></div>`).join("")}</div>`:'<p class="empty">Keep your plumber, electrician, aircon technician and mechanic here.</p>'}</section>
  <section class="card"><h2>Reminders</h2><p class="small muted">Export your upcoming tasks to your phone's calendar so it reminds you. Each task also has an "Add to Google Calendar" button.</p>
    <div class="fgrid"><label class="f">Remind me (days before)<select data-set="lead">${[0,1,2,3,5,7,14].map(n=>`<option value="${n}"${+S.set.lead===n?" selected":""}>${n===0?"On the day":n+" day"+(n>1?"s":"")}</option>`).join("")}</select></label></div>
    <div class="actions"><button class="btn primary" data-act="ics">Export to calendar (.ics)</button></div>
    <p class="small muted">Re-export after you complete tasks: events keep the same ID, so Google Calendar updates them instead of duplicating.</p></section>
  <section class="card"><h2>Suggested tasks</h2><p class="small muted">Add more from the starter list any time.</p><div class="actions"><button class="btn" data-act="presets">Browse suggestions</button></div></section>
  <section class="card"><h2>Settings</h2><div class="fgrid">
    <label class="f">Currency<input type="text" data-set="cur" value="${esc(S.set.cur)}" maxlength="5"></label>
    <label class="f">Theme<select data-set="theme">${["auto","light","dark"].map(t=>`<option${S.set.theme===t?" selected":""}>${t}</option>`).join("")}</select></label>
    <label class="f full">Household names for cleaning (comma-separated; first two are Person A and B)<input type="text" data-set="people" value="${esc(S.set.people)}" maxlength="80"></label>
    <label class="f full chk"><input type="checkbox" id="ab-rotate"${S.set.abRotate?" checked":""}> Swap Person A and B every week</label>
    <label class="f full">Average km per day (for km-based due dates)<input type="number" data-set="kmday" min="1" max="500" value="${S.set.kmday}"></label></div></section>
  <section class="card"><h2>Backup</h2><p class="small muted">Your log is stored in your own Cloudflare database and on each phone. Export a backup now and then. Importing a backup replaces the shared log on both phones.</p>
    <div class="actions"><button class="btn" data-act="export">Export backup</button><label class="btn">Import backup<input type="file" id="imp" accept="application/json,.json" hidden></label></div></section>
  <section class="card"><details class="fold"><summary>Reset data</summary><div class="actions">
    <button class="btn danger block" data-act="reset" data-what="log">Clear service history</button>
    <button class="btn danger block" data-act="reset" data-what="all">Erase everything</button></div></details></section>`};

function render(){applyTheme();const n=new Date();$("#hdr-date").textContent=DOW[n.getDay()]+" "+n.getDate()+" "+MON[n.getMonth()];
  const v=$("#view"),open=$$("details[id]",v).filter(d=>d.open).map(d=>d.id);v.innerHTML=!Y.first&&!S.setup?connectHTML():V[S.tab]();applyDyn(v);setSync(syncState);
  open.forEach(id=>{const d=document.getElementById(id);if(d)d.open=true});
  $$("#tabs button").forEach(b=>{b.dataset.tab===S.tab?b.setAttribute("aria-current","page"):b.removeAttribute("aria-current");const old=$(".badge",b);if(old)old.remove()});
  $("#tabs").hidden=!S.setup;const od=S.setup?overdueN():0;if(od)$('#tabs [data-tab="due"]').insertAdjacentHTML("beforeend",`<span class="badge">${od}</span>`);
  try{if(navigator.setAppBadge)od?navigator.setAppBadge(od):navigator.clearAppBadge()}catch(e){}}
function go(tab){if(tab!==S.tab){S.tab=tab;save();window.scrollTo(0,0)}if(tab==="items"&&S.tab==="items")render();else render()}

/* ---------- sheets ---------- */
function taskSheet(t){const it=item(t.item)||{},st=status(t),p=prov(t.prov),hist=S.log.filter(l=>l.task===t.id).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
  const kv=[["Schedule",every(t)+(t.km?" or "+km(t.km):"")+(t.kind==="r"?" (renewal, fixed date)":"")],["Next due",t.due?nice(t.due)+" ("+st.label+")":st.label],
    ["Last done",t.lastDone?nice(t.lastDone):""],["Last done at",t.lastKm!==""&&t.lastKm!=null&&t.km?km(t.lastKm):""],["Usual cost",t.cost?money(t.cost):""],["Provider",p?p.name+(p.phone?" · "+p.phone:""):""]].filter(x=>x[1]);
  const g=gcal(t);
  openModal(`<div class="card-h"><div><div class="eyebrow">${esc(it.name||"")}</div><h2>${esc(t.title)}</h2></div><button class="btn sm ghost" data-act="close">Close</button></div>
  <dl class="kv">${kv.map(x=>`<dt>${x[0]}</dt><dd>${esc(x[1])}</dd>`).join("")}</dl>${t.tip?`<div class="tip">${esc(t.tip)}</div>`:""}
  ${hist.length?`<div><h3>History</h3><div class="list">${hist.map(lrow).join("")}</div></div>`:""}
  <div class="actions">${t.due||st.kmLeft!=null?`<button class="btn primary" data-act="done" data-id="${esc(t.id)}">Mark done</button><button class="btn" data-act="edittask" data-id="${esc(t.id)}">Edit</button>`:`<button class="btn primary" data-act="edittask" data-id="${esc(t.id)}">Set date</button><button class="btn" data-act="done" data-id="${esc(t.id)}">Renewed today</button>`}
  ${t.due?`<button class="btn" data-act="snooze" data-id="${esc(t.id)}">Snooze 1 week</button>`:""}${g?`<a class="btn" href="${esc(g)}" target="_blank" rel="noopener">Add to Google Calendar</a>`:""}
  ${p&&p.phone?`<a class="btn" href="tel:${esc(p.phone.replace(/[^\d+]/g,""))}">Call ${esc(p.name)}</a>`:""}</div>`)}
function nextAfter(t,doneKey){if(!(t.n>0))return"";const base=t.kind==="r"&&t.due?t.due:doneKey;let n=addN(base,t.n,t.u);
  if(t.kind==="r")while(pkey(n)<=pkey(doneKey)&&t.due)n=addN(n,t.n,t.u);return n}
function doneSheet(t){const it=item(t.item)||{},today=dkey();
  openModal(`<div class="card-h"><div><div class="eyebrow">Mark done</div><h2>${esc(t.title)}</h2></div><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <div class="fgrid"><label class="f">Date done<input type="date" id="dn-date" value="${today}" max="${today}"></label>
  <label class="f">Cost (${esc(S.set.cur)})<input type="number" id="dn-cost" inputmode="decimal" min="0" value="${esc(t.cost||"")}" placeholder="0"></label>
  <label class="f">Provider<select id="dn-prov">${provOpts(t.prov)}</select></label>
  ${it.vehicle?`<label class="f">Odometer (km)<input type="number" id="dn-km" inputmode="numeric" min="0" value="${esc(it.odo||"")}"></label>`:""}
  <label class="f full">Notes<textarea id="dn-notes" placeholder="Parts used, what was found, warranty on the work…"></textarea></label>
  ${t.n>0?`<label class="f full">Next due<input type="date" id="dn-next" value="${esc(nextAfter(t,today))}" data-tid="${esc(t.id)}"></label>`:`<p class="small muted full">One-off task: it will be archived.</p>`}</div>
  <div class="actions"><button class="btn primary big" data-act="savedone" data-id="${esc(t.id)}">Save</button></div>`)}
function taskEditor(t){const isNew=!t;t=t||{id:"",item:itemView||(S.items[0]||{}).id,title:"",kind:"m",n:6,u:"month",due:dkey(),km:0,lastKm:"",tip:"",cost:"",prov:""};
  const it=item(t.item)||{};
  openModal(`<div class="card-h"><h2>${isNew?"New task":"Edit task"}</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <div class="fgrid"><label class="f full">Task<input type="text" id="te-title" value="${esc(t.title)}" maxlength="90" placeholder="e.g. Service pool pump"></label>
  <label class="f">Item<select id="te-item">${itemOpts(t.item)}</select></label>
  <label class="f">Type<select id="te-kind"><option value="m"${t.kind!=="r"?" selected":""}>Maintenance</option><option value="r"${t.kind==="r"?" selected":""}>Renewal / expiry</option></select></label>
  <label class="f">Repeat every<input type="number" id="te-n" min="0" max="120" inputmode="numeric" value="${t.n}"></label>
  <label class="f">Unit<select id="te-u">${Object.keys(UNITS).map(u=>`<option value="${u}"${t.u===u?" selected":""}>${UNITS[u][1]}</option>`).join("")}</select></label>
  <label class="f full">Next due date<input type="date" id="te-due" value="${esc(t.due||"")}"></label>
  <div class="fgrid full" id="te-kmbox"${it.vehicle?"":" hidden"}><label class="f">Or every (km)<input type="number" id="te-km" min="0" inputmode="numeric" value="${t.km||""}" placeholder="e.g. 10000"></label><label class="f">Last done at (km)<input type="number" id="te-lastkm" min="0" inputmode="numeric" value="${esc(t.lastKm)}"></label></div>
  <label class="f">Usual cost (${esc(S.set.cur)})<input type="number" id="te-cost" min="0" inputmode="decimal" value="${esc(t.cost)}"></label>
  <label class="f">Provider<select id="te-prov">${provOpts(t.prov)}</select></label>
  <label class="f full">Notes / how-to<textarea id="te-tip">${esc(t.tip)}</textarea></label></div>
  <p class="small muted">Set repeat to 0 for a one-off job. Renewals keep their anniversary date even if you renew early or late.</p>
  <div class="actions"><button class="btn primary" data-act="savetask" data-id="${esc(t.id)}">Save</button>${isNew?"":`<button class="btn danger" data-act="deltask" data-id="${esc(t.id)}">Delete</button>`}</div>`)}
function itemEditor(i){const isNew=!i;i=i||{id:"",name:"",cat:"home",vehicle:false};
  openModal(`<div class="card-h"><h2>${isNew?"New item":"Edit item"}</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <div class="fgrid"><label class="f full">Name<input type="text" id="ie-name" value="${esc(i.name)}" maxlength="60" placeholder="e.g. Pool pump, Bedroom aircon"></label>
  <label class="f">Category<select id="ie-cat">${catOpts(i.cat)}</select></label>
  <label class="check"><input type="checkbox" id="ie-veh"${i.vehicle?" checked":""}> Track kilometres</label>
  <label class="f">Make / model<input type="text" id="ie-model" value="${esc(i.model)}" maxlength="80"></label>
  <label class="f">Serial / plate<input type="text" id="ie-serial" value="${esc(i.serial)}" maxlength="60"></label>
  <label class="f">Bought<input type="date" id="ie-bought" value="${esc(i.bought)}"></label>
  <label class="f">Warranty until<input type="date" id="ie-warranty" value="${esc(i.warranty)}"></label>
  <label class="f full">Location<input type="text" id="ie-loc" value="${esc(i.location)}" maxlength="80" placeholder="e.g. Roof, garage, kitchen"></label>
  <label class="f full">Notes<textarea id="ie-notes" placeholder="Filter sizes, paint colours, parts numbers…">${esc(i.notes)}</textarea></label></div>
  <div class="actions"><button class="btn primary" data-act="saveitem" data-id="${esc(i.id)}">Save</button>${isNew?"":`<button class="btn danger" data-act="delitem" data-id="${esc(i.id)}">Delete item</button>`}</div>`)}
function logEditor(l,itemId){const isNew=!l;l=l||{id:"",date:dkey(),item:itemId||itemView||(S.items[0]||{}).id,title:"",cost:"",prov:"",km:"",notes:""};
  openModal(`<div class="card-h"><h2>${isNew?"Log a repair or purchase":"Edit entry"}</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <div class="fgrid"><label class="f full">What was done<input type="text" id="le-title" value="${esc(l.title)}" maxlength="90" placeholder="e.g. Replaced kitchen tap"></label>
  <label class="f">Item<select id="le-item">${itemOpts(l.item)}</select></label><label class="f">Date<input type="date" id="le-date" value="${esc(l.date)}"></label>
  <label class="f">Cost (${esc(S.set.cur)})<input type="number" id="le-cost" min="0" inputmode="decimal" value="${esc(l.cost)}"></label><label class="f">Provider<select id="le-prov">${provOpts(l.prov)}</select></label>
  <label class="f">Odometer (km, vehicles)<input type="number" id="le-km" min="0" inputmode="numeric" value="${esc(l.km)}"></label>
  <label class="f full">Notes<textarea id="le-notes">${esc(l.notes)}</textarea></label></div>
  <div class="actions"><button class="btn primary" data-act="savelog" data-id="${esc(l.id)}">Save</button>${isNew?"":`<button class="btn danger" data-act="dellog" data-id="${esc(l.id)}">Delete</button>`}</div>`)}
function provEditor(p){const isNew=!p;p=p||{id:"",name:"",trade:"",phone:"",notes:""};
  openModal(`<div class="card-h"><h2>${isNew?"New provider":"Edit provider"}</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <div class="fgrid"><label class="f full">Name<input type="text" id="pe-name" value="${esc(p.name)}" maxlength="60"></label>
  <label class="f">Trade<input type="text" id="pe-trade" value="${esc(p.trade)}" maxlength="40" placeholder="Plumber, mechanic…"></label>
  <label class="f">Phone<input type="tel" id="pe-phone" value="${esc(p.phone)}" maxlength="24" placeholder="5xxx xxxx"></label>
  <label class="f full">Notes<textarea id="pe-notes" placeholder="Rates, reliability, who recommended them…">${esc(p.notes)}</textarea></label></div>
  <div class="actions"><button class="btn primary" data-act="saveprov" data-id="${esc(p.id)}">Save</button>${isNew?"":`<button class="btn danger" data-act="delprov" data-id="${esc(p.id)}">Delete</button>`}</div>`)}
function presetSheet(){const on=t=>[...new Set(active().filter(x=>x.title===t).map(x=>(item(x.item)||{}).name).filter(Boolean))].join(", ");
  openModal(`<div class="card-h"><h2>Suggested tasks</h2><button class="btn sm ghost" data-act="close">Close</button></div>
  <label class="f">Add to item<select id="ps-item">${itemOpts(itemView)}</select></label>
  ${["home","car","appliance","garden"].map(c=>`<div class="pgroup"><h3 class="eyebrow">${CATS[c]}</h3>${P.map((p,i)=>p.c!==c?"":`<label class="prow"><input type="checkbox" data-preset="${i}"><span><span class="t">${esc(p.t)}</span>${on(p.t)?` <span class="chip good">on ${esc(on(p.t))}</span>`:""}<br><span class="s">${esc(every(p))}${p.km?" or "+km(p.km):""}</span></span></label>`).join("")}</div>`).join("")}
  <p class="small muted">Tip: pick the item first, e.g. choose your car before adding car tasks.</p>
  <div class="actions"><button class="btn primary" data-act="addpresets">Add selected</button></div>`)}

/* ---------- calendar export ---------- */
function icsText(){const now=new Date(),stamp=now.toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");const E=s=>String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
  const fold=l=>{let o="";while(l.length>74){o+=l.slice(0,74)+"\r\n ";l=l.slice(74)}return o+l};
  const lead=+S.set.lead||0,trig=lead===0?"PT9H":"-PT"+(lead*24-9)+"H",seq=Math.floor(Date.now()/1000)%2e9;
  const L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Home Log//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Home Log"];
  let n=0;active().filter(t=>t.due).forEach(t=>{const it=item(t.item);n++;
    L.push("BEGIN:VEVENT","UID:"+t.id+"@homelog","SEQUENCE:"+seq,"DTSTAMP:"+stamp,"DTSTART;VALUE=DATE:"+t.due.replace(/-/g,""),"DTEND;VALUE=DATE:"+addN(t.due,1,"day").replace(/-/g,""),
      "SUMMARY:"+E(t.title+(it?" · "+it.name:"")),"DESCRIPTION:"+E([every(t),t.tip].filter(Boolean).join("\n")),"TRANSP:TRANSPARENT");
    if(t.kind==="r"&&t.n>0)L.push("RRULE:FREQ="+{day:"DAILY",week:"WEEKLY",month:"MONTHLY",year:"YEARLY"}[t.u]+";INTERVAL="+t.n);
    L.push("BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:"+E(t.title),"TRIGGER:"+trig,"END:VALARM","END:VEVENT")});
  L.push("END:VCALENDAR");return{text:L.map(fold).join("\r\n")+"\r\n",n}}
function download(text,name,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
async function exportIcs(){const {text,n}=icsText();if(!n){toast("No dated tasks to export.");return}const name="home-log-"+dkey()+".ics";
  try{const f=new File([text],name,{type:"text/calendar"});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:"Home Log reminders"});return}}catch(e){if(e&&e.name==="AbortError")return}
  download(text,name,"text/calendar");toast(n+" tasks exported")}

/* ---------- actions ---------- */
const val=id=>{const e=document.getElementById(id);return e?e.value:""};
const A={
  close:closeModal,
  setup(){const home={id:uid(),name:val("su-home").trim()||"Home",cat:"home"},items=[home],hasCar=$("#su-hascar").checked;let car=null;
    if(hasCar){const odo=Math.round(num(val("su-odo")));car={id:uid(),name:val("su-carname").trim()||"Car",cat:"car",vehicle:true,odo:odo||0,odoDate:odo?dkey():""};items.push(car)}
    const ap={id:uid(),name:"Appliances",cat:"appliance"},gd={id:uid(),name:"Garden",cat:"garden"};
    const picks=$$("[data-preset]:checked").map(x=>+x.dataset.preset).filter(i=>P[i]&&(P[i].c!=="car"||car));
    if(picks.some(i=>P[i].c==="appliance"))items.push(ap);if(picks.some(i=>P[i].c==="garden"))items.push(gd);
    const byCat={home:home.id,car:car&&car.id,appliance:ap.id,garden:gd.id};
    S.items=items;S.tasks=picks.map((i,k)=>presetTask(P[i],k,byCat[P[i].c],car&&car.odo));S.setup=true;save();render();window.scrollTo(0,0);toast("Your log is ready")},
  task(b){const t=S.tasks.find(x=>x.id===b.dataset.id);if(t)taskSheet(t)},
  done(b){const t=S.tasks.find(x=>x.id===b.dataset.id);if(t)doneSheet(t)},
  savedone(b){const t=S.tasks.find(x=>x.id===b.dataset.id);if(!t)return;const it=item(t.item)||{},date=val("dn-date")||dkey(),k=Math.round(num(val("dn-km")));
    S.log.push({id:uid(),ts:Date.now(),by:myName(),date,item:t.item,task:t.id,title:t.title,cost:num(val("dn-cost"))||"",prov:val("dn-prov"),km:k||"",notes:val("dn-notes").trim()});
    t.lastDone=date;t.prov=val("dn-prov")||t.prov;if(k){t.lastKm=k;if(it.vehicle&&k>(it.odo||0)){it.odo=k;it.odoDate=date}}else if(t.km&&it.vehicle&&it.odo)t.lastKm=it.odo;
    if(t.n>0){const nx=val("dn-next");t.due=validKey(nx)?nx:nextAfter(t,date)}else{t.archived=true}
    save();closeModal();render();toast(t.archived?"Done and archived":"Done · next "+nice(t.due))},
  snooze(b){const t=S.tasks.find(x=>x.id===b.dataset.id);if(!t||!t.due)return;const base=diff(t.due)<0?dkey():t.due;t.due=addN(base,7,"day");save();closeModal();render();toast("Snoozed to "+nice(t.due))},
  newtask(b){if(!S.items.length){toast("Add an item first.");return}taskEditor(null);if(b.dataset.item)$("#te-item").value=b.dataset.item,syncKm()},
  edittask(b){const t=S.tasks.find(x=>x.id===b.dataset.id);if(t)taskEditor(t)},
  savetask(b){const title=val("te-title").trim();if(!title){toast("Name the task.");return}const n=Math.max(0,Math.round(num(val("te-n")))),due=val("te-due");
    let t=S.tasks.find(x=>x.id===b.dataset.id);if(!t){t={id:uid(),lastDone:""};S.tasks.push(t)}
    Object.assign(t,{title,item:val("te-item"),kind:val("te-kind"),n,u:val("te-u"),due:validKey(due)?due:"",km:Math.round(num(val("te-km")))||0,lastKm:val("te-lastkm")===""?"":Math.round(num(val("te-lastkm"))),cost:num(val("te-cost"))||"",prov:val("te-prov"),tip:val("te-tip").trim()});
    if(t.km&&t.lastKm===""){const it=item(t.item);if(it&&it.odo)t.lastKm=it.odo}
    save();closeModal();render();toast("Task saved")},
  deltask(b){if(!confirm("Delete this task? Its history stays in the log."))return;S.tasks=S.tasks.filter(x=>x.id!==b.dataset.id);save();closeModal();render()},
  openitem(b){itemView=b.dataset.id;S.tab="items";save();render();window.scrollTo(0,0)},
  backitems(){itemView=null;render();window.scrollTo(0,0)},
  newitem(){itemEditor(null)},
  edititem(b){const i=item(b.dataset.id);if(i)itemEditor(i)},
  saveitem(b){const name=val("ie-name").trim();if(!name){toast("Name the item.");return}let i=item(b.dataset.id);if(!i){i={id:uid()};S.items.push(i)}
    Object.assign(i,{name,cat:val("ie-cat"),vehicle:$("#ie-veh").checked,model:val("ie-model").trim(),serial:val("ie-serial").trim(),bought:val("ie-bought"),warranty:val("ie-warranty"),location:val("ie-loc").trim(),notes:val("ie-notes").trim()});
    save();closeModal();itemView=i.id;S.tab="items";render();toast("Saved")},
  delitem(b){const id=b.dataset.id,n=S.tasks.filter(t=>t.item===id).length;if(!confirm("Delete this item and its "+n+" task(s)? Logged history is kept."))return;
    S.items=S.items.filter(i=>i.id!==id);S.tasks=S.tasks.filter(t=>t.item!==id);itemView=null;save();closeModal();render()},
  odo(b){const i=item(b.dataset.id),v=Math.round(num(val("odo-in")));if(!i||!v){toast("Enter the km reading.");return}if(i.odo&&v<i.odo&&!confirm("That's lower than the last reading ("+km(i.odo)+"). Use it anyway?"))return;
    i.odo=v;i.odoDate=dkey();save();render();toast("Odometer updated")},
  newlog(b){if(!S.items.length){toast("Add an item first.");return}logEditor(null,b.dataset.item)},
  editlog(b){const l=S.log.find(x=>x.id===b.dataset.id);if(l)logEditor(l)},
  savelog(b){const title=val("le-title").trim();if(!title){toast("Describe what was done.");return}let l=S.log.find(x=>x.id===b.dataset.id);if(!l){l={id:uid(),ts:Date.now(),task:""};S.log.push(l)}
    Object.assign(l,{title,item:val("le-item"),date:val("le-date")||dkey(),cost:num(val("le-cost"))||"",prov:val("le-prov"),km:Math.round(num(val("le-km")))||"",notes:val("le-notes").trim()});
    const it=item(l.item);if(it&&it.vehicle&&l.km>(it.odo||0)){it.odo=l.km;it.odoDate=l.date}save();closeModal();render();toast("Logged")},
  dellog(b){if(!confirm("Delete this entry?"))return;S.log=S.log.filter(x=>x.id!==b.dataset.id);save();closeModal();render()},
  newprov(){provEditor(null)},
  editprov(b){const p=prov(b.dataset.id);if(p)provEditor(p)},
  saveprov(b){const name=val("pe-name").trim();if(!name){toast("Add a name.");return}let p=prov(b.dataset.id);if(!p){p={id:uid()};S.provs.push(p)}
    Object.assign(p,{name,trade:val("pe-trade").trim(),phone:val("pe-phone").trim(),notes:val("pe-notes").trim()});save();closeModal();render();toast("Saved")},
  delprov(b){if(!confirm("Delete this provider?"))return;S.provs=S.provs.filter(p=>p.id!==b.dataset.id);save();closeModal();render()},
  presets(){presetSheet()},
  addpresets(){const iid=val("ps-item"),it=item(iid),picks=$$("#modal [data-preset]:checked").map(x=>+x.dataset.preset);if(!picks.length){toast("Tick at least one.");return}
    picks.forEach((i,k)=>S.tasks.push(presetTask(P[i],k,iid,it&&it.odo)));save();closeModal();render();toast(picks.length+" task"+(picks.length>1?"s":"")+" added to "+(it?it.name:""))},
  ics(){exportIcs()},
  ctick(b){const c=S.clean.tasks.find(x=>x.id===b.dataset.id);if(!c)return;const k=dkey(),was=isDone(c);
    if(c.f==="o"){S.clean.tasks=S.clean.tasks.filter(x=>x!==c);delete S.clean.done[c.id];delete S.clean.by[c.id];save();render();toast("Done: "+c.t);return}
    if(was){delete S.clean.done[c.id];delete S.clean.by[c.id]}else{S.clean.done[c.id]=period(c.f);if(myName())S.clean.by[c.id]=myName()}
    {const all=todayAll();S.clean.days[k]=all.length>0&&all.every(isDone);const cut=dkey(new Date(Date.now()-90*DAY));for(const d in S.clean.days)if(d<cut)delete S.clean.days[d]}
    save();render();if(!was){const td=cleanToday();if(td.list.length&&td.done===td.list.length)toast("Today's cleaning is done")}},
  cwho(b){cleanWho=b.dataset.p;render()},
  syncnow(){Y.me=null;sync()},
  signin(){location.assign(location.pathname+"?signin="+Date.now())},
  cswap(){S.set.abFlip=!S.set.abFlip;save();render();const R=roles();toast(R.A+" is Person A this week")},
  cnew(){cleanEditor(null)},
  cedit(b){const c=S.clean.tasks.find(x=>x.id===b.dataset.id);if(c)cleanEditor(c)},
  csave(b){const t=val("ce-t").trim();if(!t){toast("Name the task.");return}let c=S.clean.tasks.find(x=>x.id===b.dataset.id);if(!c){c={id:uid()};S.clean.tasks.push(c)}
    const f=val("ce-f");const wv=val("ce-who"),role=wv==="@A"?"A":wv==="@B"?"B":"";if(t!==c.t)c.rot=0;
    Object.assign(c,{t,f,day:f==="w"&&val("ce-day")!==""?+val("ce-day"):"",who:role?"":wv,role,min:Math.round(num(val("ce-min")))||0,tip:val("ce-tip").trim()});save();closeModal();render();toast("Saved")},
  cdel(b){if(!confirm("Delete this cleaning task?"))return;S.clean.tasks=S.clean.tasks.filter(x=>x.id!==b.dataset.id);delete S.clean.done[b.dataset.id];delete S.clean.by[b.dataset.id];save();closeModal();render()},
  crestore(){const key=c=>c.t+"|"+c.day+"|"+(c.role||"");const have=new Set(S.clean.tasks.map(key));const add=cleanDefaults().filter(c=>!have.has(key(c)));if(!add.length){toast("The full plan is already in your list.");return}
    S.clean.tasks.push(...add);save();render();toast(add.length+" task"+(add.length>1?"s":"")+" restored")},
  export(){download(JSON.stringify(Object.assign({},S,{exportedAt:new Date().toISOString()}),null,1),"home-log-backup-"+dkey()+".json","application/json")},
  reset(b){const w=b.dataset.what;if(!confirm(w==="all"?"Erase everything on both phones: items, tasks, history, providers and cleaning list?":"Clear all service history on both phones?"))return;
    if(w==="all"){S=fresh();itemView=null}else S.log=[];save();render();toast("Done")}
};
function syncKm(){const it=item(val("te-item")),box=$("#te-kmbox");if(box)box.hidden=!(it&&it.vehicle)}
document.addEventListener("click",e=>{const t=e.target.closest("[data-tab]");if(t){if(t.dataset.tab==="items")itemView=null;go(t.dataset.tab);return}
  const b=e.target.closest("[data-act]");if(b&&!b.disabled&&A[b.dataset.act]){e.preventDefault();A[b.dataset.act](b,e);return}
  if(e.target.id==="modal")closeModal()});
document.addEventListener("change",e=>{const t=e.target;
  if(t.id==="su-hascar"){$("#su-car").hidden=!t.checked;const pg=$('[data-pg="car"]');if(pg)pg.hidden=!t.checked}
  if(t.id==="te-item")syncKm();
  if(t.id==="ab-rotate"){S.set.abRotate=t.checked;save();render()}
  if(t.id==="ce-f"){const bx=$("#ce-daybox");if(bx)bx.hidden=t.value!=="w"}
  if(t.id==="ie-cat"&&t.value==="car")$("#ie-veh").checked=true;
  if(t.id==="dn-date"){const nx=$("#dn-next");if(nx){const tk=S.tasks.find(x=>x.id===nx.dataset.tid);if(tk&&validKey(t.value))nx.value=nextAfter(tk,t.value)}}
  if(t.id==="lf-year"){logF.year=t.value;render()}if(t.id==="lf-item"){logF.item=t.value;render()}
  if(t.dataset.set){const k=t.dataset.set;if(k==="cur")S.set.cur=t.value.trim()||"Rs";else if(k==="people")S.set.people=t.value;else if(k==="theme")S.set.theme=t.value;else S.set[k]=Math.max(k==="lead"?0:1,Math.round(num(t.value)));save();render()}
  if(t.id==="imp"&&t.files&&t.files[0]){if(S.setup&&!confirm("Replace the shared log on both phones with this backup?")){t.value="";return}const r=new FileReader();r.onload=()=>{try{const o=JSON.parse(r.result);if(!o||o.v!==1||!Array.isArray(o.tasks))throw 0;delete o.exportedAt;S=sanitize(o);itemView=null;save();render();toast("Backup restored")}catch(x){toast("That file isn't a Home Log backup.")}};r.readAsText(t.files[0])}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#modal").hidden)closeModal()});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){render();sync()}});
window.addEventListener("online",sync);
setInterval(()=>{if(document.visibilityState==="visible")sync()},30e3);

render();sync();
const sp=$("#splash");setTimeout(()=>{sp.classList.add("out");setTimeout(()=>sp.remove(),500)},900);
if("serviceWorker" in navigator&&location.protocol!=="file:")window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
window.__home={get S(){return S},get Y(){return Y},sync,status,addN,nextAfter,icsText};
})();
