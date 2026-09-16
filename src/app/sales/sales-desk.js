/* PLNT Sales Desk — vanilla-JS app mounted by src/app/sales/page.tsx.
 * Ported from the original single-file artifact. All DOM ids it touches live in shell.ts.
 * mountSalesDesk() wires document-level listeners and store subscriptions; call the returned
 * function to tear them down when the page unmounts. */
export function mountSalesDesk(opts){

/* ---------- constants ---------- */
const STAGES=[
  {id:'cold',label:'Cold outreach',cls:'cold',hint:'Calling and emailing'},
  {id:'demo_5acre',label:'5-acre demo',cls:'demo',hint:'On-site demo scheduled or done'},
  {id:'demo_video',label:'Video demo',cls:'demo',hint:'Video-call demo scheduled or done'},
  {id:'pilot',label:'Paid pilot',cls:'pilot',hint:'Paid trial underway'},
  {id:'paying',label:'Paying',cls:'paying',hint:'First paid service months'},
  {id:'recurring',label:'Recurring client',cls:'recurring',hint:'Ongoing monthly service'},
  {id:'lost',label:'Lost / On hold',cls:'lost',hint:'Not now'},
];
const STAGE=Object.fromEntries(STAGES.map(s=>[s.id,s]));
const OUTCOMES={
  call:[['connected','Connected'],['not_connected','Not connected'],['voicemail','Left voicemail']],
  email:[['sent','Sent'],['replied','They replied'],['bounced','Bounced']],
};
const OUT_LABEL=Object.fromEntries([...OUTCOMES.call,...OUTCOMES.email]);
const NEXT_OK=new Set(['call','email','demo']);
const NEXT_TYPES=[['call','Call again'],['email','Send email'],['demo','Schedule demo'],['none','No follow-up']];
const TEMPLATE_CATS=[['after_call','After a connected call'],['after_voicemail','After a voicemail'],['cold_email','Cold email'],['demo','Demo scheduling / follow-up'],['pilot','Pilot proposal'],['other','Other']];
const CAT_LABEL=Object.fromEntries(TEMPLATE_CATS);
const FIELDS=[['org','Organization'],['contact','Contact name'],['role','Contact role'],['phone','Phone'],['email','Email'],['address','Address'],['state','State'],['acreage','Acreage'],['plantTypes','Plant types'],['inventory','Critical inventory info'],['notes','Notes'],['owner','Owner (rep)'],['skip','— Skip this column —']];
const VIEWS=[['today','Schedule'],['pipeline','Pipeline'],['orgs','Organizations'],['templates','Templates'],['import','Import leads'],['reports','Reports'],['settings','Team & settings']];
const MAX_LOG=400;
const US_STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',PR:'Puerto Rico'};
const STATE_BY_NAME=Object.fromEntries(Object.entries(US_STATES).map(([k,v])=>[v.toLowerCase(),k]));
function normState(v){v=(v||'').trim();if(!v)return'';const u=v.toUpperCase();if(US_STATES[u])return u;return STATE_BY_NAME[v.toLowerCase()]||u.slice(0,2);}
function stateFromAddress(a){if(!a)return'';const codes=[...a.matchAll(/(?:^|[\s,])([A-Za-z]{2})(?=[\s,.]|$|\s*\d{5})/g)].map(m=>m[1].toUpperCase()).filter(c=>US_STATES[c]);if(codes.length)return codes[codes.length-1];const low=a.toLowerCase();let best='';for(const [name,code] of Object.entries(STATE_BY_NAME)){if(low.includes(name))best=code;}return best;}
function parseAcres(v){const s=String(v??'').trim();if(!s)return'';const m=s.match(/\d[\d,]*(?:\.\d+)?/);if(!m)return s;const n=parseFloat(m[0].replace(/,/g,''));const rest=s.replace(m[0],'').replace(/^[\s\-–]+|[\s\-–]+$/g,'');return rest?s:n;}
function orgState(o){return o.state||stateFromAddress(o.address);}

/* ---------- state ---------- */
const S={email:'',byEmail:{},statusLive:null,statusText:'Connecting…',orgs:new Map(),templates:new Map(),team:[],me:'',view:'today',scope:'mine',q:'',stageF:'',ownerF:'',sort:'next',sortDir:1,online:null,drawerOrg:null,tplSel:null,imp:null,selDay:null,weekOff:0,stateF:'',acreMin:'',acreMax:'',pipeSort:'updated:desc'};
let db=null,downloads=null;const listeners=[];function on(ev,fn){document.addEventListener(ev,fn);listeners.push([ev,fn]);}

/* ---------- utils ---------- */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const clone=o=>JSON.parse(JSON.stringify(o));
const nowISO=()=>new Date().toISOString();
function todayStr(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function addDays(dateStr,n){const d=dateStr?new Date(dateStr+'T12:00:00'):new Date();d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function nextBizDay(dateStr,n){let d=dateStr||todayStr();let left=n;while(left>0){d=addDays(d,1);const dow=new Date(d+'T12:00:00').getDay();if(dow!==0&&dow!==6)left--;}return d;}
function fmtDate(s){if(!s)return'';const d=new Date(s.length>10?s:s+'T12:00:00');return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:d.getFullYear()!==new Date().getFullYear()?'numeric':undefined});}
function fmtDT(s){if(!s)return'';const d=new Date(s);return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
function dueClass(d){const t=todayStr();if(d<t)return'due-over';if(d===t)return'due-today';return'due-later';}
function dueLabel(d){const t=todayStr();if(d===t)return'Today';if(d===addDays(t,1))return'Tomorrow';if(d<t){const n=Math.round((new Date(t)-new Date(d))/864e5);return n+'d overdue';}return fmtDate(d);}
function firstName(n){return (n||'').trim().split(/\s+/)[0]||'';}
function ls(k,v){try{if(v===undefined)return localStorage.getItem('plnt-crm-'+k);localStorage.setItem('plnt-crm-'+k,v);}catch(e){return null;}}
function toast(msg,kind){const t=document.createElement('div');t.className='tst'+(kind==='err'?' err':'');t.textContent=msg;document.getElementById('toast').appendChild(t);setTimeout(()=>t.remove(),kind==='err'?4200:2200);}
async function copyText(txt){try{await navigator.clipboard.writeText(txt);toast('Copied');}catch(e){const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast('Copied');}catch(e2){toast('Copy failed. Select the text and copy manually.','err');}ta.remove();}}
function stagePill(id){const s=STAGE[id]||STAGE.cold;return `<span class="pill ${s.cls}"><i></i>${esc(s.label)}</span>`;}
function primaryContact(o){return (o.contacts||[]).find(c=>c.primary)||(o.contacts||[])[0]||null;}
function lastActivity(o){const l=(o.log||[]).filter(e=>e.type==='call'||e.type==='email');return l.length?l[l.length-1]:null;}
function orgNext(o){let best=null;for(const c of o.contacts||[]){if(c.next&&c.next.date&&c.next.type!=='none'){if(!best||c.next.date<best.date)best={...c.next,contact:c};}}return best;}
function isMine(o){return !S.me||S.scope==='all'||o.owner===S.me;}
function orgsList(){return [...S.orgs.entries()].map(([id,o])=>({id,...o}));}
function matchesQ(o,q){if(!q)return true;q=q.toLowerCase();const hay=[o.name,o.address,o.plantTypes,o.inventory,o.notes,o.owner,...(o.contacts||[]).flatMap(c=>[c.name,c.role,c.email,c.phone])].join(' ').toLowerCase();return q.split(/\s+/).every(w=>hay.includes(w));}
function mergeTemplate(text,ctx){return (text||'').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi,(m,k)=>{k=k.toLowerCase();return ctx[k]??m;});}
function mergeCtx(o,c){return {first_name:firstName(c?.name)||'there',contact_name:c?.name||'',org:o?.name||'',my_name:S.me||'',acreage:o?.acreage?String(o.acreage):'',plant_types:o?.plantTypes||'',role:c?.role||'',email:c?.email||'',phone:c?.phone||''};}

/* ---------- persistence ---------- */
const local={
  load(){try{const j=JSON.parse(ls('data')||'null');if(j){S.orgs=new Map(Object.entries(j.orgs||{}));S.templates=new Map(Object.entries(j.templates||{}));S.team=j.team||[];}}catch(e){}},
  save(){try{ls('data',JSON.stringify({orgs:Object.fromEntries(S.orgs),templates:Object.fromEntries(S.templates),team:S.team}));}catch(e){}}
};
async function persist(fn,label){try{if(db){await fn();}else local.save();}catch(e){toast((label||'Save')+' failed: '+(e.message||e.code||'unknown'),'err');}}
async function saveOrg(id,o){o.updatedAt=nowISO();if(!o.createdAt)o.createdAt=o.updatedAt;if((o.log||[]).length>MAX_LOG)o.log=o.log.slice(-MAX_LOG);S.orgs.set(id,o);render();await persist(()=>db.doc('orgs/'+id).set(o),'Save');}
async function deleteOrg(id){S.orgs.delete(id);if(S.drawerOrg===id)closeDrawer();render();await persist(()=>db.doc('orgs/'+id).delete(),'Delete');}
async function saveTemplate(id,t){t.updatedAt=nowISO();S.templates.set(id,t);render();await persist(()=>db.doc('templates/'+id).set(t),'Save');}
async function deleteTemplate(id){S.templates.delete(id);if(S.tplSel===id)S.tplSel=null;render();await persist(()=>db.doc('templates/'+id).delete(),'Delete');}
async function saveTeam(members,extra){S.team=members;render();await persist(()=>db.doc('settings/team').set({...(extra||{}),byEmail:S.byEmail||{},members,updatedAt:nowISO()}),'Save');}

function setStatus(live,text){S.statusLive=live;S.statusText=text;applyStatus();}
function applyStatus(){const el=document.getElementById('status');if(!el)return;el.className='status'+(S.statusLive?' live':'');const sp=el.querySelector('span');if(sp)sp.textContent=S.statusText||'Connecting…';}

