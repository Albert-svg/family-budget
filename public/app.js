/* Family Budget — shared, synced household budget.
   Data: a local copy (localStorage) + an outbox of unsent changes, synced with /api (Cloudflare D1).
   Works offline; changes upload when the connection is back. Last write wins per record. */
(function(){
"use strict";
const validKey=k=>/^\d{4}-\d{2}-\d{2}$/.test(k||"");
const KEY="familybudget:v1", DAY=864e5;
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=p=>(p||"r")+"-"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const pad=n=>String(n).padStart(2,"0");
const dkey=(d=new Date())=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const pkey=k=>{const[a,b,c]=String(k).split("-").map(Number);return new Date(a,b-1,c||1)};

const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],MONL=["January","February","March","April","May","June","July","August","September","October","November","December"],DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const nice=k=>{const d=pkey(k);return d.getDate()+" "+MON[d.getMonth()]};
const niceDay=k=>{const d=pkey(k),t=dkey(),y=dkey(new Date(Date.now()-DAY));return k===t?"Today":k===y?"Yesterday":DOW[d.getDay()]+" "+d.getDate()+" "+MON[d.getMonth()]};
const num=v=>{const n=parseFloat(String(v).replace(/[^\d.\-]/g,""));return isFinite(n)?Math.round(n*100)/100:0};
const COLORS=["#0E8A5F","#E9B949","#E8784F","#5B8DEF","#B06AD9","#2DB3C6","#D9577B","#8A9A3B","#C58B4B","#6B7A8F","#3CCB94","#F2994A"];
const METHODS=["Card","Cash","Juice / mobile","Bank transfer","Standing order"];

const DEFAULT_CATS=[
 ["home","Rent / mortgage","Home"],["elec","Electricity (CEB)","Home"],["water","Water (CWA)","Home"],["net","Internet & phones","Home"],["gas","Cooking gas","Home"],["homefix","Home maintenance","Home"],
 ["groc","Groceries","Food"],["market","Market: fruit & veg","Food"],["eatout","Eating out & takeaway","Food"],
 ["fuel","Fuel","Transport"],["car","Car lease & costs","Transport"],["bus","Bus & taxi","Transport"],
 ["health","Health & pharmacy","Family"],["clothes","Clothing","Family"],["care","Personal care","Family"],["gifts","Gifts & occasions","Family"],
 ["give","Donations","Giving"],
 ["subs","Subscriptions","Other"],["edu","Education & certifications","Other"],["fun","Entertainment & outings","Other"],["misc","Miscellaneous","Other"]];
const BILL_SUGGEST=[["Electricity (CEB)","elec"],["Water (CWA)","water"],["Internet","net"],["Mobile phones","net"],["Car lease (MCB Leasing)","car"],["Car insurance","car"],["Home insurance","homefix"],["Rent / mortgage","home"]];

/* ---------- local store ---------- */
function freshL(){return{recs:{},rev:0,out:{},me:null,lastSync:0,ui:{tab:"home",theme:"auto"},seeded:false}}
function loadL(){try{const s=JSON.parse(localStorage.getItem(KEY));if(s&&s.recs)return Object.assign(freshL(),s)}catch(e){}return freshL()}
let L=loadL(), syncState="idle", period=null, filt={q:"",cat:"",who:"",type:""};
function saveL(){try{localStorage.setItem(KEY,JSON.stringify(L))}catch(e){toast("Couldn't save on this phone. Storage full?")}}
const norm={cat:x=>{x.name=String(x.name||"Unnamed");return x},tx:x=>{if(!validKey(x.date))x.date="1970-01-01";x.amount=+x.amount||0;return x},bill:x=>{x.name=String(x.name||"Bill");return x},goal:x=>{x.name=String(x.name||"Goal");return x}};
const all=k=>Object.values(L.recs).filter(r=>r.kind===k&&!r.deleted&&r.data&&typeof r.data==="object").map(r=>(norm[k]||(x=>x))(Object.assign({},r.data,{id:r.id,_by:r.author})));
const get=id=>{const r=L.recs[id];return r&&!r.deleted?Object.assign({id:r.id},r.data):null};
function put(kind,id,data){const rec={id,kind,data,mtime:Math.max(Date.now(),((L.recs[id]||{}).mtime||0)+1),deleted:0,author:L.me?L.me.name:""};L.recs[id]=rec;L.out[id]=rec;saveL();queueSync()}
function del(id){const r=L.recs[id];if(!r)return;const rec=Object.assign({},r,{deleted:1,mtime:Math.max(Date.now(),r.mtime+1)});L.recs[id]=rec;L.out[id]=rec;saveL();queueSync()}
const settings=()=>Object.assign({currency:"Rs",start:1,income:[]},get("settings")||{});
const cats=()=>all("cat").sort((a,b)=>(a.order||0)-(b.order||0)||a.name.localeCompare(b.name));
const catById=id=>get(id)||{name:"Uncategorised",color:9};
const cColor=c=>COLORS[(+c.color||0)%COLORS.length];
const people=()=>(L.me&&L.me.people&&L.me.people.length?L.me.people:["Albert","Ruth"]);
const money=(n,sign)=>{const cur=settings().currency||"Rs",v=Math.abs(+n||0),s=v%1?v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):v.toLocaleString("en-US");return(sign&&n<0?"−":"")+cur+" "+s};

/* ---------- periods (budget month can start on payday) ---------- */
const startDay=()=>Math.min(28,Math.max(1,+settings().start||1));
function periodOf(k){const d=pkey(k),s=startDay();let Y=d.getFullYear(),M=d.getMonth()+1;if(d.getDate()<s){M--;if(M<1){M=12;Y--}}return Y+"-"+pad(M)}
function range(pk){const[Y,M]=pk.split("-").map(Number),s=startDay();return{from:dkey(new Date(Y,M-1,s)),to:dkey(new Date(Y,M,s-1))}}
function shift(pk,n){const[Y,M]=pk.split("-").map(Number);const d=new Date(Y,M-1+n,1);return d.getFullYear()+"-"+pad(d.getMonth()+1)}
function plabel(pk){const[Y,M]=pk.split("-").map(Number);if(startDay()===1)return MONL[M-1]+" "+Y;const r=range(pk);return nice(r.from)+" – "+nice(r.to)}
const curP=()=>periodOf(dkey());
const txIn=pk=>{const r=range(pk);return all("tx").filter(t=>t.date>=r.from&&t.date<=r.to)};
function totals(pk){const tx=txIn(pk);let inc=0,sp=0,sav=0;const byCat={},byWho={};
  tx.forEach(t=>{const a=+t.amount||0;if(t.type==="income")inc+=a;else if(t.type==="save")sav+=a;else{sp+=a;byCat[t.cat]=(byCat[t.cat]||0)+a;byWho[t.who||"?"]=(byWho[t.who||"?"]||0)+a}});
  return{inc,sp,sav,byCat,byWho,tx}}
const budgeted=()=>cats().reduce((a,c)=>a+(+c.limit||0),0);
/* ---------- weekly split: a category's period budget divided into 4 weeks ---------- */
function weeksOf(pk){const r=range(pk),d0=pkey(r.from),out=[];for(let i=0;i<4;i++){const a=new Date(d0);a.setDate(d0.getDate()+7*i);const b=new Date(d0);b.setDate(d0.getDate()+7*i+6);out.push({i,from:dkey(a),to:i===3?r.to:dkey(b)})}return out}
const weekIdx=(date,pk)=>{const w=weeksOf(pk);for(const x of w)if(date>=x.from&&date<=x.to)return x.i;return -1};
function evenSplit(total){total=+total||0;const base=Math.floor(total/4);return[base,base,base,total-3*base]}
function allocFor(c,pk){const by=c.weeksBy&&c.weeksBy[pk];const a=by||c.weeks;return Array.isArray(a)&&a.length===4?a.map(x=>+x||0):evenSplit(c.limit)}
const weeklyCats=()=>cats().filter(c=>c.weekly);
function weekSpent(c,pk){const w=[0,0,0,0];txIn(pk).forEach(t=>{if(t.type==="expense"&&t.cat===c.id){const i=weekIdx(t.date,pk);if(i>=0)w[i]+=+t.amount||0}});return w}
const wkLabel=w=>nice(w.from)+" – "+nice(w.to);
function weeklyCard(c,pk){const W=weeksOf(pk),al=allocFor(c,pk),sp=weekSpent(c,pk),today=dkey(),cw=pk===curP()?weekIdx(today,pk):-1,tot=al.reduce((a,b)=>a+b,0),st=sp.reduce((a,b)=>a+b,0);
  return`<section class="card weekly"><div class="card-h"><h2>${dot(c)} ${esc(c.name)} by week</h2><button class="link" data-act="weekedit" data-id="${esc(c.id)}">Adjust</button></div>
  <p class="small muted">${esc(money(st))} spent of ${esc(money(tot))} for the period</p>
  <div class="wkrows">${W.map(w=>{const a=al[w.i],s2=sp[w.i],left=a-s2,over=a&&s2>a,cur=w.i===cw,past=pk<curP()||(cw>=0&&w.i<cw);
    return`<button class="wkrow${cur?" cur":""}${over?" over":""}" data-act="weekspend" data-id="${esc(c.id)}" data-wk="${w.i}"><span class="wk-h"><b>Week ${w.i+1}</b>${cur?'<span class="chip good">this week</span>':""}<span class="small muted">${esc(wkLabel(w))}</span></span>
      <span class="wk-v"><span>${esc(money(s2))} / ${esc(money(a))}</span><span class="small ${left<0?"neg":past||cur?"pos":"muted"}">${a?(left<0?esc(money(-left))+" over":esc(money(left))+" left"):"no allocation"}</span></span>
      ${a?`<span class="bar ${over?"over":s2>a*.85?"warn":""}"><i data-w="${100*s2/a}"></i></span>`:""}</button>`}).join("")}</div></section>`}
function billDue(b,pk){if(!b.anchor)return true;const[ay,am]=b.anchor.split("-").map(Number),[py,pm]=pk.split("-").map(Number),diff=(py-ay)*12+(pm-am),ev=+b.every||1;return diff>=0&&diff%ev===0}
function billDate(b,pk){const r=range(pk),a=pkey(r.from),dd=Math.min(31,Math.max(1,+b.day||1));
  for(let i=0;i<2;i++){const y=a.getFullYear(),m=a.getMonth()+i,last=new Date(y,m+1,0).getDate(),k=dkey(new Date(y,m,Math.min(dd,last)));if(k>=r.from&&k<=r.to)return k}return r.from}

/* ---------- sync ---------- */
let syncing=false,syncT=null,again=false;
function queueSync(){clearTimeout(syncT);syncT=setTimeout(sync,700)}
async function api(path,opts){const o=Object.assign({credentials:"same-origin",redirect:"manual",cache:"no-store"},opts||{});if(o.body)o.headers={"content-type":"application/json"};
  let r;try{r=await fetch("/api/"+path,o)}catch(e){throw{offline:true}}
  if(r.type==="opaqueredirect"||r.status===401)throw{auth:true};if(r.status===403)throw{forbidden:true};if(!r.ok)throw{status:r.status};return r.json()}
async function sync(){if(syncing){again=true;return}syncing=true;setSync("syncing");
  try{if(!L.me||!L.me.people)L.me=await api("me");
    const outs=Object.values(L.out);
    for(let i=0;i<outs.length;i+=200){const chunk=outs.slice(i,i+200);await api("sync",{method:"POST",body:JSON.stringify({changes:chunk.map(c=>({id:c.id,kind:c.kind,data:c.data,mtime:c.mtime,deleted:c.deleted}))})});
      chunk.forEach(c=>{if(L.out[c.id]&&L.out[c.id].mtime===c.mtime)delete L.out[c.id]})}
    let more=true,changed=false;while(more){const j=await api("sync?since="+L.rev);j.records.forEach(r=>{const mine=L.out[r.id];if(mine&&mine.mtime>r.mtime)return;const cur=L.recs[r.id];if(!cur||cur.mtime<=r.mtime){L.recs[r.id]=r;changed=true}});L.rev=j.rev;more=j.more}
    L.lastSync=Date.now();seed();weeklyInit();saveL();setSync(Object.keys(L.out).length?"syncing":"ok");if(changed||!render.done)render()}
  catch(e){const prev=syncState;setSync(e.auth?"auth":e.forbidden?"forbidden":"offline");if(prev!==syncState||!(L.lastSync||Object.keys(L.recs).length))render()}
  finally{syncing=false;if(again){again=false;queueSync()}}}
/* one-time (Oct 2026): turn on weekly tracking for Groceries, right after a fresh sync so nothing stale is written */
function weeklyInit(){if(settings().weeklyInit||!cats().length)return;const g=get("c-groc")||cats().find(c=>/grocer/i.test(c.name));if(g&&g.weekly==null){const{id:_i,...rest}=g;put("cat",g.id,Object.assign(rest,{weekly:true}))}const st=settings();st.weeklyInit=1;saveSettings(st);queueSync()}
function seed(){if(L.seeded)return;const hasCat=Object.values(L.recs).some(r=>r.kind==="cat");
  if(!hasCat)DEFAULT_CATS.forEach((c,i)=>put("cat","c-"+c[0],{name:c[1],group:c[2],limit:0,color:i%COLORS.length,order:i}));
  if(!L.recs.settings)put("settings","settings",{currency:"Rs",start:1,income:[{name:"Albert: salary",amount:0},{name:"Albert: freelance",amount:0},{name:"Ruth",amount:0}]});
  L.seeded=true}
function setSync(s){syncState=s;const p=$("#syncpill");if(!p)return;p.className="syncpill "+s;const n=Object.keys(L.out).length;
  $("span",p).textContent=s==="ok"?"Synced":s==="syncing"?(n?n+" to send":"Syncing"):s==="auth"?"Sign in":s==="forbidden"?"No access":"Offline"+(n?" · "+n:"");renderBanner()}
function renderBanner(){const b=$("#banner");if(!b)return;let h="";
  if(syncState==="auth")h=`<div class="banner"><b>Please sign in again.</b><span class="small">Your Cloudflare sign-in has expired. Changes are kept on this phone until you do.</span><div><button class="btn sm primary" data-act="signin">Sign in</button></div></div>`;
  else if(syncState==="forbidden")h=`<div class="banner bad"><b>This email isn't on the family list.</b><span class="small">Ask Albert to add it in the Cloudflare settings (PEOPLE).</span></div>`;
  b.innerHTML=h}