async function init(){
  const v=ls('view');if(v&&VIEWS.some(x=>x[0]===v))S.view=v;
  S.scope=ls('scope')||'mine';
  render();
  if(db){
    S.online=true;setStatus(true,'Shared with your team · live');
    unsubs.push(db.collection('orgs').onSnapshot(snap=>{S.orgs=new Map(snap.docs.map(d=>[d.id,d.data()]));render();},e=>{setStatus(false,'Connection problem: '+(e.message||e.code));}));
    unsubs.push(db.collection('templates').onSnapshot(snap=>{S.templates=new Map(snap.docs.map(d=>[d.id,d.data()]));render();},e=>{}));
    unsubs.push(db.doc('settings/team').onSnapshot(snap=>{const d=snap.exists?snap.data():{};S.team=d.members||[];S.byEmail=d.byEmail||{};const nm=S.byEmail[S.email]||S.me;if(nm&&nm!==S.me){S.me=nm;}if(S.me&&!S.team.includes(S.me))saveTeam([...S.team,S.me].sort(),d);render();},e=>{}));
  }else{
    S.online=false;local.load();setStatus(false,'Not connected · changes stay in this browser');render();
  }
}
let unsubs=[];
/* ---------- render ---------- */
function render(){renderNav();renderMe();applyStatus();renderView();if(S.drawerOrg)renderDrawer();}
function counts(){const t=todayStr();let due=0;for(const o of S.orgs.values()){if(!isMine(o))continue;for(const c of o.contacts||[]){if(c.next?.date&&c.next.type!=='none'&&c.next.date<=t)due++;}}return{today:due};}
function renderNav(){
  const c=counts();
  document.getElementById('nav').innerHTML=VIEWS.map(([id,l])=>`<button data-act="nav" data-v="${id}" class="${S.view===id?'on':''}"><span>${l}</span>${id==='today'&&c.today?`<span class="cnt">${c.today}</span>`:''}</button>`).join('');
  document.getElementById('page-title').textContent=VIEWS.find(v=>v[0]===S.view)[1];
}
function renderMe(){
  const n=document.getElementById('me-name'),m=document.getElementById('me-mail');
  if(n)n.textContent=S.me||'—';if(m)m.textContent=S.email||'';
}
function renderView(){
  const el=document.getElementById('view');
  const fn={today:vToday,pipeline:vPipeline,orgs:vOrgs,templates:vTemplates,import:vImport,reports:vReports,settings:vSettings}[S.view];
  el.innerHTML=fn();
  if(S.view==='import')wireImport();
}

/* ----- Schedule ----- */
function mondayOf(dateStr){const d=new Date(dateStr+'T12:00:00');const day=(d.getDay()+6)%7;return addDays(dateStr,-day);}
function fmtLong(d){return new Date(d+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});}
function vToday(){
  const t=todayStr();if(!S.selDay)S.selDay=t;
  const wk=addDays(mondayOf(t),7*S.weekOff);const days=[...Array(7)].map((_,i)=>addDays(wk,i));
  const items=[];const noNext=[];
  for(const o of orgsList()){
    if(!isMine(o)||!matchesQ(o,S.q))continue;let any=false;
    for(const c of o.contacts||[]){if(c.next?.date&&c.next.type!=='none'){any=true;items.push({o,c,d:c.next.date});}}
    if(!any&&!['lost','recurring'].includes(o.stage))noNext.push(o);
  }
  items.sort((a,b)=>a.d.localeCompare(b.d)||(a.c.next.type==='demo'?0:1)-(b.c.next.type==='demo'?0:1)||a.o.name.localeCompare(b.o.name));
  const overdue=items.filter(i=>i.d<t);const sel=items.filter(i=>i.d===S.selDay);
  const scope=`<div class="seg"><button data-act="scope" data-s="mine" class="${S.scope==='mine'?'on':''}">My queue</button><button data-act="scope" data-s="all" class="${S.scope==='all'?'on':''}">Whole team</button></div>`;
  const range=`${fmtDate(days[0])} – ${fmtDate(days[6])}`;
  let h=`<div class="btnrow" style="margin-bottom:12px"><div class="seg"><button data-act="week" data-n="-1" aria-label="Previous week">‹</button><button data-act="week" data-n="0" class="${S.weekOff===0?'on':''}">This week</button><button data-act="week" data-n="1" aria-label="Next week">›</button></div><b>${range}</b><span class="muted small">${(n=>n+' touch'+(n===1?'':'es')+' this week')(items.filter(i=>i.d>=days[0]&&i.d<=days[6]).length)}</span><span style="margin-left:auto"></span>${scope}</div>`;
  h+=`<div class="wk">${days.map(d=>{const list=items.filter(i=>i.d===d);const dt=new Date(d+'T12:00:00');
    return `<div class="wday ${d===t?'today':''} ${d===S.selDay?'sel':''} ${d<t?'past':''}" data-day="${d}"><button class="wh" data-act="sel-day" data-d="${d}"><span class="dn">${dt.toLocaleDateString(undefined,{weekday:'short'})}</span><span class="dd">${dt.getDate()}</span>${list.length?`<span class="n">${list.length}</span>`:''}</button><div class="wlist">${list.map(i=>`<div class="wi ${NEXT_OK.has(i.c.next.type)?i.c.next.type:'call'} ${d<t?'late':''}" draggable="true" data-act="log" data-id="${i.o.id}" data-c="${i.c.id}" data-t="${i.c.next.type==='email'?'email':'call'}" title="${esc(i.c.name)} · ${esc(i.o.name)}${i.c.next.note?' · '+esc(i.c.next.note):''}">${i.c.next.type==='email'?'✉':i.c.next.type==='demo'?'★':'☎'} <b>${esc(i.c.name)}</b><span>${esc(i.o.name)}</span>${S.scope==='all'&&i.o.owner?`<span class="faint">${esc(i.o.owner)}</span>`:''}</div>`).join('')||`<div class="wnone">${d===t?'Nothing today':''}</div>`}</div></div>`;}).join('')}</div>
  <div class="small muted" style="margin:-8px 0 18px">☎ Call &nbsp; ✉ Email &nbsp; ★ Demo &nbsp;·&nbsp; Click a touch to log it. Drag it to another day to reschedule. Click a day to see the full list below.</div>`;
  if(!items.length&&!noNext.length)h+=`<div class="panel"><div class="empty"><h3>Nothing scheduled</h3>Add a lead or import a list, and each contact's next call or email lands here.<div class="btnrow" style="justify-content:center;margin-top:12px"><button class="btn primary" data-act="new-lead">+ New lead</button><button class="btn" data-act="nav" data-v="import">Import leads</button></div></div></div>`;
  if(overdue.length)h+=`<div class="section"><div class="section-title"><h2>Overdue</h2><span class="n">${overdue.length}</span><span style="margin-left:auto"></span><button class="btn sm" data-act="overdue-today">Move all to today</button></div><div class="panel queue">${overdue.map(i=>qrow(i.o,i.c)).join('')}</div></div>`;
  h+=`<div class="section"><div class="section-title"><h2>${S.selDay===t?'Today · ':''}${fmtLong(S.selDay)}</h2><span class="n">${sel.length}</span></div>${sel.length?`<div class="panel queue">${sel.map(i=>qrow(i.o,i.c)).join('')}</div>`:`<div class="panel"><div class="empty small">No calls or emails scheduled for this day.</div></div>`}</div>`;
  if(noNext.length)h+=`<div class="section"><div class="section-title"><h2>Needs a next step</h2><span class="n">${noNext.length}</span></div><div class="panel"><div class="tablewrap"><table><tr><th>Organization</th><th>Stage</th><th>Contact</th><th>Owner</th><th></th></tr>${noNext.slice(0,50).map(o=>{const c=primaryContact(o);return `<tr class="row" data-act="open-org" data-id="${o.id}"><td><b>${esc(o.name)}</b>${o.isExample?' <span class="pill ex">example</span>':''}</td><td>${stagePill(o.stage)}</td><td>${esc(c?.name||'—')}</td><td>${esc(o.owner||'—')}</td><td class="btnrow" style="justify-content:flex-end">${c?`<button class="btn sm" data-act="sched" data-id="${o.id}" data-c="${c.id}">Schedule</button><button class="btn sm" data-act="log" data-id="${o.id}" data-c="${c.id}" data-t="call">Log call</button>`:''}</td></tr>`;}).join('')}</table></div></div></div>`;
  return h;
}
function qrow(o,c){
  const s=STAGE[o.stage]||STAGE.cold;const n=c.next;
  return `<div class="qrow ${s.cls}"><div class="stripe"></div><div class="body">
    <div class="who"><b data-act="open-org" data-id="${o.id}" style="cursor:pointer">${esc(o.name)}</b> ${stagePill(o.stage)}<div class="sub">${esc(c.name)}${c.role?' · '+esc(c.role):''}${o.acreage?' · '+esc(o.acreage)+' ac':''}</div></div>
    <div class="reach">${c.phone?`<a href="tel:${esc(c.phone.replace(/[^\d+]/g,''))}">☎ ${esc(c.phone)}</a>`:''}${c.email?`<a href="mailto:${esc(c.email)}">✉ ${esc(c.email)}</a>`:''}${!c.phone&&!c.email?'<span class="faint">No phone or email</span>':''}</div>
    <div class="when"><span class="pill act">${n.type==='email'?'✉ Email':n.type==='demo'?'★ Demo':'☎ Call'}</span><span class="pill ${dueClass(n.date)}">${dueLabel(n.date)}</span>${o.owner&&S.scope==='all'?`<span class="faint small">${esc(o.owner)}</span>`:''}</div>
    ${n.note||c.lastOutcome?`<div class="note">${n.note?esc(n.note):''}${c.lastOutcome?`<span class="faint"> · last: ${esc(OUT_LABEL[c.lastOutcome]||c.lastOutcome)}${c.lastAt?' '+fmtDate(c.lastAt):''}</span>`:''}</div>`:''}
  </div>
  <div class="acts"><button class="btn sm primary" data-act="log" data-id="${o.id}" data-c="${c.id}" data-t="call">Log call</button><button class="btn sm" data-act="log" data-id="${o.id}" data-c="${c.id}" data-t="email">Log email</button><button class="btn sm ghost" data-act="sched" data-id="${o.id}" data-c="${c.id}" title="Change the next step or its date">Reschedule</button><button class="btn sm ghost" data-act="snooze" data-id="${o.id}" data-c="${c.id}" title="Push to tomorrow">+1d</button></div></div>`;
}

/* ----- Pipeline ----- */
function acreFilter(o){const mn=S.acreMin!==''?+S.acreMin:null,mx=S.acreMax!==''?+S.acreMax:null;const ac=+o.acreage||0;return (mn===null||ac>=mn)&&(mx===null||ac<=mx);}
function stateSelect(){const states=[...new Set(orgsList().map(orgState).filter(Boolean))].sort();return `<select data-change="stateF" aria-label="State"><option value="">All states</option>${states.map(st=>`<option value="${st}" ${S.stateF===st?'selected':''}>${esc(US_STATES[st]||st)} (${st})</option>`).join('')}</select>`;}
function acreRange(){return `<span class="range"><span class="lbl">Acres</span><input type="number" min="0" step="any" placeholder="min" value="${esc(S.acreMin)}" data-input="acreMin" aria-label="Minimum acreage"><span class="faint">–</span><input type="number" min="0" step="any" placeholder="max" value="${esc(S.acreMax)}" data-input="acreMax" aria-label="Maximum acreage"></span>`;}
function vPipeline(){
  const list=orgsList().filter(o=>isMine(o)&&matchesQ(o,S.q)&&(!S.stateF||orgState(o)===S.stateF)&&acreFilter(o));
  const scope=`<div class="seg"><button data-act="scope" data-s="mine" class="${S.scope==='mine'?'on':''}">Mine</button><button data-act="scope" data-s="all" class="${S.scope==='all'?'on':''}">Whole team</button></div>`;
  const SORTS=[['updated:desc','Recently updated'],['acreage:asc','Acreage · smallest to largest'],['acreage:desc','Acreage · largest to smallest'],['name:asc','Name A–Z'],['state:asc','State A–Z'],['next:asc','Next action · soonest']];
  const [sk,sd]=S.pipeSort.split(':');const key={updated:o=>o.updatedAt||'',acreage:o=>+o.acreage||0,name:o=>o.name.toLowerCase(),state:o=>orgState(o),next:o=>orgNext(o)?.date||'9999'}[sk]||(o=>o.updatedAt||'');const dir=sd==='desc'?-1:1;
  const anyF=S.stateF||S.acreMin!==''||S.acreMax!=='';
  let h=`<div class="filters">${scope}${stateSelect()}${acreRange()}<select data-change="pipeSort" aria-label="Sort"><option value="">Sort…</option>${SORTS.map(([v,l])=>`<option value="${v}" ${S.pipeSort===v?'selected':''}>${esc(l)}</option>`).join('')}</select>${anyF?`<button class="btn sm ghost" data-act="clear-filters">Clear filters</button>`:''}<span class="muted small">${list.length} of ${S.orgs.size} · drag a card to move it to a new stage</span></div><div class="board">`;
  for(const s of STAGES){
    const items=list.filter(o=>(o.stage||'cold')===s.id).sort((a,b)=>{const x=key(a),y=key(b);return (x<y?-1:x>y?1:0)*dir;});
    const acres=items.reduce((n,o)=>n+(+o.acreage||0),0);const mrr=items.reduce((n,o)=>n+(+o.monthly||0),0);
    h+=`<div class="col" data-stage="${s.id}"><div class="ch"><span><span class="pill ${s.cls}"><i></i>${esc(s.label)}</span></span><span class="sum num">${items.length}${acres?' · '+acres.toLocaleString()+' ac':''}${mrr&&(s.id==='paying'||s.id==='recurring')?' · $'+mrr.toLocaleString()+'/mo':''}</span></div>`;
    for(const o of items){const c=primaryContact(o);const nx=orgNext(o);const la=lastActivity(o);const st=orgState(o);
      h+=`<div class="card" draggable="true" data-id="${o.id}" data-act="open-org"><div class="t">${esc(o.name)}${o.isExample?' <span class="pill ex">example</span>':''}</div><div class="m">${c?`<span>${esc(c.name)}</span>`:''}${o.acreage?`<span class="num">${esc(o.acreage)} ac</span>`:''}${st?`<span>${esc(st)}</span>`:''}${o.plantTypes?`<span>${esc(o.plantTypes)}</span>`:''}</div><div class="f"><span>${nx?`Next: ${NEXT_OK.has(nx.type)?nx.type:'call'} ${dueLabel(nx.date)}`:la?`Last: ${esc(OUT_LABEL[la.outcome]||la.type)} ${fmtDate(la.at)}`:'No activity yet'}</span>${o.owner?`<span class="own">${esc(o.owner)}</span>`:''}</div></div>`;}
    h+=`</div>`;
  }
  return h+`</div>`;
}

/* ----- Organizations ----- */
function vOrgs(){
  let list=orgsList().filter(o=>matchesQ(o,S.q)&&(!S.stageF||o.stage===S.stageF)&&(!S.ownerF||o.owner===S.ownerF)&&(!S.stateF||orgState(o)===S.stateF)&&acreFilter(o));
  const key={name:o=>o.name.toLowerCase(),stage:o=>STAGES.findIndex(s=>s.id===o.stage),acreage:o=>+o.acreage||0,state:o=>orgState(o),last:o=>lastActivity(o)?.at||'',next:o=>orgNext(o)?.date||'9999',owner:o=>o.owner||''}[S.sort];
  list.sort((a,b)=>{const x=key(a),y=key(b);return (x<y?-1:x>y?1:0)*S.sortDir;});
  const owners=[...new Set([...S.team,...orgsList().map(o=>o.owner).filter(Boolean)])].sort();
  const th=(id,l)=>`<th class="sortable" data-act="sort" data-k="${id}">${l}${S.sort===id?(S.sortDir>0?' ▲':' ▼'):''}</th>`;
  const sortVal=S.sort+':'+(S.sortDir>0?'asc':'desc');
  const SORTS=[['acreage:asc','Acreage · smallest to largest'],['acreage:desc','Acreage · largest to smallest'],['name:asc','Name A–Z'],['state:asc','State A–Z'],['next:asc','Next action · soonest'],['last:desc','Last activity · newest'],['stage:asc','Stage · cold to recurring']];
  const anyF=S.stageF||S.ownerF||S.stateF||S.acreMin!==''||S.acreMax!=='';
  let h=`<div class="filters"><select data-change="stageF" aria-label="Stage"><option value="">All stages</option>${STAGES.map(s=>`<option value="${s.id}" ${S.stageF===s.id?'selected':''}>${esc(s.label)}</option>`).join('')}</select><select data-change="ownerF" aria-label="Owner"><option value="">All owners</option>${owners.map(o=>`<option ${S.ownerF===o?'selected':''}>${esc(o)}</option>`).join('')}</select>${stateSelect()}${acreRange()}<select data-change="sortSel" aria-label="Sort"><option value="">Sort…</option>${SORTS.map(([v,l])=>`<option value="${v}" ${sortVal===v?'selected':''}>${esc(l)}</option>`).join('')}</select>${anyF?`<button class="btn sm ghost" data-act="clear-filters">Clear filters</button>`:''}<span class="muted small">${list.length} of ${S.orgs.size}</span><span style="margin-left:auto"></span><button class="btn sm" data-act="export">Export CSV</button></div>`;
  if(!list.length)return h+`<div class="panel"><div class="empty"><h3>No organizations${S.q?' match your search':' yet'}</h3>Add one with <b>+ New lead</b> or import a spreadsheet.</div></div>`;
  h+=`<div class="panel"><div class="tablewrap"><table><thead><tr>${th('name','Organization')}${th('state','State')}<th>Contacts</th>${th('stage','Stage')}${th('acreage','Acreage')}<th>Plant types</th>${th('owner','Owner')}${th('last','Last activity')}${th('next','Next action')}</tr></thead><tbody>`;
  for(const o of list){const cs=o.contacts||[];const la=lastActivity(o);const nx=orgNext(o);
    h+=`<tr class="row" data-act="open-org" data-id="${o.id}"><td><b>${esc(o.name)}</b>${o.isExample?' <span class="pill ex">example</span>':''}<div class="small muted">${esc(o.address||'')}</div></td><td>${orgState(o)?`<span class="pill act" title="${esc(US_STATES[orgState(o)]||'')}">${esc(orgState(o))}</span>`:'<span class="faint">—</span>'}</td><td>${cs.slice(0,2).map(c=>`<div>${esc(c.name)}<span class="small muted">${c.role?' · '+esc(c.role):''}</span></div>`).join('')}${cs.length>2?`<div class="small faint">+${cs.length-2} more</div>`:''}${!cs.length?'<span class="faint">—</span>':''}</td><td>${stagePill(o.stage)}</td><td class="num">${o.acreage?esc(o.acreage):'—'}</td><td>${esc(o.plantTypes||'—')}</td><td>${esc(o.owner||'—')}</td><td class="small">${la?`${esc(OUT_LABEL[la.outcome]||la.type)}<div class="faint">${fmtDate(la.at)} · ${esc(la.by||'')}</div>`:'<span class="faint">—</span>'}</td><td>${nx?`<span class="pill ${dueClass(nx.date)}">${NEXT_OK.has(nx.type)?nx.type:'call'} · ${dueLabel(nx.date)}</span>`:'<span class="faint">—</span>'}</td></tr>`;}
  return h+`</tbody></table></div></div>`;
}

/* ----- Templates ----- */
function vTemplates(){
  const list=[...S.templates.entries()].map(([id,t])=>({id,...t})).sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
  const sel=S.tplSel?S.templates.get(S.tplSel):null;
  const t=sel||{name:'',category:'after_call',subject:'',body:''};
  const exampleOrg=orgsList()[0]||{name:'Riverbend Nursery',acreage:40,plantTypes:'Container shrubs'};const exampleC=primaryContact(exampleOrg)||{name:'Jordan Lee',role:'Owner'};
  const ctx=mergeCtx(exampleOrg,exampleC);
  return `<div class="tpl"><div class="panel"><div class="ph"><h2>Templates</h2><button class="btn sm" data-act="tpl-new">+ New</button></div><div class="tlist">${list.length?list.map(x=>`<button data-act="tpl-sel" data-id="${x.id}" class="${S.tplSel===x.id?'on':''}"><div class="n">${esc(x.name)}</div><div class="c">${esc(CAT_LABEL[x.category]||x.category)}${x.createdBy?' · '+esc(x.createdBy):''}</div></button>`).join(''):'<div class="empty small">No templates yet. Everyone on the team can add them.</div>'}</div></div>
  <div class="panel"><div class="ph"><h2>${sel?'Edit template':'New template'}</h2>${sel?`<button class="btn sm danger" data-act="tpl-del" data-id="${S.tplSel}">Delete</button>`:''}</div><div class="mb"><form data-form="tpl" class="grid"><input type="hidden" name="id" value="${esc(S.tplSel||'')}"><div class="grid g2"><div><label for="tpl-name">Name</label><input id="tpl-name" name="name" required value="${esc(t.name)}" placeholder="e.g. Voicemail follow-up"></div><div><label for="tpl-cat">Use it</label><select id="tpl-cat" name="category">${TEMPLATE_CATS.map(([id,l])=>`<option value="${id}" ${t.category===id?'selected':''}>${esc(l)}</option>`).join('')}</select></div></div>
  <div><label for="tpl-subj">Subject</label><input id="tpl-subj" name="subject" value="${esc(t.subject)}" placeholder="Quick follow-up from {{my_name}} at PLNT"></div>
  <div><label for="tpl-body">Body</label><textarea id="tpl-body" name="body" rows="10" placeholder="Hi {{first_name}},&#10;&#10;Great speaking with you today about {{org}}…">${esc(t.body)}</textarea></div>
  <div><label>Merge fields (click to insert)</label><div class="chips">${['first_name','contact_name','org','my_name','acreage','plant_types','role'].map(k=>`<button type="button" class="chip" data-act="tpl-ins" data-k="${k}">{{${k}}}</button>`).join('')}</div></div>
  <div class="field-note"><b>Preview</b> with ${esc(exampleOrg.name)} · ${esc(exampleC.name)}:<div style="margin-top:6px;white-space:pre-wrap">${esc(mergeTemplate(t.subject,ctx))}${t.subject?'\n\n':''}${esc(mergeTemplate(t.body,ctx))}</div></div>
  <div class="btnrow" style="justify-content:flex-end"><button class="btn primary" type="submit">${sel?'Save changes':'Create template'}</button></div></form></div></div></div>`;
}