/* ---------- ui helpers ---------- */
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(toast.h);toast.h=setTimeout(()=>t.classList.remove("show"),2400)}
function applyDyn(r){$$("[data-w]",r).forEach(el=>el.style.width=Math.max(0,Math.min(100,+el.dataset.w))+"%");$$("[data-c]",r).forEach(el=>el.style.background=el.dataset.c)}
function applyTheme(){const t=L.ui.theme||"auto";if(t==="auto")document.documentElement.removeAttribute("data-theme");else document.documentElement.dataset.theme=t}
const dot=c=>`<span class="dot" data-c="${esc(cColor(c))}"></span>`;
function openModal(html){const m=$("#modal");m.innerHTML=`<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;m.hidden=false;applyDyn(m)}
function closeModal(){const m=$("#modal");m.hidden=true;m.innerHTML=""}
const catOpts=(sel,first)=>(first!=null?`<option value="">${esc(first)}</option>`:"")+cats().map(c=>`<option value="${esc(c.id)}"${c.id===sel?" selected":""}>${esc(c.name)}</option>`).join("");
const whoOpts=(sel,first)=>(first!=null?`<option value="">${esc(first)}</option>`:"")+people().map(p=>`<option${p===sel?" selected":""}>${esc(p)}</option>`).join("");

/* ---------- views ---------- */
const V={};
const pnav=()=>`<div class="pnav"><button class="btn" data-act="prev" aria-label="Previous period">‹</button><b>${esc(plabel(period))}</b><button class="btn" data-act="next" aria-label="Next period"${period>=curP()?" disabled":""}>›</button></div>`;
V.home=function(){
  const T=totals(period),B=budgeted(),left=B-T.sp,r=range(period),isCur=period===curP();
  const daysLeft=isCur?Math.round((pkey(r.to)-pkey(dkey()))/DAY)+1:0,cash=T.inc-T.sp-T.sav;
  let h=pnav();
  h+=`<section class="card hero">${B?`<div class="eyebrow">Left in budget</div><h1 class="${left<0?"over":""}">${esc(money(left,1))}</h1>
    <div class="bar lg ${T.sp>B?"over":T.sp>B*.85?"warn":""}"><i data-w="${B?100*T.sp/B:0}"></i></div>
    <p class="small muted">${esc(money(T.sp))} spent of ${esc(money(B))}${isCur&&daysLeft>0&&left>0?" · "+daysLeft+" days left · about "+esc(money(Math.floor(left/daysLeft)))+"/day":""}</p>`
    :`<div class="eyebrow">This period</div><h1>${esc(money(T.sp))}</h1><p class="small muted">spent so far. Set monthly limits in <button class="link" data-tab="plan">Plan</button> to track what's left.</p>`}</section>
  <section class="grid3"><div class="tile inc"><div class="n">${esc(money(T.inc))}</div><div class="l">income</div></div><div class="tile"><div class="n">${esc(money(T.sp))}</div><div class="l">spent</div></div><div class="tile sav"><div class="n">${esc(money(T.sav))}</div><div class="l">saved</div></div></section>`;
  {const pb=planBalance();if(pb.state!=="empty")h+=`<button class="card balrow ${pb.state}" data-tab="plan"><span><b>Monthly plan</b><span class="small muted">${pb.state==="ok"?"Income, spending, pocket money and savings all add up.":"Tap to finish balancing in Plan."}</span></span>${balanceBadge(pb)}</button>`}
  weeklyCats().forEach(c=>{h+=weeklyCard(c,period)});
  if(T.inc)h+=`<p class="small muted center">Income − spending − savings = <b class="num ${cash<0?"neg":"pos"}">${esc(money(cash,1))}</b></p>`;
  const bills=all("bill").filter(b=>billDue(b,period)).map(b=>({b,d:billDate(b,period),paid:(b.paid||{})[period]})).sort((a,b)=>a.d.localeCompare(b.d));
  if(bills.length){const unpaid=bills.filter(x=>!x.paid);
    h+=`<div class="group-h"><h2>Bills</h2><span class="small muted">${bills.length-unpaid.length}/${bills.length} paid</span></div><div class="list">${bills.map(x=>{const due=!x.paid&&isCur&&x.d<=dkey();
      return`<div class="trow">${dot(catById(x.b.cat))}<div class="main"><div class="t">${esc(x.b.name)}</div><div class="s">${x.paid?"Paid":"Due "+esc(nice(x.d))}${x.b.amount?" · "+esc(money(x.b.amount)):""}</div></div>${x.paid?'<span class="chip good">paid</span>':`<button class="btn sm ${due?"primary":""}" data-act="paybill" data-id="${esc(x.b.id)}">Pay</button>`}</div>`}).join("")}</div>`}
  const cs=cats().map(c=>({c,s:T.byCat[c.id]||0,l:+c.limit||0})).filter(x=>x.s||x.l).sort((a,b)=>(b.l?b.s/b.l:b.s?9:0)-(a.l?a.s/a.l:a.s?9:0));
  const unc=Object.keys(T.byCat).filter(k=>!get(k)).reduce((a,k)=>a+T.byCat[k],0);
  h+=`<div class="group-h"><h2>Categories</h2><button class="link" data-tab="plan">Edit limits</button></div><div class="list">${cs.length?cs.map(x=>{const over=x.l&&x.s>x.l;
    return`<button class="crow${over?" over":""}" data-act="catspend" data-id="${esc(x.c.id)}"><span class="t">${dot(x.c)}<span>${esc(x.c.name)}</span></span><span class="v">${esc(money(x.s))}${x.l?" / "+esc(money(x.l)):""}</span>${x.l?`<div class="bar ${over?"over":x.s>x.l*.85?"warn":""}"><i data-w="${100*x.s/x.l}"></i></div>`:""}</button>`}).join(""):'<p class="empty">No spending yet this period. Tap + to add one.</p>'}${unc?`<div class="crow"><span class="t"><span>Uncategorised</span></span><span class="v">${esc(money(unc))}</span></div>`:""}</div>`;
  const ppl=Object.keys(T.byWho);if(T.sp&&ppl.length>1){const a=T.byWho[ppl[0]]||0;
    h+=`<section class="card"><h2>Who spent</h2><div class="bar lg split"><i data-w="${100*a/T.sp}"></i><i data-w="${100-100*a/T.sp}"></i></div><div class="sumrow small"><span>${esc(ppl[0])} <b>${esc(money(a))}</b></span><span>${esc(ppl.slice(1).join(", "))} <b>${esc(money(T.sp-a))}</b></span></div></section>`}
  h+=`<section class="card"><h2>Last 6 periods</h2>${chart()}<div class="legend"><span><i></i>Spent</span><span><i class="in"></i>Income</span></div></section>`;
  const goals=all("goal");if(goals.length)h+=`<div class="group-h"><h2>Savings goals</h2><button class="link" data-tab="plan">Manage</button></div><div class="list">${goals.map(goalRow).join("")}</div>`;
  const rec=T.tx.slice().sort((a,b)=>b.date.localeCompare(a.date)||(b.ts||0)-(a.ts||0)).slice(0,5);
  if(rec.length)h+=`<div class="group-h"><h2>Recent</h2><button class="link" data-tab="spend">See all</button></div><div class="list">${rec.map(txRow).join("")}</div>`;
  return h};
function chart(){const ps=[];for(let i=5;i>=0;i--)ps.push(shift(period,-i));const d=ps.map(p=>{const t=totals(p);return{p,sp:t.sp,inc:t.inc}});
  const mx=Math.max(1,...d.map(x=>Math.max(x.sp,x.inc))),W=320,H=140,bw=W/6;
  return`<svg class="chart" viewBox="0 0 ${W} ${H+18}" role="img" aria-label="Spending and income, last six periods">${d.map((x,i)=>{const hi=Math.round((H-6)*x.inc/mx),hs=Math.round((H-6)*x.sp/mx),X=i*bw+bw*.18;
    return`<rect class="in" x="${X}" y="${H-hi}" width="${bw*.3}" height="${hi}" rx="3"/><rect class="sp" x="${X+bw*.32}" y="${H-hs}" width="${bw*.3}" height="${hs}" rx="3"/><text x="${i*bw+bw/2}" y="${H+14}" text-anchor="middle">${MON[+x.p.slice(5)-1]}</text>`}).join("")}</svg>`}
function goalSaved(g){return(+g.startAmount||0)+all("tx").filter(t=>t.type==="save"&&t.goal===g.id).reduce((a,t)=>a+(+t.amount||0),0)}
function goalRow(g){const s=goalSaved(g),t=+g.target||0,pct=t?100*s/t:0;let need="";
  if(g.deadline&&t>s){const m=Math.max(1,Math.round((pkey(g.deadline)-new Date())/(30.4*DAY)));need=" · "+money(Math.ceil((t-s)/m))+"/month to reach by "+nice(g.deadline)+" "+g.deadline.slice(0,4)}
  if(+g.monthly)need=" · "+money(g.monthly)+"/month planned"+need;
  return`<button class="crow" data-act="editgoal" data-id="${esc(g.id)}"><span class="t"><span>${esc(g.name)}</span></span><span class="v">${esc(money(s))}${t?" / "+esc(money(t)):""}</span><div class="bar"><i data-w="${pct}"></i></div><span class="s">${t?Math.round(pct)+"%":""}${esc(need)}</span></button>`}
function txRow(t){const c=t.type==="income"?{name:t.source||"Income",color:0}:t.type==="save"?{name:"To "+((get(t.goal)||{}).name||"savings"),color:1}:catById(t.cat);
  return`<button class="trow" data-act="edittx" data-id="${esc(t.id)}">${dot(c)}<div class="main"><div class="t">${esc(t.note||c.name)}</div><div class="s">${esc(t.note?c.name+" · ":"")}${esc(t.who||"")}${t.method&&t.type==="expense"?" · "+esc(t.method):""}</div></div><span class="amt ${t.type==="income"?"inc":t.type==="save"?"sav":""}">${t.type==="income"?"+":t.type==="save"?"→ ":"−"}${esc(money(t.amount))}</span></button>`}

V.spend=function(){
  const q=filt.q.toLowerCase(),WK=filt.wk!=null&&filt.wk!==""?weeksOf(period)[+filt.wk]:null,T=txIn(period).filter(t=>(!WK||(t.date>=WK.from&&t.date<=WK.to))&&(!filt.cat||t.cat===filt.cat)&&(!filt.who||t.who===filt.who)&&(!filt.type||t.type===filt.type)&&(!q||[t.note,t.source,catById(t.cat).name,t.who,t.method].join(" ").toLowerCase().includes(q)))
    .sort((a,b)=>b.date.localeCompare(a.date)||(b.ts||0)-(a.ts||0));
  const days={};T.forEach(t=>(days[t.date]=days[t.date]||[]).push(t));
  const sp=T.filter(t=>t.type==="expense").reduce((a,t)=>a+(+t.amount||0),0);
  return pnav()+`<div class="filters"><input type="search" id="f-q" placeholder="Search notes, categories, people" value="${esc(filt.q)}" aria-label="Search">
    <select id="f-cat" aria-label="Category">${catOpts(filt.cat,"All categories")}</select>
    <select id="f-who" aria-label="Person">${whoOpts(filt.who,"Everyone")}</select>
    <select id="f-type" aria-label="Type"><option value="">All types</option>${[["expense","Spending"],["income","Income"],["save","Savings"]].map(x=>`<option value="${x[0]}"${filt.type===x[0]?" selected":""}>${x[1]}</option>`).join("")}</select>
    <select id="f-wk" aria-label="Week"><option value="">Whole period</option>${weeksOf(period).map(w=>`<option value="${w.i}"${WK&&WK.i===w.i?" selected":""}>Week ${w.i+1} · ${esc(wkLabel(w))}</option>`).join("")}</select>
    ${filt.cat||filt.who||filt.type||filt.q||WK?`<button class="btn sm ghost" data-act="clearf">Clear filters</button>`:""}</div>
  <p class="small muted">${T.length} entr${T.length===1?"y":"ies"} · ${esc(money(sp))} spent</p>
  <div class="list">${T.length?Object.keys(days).map(k=>{const tot=days[k].filter(t=>t.type==="expense").reduce((a,t)=>a+(+t.amount||0),0);return`<div class="day-h"><span>${esc(niceDay(k))}</span><span>${tot?"−"+esc(money(tot)):""}</span></div>${days[k].map(txRow).join("")}`}).join(""):'<p class="empty">Nothing here yet.</p>'}</div>
  <div class="actions"><button class="btn" data-act="csv">Export CSV (this period)</button></div>`};

V.plan=function(){
  const S=settings(),inc=(S.income||[]),planned=inc.reduce((a,x)=>a+(+x.amount||0),0),B=budgeted(),goals=all("goal"),bills=all("bill");
  const pocket=pocketList(),pocketTot=pocket.reduce((a,x)=>a+(+x.amount||0),0),afterPocket=planned-B-pocketTot,pb=planBalance();
  const byG={};cats().forEach(c=>(byG[c.group||"Other"]=byG[c.group||"Other"]||[]).push(c));
  let h=`<section class="card"><h2>Monthly plan</h2>
    <div class="sumrow"><span>Expected income</span><b>${esc(money(planned))}</b></div>
    <div class="sumrow"><span>Budgeted spending</span><b>${esc(money(B))}</b></div>
    <div class="sumrow total"><span>${planned-B>=0?"Left to save or assign":"Over-planned by"}</span><b class="${planned-B>=0?"pos":"neg"}">${esc(money(Math.abs(planned-B)))}</b></div>
    <div class="pocket"><div class="pocket-h"><span>Pocket money</span><span class="small muted">after everything else</span></div>
    ${pocket.map((x,i)=>`<div class="pocket-row"><span>${esc(x.name)}</span><input type="number" inputmode="decimal" min="0" data-pocket="${i}" value="${esc(x.amount||"")}" placeholder="0" aria-label="Pocket money for ${esc(x.name)}"></div>`).join("")}
    <div class="sumrow total"><span>${afterPocket>=0?"Left after pocket money":"Short after pocket money"}</span><b class="${afterPocket>=0?"pos":"neg"}">${esc(money(Math.abs(afterPocket)))}</b></div></div>
    <div class="sumrow"><span>Planned savings <button class="link" data-act="goalsjump">${goals.length?"(set per goal)":"(add a goal)"}</button></span><b>${esc(money(pb.sav))}</b></div>
    <div class="balance-box ${pb.state}"><div><b>Does the budget balance?</b><div class="small">${pb.state==="ok"?"Every rupee of expected income has a job.":pb.state==="under"?"Assign it to a category, pocket money or a savings goal so the plan balances.":pb.state==="over"?"You've planned more than you expect to earn. Lower some limits, pocket money or savings.":"Add your expected income and category limits."}</div></div>${balanceBadge(pb,1)}</div>
    <p class="small muted">Income − budgeted spending − pocket money − planned savings should equal zero.</p></section>
  <section class="card"><div class="card-h"><h2>Expected income</h2><button class="link" data-act="addinc">+ Add</button></div>
    ${inc.map((x,i)=>`<div class="inc-row"><input type="text" data-inc="${i}" data-k="name" value="${esc(x.name)}" aria-label="Income name"><input type="number" inputmode="decimal" data-inc="${i}" data-k="amount" value="${esc(x.amount||"")}" placeholder="0" aria-label="Monthly amount"><button class="btn sm ghost" data-act="delinc" data-i="${i}" aria-label="Remove">✕</button></div>`).join("")||'<p class="empty">Add each regular income.</p>'}</section>
  <div class="group-h"><h2>Category limits (per month)</h2><button class="link" data-act="newcat">+ Category</button></div>`;
  Object.keys(byG).forEach(g=>{const sub=byG[g].reduce((a,c)=>a+(+c.limit||0),0);
    h+=`<div class="list"><div class="day-h"><span>${esc(g)}</span><span>${esc(money(sub))}</span></div>${byG[g].map(c=>`<div class="limit-row">${dot(c)}<button class="name" data-act="editcat" data-id="${esc(c.id)}">${esc(c.name)}</button><input type="number" inputmode="decimal" min="0" data-limit="${esc(c.id)}" value="${esc(c.limit||"")}" placeholder="0" aria-label="Limit for ${esc(c.name)}"></div>`).join("")}</div>`});
  h+=`<div class="group-h"><h2>Bills & regular payments</h2><button class="link" data-act="newbill">+ Bill</button></div>
  <div class="list">${bills.length?bills.sort((a,b)=>(+a.day||0)-(+b.day||0)).map(b=>`<button class="trow" data-act="editbill" data-id="${esc(b.id)}">${dot(catById(b.cat))}<div class="main"><div class="t">${esc(b.name)}</div><div class="s">Day ${esc(b.day||1)} · ${+b.every>1?"every "+b.every+" months":"monthly"} · ${esc(catById(b.cat).name)}</div></div><span class="amt">${b.amount?esc(money(b.amount)):"–"}</span></button>`).join(""):`<p class="empty">Quick add:</p><div class="actions empty">${BILL_SUGGEST.map((s,i)=>`<button class="btn sm" data-act="suggbill" data-i="${i}">${esc(s[0])}</button>`).join("")}</div>`}</div>
  <div class="group-h" id="goals-h"><h2>Savings goals</h2><button class="link" data-act="newgoal">+ Goal</button></div>
  <div class="list">${goals.length?goals.map(goalRow).join(""):'<p class="empty">An emergency fund (3–6 months of expenses) is a good first goal.</p>'}</div>`;
  return h};

V.more=function(){const S=settings(),n=Object.keys(L.out).length;
  return`<section class="card"><h2>Account & sync</h2>
    <div class="sumrow"><span>Signed in as</span><b>${esc(L.me?L.me.name+" ("+L.me.email+")":"not connected")}</b></div>
    <div class="sumrow"><span>Household</span><b>${esc(people().join(", "))}</b></div>
    <div class="sumrow"><span>Last synced</span><b>${L.lastSync?esc(niceDay(dkey(new Date(L.lastSync)))+" "+new Date(L.lastSync).toTimeString().slice(0,5)):"never"}</b></div>
    <div class="sumrow"><span>Waiting to upload</span><b>${n}</b></div>
    <div class="actions"><button class="btn primary" data-act="syncnow">Sync now</button><a class="btn ghost" href="/cdn-cgi/access/logout">Sign out</a></div></section>
  <section class="card"><h2>Settings</h2><div class="fgrid">
    <label class="f">Currency<input type="text" data-set="currency" value="${esc(S.currency)}" maxlength="5"></label>
    <label class="f">Budget month starts on day<select data-set="start">${Array.from({length:28},(_,i)=>`<option${+S.start===i+1?" selected":""}>${i+1}</option>`).join("")}</select></label>
    <label class="f">Theme (this phone)<select data-ui="theme">${["auto","light","dark"].map(t=>`<option${L.ui.theme===t?" selected":""}>${t}</option>`).join("")}</select></label></div>
    <p class="small muted">If you're paid on the 25th, start the budget month on the 25th so each period runs from payday to payday. Settings are shared by both phones.</p></section>
  <section class="card"><h2>Export</h2><p class="small muted">Download everything as a spreadsheet, or keep a full backup.</p>
    <div class="actions"><button class="btn" data-act="csvall">All transactions (CSV)</button><button class="btn" data-act="backup">Full backup (JSON)</button></div></section>
  <section class="card"><h2>Privacy</h2><p class="small muted">Only the emails on your family list can open this app (Cloudflare Access, one-time code by email). Data is stored in your own Cloudflare D1 database. A copy lives on each phone so it works offline.</p>
    <div class="actions"><button class="btn danger sm" data-act="forget">Remove local copy from this phone</button></div></section>`};

function connectHTML(){const s=syncState;return`<section class="card connect"><div class="eyebrow">Family Budget</div><h2>${s==="auth"?"Sign in to continue":s==="forbidden"?"No access for this email":s==="syncing"||s==="idle"?"Connecting…":"You're offline"}</h2>
  <p class="small muted">${s==="offline"?"The first sync needs a connection. After that the app also works offline.":s==="auth"?"You'll get a one-time code by email.":""}</p>${s==="auth"?'<button class="btn primary" data-act="signin">Sign in</button>':s==="offline"?'<button class="btn" data-act="syncnow">Try again</button>':""}</section>`}
function render(){render.done=true;applyTheme();const v=$("#view"),ae=document.activeElement,aid=ae&&ae.id,sel=ae&&ae.selectionStart;
  if(!period)period=curP();
  const ready=L.lastSync||Object.keys(L.recs).length;v.innerHTML=ready?V[L.ui.tab]():connectHTML();$("#fab").hidden=!ready;applyDyn(v);
  if(aid&&document.getElementById(aid)&&v.contains(document.getElementById(aid))){const e=document.getElementById(aid);e.focus();try{e.setSelectionRange(sel,sel)}catch(x){}}
  $$("#tabs button").forEach(b=>b.dataset.tab===L.ui.tab?b.setAttribute("aria-current","page"):b.removeAttribute("aria-current"));setSync(syncState)}
function go(tab){if(L.ui.tab!==tab){L.ui.tab=tab;saveL();window.scrollTo(0,0)}render()}

/* ---------- sheets ---------- */
let draft=null;
function txSheet(t,preset){const isNew=!t;t=t||Object.assign({type:"expense",amount:"",cat:"",date:dkey(),who:L.me?L.me.name:people()[0],method:"Card",note:""},preset||{});draft=Object.assign({},t);
  const d=draft,goals=all("goal"),incNames=(settings().income||[]).map(x=>x.name);
  openModal(`<div class="card-h"><h2>${isNew?(d.bill?"Pay bill":"Add"):"Edit"}</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <div class="seg" role="tablist">${[["expense","Spending"],["income","Income"],["save","Saving"]].map(x=>`<button class="${d.type===x[0]?"on":""}" data-act="ttype" data-t="${x[0]}">${x[1]}</button>`).join("")}</div>
  <div class="amount-in"><span>${esc(settings().currency)}</span><input type="text" id="tx-amt" inputmode="decimal" autocomplete="off" value="${esc(d.amount)}" placeholder="0" aria-label="Amount"></div>
  <p class="small wkhint" id="wkhint">${wkHint(d)}</p>
  ${d.type==="expense"?`<div class="cats" role="listbox" aria-label="Category">${cats().map(c=>`<button class="${d.cat===c.id?"on":""}" data-act="tcat" data-id="${esc(c.id)}">${dot(c)}${esc(c.name)}</button>`).join("")}</div>`:""}
  ${d.type==="income"?`<label class="f">Source<input type="text" id="tx-src" list="incl" value="${esc(d.source||"")}" placeholder="e.g. Albert: salary"><datalist id="incl">${incNames.map(n=>`<option value="${esc(n)}">`).join("")}</datalist></label>`:""}
  ${d.type==="save"?(goals.length?`<label class="f">Goal<select id="tx-goal">${goals.map(g=>`<option value="${esc(g.id)}"${d.goal===g.id?" selected":""}>${esc(g.name)}</option>`).join("")}</select></label>`:'<p class="small muted">Create a savings goal in Plan first.</p>'):""}
  <div class="fgrid"><label class="f">Date<input type="date" id="tx-date" value="${esc(d.date)}"></label><label class="f">Who<select id="tx-who">${whoOpts(d.who)}</select></label>
  ${d.type==="expense"?`<label class="f">Paid by<select id="tx-method">${METHODS.map(m=>`<option${d.method===m?" selected":""}>${m}</option>`).join("")}</select></label>`:""}
  <label class="f ${d.type==="expense"?"":"full"}">Note<input type="text" id="tx-note" maxlength="80" value="${esc(d.note)}" placeholder="${d.type==="expense"?"e.g. Winners weekly shop":"optional"}"></label></div>
  <div class="actions"><button class="btn primary big" data-act="savetx" data-id="${esc(t.id||"")}">Save</button>${isNew?"":`<button class="btn danger" data-act="deltx" data-id="${esc(t.id)}">Delete</button><span class="small muted">Added by ${esc(t._by||"?")}</span>`}</div>`);
  const a=$("#tx-amt");if(isNew&&!d.amount)setTimeout(()=>a.focus(),60)}
function wkHint(d){const c=d&&d.type==="expense"&&d.cat?get(d.cat):null;if(!c||!c.weekly||!validKey(d.date))return"";const pk=periodOf(d.date),i=weekIdx(d.date,pk);if(i<0)return"";
  const a=allocFor(c,pk)[i],s2=weekSpent(c,pk)[i]-(d.id&&get(d.id)&&periodOf(get(d.id).date)===pk&&weekIdx(get(d.id).date,pk)===i?+get(d.id).amount||0:0);
  return esc(c.name)+" · Week "+(i+1)+" ("+esc(wkLabel(weeksOf(pk)[i]))+"): "+(a?esc(money(Math.max(0,a-s2)))+" left before this":esc(money(s2))+" spent so far")}
function keepDraft(){if(!draft)return;const v=id=>{const e=document.getElementById(id);return e?e.value:undefined};
  [["amount","tx-amt"],["date","tx-date"],["who","tx-who"],["method","tx-method"],["note","tx-note"],["source","tx-src"],["goal","tx-goal"]].forEach(([k,id])=>{const x=v(id);if(x!==undefined)draft[k]=x})}
function weekSum(){const t=[0,1,2,3].reduce((a,i)=>a+num(val("wk-"+i)),0),e=$("#wk-sum");if(e)e.textContent=money(t)}
function weekSheet(c){const W=weeksOf(period),al=allocFor(c,period),sp=weekSpent(c,period);
  openModal(`<div class="card-h" id="wk-sheet" data-id="${esc(c.id)}"><h2>${esc(c.name)}: weekly amounts</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <p class="small muted">${esc(plabel(period))}. Week 4 runs to the end of the budget period, so it can be a few days longer.</p>
  <div class="wk-edit">${W.map(w=>`<label class="f"><span>Week ${w.i+1} · ${esc(wkLabel(w))}${sp[w.i]?" · spent "+esc(money(sp[w.i])):""}</span><input type="number" inputmode="decimal" min="0" id="wk-${w.i}" value="${esc(al[w.i]||"")}" placeholder="0"></label>`).join("")}</div>
  <div class="sumrow total"><span>Total for the period</span><b id="wk-sum">${esc(money(al.reduce((a,b)=>a+b,0)))}</b></div>
  <div class="fgrid"><label class="f">Split evenly from<input type="number" inputmode="decimal" id="wk-total" value="${esc(c.limit||"")}" placeholder="monthly amount"></label><div class="f"><span>&nbsp;</span><button class="btn" data-act="weekeven">Split into 4</button></div></div>
  <label class="check"><input type="checkbox" id="wk-future" checked> Use these amounts for future periods too</label>
  <label class="check"><input type="checkbox" id="wk-limit" checked> Set the monthly limit to the total</label>
  <div class="actions"><button class="btn primary" data-act="weeksave" data-id="${esc(c.id)}">Save</button><button class="btn ghost" data-act="weekoff" data-id="${esc(c.id)}">Stop weekly tracking</button></div>`)}
function catSheet(c){const isNew=!c;c=c||{name:"",group:"Other",limit:"",color:cats().length%COLORS.length};const groups=[...new Set(cats().map(x=>x.group||"Other"))];
  openModal(`<div class="card-h"><h2>${isNew?"New category":"Edit category"}</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <div class="fgrid"><label class="f full">Name<input type="text" id="c-name" value="${esc(c.name)}" maxlength="40"></label>
  <label class="f">Group<input type="text" id="c-group" list="grpl" value="${esc(c.group||"")}" maxlength="24"><datalist id="grpl">${groups.map(g=>`<option value="${esc(g)}">`).join("")}</datalist></label>
  <label class="f">Monthly limit<input type="number" id="c-limit" inputmode="decimal" value="${esc(c.limit||"")}"></label>
  <label class="check full"><input type="checkbox" id="c-weekly"${c.weekly?" checked":""}> Split into 4 weekly amounts (track spending week by week)</label>
  <label class="f full">Colour<select id="c-color">${COLORS.map((_,i)=>`<option value="${i}"${+c.color===i?" selected":""}>Colour ${i+1}</option>`).join("")}</select></label></div>
  <div class="actions"><button class="btn primary" data-act="savecat" data-id="${esc(c.id||"")}">Save</button>${isNew?"":`<button class="btn danger" data-act="delcat" data-id="${esc(c.id)}">Delete</button>`}</div>
  ${isNew?"":'<p class="small muted">Deleting a category keeps its past transactions (shown as Uncategorised).</p>'}`)}
function billSheet(b){const isNew=!b||!b.id;b=Object.assign({name:"",amount:"",cat:"",day:1,every:1,anchor:curP(),method:"Standing order"},b||{});
  openModal(`<div class="card-h"><h2>${isNew?"New bill":"Edit bill"}</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  <div class="fgrid"><label class="f full">Name<input type="text" id="b-name" value="${esc(b.name)}" maxlength="40"></label>
  <label class="f">Usual amount<input type="number" id="b-amt" inputmode="decimal" value="${esc(b.amount)}"></label>
  <label class="f">Category<select id="b-cat">${catOpts(b.cat)}</select></label>
  <label class="f">Due on day<input type="number" id="b-day" min="1" max="31" inputmode="numeric" value="${esc(b.day)}"></label>
  <label class="f">How often<select id="b-every">${[[1,"Monthly"],[2,"Every 2 months"],[3,"Quarterly"],[6,"Twice a year"],[12,"Yearly"]].map(x=>`<option value="${x[0]}"${+b.every===x[0]?" selected":""}>${x[1]}</option>`).join("")}</select></label>
  <label class="f full">Next due month<input type="month" id="b-anchor" value="${esc(b.anchor)}"></label></div>
  <p class="small muted">Tap Pay on the Overview when it's paid: it's recorded as spending in its category.</p>
  <div class="actions"><button class="btn primary" data-act="savebill" data-id="${esc(b.id||"")}">Save</button>${isNew?"":`<button class="btn danger" data-act="delbill" data-id="${esc(b.id)}">Delete</button>`}</div>`)}
function goalSheet(g){const isNew=!g;g=g||{name:"",target:"",deadline:"",startAmount:""};const s=isNew?0:goalSaved(g);
  openModal(`<div class="card-h"><h2>${isNew?"New savings goal":esc(g.name)}</h2><button class="btn sm ghost" data-act="close">Cancel</button></div>
  ${isNew?"":`<p>Saved so far: <b class="num">${esc(money(s))}</b>${g.target?" of "+esc(money(g.target)):""}</p><div class="actions"><button class="btn primary" data-act="addsave" data-id="${esc(g.id)}">Add money</button></div>`}
  <div class="fgrid"><label class="f full">Name<input type="text" id="g-name" value="${esc(g.name)}" maxlength="40" placeholder="e.g. Emergency fund"></label>
  <label class="f">Target<input type="number" id="g-target" inputmode="decimal" value="${esc(g.target)}"></label>
  <label class="f">Target date<input type="date" id="g-dead" value="${esc(g.deadline)}"></label>
  <label class="f full">Planned each month<input type="number" id="g-monthly" inputmode="decimal" value="${esc(g.monthly||"")}" placeholder="counts toward balancing the budget"></label>
  <label class="f full">Already saved before using the app<input type="number" id="g-start" inputmode="decimal" value="${esc(g.startAmount)}"></label></div>
  <div class="actions"><button class="btn ${isNew?"primary":""}" data-act="savegoal" data-id="${esc(g.id||"")}">Save goal</button>${isNew?"":`<button class="btn danger" data-act="delgoal" data-id="${esc(g.id)}">Delete</button>`}</div>`)}

/* ---------- CSV / backup ---------- */
function download(text,name,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
function csv(list,name){const q=v=>{v=String(v==null?"":v);return/[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const rows=[["Date","Type","Amount","Category","Source / goal","Who","Paid by","Note"]].concat(list.sort((a,b)=>a.date.localeCompare(b.date)).map(t=>[t.date,t.type,t.amount,t.type==="expense"?catById(t.cat).name:"",t.type==="income"?t.source:t.type==="save"?(get(t.goal)||{}).name:"",t.who,t.method,t.note]));
  download("﻿"+rows.map(r=>r.map(q).join(",")).join("\r\n"),name,"text/csv")}

/* ---------- actions ---------- */
const val=id=>{const e=document.getElementById(id);return e?e.value:""};
const A={
  close(){closeModal();draft=null},
  add(){txSheet(null)},
  prev(){period=shift(period,-1);render()},
  next(){if(period<curP()){period=shift(period,1);render()}},
  ttype(b){keepDraft();const cur=Object.assign({},draft,{type:b.dataset.t});if(cur.id)txSheet(cur);else txSheet(null,cur)},
  tcat(b){draft.cat=b.dataset.id;$$(".cats button").forEach(x=>x.classList.toggle("on",x===b));keepDraft();const h=$("#wkhint");if(h)h.innerHTML=wkHint(draft)},
  savetx(b){keepDraft();const d=draft,amt=num(d.amount);if(!(amt>0)){toast("Enter an amount.");return}
    if(d.type==="expense"&&!d.cat){toast("Pick a category.");return}if(d.type==="save"&&!d.goal){const g=$("#tx-goal");if(g)d.goal=g.value;if(!d.goal){toast("Create a goal first.");return}}
    const id=b.dataset.id||uid("t"),old=get(id)||{};
    const rec={type:d.type,amount:amt,date:validKey(d.date)?d.date:dkey(),who:d.who||"",note:(d.note||"").trim(),ts:old.ts||Date.now()};
    if(d.type==="expense"){rec.cat=d.cat;rec.method=d.method||""}if(d.type==="income")rec.source=(d.source||"").trim();if(d.type==="save")rec.goal=d.goal;if(d.bill)rec.bill=d.bill;
    put("tx",id,rec);
    if(d.bill&&d.billPeriod){const bl=get(d.bill);if(bl){const paid=Object.assign({},bl.paid||{});paid[d.billPeriod]=id;const{ id:_i,...rest}=bl;put("bill",bl.id,Object.assign(rest,{paid}))}}
    closeModal();draft=null;render();toast(b.dataset.id?"Updated":"Added "+money(amt))},
  deltx(b){if(!confirm("Delete this entry?"))return;const t=get(b.dataset.id);del(b.dataset.id);
    if(t&&t.bill){const bl=get(t.bill);if(bl&&bl.paid){const paid=Object.assign({},bl.paid);for(const k in paid)if(paid[k]===t.id)delete paid[k];const{id:_i,...rest}=bl;put("bill",bl.id,Object.assign(rest,{paid}))}}
    closeModal();render()},
  edittx(b){const t=all("tx").find(x=>x.id===b.dataset.id);if(t)txSheet(t)},
  catspend(b){filt={q:"",cat:b.dataset.id,who:"",type:"",wk:""};go("spend")},
  clearf(){filt={q:"",cat:"",who:"",type:"",wk:""};render()},
  weekspend(b){filt={q:"",cat:b.dataset.id,who:"",type:"",wk:b.dataset.wk};go("spend")},
  weekedit(b){const c=get(b.dataset.id);if(c)weekSheet(c)},
  weekeven(){const c=get($("#wk-sheet").dataset.id),lim=num(val("wk-total"))||+c.limit||0;evenSplit(lim).forEach((v,i)=>{const e=$("#wk-"+i);if(e)e.value=v});weekSum()},
  weeksave(b){const c=get(b.dataset.id);if(!c)return;const a=[0,1,2,3].map(i=>num(val("wk-"+i)));const{id:_i,...rest}=c;const by=Object.assign({},c.weeksBy||{});by[period]=a;
    const upd={weekly:true,weeksBy:by};if($("#wk-future").checked)upd.weeks=a;if($("#wk-limit").checked)upd.limit=a.reduce((x,y)=>x+y,0);
    put("cat",c.id,Object.assign(rest,upd));closeModal();render();toast("Weekly amounts saved")},
  weekoff(b){const c=get(b.dataset.id);if(!c)return;const{id:_i,...rest}=c;put("cat",c.id,Object.assign(rest,{weekly:false}));closeModal();render();toast("Weekly tracking off for "+c.name)},
  csv(){csv(txIn(period),"budget-"+period+".csv")},
  csvall(){csv(all("tx"),"budget-all-"+dkey()+".csv")},
  backup(){download(JSON.stringify({exportedAt:new Date().toISOString(),records:Object.values(L.recs)},null,1),"family-budget-backup-"+dkey()+".json","application/json")},
  syncnow(){L.me=null;sync()},
  signin(){location.assign("/?signin="+Date.now())},
  forget(){if(Object.keys(L.out).length&&!confirm("Some changes haven't uploaded yet and will be lost. Continue?"))return;if(!confirm("Remove the local copy? Your data stays safely in the shared database."))return;localStorage.removeItem(KEY);location.reload()},
  newcat(){catSheet(null)},
  editcat(b){const c=get(b.dataset.id);if(c)catSheet(c)},
  savecat(b){const name=val("c-name").trim();if(!name){toast("Name it.");return}const id=b.dataset.id||uid("c"),old=get(id)||{order:cats().length};
    put("cat",id,Object.assign({},old,{name,group:val("c-group").trim()||"Other",limit:num(val("c-limit")),color:+val("c-color")||0,order:old.order||0,weekly:!!($("#c-weekly")&&$("#c-weekly").checked)}));closeModal();render()},
  delcat(b){if(!confirm("Delete this category?"))return;del(b.dataset.id);closeModal();render()},
  newbill(){billSheet(null)},
  suggbill(b){const s=BILL_SUGGEST[+b.dataset.i];billSheet({name:s[0],cat:get("c-"+s[1])?"c-"+s[1]:""})},
  editbill(b){const x=get(b.dataset.id);if(x)billSheet(x)},
  savebill(b){const name=val("b-name").trim();if(!name){toast("Name it.");return}const id=b.dataset.id||uid("b"),old=get(id)||{};
    put("bill",id,{name,amount:num(val("b-amt")),cat:val("b-cat"),day:Math.min(31,Math.max(1,Math.round(num(val("b-day")))||1)),every:+val("b-every")||1,anchor:/^\d{4}-\d{2}$/.test(val("b-anchor"))?val("b-anchor"):curP(),paid:old.paid||{}});closeModal();render()},
  delbill(b){if(!confirm("Delete this bill? Past payments stay in spending."))return;del(b.dataset.id);closeModal();render()},
  paybill(b){const x=get(b.dataset.id);if(!x)return;txSheet(null,{type:"expense",amount:x.amount||"",cat:x.cat,note:x.name,method:x.method||"Standing order",date:period===curP()?dkey():billDate(x,period),bill:x.id,billPeriod:period,who:L.me?L.me.name:people()[0]})},
  newgoal(){goalSheet(null)},
  editgoal(b){const g=get(b.dataset.id);if(g)goalSheet(g)},
  savegoal(b){const name=val("g-name").trim();if(!name){toast("Name the goal.");return}put("goal",b.dataset.id||uid("g"),{name,target:num(val("g-target")),deadline:val("g-dead"),startAmount:num(val("g-start")),monthly:num(val("g-monthly"))});closeModal();render()},
  delgoal(b){if(!confirm("Delete this goal? Its contributions stay in the history."))return;del(b.dataset.id);closeModal();render()},
  goalsjump(){const e=$("#goals-h");if(e)e.scrollIntoView({behavior:"smooth",block:"start"});if(!all("goal").length)goalSheet(null)},
  addsave(b){closeModal();txSheet(null,{type:"save",goal:b.dataset.id,who:L.me?L.me.name:people()[0]})},
  addinc(){const s=settings();s.income=(s.income||[]).concat([{name:"",amount:0}]);saveSettings(s);render()},
  delinc(b){const s=settings();s.income=(s.income||[]).filter((_,i)=>i!==+b.dataset.i);saveSettings(s);render()}
};
/* zero-based check: income − (budgeted spending + pocket money + planned savings) should be 0 */
function planBalance(){const S=settings(),inc=(S.income||[]).reduce((a,x)=>a+(+x.amount||0),0),B=budgeted(),pocket=pocketList().reduce((a,x)=>a+(+x.amount||0),0),
  sav=all("goal").reduce((a,g)=>a+(+g.monthly||0),0),diff=Math.round((inc-B-pocket-sav)*100)/100;
  return{inc,B,pocket,sav,diff,state:!inc&&!B?"empty":Math.abs(diff)<1?"ok":diff>0?"under":"over"}}
function balanceBadge(pb,big){const t=pb.state==="ok"?"Balanced ✓":pb.state==="under"?esc(money(pb.diff))+" not assigned yet":pb.state==="over"?"Over-planned by "+esc(money(-pb.diff)):"Not set up yet";
  return`<span class="bal ${pb.state}${big?" big":""}">${t}</span>`}
function pocketList(){const S=settings(),saved=Array.isArray(S.pocket)?S.pocket:[];const names=people();
  return names.map(n=>({name:n,amount:+((saved.find(x=>x.name===n)||{}).amount)||0})).concat(saved.filter(x=>!names.includes(x.name)))}
function saveSettings(s){const{id:_i,...rest}=s;put("settings","settings",rest)}
document.addEventListener("click",e=>{const t=e.target.closest("[data-tab]");if(t){go(t.dataset.tab);return}
  const b=e.target.closest("[data-act]");if(b&&!b.disabled&&A[b.dataset.act]){e.preventDefault();A[b.dataset.act](b,e);return}
  if(e.target.id==="modal"){closeModal();draft=null}});
document.addEventListener("change",e=>{const t=e.target;
  if(t.dataset.limit){const c=get(t.dataset.limit);if(c){const{id:_i,...rest}=c;put("cat",c.id,Object.assign(rest,{limit:num(t.value)}));render()}}
  if(t.dataset.pocket!=null){const s=settings(),pk=pocketList(),i=+t.dataset.pocket;if(pk[i]){pk[i]=Object.assign({},pk[i],{amount:num(t.value)});s.pocket=pk;saveSettings(s);render()}}
  if(t.dataset.inc!=null){const s=settings(),inc=(s.income||[]).slice(),i=+t.dataset.inc;if(inc[i]){inc[i]=Object.assign({},inc[i],{[t.dataset.k]:t.dataset.k==="amount"?num(t.value):t.value.trim()});s.income=inc;saveSettings(s);render()}}
  if(t.dataset.set){const s=settings();s[t.dataset.set]=t.dataset.set==="start"?+t.value:(t.value.trim()||"Rs");saveSettings(s);period=curP();render()}
  if(t.dataset.ui){L.ui[t.dataset.ui]=t.value;saveL();render()}
  if(t.id==="f-wk"){filt.wk=t.value;render()}
  if(t.id==="f-cat"){filt.cat=t.value;render()}if(t.id==="f-who"){filt.who=t.value;render()}if(t.id==="f-type"){filt.type=t.value;render()}});
document.addEventListener("input",e=>{if(e.target.id==="f-q"){filt.q=e.target.value;render()}if(/^wk-[0-3]$/.test(e.target.id))weekSum()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#modal").hidden){closeModal();draft=null}if(e.key==="Enter"&&e.target.id==="tx-amt"){e.preventDefault();$('[data-act="savetx"]').click()}});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")sync()});
window.addEventListener("online",sync);
setInterval(()=>{if(document.visibilityState==="visible"&&$("#modal").hidden)sync()},60e3);

applyTheme();render();sync();
const sp=$("#splash");setTimeout(()=>{sp.classList.add("out");setTimeout(()=>sp.remove(),500)},900);
if("serviceWorker" in navigator&&location.protocol!=="file:")window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
window.__fb={get L(){return L},sync,periodOf,range,billDue,billDate};
})();