/* ----- Import ----- */
function vImport(){
  const st=S.imp;
  const owners=[...new Set([...S.team,...(S.me?[S.me]:[])])].sort();
  let h=`<div class="two"><div>`;
  h+=`<div class="panel" style="margin-bottom:16px"><div class="ph"><h2>1. Add your list</h2></div><div class="mb"><div class="drop" id="drop"><b>Drop a .csv here</b> or click to choose a file<br><span class="small muted">Excel: File → Save As → CSV. Google Sheets: File → Download → CSV.</span><input type="file" id="file" accept=".csv,.tsv,.txt,text/csv" class="hidden"></div><div class="help" style="margin:10px 0 4px">Or paste rows (with a header row) straight from a spreadsheet:</div><textarea id="paste" rows="5" placeholder="Organization,Contact,Role,Phone,Email,Address,Acreage,Plant Types,Critical Inventory&#10;Riverbend Nursery,Jordan Lee,Owner,(555) 210-4411,jordan@riverbend.com,…"></textarea><div class="btnrow" style="margin-top:8px"><button class="btn" data-act="imp-parse">Read pasted rows</button><button class="btn ghost sm" data-act="imp-sample">Copy a sample header row</button></div></div></div>`;
  h+=`</div><div>`;
  if(st){
    h+=`<div class="panel" style="margin-bottom:16px"><div class="ph"><h2>2. Match columns</h2><span class="muted small">${st.rows.length} rows found</span></div><div class="mb">`;
    h+=st.headers.map((hd,i)=>`<div class="maprow"><div class="h">${esc(hd)||'<span class="faint">(blank)</span>'}</div><div class="s" title="${esc(st.rows[0]?.[i]||'')}">${esc(st.rows[0]?.[i]||'')}</div><select data-change="map" data-i="${i}">${FIELDS.map(([id,l])=>`<option value="${id}" ${st.map[i]===id?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`).join('');
    h+=`<div class="help" style="margin-top:8px">Two columns matched to the same field are joined (First + Last name, City + State + Zip).</div></div></div>`;
    h+=`<div class="panel"><div class="ph"><h2>3. Schedule and import</h2></div><div class="mb grid"><div class="grid g3"><div><label for="imp-owner">Assign to</label><select id="imp-owner">${owners.length?owners.map(o=>`<option ${o===S.me?'selected':''}>${esc(o)}</option>`).join(''):'<option value="">(no owner)</option>'}<option value="__col">Use the Owner column</option></select></div><div><label for="imp-action">First touch</label><select id="imp-action"><option value="call">Call</option><option value="email">Email</option><option value="none">Don't schedule</option></select></div><div><label for="imp-date">Starting</label><input id="imp-date" type="date" value="${todayStr()}"></div></div>
    <div class="grid g2"><div><label for="imp-stage">Stage</label><select id="imp-stage">${STAGES.map(s=>`<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select></div><div><label for="imp-perday">Spread over</label><select id="imp-perday"><option value="0">All on the start date</option><option value="10">10 per business day</option><option value="20">20 per business day</option><option value="40">40 per business day</option></select></div></div>
    <label class="check"><input type="checkbox" id="imp-dupes" checked> Skip organizations that already exist (adds new contacts to them instead)</label>
    ${st.progress!=null?`<div class="progress"><i style="width:${st.progress}%"></i></div><div class="small muted">${st.msg||''}</div>`:''}
    ${st.result?`<div class="banner info">${esc(st.result)}</div>`:''}
    <div class="btnrow" style="justify-content:flex-end"><button class="btn primary" data-act="imp-run" ${st.progress!=null&&st.progress<100?'disabled':''}>Import ${st.rows.length} rows</button></div></div></div>`;
  }else{
    h+=`<div class="panel"><div class="mb"><h3>What happens on import</h3><ul class="small muted" style="padding-left:18px;margin:8px 0 0;line-height:1.7"><li>Each row becomes an organization with one contact, at the stage you pick.</li><li>Every contact gets a first call or email on the scheduler, spread over business days if you like.</li><li>Rows whose organization already exists add the contact to it, so re-importing an updated sheet is safe.</li><li>Columns are matched by header name and you can fix any match before importing.</li></ul></div></div>`;
  }
  return h+`</div></div>`;
}
function wireImport(){
  const drop=document.getElementById('drop'),file=document.getElementById('file');if(!drop)return;
  drop.onclick=()=>file.click();
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');};drop.ondragleave=()=>drop.classList.remove('over');
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');const f=e.dataTransfer.files[0];if(f)readFile(f);};
  file.onchange=()=>{if(file.files[0])readFile(file.files[0]);};
  function readFile(f){const r=new FileReader();r.onload=()=>startImport(r.result);r.onerror=()=>toast('Could not read that file','err');r.readAsText(f);}
}
function parseCSV(text){
  text=text.replace(/^﻿/,'');const firstLine=text.split('\n')[0];const delim=firstLine.includes('\t')?'\t':(firstLine.split(';').length>firstLine.split(',').length?';':',');
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}
    else if(c==='"')q=true;else if(c===delim){row.push(f);f='';}else if(c==='\n'){row.push(f);rows.push(row);row=[];f='';}else if(c!=='\r')f+=c;}
  if(f!==''||row.length){row.push(f);rows.push(row);}
  return rows.map(r=>r.map(x=>x.trim())).filter(r=>r.some(x=>x!==''));
}
function guessField(h){const s=h.toLowerCase();
  if(/acre/.test(s))return'acreage';if(/inventor|stock|critical/.test(s))return'inventory';if(/plant|crop|variet|species|grow/.test(s))return'plantTypes';
  if(/role|title|position/.test(s))return'role';if(/phone|tel|mobile|cell/.test(s))return'phone';if(/e-?mail/.test(s))return'email';
  if(/^\s*(state|st|province|state\/prov(ince)?)\s*$/.test(s))return'state';if(/address|street|city|state|zip|postal/.test(s))return'address';if(/owner|rep\b|assigned|salesperson/.test(s))return'owner';
  if(/org|company|business|nursery|farm|account|grower/.test(s))return'org';if(/first|last|contact|name|person/.test(s))return'contact';if(/note|comment/.test(s))return'notes';return'skip';}
function startImport(text){const rows=parseCSV(text);if(rows.length<2){toast('Need a header row plus at least one data row','err');return;}const headers=rows[0];S.imp={headers,rows:rows.slice(1),map:headers.map(guessField),progress:null,result:null};render();}
async function runImport(){
  const st=S.imp;if(!st)return;
  const ownerSel=document.getElementById('imp-owner').value,action=document.getElementById('imp-action').value,start=document.getElementById('imp-date').value||todayStr(),stage=document.getElementById('imp-stage').value,perDay=+document.getElementById('imp-perday').value,skipDupes=document.getElementById('imp-dupes').checked;
  const byName=new Map(orgsList().map(o=>[o.name.trim().toLowerCase(),o.id]));
  let created=0,added=0,skipped=0,i=0,date=start,onDay=0;
  st.progress=0;render();
  for(const r of st.rows){
    const rec={};st.map.forEach((f,ci)=>{if(f==='skip'||!r[ci])return;rec[f]=rec[f]?rec[f]+' '+r[ci]:r[ci];});
    if(!rec.org&&!rec.contact){skipped++;i++;continue;}
    const name=(rec.org||rec.contact).trim();const owner=ownerSel==='__col'?(rec.owner||''):ownerSel;
    if(perDay&&onDay>=perDay){date=nextBizDay(date,1);onDay=0;}
    const contact=rec.contact||rec.email||rec.phone?{id:uid(),name:rec.contact||'(unknown)',role:rec.role||'',phone:rec.phone||'',email:rec.email||'',notes:'',primary:false,next:action==='none'?null:{type:action,date,note:'First touch from import'}}:null;
    const key=name.toLowerCase();
    if(byName.has(key)){
      if(skipDupes){const id=byName.get(key);const o=clone(S.orgs.get(id));o.contacts=o.contacts||[];
        const dup=contact&&o.contacts.some(c=>(c.email&&contact.email&&c.email.toLowerCase()===contact.email.toLowerCase())||c.name.toLowerCase()===contact.name.toLowerCase());
        if(contact&&!dup){o.contacts.push(contact);added++;onDay++;S.orgs.set(id,o);await persist(()=>db.doc('orgs/'+id).set(o));}else skipped++;
        i++;st.progress=Math.round(100*i/st.rows.length);st.msg=`${i} of ${st.rows.length}`;continue;}
    }
    const id=uid();const o={name,address:rec.address||'',state:normState(rec.state)||stateFromAddress(rec.address||''),acreage:parseAcres(rec.acreage),plantTypes:rec.plantTypes||'',inventory:rec.inventory||'',notes:rec.notes||'',stage,owner,monthly:'',demoDate:'',pilotStart:'',contacts:contact?[{...contact,primary:true}]:[],log:[{id:uid(),at:nowISO(),by:S.me||'import',type:'note',notes:'Imported from spreadsheet'}],createdAt:nowISO(),updatedAt:nowISO(),source:'import'};
    S.orgs.set(id,o);byName.set(key,id);created++;onDay++;
    await persist(()=>db.doc('orgs/'+id).set(o),'Import');
    i++;st.progress=Math.round(100*i/st.rows.length);st.msg=`${i} of ${st.rows.length}`;if(i%5===0)render();
  }
  if(!db)local.save();
  st.progress=100;st.result=`Done: ${created} organizations created, ${added} contacts added to existing ones, ${skipped} rows skipped.`;render();toast('Import finished');
}

/* ----- Reports ----- */
function weekStart(){const d=new Date();const day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);d.setHours(0,0,0,0);return d.toISOString();}
function vReports(){
  const all=orgsList();const ws=weekStart();
  const logs=all.flatMap(o=>(o.log||[]).map(e=>({...e,org:o})));const week=logs.filter(e=>e.at>=ws&&(e.type==='call'||e.type==='email'));
  const calls=week.filter(e=>e.type==='call'),emails=week.filter(e=>e.type==='email');const connected=calls.filter(e=>e.outcome==='connected').length;
  const allCalls=logs.filter(e=>e.type==='call');const allConn=allCalls.filter(e=>e.outcome==='connected').length;
  const active=all.filter(o=>!['lost'].includes(o.stage));const acres=active.reduce((n,o)=>n+(+o.acreage||0),0);
  const mrr=all.filter(o=>o.stage==='paying'||o.stage==='recurring').reduce((n,o)=>n+(+o.monthly||0),0);
  const demos=all.filter(o=>o.stage==='demo_5acre'||o.stage==='demo_video').length;
  const byStage=STAGES.map(s=>[s.label,all.filter(o=>(o.stage||'cold')===s.id).length]);
  const users=[...new Set([...S.team,...week.map(e=>e.by).filter(Boolean)])];
  const byUser=users.map(u=>[u,week.filter(e=>e.by===u).length]).sort((a,b)=>b[1]-a[1]);
  const bars=(rows,title)=>{const mx=Math.max(1,...rows.map(r=>r[1]));return `<div class="panel"><div class="ph"><h2>${title}</h2></div><div class="bars">${rows.length?rows.map(([l,v])=>`<div class="bar" title="${esc(l)}: ${v}"><span>${esc(l)}</span><div class="tr"><i class="fl" style="width:${100*v/mx}%"></i></div><span class="v">${v}</span></div>`).join(''):'<div class="muted small">Nothing yet.</div>'}</div></div>`;};
  const tile=(l,v,s)=>`<div class="tile"><div class="l">${l}</div><div class="v">${v}</div>${s?`<div class="s">${s}</div>`:''}</div>`;
  const recent=logs.filter(e=>e.type!=='note').sort((a,b)=>b.at.localeCompare(a.at)).slice(0,25);
  return `<div class="tiles">${tile('Calls this week',calls.length,`${connected} connected`)}${tile('Emails this week',emails.length)}${tile('Connect rate',allCalls.length?Math.round(100*allConn/allCalls.length)+'%':'—','all time, calls answered')}${tile('In demo stage',demos,'5-acre + video')}${tile('Acres in pipeline',acres.toLocaleString(),'excluding lost')}${tile('Monthly revenue','$'+mrr.toLocaleString(),'paying + recurring')}</div>
  <div class="two" style="margin-bottom:16px">${bars(byStage,'Organizations by stage')}${bars(byUser,'Touches this week by rep')}</div>
  <div class="panel"><div class="ph"><h2>Team activity</h2><span class="muted small">latest 25</span></div><div class="timeline">${recent.length?recent.map(e=>evRow(e,true)).join(''):'<div class="empty small">No calls or emails logged yet.</div>'}</div></div>`;
}
function evRow(e,withOrg){
  const ic={call:'☎',email:'✉',stage:'→',demo:'★',note:'✎'}[e.type]||'•';
  const c=e.org?(e.org.contacts||[]).find(x=>x.id===e.contactId):null;
  const title=e.type==='call'?`Call · ${OUT_LABEL[e.outcome]||''}`:e.type==='email'?`Email · ${OUT_LABEL[e.outcome]||''}`:e.type==='stage'?'Stage change':e.type==='demo'?'Demo':'Note';
  return `<div class="ev"><div class="ic ${e.type}">${ic}</div><div><div class="h"><b>${esc(title)}</b>${withOrg&&e.org?`<span data-act="open-org" data-id="${e.org.id}" style="cursor:pointer;color:var(--accent)">${esc(e.org.name)}</span>`:''}${c?`<span class="muted">${esc(c.name)}</span>`:''}<span class="muted">by ${esc(e.by||'—')}</span><span class="t">${fmtDT(e.at)}</span></div>${e.notes?`<div class="p">${esc(e.notes)}</div>`:''}${e.next&&e.next.date&&e.next.type&&e.next.type!=='none'?`<div class="nx">Next: ${esc(e.next.type)} on ${fmtDate(e.next.date)}</div>`:''}</div></div>`;
}

/* ----- Settings ----- */
function vSettings(){
  const ex=orgsList().filter(o=>o.isExample).length;
  return `<div class="two"><div class="panel"><div class="ph"><h2>Team members</h2></div><div class="mb"><p class="small muted" style="margin:0 0 10px">Names here appear as owners. Your own name comes from your plnt.net sign-in.</p>${S.team.length?`<table>${S.team.map(m=>`<tr><td>${esc(m)}</td><td style="text-align:right"><button class="btn sm ghost" data-act="team-del" data-n="${esc(m)}">Remove</button></td></tr>`).join('')}</table>`:'<div class="muted small">No one yet.</div>'}<form data-form="team" class="btnrow" style="margin-top:12px"><input name="name" placeholder="Full name" required style="flex:1"><button class="btn primary">Add</button></form></div></div>
  <div><div class="panel" style="margin-bottom:16px"><div class="ph"><h2>Data</h2></div><div class="mb grid"><div><b>Export</b><div class="small muted">One row per contact, with organization fields, stage, owner and next action.</div><div class="btnrow" style="margin-top:8px"><button class="btn" data-act="export">Export CSV</button></div></div>
  ${ex?`<div><b>Example data</b><div class="small muted">${ex} example organization${ex===1?'':'s'} were loaded so you could see the desk working.</div><div class="btnrow" style="margin-top:8px"><button class="btn danger" data-act="clear-examples">Remove example data</button></div></div>`:''}
  <div><b>Storage</b><div class="small muted">${S.online===true?'Records are stored in the PLNT database and shared live with everyone who can open plnt.net/sales.':S.online===false?'Not connected to the database. Changes stay in this browser only.':'Connecting…'}</div></div></div></div>
  <div class="panel"><div class="ph"><h2>How the pipeline works</h2></div><div class="mb small" style="line-height:1.7">${STAGES.map(s=>`<div>${stagePill(s.id)} <span class="muted">${esc(s.hint)}</span></div>`).join('')}<p class="muted" style="margin:10px 0 0">Log every call or email from Today or an organization's page. The desk asks how it went, what happens next, and offers a template to send right away.</p></div></div></div></div>`;
}

/* ---------- drawer (organization) ---------- */
function openOrg(id){S.drawerOrg=id;renderDrawer();}
function closeDrawer(){S.drawerOrg=null;document.getElementById('drawer-root').innerHTML='';}
function renderDrawer(){
  const o=S.orgs.get(S.drawerOrg);const root=document.getElementById('drawer-root');
  if(!o){root.innerHTML='';S.drawerOrg=null;return;}
  const id=S.drawerOrg;const owners=[...new Set([...S.team,...(o.owner?[o.owner]:[]),...(S.me?[S.me]:[])])].sort();
  const focused=document.activeElement;const keepFocus=root.contains(focused)?focused.id:null;
  root.innerHTML=`<div class="drawer-wrap" data-act="drawer-bg"><div class="drawer" role="dialog" aria-label="${esc(o.name)}">
  <div class="dh"><h2>${esc(o.name)}${o.isExample?' <span class="pill ex">example</span>':''}</h2><button class="btn sm primary" data-act="log" data-id="${id}" data-t="call">Log call</button><button class="btn sm" data-act="log" data-id="${id}" data-t="email">Log email</button><button class="x" data-act="drawer-close" aria-label="Close">×</button></div>
  <div class="db">
  <form data-form="org" class="panel"><input type="hidden" name="id" value="${id}"><div class="ph"><h2>Details</h2><button class="btn sm primary" type="submit">Save</button></div><div class="mb grid">
    <div class="grid g3"><div class="span2"><label for="o-name">Organization</label><input id="o-name" name="name" required value="${esc(o.name)}"></div><div><label for="o-stage">Stage</label><select id="o-stage" name="stage">${STAGES.map(s=>`<option value="${s.id}" ${o.stage===s.id?'selected':''}>${esc(s.label)}</option>`).join('')}</select></div></div>
    <div class="grid g3"><div><label for="o-owner">Owner</label><select id="o-owner" name="owner"><option value="">—</option>${owners.map(m=>`<option ${o.owner===m?'selected':''}>${esc(m)}</option>`).join('')}</select></div><div><label for="o-acre">Acreage</label><input id="o-acre" name="acreage" type="number" step="any" min="0" value="${esc(o.acreage)}"></div><div><label for="o-monthly">Monthly value ($)</label><input id="o-monthly" name="monthly" type="number" step="any" min="0" value="${esc(o.monthly)}"></div></div>
    <div class="grid g3"><div class="span2"><label for="o-addr">Address</label><input id="o-addr" name="address" value="${esc(o.address)}"></div><div><label for="o-state">State</label><input id="o-state" name="state" list="states" value="${esc(orgState(o))}" placeholder="OR" maxlength="20"></div></div>
    <div><label for="o-plants">Plant types</label><input id="o-plants" name="plantTypes" value="${esc(o.plantTypes)}" placeholder="e.g. container shrubs, B&amp;B trees, perennials"></div>
    <div><label for="o-inv">Critical inventory information</label><textarea id="o-inv" name="inventory" rows="3" placeholder="Key crops, quantities, seasonal timing, pest or disease pressure…">${esc(o.inventory)}</textarea></div>
    <div class="grid g3"><div><label for="o-demo">Demo date</label><input id="o-demo" name="demoDate" type="date" value="${esc(o.demoDate)}"></div><div><label for="o-pilot">Pilot start</label><input id="o-pilot" name="pilotStart" type="date" value="${esc(o.pilotStart)}"></div><div><label for="o-lost">Lost / hold reason</label><input id="o-lost" name="lostReason" value="${esc(o.lostReason)}"></div></div>
    <div><label for="o-notes">Notes</label><textarea id="o-notes" name="notes" rows="3">${esc(o.notes)}</textarea></div>
  </div></form>
  <div class="panel"><div class="ph"><h2>Contacts</h2><span class="muted small">${(o.contacts||[]).length}</span><button class="btn sm" data-act="contact-new" data-id="${id}">+ Add contact</button></div>
  ${(o.contacts||[]).length?(o.contacts||[]).map(c=>`<div class="contact"><div><div class="n">${esc(c.name)}${c.primary?' <span class="pill act">primary</span>':''}</div><div class="r">${esc(c.role||'')}</div><div class="c">${c.phone?`<a href="tel:${esc(c.phone.replace(/[^\d+]/g,''))}">☎ ${esc(c.phone)}</a>`:''}${c.email?`<a href="mailto:${esc(c.email)}">✉ ${esc(c.email)}</a>`:''}</div>${c.notes?`<div class="small muted" style="margin-top:4px">${esc(c.notes)}</div>`:''}<div class="nx">${c.next?.date&&c.next.type!=='none'?`<span class="pill act">${esc(NEXT_OK.has(c.next.type)?c.next.type:'call')}</span><span class="pill ${dueClass(c.next.date)}">${dueLabel(c.next.date)}</span>${c.next.note?`<span class="muted">${esc(c.next.note)}</span>`:''}`:'<span class="faint">No next step</span>'}${c.lastOutcome?`<span class="faint">· last ${esc(OUT_LABEL[c.lastOutcome]||c.lastOutcome)} ${fmtDate(c.lastAt)}</span>`:''}</div></div><div class="acts"><div class="btnrow"><button class="btn sm primary" data-act="log" data-id="${id}" data-c="${c.id}" data-t="call">Call</button><button class="btn sm" data-act="log" data-id="${id}" data-c="${c.id}" data-t="email">Email</button></div><button class="btn sm ghost" data-act="contact-edit" data-id="${id}" data-c="${c.id}">Edit</button></div></div>`).join(''):'<div class="empty small">No contacts yet.</div>'}</div>
  <div class="panel"><div class="ph"><h2>Timeline</h2><span class="muted small">${(o.log||[]).length}</span><button class="btn sm" data-act="note-new" data-id="${id}">+ Note</button></div><div class="timeline">${(o.log||[]).length?[...o.log].reverse().map(e=>evRow({...e,org:{...o,id}},false)).join(''):'<div class="empty small">No activity yet.</div>'}</div></div>
  <div class="btnrow" style="justify-content:space-between"><span class="faint small">Added ${fmtDate(o.createdAt)}${o.source?' · '+esc(o.source):''}</span><button class="btn sm danger" data-act="org-del" data-id="${id}">Delete organization</button></div>
  </div></div></div>`;
  if(keepFocus){const f=document.getElementById(keepFocus);if(f)f.focus();}
}

/* ---------- modals ---------- */
function modal(html,cls){document.getElementById('modal-root').innerHTML=`<div class="overlay" data-act="modal-bg"><div class="modal ${cls||''}" role="dialog">${html}</div></div>`;const first=document.querySelector('#modal-root input:not([type=hidden]):not([type=radio]),#modal-root select,#modal-root textarea');if(first)first.focus();}
function closeModal(){document.getElementById('modal-root').innerHTML='';}
/* In-page confirm/prompt: the browser's own dialogs are blocked inside the artifact frame. */
let askCancel=null;
function ask(msg,opts={}){return new Promise(res=>{const root=document.getElementById('confirm-root');
  root.innerHTML=`<div class="overlay" style="z-index:70"><div class="modal" style="max-width:440px" role="alertdialog"><div class="mb">${opts.input?`<label for="ask-in">${esc(msg)}</label><input id="ask-in" value="${esc(opts.value||'')}" placeholder="${esc(opts.placeholder||'')}" autocomplete="off">`:`<p style="margin:0">${esc(msg)}</p>`}</div><div class="mf"><button type="button" class="btn" data-ask="no">Cancel</button><button type="button" class="btn ${opts.danger?'danger':'primary'}" data-ask="yes">${esc(opts.ok||'OK')}</button></div></div></div>`;
  const done=v=>{root.innerHTML='';askCancel=null;res(v);};
  askCancel=()=>done(opts.input?null:false);
  root.querySelector('[data-ask=no]').onclick=askCancel;
  const inp=root.querySelector('#ask-in');
  const yes=()=>done(opts.input?(inp.value.trim()||null):true);
  root.querySelector('[data-ask=yes]').onclick=yes;
  if(inp){inp.focus();inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();yes();}};}else root.querySelector('[data-ask=yes]').focus();
});}
function askName(){return ask('Your name, as the team will see it:',{input:true,ok:'Save',placeholder:'Full name'});}
function mhead(t){return `<div class="mh"><h2>${t}</h2><button class="x" data-act="modal-close" aria-label="Close">×</button></div>`;}

function newLeadModal(){
  const owners=[...new Set([...S.team,...(S.me?[S.me]:[])])].sort();
  modal(mhead('New lead')+`<form data-form="lead"><div class="mb grid">
    <div class="grid g3"><div class="span2"><label for="l-org">Organization</label><input id="l-org" name="name" required placeholder="Nursery, farm or grower name"></div><div><label for="l-stage">Stage</label><select id="l-stage" name="stage">${STAGES.map(s=>`<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select></div></div>
    <div class="grid g2"><div><label for="l-contact">Contact name</label><input id="l-contact" name="contact"></div><div><label for="l-role">Contact's role</label><input id="l-role" name="role" placeholder="Owner, Grower, Purchasing…"></div></div>
    <div class="grid g2"><div><label for="l-phone">Phone</label><input id="l-phone" name="phone" type="tel"></div><div><label for="l-email">Email</label><input id="l-email" name="email" type="email"></div></div>
    <div class="grid g3"><div class="span2"><label for="l-addr">Address</label><input id="l-addr" name="address"></div><div><label for="l-state">State</label><input id="l-state" name="state" list="states" placeholder="OR" maxlength="20"></div></div>
    <div class="grid g2"><div><label for="l-acre">Acreage</label><input id="l-acre" name="acreage" type="number" step="any" min="0"></div><div><label for="l-plants">Plant types</label><input id="l-plants" name="plantTypes"></div></div>
    <div><label for="l-inv">Critical inventory information</label><textarea id="l-inv" name="inventory" rows="2"></textarea></div>
    <div class="grid g3"><div><label for="l-owner">Owner</label><select id="l-owner" name="owner"><option value="">—</option>${owners.map(m=>`<option ${m===S.me?'selected':''}>${esc(m)}</option>`).join('')}</select></div><div><label for="l-first">First touch</label><select id="l-first" name="first"><option value="call">Call</option><option value="email">Email</option><option value="none">Nothing yet</option></select></div><div><label for="l-date">On</label><input id="l-date" name="date" type="date" value="${todayStr()}"></div></div>
  </div><div class="mf"><button type="button" class="btn" data-act="modal-close">Cancel</button><button class="btn primary">Add lead</button></div></form>`);
}
function contactModal(orgId,cid){
  const o=S.orgs.get(orgId);const c=cid?(o.contacts||[]).find(x=>x.id===cid):{name:'',role:'',phone:'',email:'',notes:'',primary:!(o.contacts||[]).length,next:null};
  modal(mhead(cid?'Edit contact':'Add contact')+`<form data-form="contact"><input type="hidden" name="org" value="${orgId}"><input type="hidden" name="cid" value="${esc(cid||'')}"><div class="mb grid">
    <div class="grid g2"><div><label for="c-name">Name</label><input id="c-name" name="name" required value="${esc(c.name)}"></div><div><label for="c-role">Role</label><input id="c-role" name="role" value="${esc(c.role)}"></div></div>
    <div class="grid g2"><div><label for="c-phone">Phone</label><input id="c-phone" name="phone" type="tel" value="${esc(c.phone)}"></div><div><label for="c-email">Email</label><input id="c-email" name="email" type="email" value="${esc(c.email)}"></div></div>
    <div><label for="c-notes">Notes</label><textarea id="c-notes" name="notes" rows="2">${esc(c.notes)}</textarea></div>
    <div class="grid g3"><div><label for="c-nt">Next step</label><select id="c-nt" name="ntype">${NEXT_TYPES.filter(t=>t[0]!=='demo').map(([v,l])=>`<option value="${v}" ${(c.next?.type||'none')===v?'selected':''}>${l}</option>`).join('')}<option value="demo" ${c.next?.type==='demo'?'selected':''}>Demo</option></select></div><div><label for="c-nd">On</label><input id="c-nd" name="ndate" type="date" value="${esc(c.next?.date||todayStr())}"></div><div><label for="c-nn">Reminder note</label><input id="c-nn" name="nnote" value="${esc(c.next?.note||'')}"></div></div>
    <label class="check"><input type="checkbox" name="primary" ${c.primary?'checked':''}> Primary contact for this organization</label>
  </div><div class="mf">${cid?`<button type="button" class="btn danger left" data-act="contact-del" data-id="${orgId}" data-c="${cid}">Remove contact</button>`:''}<button type="button" class="btn" data-act="modal-close">Cancel</button><button class="btn primary">Save</button></div></form>`);
}
function scheduleModal(orgId,cid){
  const o=S.orgs.get(orgId);if(!o)return;const cs=o.contacts||[];if(!cs.length){toast('Add a contact first.','err');contactModal(orgId);return;}
  cid=cid||primaryContact(o)?.id;const c=cs.find(x=>x.id===cid)||cs[0];const n=c.next||{type:'call',date:todayStr(),note:''};
  modal(mhead('Schedule a follow-up')+`<form data-form="sched"><input type="hidden" name="org" value="${orgId}"><div class="mb grid">
    <div><label for="sc-c">Who</label><select id="sc-c" name="contact">${cs.map(x=>`<option value="${x.id}" ${x.id===c.id?'selected':''}>${esc(x.name)}${x.role?' · '+esc(x.role):''}</option>`).join('')}</select><div class="help">${esc(o.name)}</div></div>
    <div><label>What</label><div class="radios">${NEXT_TYPES.map(([v,l])=>`<label><input type="radio" name="ntype" value="${v}" ${(n.type||'call')===v?'checked':''}><span>${v==='none'?'Clear follow-up':l}</span></label>`).join('')}</div></div>
    <div class="grid g2"><div><label for="sc-d">On</label><input id="sc-d" name="ndate" type="date" value="${esc(n.date||todayStr())}"></div><div><label for="sc-q">Quick pick</label><select id="sc-q" data-change="quickdate"><option value="">—</option><option value="0">Today</option><option value="b1">Tomorrow (business day)</option><option value="b2">In 2 business days</option><option value="b3">In 3 business days</option><option value="7">In 1 week</option><option value="14">In 2 weeks</option><option value="30">In 30 days</option></select></div></div>
    <div><label for="sc-n">Reminder note</label><input id="sc-n" name="nnote" value="${esc(n.note||'')}" placeholder="What to bring up, what they asked for…"></div>
  </div><div class="mf"><button type="button" class="btn" data-act="modal-close">Cancel</button><button class="btn primary">Save</button></div></form>`);
}
function noteModal(orgId){modal(mhead('Add a note')+`<form data-form="note"><input type="hidden" name="org" value="${orgId}"><div class="mb"><label for="n-txt">Note</label><textarea id="n-txt" name="notes" rows="4" required></textarea></div><div class="mf"><button type="button" class="btn" data-act="modal-close">Cancel</button><button class="btn primary">Save note</button></div></form>`);}

function logModal(orgId,cid,type){
  const o=S.orgs.get(orgId);if(!o)return;const cs=o.contacts||[];cid=cid||primaryContact(o)?.id||'';type=type||'call';
  if(!cs.length){toast('Add a contact first, then log the call.','err');contactModal(orgId);return;}
  const out=t=>`<div class="radios" data-outset="${t}">${OUTCOMES[t].map(([v,l],i)=>`<label><input type="radio" name="outcome_${t}" value="${v}" ${i===0?'checked':''}><span>${l}</span></label>`).join('')}</div>`;
  modal(mhead(`Log a ${type}`)+`<form data-form="log"><input type="hidden" name="org" value="${orgId}"><div class="mb grid">
    <div class="grid g2"><div><label>What</label><div class="radios"><label><input type="radio" name="ltype" value="call" ${type==='call'?'checked':''}><span>☎ Call</span></label><label><input type="radio" name="ltype" value="email" ${type==='email'?'checked':''}><span>✉ Email</span></label></div></div><div><label for="lg-c">With</label><select id="lg-c" name="contact">${cs.map(c=>`<option value="${c.id}" ${c.id===cid?'selected':''}>${esc(c.name)}${c.role?' · '+esc(c.role):''}</option>`).join('')}</select></div></div>
    <div><label>How did it go?</label>${out('call')}${out('email')}</div>
    <div><label for="lg-notes">Notes</label><textarea id="lg-notes" name="notes" rows="3" placeholder="What did they say? Objections, timing, who else to talk to…"></textarea></div>
    <div><label>How should we proceed?</label><div class="radios">${NEXT_TYPES.map(([v,l])=>`<label><input type="radio" name="ntype" value="${v}"><span>${l}</span></label>`).join('')}</div></div>
    <div class="grid g3"><div><label for="lg-date">On</label><input id="lg-date" name="ndate" type="date" value="${todayStr()}"></div><div id="lg-demo-wrap" class="hidden"><label for="lg-demo">Demo type</label><select id="lg-demo" name="demoType"><option value="demo_5acre">5-acre demo</option><option value="demo_video">Video call demo</option></select></div><div><label for="lg-stage">Stage after this</label><select id="lg-stage" name="stage">${STAGES.map(s=>`<option value="${s.id}" ${o.stage===s.id?'selected':''}>${esc(s.label)}</option>`).join('')}</select></div></div>
    <div class="help" id="lg-hint"></div>
  </div><div class="mf"><button type="button" class="btn" data-act="modal-close">Cancel</button><button class="btn primary">Save &amp; pick a template</button></div></form>`);
  applyLogDefaults(document.querySelector('form[data-form=log]'));syncLogForm();
}
function syncLogForm(){
  const f=document.querySelector('form[data-form=log]');if(!f)return;
  const type=f.ltype.value;
  f.querySelectorAll('[data-outset]').forEach(d=>d.classList.toggle('hidden',d.dataset.outset!==type));
  const outcome=f['outcome_'+type].value;
  const nt=f.ntype.value;
  document.getElementById('lg-demo-wrap').classList.toggle('hidden',nt!=='demo');
  f.ndate.disabled=nt==='none';
  const hints={voicemail:'Voicemail left: suggest calling again in 3 business days.',not_connected:'No answer: suggest trying again tomorrow.',connected:'Connected: send a recap email now, then call to follow up.',sent:'Email sent: suggest a follow-up call in 2 business days.',replied:'They replied: suggest calling back tomorrow.',bounced:'Bounced: fix the address on the contact, then call.'};
  document.getElementById('lg-hint').textContent=hints[outcome]||'';
}
function applyLogDefaults(f){
  const type=f.ltype.value,outcome=f['outcome_'+type].value;
  const d={voicemail:['call',nextBizDay(null,3)],not_connected:['call',nextBizDay(null,1)],connected:['email',todayStr()],sent:['call',nextBizDay(null,2)],replied:['call',nextBizDay(null,1)],bounced:['call',nextBizDay(null,1)]}[outcome];
  if(d){f.ntype.value=d[0];f.ndate.value=d[1];}
}
async function submitLog(f){
  const orgId=f.org.value;const o=clone(S.orgs.get(orgId));const type=f.ltype.value;const outcome=f['outcome_'+type].value;const cid=f.contact.value;const c=(o.contacts||[]).find(x=>x.id===cid);
  const nt=NEXT_OK.has(f.ntype.value)?f.ntype.value:'none';let next=null;
  if(nt!=='none'){next={type:nt,date:f.ndate.value||todayStr(),note:nt==='demo'?(f.demoType.value==='demo_5acre'?'5-acre demo':'Video demo'):''};}
  const entry={id:uid(),at:nowISO(),by:S.me||'',contactId:cid,type,outcome,notes:f.notes.value.trim(),next};
  o.log=o.log||[];o.log.push(entry);
  if(c){c.next=next;c.lastOutcome=outcome;c.lastAt=entry.at;if(nt==='demo'){c.next.type='demo';}}
  let newStage=f.stage.value;
  if(nt==='demo'&&!newStage.startsWith('demo'))newStage=f.demoType.value;
  if(newStage!==o.stage){o.log.push({id:uid(),at:nowISO(),by:S.me||'',type:'stage',notes:`${STAGE[o.stage]?.label||o.stage} → ${STAGE[newStage].label}`});o.stage=newStage;}
  if(nt==='demo'&&!o.demoDate)o.demoDate=next.date;
  await saveOrg(orgId,o);
  afterLogModal(orgId,cid,type,outcome,next);
}
function afterLogModal(orgId,cid,type,outcome,next){
  const o=S.orgs.get(orgId);const c=(o.contacts||[]).find(x=>x.id===cid);
  const suggest={connected:'after_call',voicemail:'after_voicemail',not_connected:'after_voicemail',sent:'other',replied:'after_call',bounced:'other'}[outcome];
  const tpls=[...S.templates.entries()].map(([id,t])=>({id,...t})).sort((a,b)=>(a.category===suggest?0:1)-(b.category===suggest?0:1)||a.name.localeCompare(b.name));
  const ctx=mergeCtx(o,c);
  const summary=`${type==='call'?'Call':'Email'} with ${esc(c?.name||'contact')} logged as <b>${esc(OUT_LABEL[outcome])}</b>.${next?` Next: <b>${esc(next.type)}</b> on ${fmtDate(next.date)}.`:' No follow-up scheduled.'}`;
  modal(mhead('Logged ✓ — send a follow-up?')+`<div class="mb"><div class="banner info" style="margin-bottom:14px">${summary}</div>
  ${tpls.length?tpls.map(t=>{const subj=mergeTemplate(t.subject,ctx),body=mergeTemplate(t.body,ctx);const mailto=c?.email?`mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`:'';
    return `<div class="tcard"><div class="th"><b>${esc(t.name)}</b><span class="pill ${t.category===suggest?'paying':'act'}">${esc(CAT_LABEL[t.category]||t.category)}${t.category===suggest?' · suggested':''}</span></div>${subj?`<div class="subj"><span class="muted">Subject:</span> ${esc(subj)}</div>`:''}<pre>${esc(body)}</pre><div class="btnrow" style="margin-top:8px"><button class="btn sm primary" data-act="copy" data-txt="${esc(subj?subj+'\n\n'+body:body)}">Copy all</button>${subj?`<button class="btn sm" data-act="copy" data-txt="${esc(subj)}">Copy subject</button>`:''}<button class="btn sm" data-act="copy" data-txt="${esc(body)}">Copy body</button>${mailto?`<a class="btn sm" href="${esc(mailto)}" target="_blank" rel="noopener">Open in email app</a>`:''}</div></div>`;}).join(''):`<div class="empty"><h3>No templates yet</h3>Create one under <b>Templates</b> and it will show up here, filled in with the contact's name and organization.</div>`}
  </div><div class="mf"><button class="btn primary" data-act="modal-close">Done</button></div>`,'wide');
}

/* ---------- actions ---------- */
const ACT={
  nav(el){S.view=el.dataset.v;ls('view',S.view);render();},
  scope(el){S.scope=el.dataset.s;ls('scope',S.scope);render();},
  'sel-day'(el){S.selDay=el.dataset.d;render();},
  'clear-filters'(){S.stageF='';S.ownerF='';S.stateF='';S.acreMin='';S.acreMax='';render();},
  week(el){const n=+el.dataset.n;S.weekOff=n===0?0:S.weekOff+n;if(n===0)S.selDay=todayStr();else S.selDay=addDays(mondayOf(todayStr()),7*S.weekOff);render();},
  sched(el){scheduleModal(el.dataset.id,el.dataset.c);},
  async 'overdue-today'(){const t=todayStr();let n=0;for(const o of orgsList()){if(!isMine(o))continue;let hit=false;const cp=clone(o);for(const c of cp.contacts||[]){if(c.next?.date&&c.next.type!=='none'&&c.next.date<t){c.next.date=t;hit=true;n++;}}if(hit){const id=cp.id;delete cp.id;await saveOrg(id,cp);}}toast(`${n} follow-up${n===1?'':'s'} moved to today`);},
  sort(el){const k=el.dataset.k;if(S.sort===k)S.sortDir*=-1;else{S.sort=k;S.sortDir=1;}render();},
  'new-lead'(){newLeadModal();},
  'open-org'(el){openOrg(el.dataset.id);},
  'drawer-close'(){closeDrawer();},
  'drawer-bg'(el,e){if(e.target===el)closeDrawer();},
  'modal-close'(){closeModal();},
  'modal-bg'(el,e){if(e.target===el)closeModal();},
  log(el){logModal(el.dataset.id,el.dataset.c,el.dataset.t);},
  async snooze(el){const o=clone(S.orgs.get(el.dataset.id));const c=(o.contacts||[]).find(x=>x.id===el.dataset.c);if(!c||!c.next)return;c.next.date=addDays(c.next.date<todayStr()?todayStr():c.next.date,1);await saveOrg(el.dataset.id,o);toast('Moved to '+fmtDate(c.next.date));},
  'contact-new'(el){contactModal(el.dataset.id);},
  'contact-edit'(el){contactModal(el.dataset.id,el.dataset.c);},
  async 'contact-del'(el){if(!await ask('Remove this contact?',{ok:'Remove',danger:true}))return;const o=clone(S.orgs.get(el.dataset.id));o.contacts=(o.contacts||[]).filter(c=>c.id!==el.dataset.c);closeModal();await saveOrg(el.dataset.id,o);},
  'note-new'(el){noteModal(el.dataset.id);},
  async 'org-del'(el){const o=S.orgs.get(el.dataset.id);if(!await ask(`Delete ${o.name} with its contacts and history? This cannot be undone.`,{ok:'Delete',danger:true}))return;await deleteOrg(el.dataset.id);toast('Deleted '+o.name);},
  copy(el){copyText(el.dataset.txt);},
  'tpl-new'(){S.tplSel=null;render();},
  'tpl-sel'(el){S.tplSel=el.dataset.id;render();},
  async 'tpl-del'(el){if(!await ask('Delete this template for everyone?',{ok:'Delete',danger:true}))return;await deleteTemplate(el.dataset.id);toast('Template deleted');},
  'tpl-ins'(el){const ta=document.getElementById('tpl-body');if(!ta)return;const s=ta.selectionStart,e=ta.selectionEnd;ta.value=ta.value.slice(0,s)+'{{'+el.dataset.k+'}}'+ta.value.slice(e);ta.focus();ta.selectionStart=ta.selectionEnd=s+el.dataset.k.length+4;},
  'imp-parse'(){const t=document.getElementById('paste').value;if(!t.trim()){toast('Paste some rows first','err');return;}startImport(t);},
  'imp-sample'(){copyText('Organization,Contact,Role,Phone,Email,Address,Acreage,Plant Types,Critical Inventory,Notes');},
  'imp-run'(){runImport();},
  async 'team-del'(el){await saveTeam(S.team.filter(m=>m!==el.dataset.n));},
  async 'clear-examples'(){const ex=orgsList().filter(o=>o.isExample);if(!await ask(`Remove ${ex.length} example organization${ex.length===1?'':'s'}?`,{ok:'Remove',danger:true}))return;for(const o of ex)await deleteOrg(o.id);toast('Example data removed');},
  async export(){const rows=[['Organization','Contact','Role','Phone','Email','Address','State','Acreage','Plant types','Critical inventory','Stage','Owner','Monthly value','Next action','Next date','Last outcome','Last activity','Notes']];
    for(const o of orgsList()){const cs=(o.contacts||[]).length?o.contacts:[{}];for(const c of cs)rows.push([o.name,c.name||'',c.role||'',c.phone||'',c.email||'',o.address||'',orgState(o),o.acreage||'',o.plantTypes||'',o.inventory||'',STAGE[o.stage]?.label||o.stage,o.owner||'',o.monthly||'',c.next?.type||'',c.next?.date||'',OUT_LABEL[c.lastOutcome]||'',c.lastAt||'',o.notes||'']);}
    const csv=rows.map(r=>r.map(v=>{v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(',')).join('\n');
    if(downloads){try{await downloads.save({filename:'plnt-sales-desk-'+todayStr()+'.csv',data:csv});toast('CSV downloaded');}catch(e){if(e.code!=='declined')toast('Export failed: '+(e.message||e.code),'err');}}
    else{copyText(csv);toast('Downloads are not available here, so the CSV was copied to your clipboard.');}},
};

on('click',e=>{const el=e.target.closest('[data-act]');if(!el)return;if(e.target.closest('a[href]'))return;if(el.dataset.act==='open-org'&&e.target.closest('[data-act]')!==el)return;const fn=ACT[el.dataset.act];if(fn){if(!(el.dataset.act==='drawer-bg'||el.dataset.act==='modal-bg'))e.preventDefault();fn(el,e);}});
on('change',e=>{const el=e.target;
  if(el.dataset.change==='stageF'){S.stageF=el.value;render();return;}
  if(el.dataset.change==='ownerF'){S.ownerF=el.value;render();return;}
  if(el.dataset.change==='stateF'){S.stateF=el.value;render();return;}
  if(el.dataset.change==='pipeSort'){if(el.value){S.pipeSort=el.value;render();}return;}
  if(el.dataset.change==='sortSel'){if(!el.value)return;const [k,d]=el.value.split(':');S.sort=k;S.sortDir=d==='desc'?-1:1;render();return;}
  if(el.dataset.change==='map'){S.imp.map[+el.dataset.i]=el.value;return;}
  if(el.dataset.change==='quickdate'){const q=el.value;if(!q)return;const d=document.getElementById('sc-d');d.value=q.startsWith('b')?nextBizDay(null,+q.slice(1)):addDays(todayStr(),+q);return;}
  const f=el.closest('form[data-form=log]');if(f){if(el.name==='ltype'||el.name.startsWith('outcome_'))applyLogDefaults(f);syncLogForm();}
});
let acreTimer;
let qTimer;on('input',e=>{
  if(e.target.dataset.input==='acreMin'||e.target.dataset.input==='acreMax'){const k=e.target.dataset.input,v=e.target.value;clearTimeout(acreTimer);acreTimer=setTimeout(()=>{S[k]=v;const keep=document.activeElement?.dataset?.input;render();if(keep){const el=document.querySelector(`[data-input=${keep}]`);if(el){el.focus();el.setSelectionRange?.(el.value.length,el.value.length);}}},250);return;}if(e.target.dataset.input==='q'){clearTimeout(qTimer);qTimer=setTimeout(()=>{S.q=e.target.value.trim();if(S.q&&S.view!=='orgs'&&S.view!=='pipeline'&&S.view!=='today'){S.view='orgs';}renderNav();renderView();},120);}});
on('keydown',e=>{if(e.key==='/'&&!/input|textarea|select/i.test(e.target.tagName)){e.preventDefault();document.getElementById('q').focus();}if(e.key==='Escape'){if(askCancel)askCancel();else if(document.querySelector('#modal-root .overlay'))closeModal();else if(S.drawerOrg)closeDrawer();}});

on('submit',async e=>{
  const f=e.target;if(!f.dataset.form)return;e.preventDefault();const v=n=>(f[n]?.value??'').trim();
  if(f.dataset.form==='lead'){
    const id=uid();const first=v('first');const contact=v('contact')||v('email')||v('phone')?{id:uid(),name:v('contact')||'(unknown)',role:v('role'),phone:v('phone'),email:v('email'),notes:'',primary:true,next:first==='none'?null:{type:first,date:v('date')||todayStr(),note:''}}:null;
    const o={name:v('name'),address:v('address'),state:normState(v('state'))||stateFromAddress(v('address')),acreage:v('acreage')?+v('acreage'):'',plantTypes:v('plantTypes'),inventory:v('inventory'),notes:'',stage:v('stage'),owner:v('owner'),monthly:'',demoDate:'',pilotStart:'',lostReason:'',contacts:contact?[contact]:[],log:[{id:uid(),at:nowISO(),by:S.me||'',type:'note',notes:'Lead created'}],source:'manual'};
    closeModal();await saveOrg(id,o);toast('Lead added');openOrg(id);
  }
  if(f.dataset.form==='org'){
    const id=v('id');const o=clone(S.orgs.get(id));const before=o.stage;
    for(const k of ['name','address','plantTypes','inventory','notes','owner','demoDate','pilotStart','lostReason','stage'])o[k]=v(k);o.state=normState(v('state'));
    o.acreage=v('acreage')?+v('acreage'):'';o.monthly=v('monthly')?+v('monthly'):'';
    if(o.stage!==before){o.log=o.log||[];o.log.push({id:uid(),at:nowISO(),by:S.me||'',type:'stage',notes:`${STAGE[before]?.label||before} → ${STAGE[o.stage].label}`});}
    await saveOrg(id,o);toast('Saved');
  }
  if(f.dataset.form==='contact'){
    const id=v('org'),cid=v('cid');const o=clone(S.orgs.get(id));o.contacts=o.contacts||[];
    let c=cid?o.contacts.find(x=>x.id===cid):null;if(!c){c={id:uid()};o.contacts.push(c);}
    Object.assign(c,{name:v('name'),role:v('role'),phone:v('phone'),email:v('email'),notes:v('notes'),primary:f.primary.checked});
    const nt=v('ntype');c.next=nt==='none'?null:{type:nt,date:v('ndate')||todayStr(),note:v('nnote')};
    if(c.primary)o.contacts.forEach(x=>{if(x.id!==c.id)x.primary=false;});
    closeModal();await saveOrg(id,o);toast('Contact saved');
  }
  if(f.dataset.form==='sched'){
    const id=v('org');const o=clone(S.orgs.get(id));const c=(o.contacts||[]).find(x=>x.id===v('contact'));if(!c)return;
    const nt=NEXT_OK.has(v('ntype'))?v('ntype'):'none';c.next=nt==='none'?null:{type:nt,date:v('ndate')||todayStr(),note:v('nnote')};
    closeModal();await saveOrg(id,o);toast(nt==='none'?'Follow-up cleared':`${NEXT_TYPES.find(x=>x[0]===nt)[1]} scheduled for ${fmtDate(c.next.date)}`);
  }
  if(f.dataset.form==='note'){const id=v('org');const o=clone(S.orgs.get(id));o.log=o.log||[];o.log.push({id:uid(),at:nowISO(),by:S.me||'',type:'note',notes:v('notes')});closeModal();await saveOrg(id,o);}
  if(f.dataset.form==='log'){const btn=f.querySelector('button.primary');btn.disabled=true;await submitLog(f);}
  if(f.dataset.form==='tpl'){const id=v('id')||uid();const t={name:v('name'),category:v('category'),subject:v('subject'),body:f.body.value,createdBy:S.templates.get(id)?.createdBy||S.me||'',createdAt:S.templates.get(id)?.createdAt||nowISO()};S.tplSel=id;await saveTemplate(id,t);toast('Template saved');}
  if(f.dataset.form==='team'){const n=v('name');if(!n)return;if(!S.team.includes(n))await saveTeam([...S.team,n].sort());f.reset();}
});

/* drag & drop: pipeline cards between stages, schedule touches between days */
let drag=null;
on('dragstart',e=>{const c=e.target.closest('.card,.wi');if(!c)return;drag={kind:c.classList.contains('card')?'org':'touch',id:c.dataset.id,c:c.dataset.c};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',c.dataset.id);});
function dropTarget(e){if(!drag)return null;return e.target.closest(drag.kind==='org'?'.col':'.wday');}
on('dragover',e=>{const t=dropTarget(e);if(!t)return;e.preventDefault();t.classList.add('over');});
on('dragleave',e=>{const t=dropTarget(e);if(t&&!t.contains(e.relatedTarget))t.classList.remove('over');});
on('drop',async e=>{const t=dropTarget(e);if(!t)return;e.preventDefault();t.classList.remove('over');const d=drag;drag=null;const o=clone(S.orgs.get(d.id));if(!o)return;
  if(d.kind==='org'){const to=t.dataset.stage;if(o.stage===to)return;o.log=o.log||[];o.log.push({id:uid(),at:nowISO(),by:S.me||'',type:'stage',notes:`${STAGE[o.stage]?.label||o.stage} → ${STAGE[to].label}`});o.stage=to;await saveOrg(d.id,o);toast('Moved to '+STAGE[to].label);}
  else{const c=(o.contacts||[]).find(x=>x.id===d.c);const day=t.dataset.day;if(!c||!c.next||c.next.date===day)return;c.next.date=day;await saveOrg(d.id,o);toast(`${c.name}: ${c.next.type} moved to ${fmtDate(day)}`);}
});
on('dragend',()=>{drag=null;document.querySelectorAll('.over').forEach(c=>c.classList.remove('over'));});


  S.me=opts.me||'';S.email=(opts.email||'').toLowerCase();db=opts.db||null;downloads=opts.downloads||null;
  init();
  if(typeof window!=='undefined')window.__plntSalesDesk={get state(){return S;}};
  return function unmount(){listeners.forEach(([ev,fn])=>document.removeEventListener(ev,fn));unsubs.forEach(u=>{try{u&&u();}catch(e){}});unsubs=[];};
}
