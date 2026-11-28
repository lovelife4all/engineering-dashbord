/* داشبورد عملکرد معاونت مهندسی — بدون وابستگی خارجی (SVG سفارشی) */
'use strict';

const FA_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const SRC_FA = {pargar:'پرگار', pmis:'PMIS', inquiry:'استعلام', meeting_mission_committee:'جلسات/مأموریت/کمیته',
                procedure:'دستورالعمل', gis:'GIS', other:'سایر'};
const COLORS = ['#1d5bd8','#12b886','#7048e8','#f59f00','#e64980','#15aabf','#2f9e44','#e8590c','#495057','#845ef7'];

const state = { logs:[], personnel:[], activities:[], activityScoreMap:[], activityScores:[], stakeholders:[], projects:[], submissions:[],
                month:null, dept:'', person:'' };

const $ = s => document.querySelector(s);
const fmt = n => (Math.round(n*100)/100).toLocaleString('en-US');
const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const BASE = (window.SUPA && window.SUPA.url) ? window.SUPA.url : '/api/';
const AUTH_BASE = (window.SUPA && window.SUPA.url) ? window.SUPA.url.replace('/rest/v1/', '/auth/v1/') : '/auth/';
const PUB_KEY = (window.SUPA && window.SUPA.key) ? window.SUPA.key : null;

/* ================= احراز هویت ================= */
let session = null;
function saveSession(s){ session=s; try{ localStorage.setItem('engkpi_session', JSON.stringify(s)); }catch(e){} }
function clearSession(){ session=null; try{ localStorage.removeItem('engkpi_session'); }catch(e){} }

async function authFetch(path, body, method, token){
  const h = {'Content-Type':'application/json'};
  if(PUB_KEY) h['apikey'] = PUB_KEY;
  if(token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(AUTH_BASE + path, {method: method||'POST', headers: h,
    body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error_description || j.msg || j.message || j.error || ('خطای ' + r.status));
  return j;
}
function authIdentifier(value){
  const raw=String(value||'').trim();
  const code=asciiDigits(raw);
  return /^\d+$/.test(code) ? `${code}@staff.engkpi.invalid` : raw.toLowerCase();
}
async function login(identifier, password){
  const email=authIdentifier(identifier);
  const s = await authFetch('token?grant_type=password', {email, password});
  saveSession({access_token: s.access_token, refresh_token: s.refresh_token,
               email, username: String(identifier||'').trim()});
}
async function tryRefresh(){
  if(!session || !session.refresh_token) return false;
  try{
    const s = await authFetch('token?grant_type=refresh_token', {refresh_token: session.refresh_token});
    saveSession({access_token: s.access_token, refresh_token: s.refresh_token, email: session.email});
    return true;
  }catch(e){ clearSession(); return false; }
}
async function restoreSession(){
  let raw; try{ raw = localStorage.getItem('engkpi_session'); }catch(e){ return false; }
  if(!raw) return false;
  try{ session = JSON.parse(raw); }catch(e){ clearSession(); return false; }
  try{
    const u = await authFetch('user', null, 'GET', session.access_token);
    session.email = u.email || session.email;
    session.username = session.email?.endsWith('@staff.engkpi.invalid') ? session.email.split('@')[0] : (session.username || session.email);
    saveSession(session);
    return true;
  }catch(e){
    return await tryRefresh();
  }
}
async function logout(){
  try{ await authFetch('logout', null, 'POST', session && session.access_token); }catch(e){}
  clearSession();
  showLogin();
  resetUi();
}
function showLogin(){
  $('#authScreen').style.display = 'flex';
  $('#appRoot').style.display = 'none';
}
function showApp(){
  $('#authScreen').style.display = 'none';
  $('#appRoot').style.display = 'block';
  $('#whoami').textContent = `${ROLE_LABEL[state.role]} · ${state.employeeNo || session.username || session.email}`;
}

async function api(path, opts={}){
  opts.headers = Object.assign({}, opts.headers||{});
  if(PUB_KEY) opts.headers['apikey'] = PUB_KEY;
  if(session && session.access_token) opts.headers['Authorization'] = 'Bearer ' + session.access_token;
  let r = await fetch(BASE + path, opts);
  if(r.status === 401 && await tryRefresh()){          // رفرش خودکار توکن
    opts.headers['Authorization'] = 'Bearer ' + session.access_token;
    r = await fetch(BASE + path, opts);
  }
  if(r.status === 401){ clearSession(); showLogin(); resetUi(); throw new Error('لطفاً دوباره وارد شوید'); }
  if(!r.ok){ let t=''; try{t=(await r.json()).message||''}catch(e){}; throw new Error(r.status+' '+t); }
  const t = await r.text();
  let body=null; try{ body = t? JSON.parse(t): null; }catch(e){ body=t; }
  // پاسخ RPCهای jsonb به‌صورت رشته/آرایه برمی‌گردد؛ همیشه دادهٔ اصلی را برگردان
  return Array.isArray(body)&&body.length===1&&body[0]&&typeof body[0]==='object'&&'r' in body[0] ? body[0].r : body;
}

/* ================= بارگذاری بر اساس نقش ================= */
const ROLE_LABEL={admin:'ادمین',management:'مدیریت',head:'رییس دپارتمان',expert:'کارشناس'};
const ROLE_TABS={admin:['dash','scores','form','table','accounts','catalog'],management:['dash','scores'],
                 head:['dash','scores','table','catalog'],expert:['form']};
function rpc(name, payload={}){
  return api('rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
}
async function allPages(path){
  const sep=path.includes('?')?'&':'?';
  const rows=[];
  for(let offset=0;;offset+=500){
    const page=await api(`${path}${sep}offset=${offset}&limit=500`);
    rows.push(...page);
    if(page.length<500) return rows;
  }
}
async function loadAll(){
  const role=state.role, initial=!state.ready,scope=state.demoScope;
  let data;
  if(role==='management'||role==='head') data=await rpc('kpi_dashboard');
  else if(role==='expert') data=await rpc('kpi_expert_form');
  else if(role==='admin') {
    const [logs,personnel,activities,stakeholders,projects,submissions,activityScoreMap]=await Promise.all([
      allPages('activity_logs?select=id,period_year,period_month,hours,doc_count,source,letter_date,notes,quality_reason,activity_id,stakeholder_id,project_id,employee:personnel(id,department:departments(id,name_fa),name_en),activity:activities(general_fa,specific_title,effort_score,value_score),stakeholder:stakeholders(name_fa)&order=id'),
      allPages('personnel?select=id,employee_no,name_en,active,department:departments(id,name_fa)&order=name_en,id'),
      allPages('activities?select=id,general_fa,specific_title,effort_score,value_score,avg_hours_doc&order=general_fa,id'),
      allPages('stakeholders?select=id,name_fa,active&order=name_fa,id'),
      allPages('projects?select=id,name_fa,active&order=name_fa,id'),
      allPages('monthly_submissions?select=employee_id,period_year,period_month,status&order=id'),
      rpc('kpi_effort_score_map'),
    ]);
    data={logs,personnel,activities,stakeholders,projects,submissions,activityScoreMap};
  } else throw new Error('برای این حساب هنوز نقشی تعیین نشده است. با ادمین تماس بگیرید.');
  if(role!=='expert') data.projectLoad=await rpc('kpi_project_load',{p_demo:false}).catch(()=>null);
  if(!session || state.role!==role || state.demoScope!==scope) return;
  const {projectLoad=null,logs,personnel,activities=[],stakeholders=[],projects=[],submissions,scope:deptScope=null,activityScoreMap=[]}=data;
  if(role==='admin'&&Array.isArray(activityScoreMap)){
    const scoreMap=new Map(activityScoreMap.map(x=>[`${x.department_id}:${x.activity_id}`,Number(x.effort_score)]));
    logs.forEach(l=>{const key=`${l.employee?.department?.id}:${l.activity_id}`;if(l.activity&&scoreMap.has(key))l.activity.effort_score=scoreMap.get(key);});
  }
  Object.assign(state,{logs,personnel,activities,activityScoreMap,stakeholders,projects,submissions,projectLoad,deptScope});
  const months=[...new Set(logs.map(l=>l.period_year*100+l.period_month))].sort((a,b)=>a-b);
  const now=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'numeric'}).formatToParts(new Date());
  const yr=Number(now.find(p=>p.type==='year').value), mo=Number(now.find(p=>p.type==='month').value);
  state.month=months.includes(state.month)?state.month:(months.at(-1)||yr*100+mo);
  if(role!=='expert') fillDashboardFilters();
  if(role==='admin'||role==='expert'){
    const year=initial?yr:Number($('#eYear').value)||yr, month=initial?mo:Number($('#eMonth').value)||mo;
    const person=role==='expert'?state.employeeId:(initial?'':$('#ePerson').value);
    const years=[...new Set([yr-1,yr,yr+1,year,...months.map(m=>Math.floor(m/100)),...submissions.map(s=>s.period_year)])].sort((a,b)=>a-b);
    fillSelect('#eYear',years.map(v=>({v,t:v})),year);
    fillSelect('#eMonth',FA_MONTHS.map((t,i)=>({v:i+1,t})),month);
    fillSelect('#ePerson',[...(role==='admin'?[{v:'',t:'انتخاب کارشناس'}]:[]),...personnel.filter(p=>p.active).map(p=>({v:p.id,t:`${p.name_en} (${p.employee_no}) — ${p.department.name_fa}`}))],person);
    $('#ePerson').disabled=role==='expert';
    fillSelect('#eStake',[{v:'',t:'—'},...stakeholders.filter(s=>s.active!==false).map(s=>({v:s.id,t:s.name_fa}))],initial?'':$('#eStake').value);
    fillSelect('#eProject',[{v:'',t:'—'},...projects.map(p=>({v:p.id,t:p.name_fa}))],initial?'':$('#eProject').value);
    refreshActivities();
  }
  state.ready=true;
  const n=logs.reduce((sum,l)=>sum+(l.event_count??1),0);
  $('#loadState').textContent=role==='expert'?'فرم گزارش ماهانهٔ شما':`${fmt(n)} رویداد · ${personnel.length} نفر`;
}

function fillSelect(sel, items, val){
  const el=$(sel); el.innerHTML = items.map(i=>`<option value="${esc(i.v)}">${esc(i.t)}</option>`).join('');
  if(val!==undefined && val!==null) el.value=String(val);
}

/* ================= حالت آزمایشی و فیلترها ================= */
const DEMO_MONTHS=[140501,140502,140503,140504,140505,140506];
const dashboardData=()=>state.demo ? state.demoData : state;
const demoPeriodLabel=m=>m===140506?'واقعی':'آزمایشی';
function fillDashboardFilters(){
  const {logs,personnel}=dashboardData();
  const months=state.demo?DEMO_MONTHS:[...new Set(logs.map(l=>l.period_year*100+l.period_month))].sort((a,b)=>a-b);
  const yearMonth=months.includes(state.month)?state.month:(months.at(-1)||state.month);
  state.month=yearMonth;
  fillSelect('#fMonth',(months.length?months:[state.month]).map(m=>({v:m,t:`${FA_MONTHS[m%100-1]} ${Math.floor(m/100)}${state.demo?' — '+demoPeriodLabel(m):''}`})),state.month);
  const depts=[...new Set(personnel.map(p=>p.department.name_fa))].sort();
  fillSelect('#fDept',[{v:'',t:'همه'},...depts.map(d=>({v:d,t:d}))],state.dept);
  fillSelect('#fPerson',[{v:'',t:'همه'},...personnel.map(p=>({v:p.id,t:p.employee_no?`${p.name_en} (${p.employee_no})`:p.name_en}))],state.person);
}
function updateScopeNote(){
  const box=$('#scopeNote'), depts=state.deptScope?.departments;
  const show=state.role==='head'&&state.tab==='dash'&&Array.isArray(depts)&&depts.length>0;
  box.hidden=!show;
  if(show){
    box.innerHTML=`<strong>نمای واحد شما</strong><p>رییس دپارتمان: فقط آمار واحدهای ${depts.map(d=>`«${esc(d)}»`).join(' و ')} نمایش داده می‌شود. برای دیدن ارقام واحدهای دیگر با ادمین تماس بگیرید.</p>`;
  }
}
function updateDemoUi(){
  const box=$('#dataMode'), btn=$('#btnDemo');
  box.hidden=state.tab!=='dash'||!['admin','management'].includes(state.role);
  box.dataset.demo=String(Boolean(state.demo));
  btn.setAttribute('aria-pressed',String(Boolean(state.demo)));
  btn.textContent=state.demo?'بازگشت به داده‌های واقعی':'نمایش داده‌های آزمایشی';
  $('#trendDemoLabel').hidden=!state.demo;
  $('#dataModeLabel').textContent=state.demo?`حالت آزمایشی · ${FA_MONTHS[state.month%100-1]} ${demoPeriodLabel(state.month)}`:'داده‌های واقعی';
  $('#dataModeInfo').textContent=state.demo?'فروردین تا مرداد ۱۴۰۵ ساختگی‌اند؛ شهریور واقعی است. از مقایسه‌های این نما برای ارزیابی عملکرد استفاده نکنید.':'حالت آزمایشی فقط برای بررسی نمودارهاست.';
}
function exitDemo(){
  if(!state.demo) return;
  state.demo=false;
  Object.assign(state,state.realFilters);
  state.realFilters=null;
  fillDashboardFilters();
  render();
}
async function toggleDemo(){
  if(state.tab!=='dash'||!['admin','management'].includes(state.role)) return;
  $('#demoMsg').textContent='';
  if(state.demo){ exitDemo(); return; }
  const scope=state.demoScope, role=state.role, btn=$('#btnDemo');
  btn.disabled=true;
  try{
    let data=state.demoData;
    if(!data){
      const [base,projectLoad]=await Promise.all([rpc('kpi_demo_dashboard'),rpc('kpi_project_load',{p_demo:true}).catch(()=>null)]);
      data={...base,projectLoad};
    }
    if(!session||scope!==state.demoScope||role!==state.role||state.tab!=='dash') return;
    state.realFilters={month:state.month,dept:state.dept,person:state.person};
    state.demoData=data;
    state.demo=true;
    state.month=140505;
    fillDashboardFilters();
    render();
  }catch(e){
    if(state.demo) exitDemo();
    if(scope===state.demoScope) $('#demoMsg').textContent='داده‌های آزمایشی بارگذاری نشدند. دوباره تلاش کنید.';
  }finally{ btn.disabled=false; }
}

function filtered(useMonth=true){
  const y=Math.floor(state.month/100), m=state.month%100;
  return dashboardData().logs.filter(l=>
    (!useMonth || (l.period_year===y && l.period_month===m)) &&
    (!state.dept || (l.employee && l.employee.department.name_fa===state.dept)) &&
    (!state.person || (l.employee && String(l.employee.id)===state.person)));
}
function roster(){ // تعداد افراد فعال (با اعمال فیلتر دپارتمان/نفر)
  return dashboardData().personnel.filter(p=>p.active &&
    (!state.dept || p.department.name_fa===state.dept) &&
    (!state.person || String(p.id)===state.person));
}

/* ================= نمودارهای خوانا (HTML + SVG سفارشی) ================= */
function emptyBox(msg){ return `<div class="empty">${esc(msg)}</div>`; }

/* نوار افقی RTL — اعداد همیشه در جلو (بیرونِ سرِ) میله؛ تعداد فعالیت در کنار نفرساعت */
function hbar(data, opt={}){
  if(!data.length) return emptyBox('داده‌ای برای نمایش نیست');
  const max=Math.max(...data.map(d=>Number(d.v)||0),1);
  const labelW=opt.labelW||200;
  const unit=opt.unit||'';
  const withCount=opt.count!==false&&data.some(d=>d.n!=null);
  let s=`<div class="hbar-list${withCount?' has-count':''}" style="--hbar-label-w:${labelW}px">`;
  data.forEach((d,i)=>{
    const val=Math.max(0, Number(d.v)||0);
    const ratio=max>0 ? Math.min(1, val/max) : 0;
    const c=d.c||COLORS[i%COLORS.length];
    const cnt=d.n==null?null:Number(d.n)||0;
    const titleTxt=(d.sub ? `${d.t} — ${d.sub}: ` : `${d.t}: `)+`${fmt(val)}${unit}${cnt!=null?' · '+actLabel(cnt):''}`;
    const barStyle=val>0
      ? `width:calc((100% - var(--hbar-val-reserve, 104px)) * ${ratio.toFixed(4)});min-width:6px;background:${c}`
      : `width:0;min-width:0;background:${c}`;
    s+=`<div class="hbar-row" title="${esc(titleTxt)}">`+
         `<div class="hbar-label">`+
           `<div class="hbar-title">${esc(d.t)}</div>`+
           (d.sub ? `<div class="hbar-sub">${esc(d.sub)}</div>` : '')+
         `</div>`+
         `<div class="hbar-track">`+
           `<div class="hbar-fill" style="${barStyle}"></div>`+
           `<span class="hbar-val">${fmt(val)}${esc(unit)}</span>`+
           (cnt!=null ? `<span class="hbar-count">${actLabel(cnt)}</span>` : '')+
         `</div>`+
       `</div>`;
  });
  return s+'</div>';
}
function trunc(s,n){ s=String(s??''); return s.length>n? s.slice(0,n-1)+'…':s; }

/* نوار عمودی (روند ماهانه) — با تعداد فعالیت زیر هر ماه */
function vbar(data, opt={}){
  if(!data.length) return emptyBox('داده‌ای برای نمایش نیست');
  const hasCount=data.some(d=>d.n!=null);
  const W=opt.w||560, H=hasCount?266:248, padL=60, padR=14, padT=30, padB=hasCount?64:46;
  const max=Math.max(...data.map(d=>d.v),1);
  const bw=Math.min(58,(W-padL-padR)/data.length-14);
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="direction:ltr">`;
  for(let g=0; g<=4; g++){
    const y=padT+(H-padT-padB)*g/4, val=max*(4-g)/4;
    s+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="${g===4?'':'3 3'}"/>`;
    s+=`<text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="10.5" fill="#475569">${fmt(val)}</text>`;
  }
  s+=`<text x="${padL}" y="12" text-anchor="start" font-size="10.5" fill="#64748b">نفرساعت</text>`;
  if(hasCount) s+=`<text x="${W-padR}" y="12" text-anchor="end" direction="rtl" font-size="10.5" fill="#64748b">تعداد فعالیت زیر هر ستون</text>`;
  const step=(W-padL-padR)/data.length;
  data.forEach((d,i)=>{
    const h=(H-padT-padB)*d.v/max, x=padL+step*i+(step-bw)/2, y=H-padB-h;
    s+=`<g><title>${esc(d.t)}${d.t2?' '+esc(d.t2):''}: ${fmt(d.v)} نفرساعت${d.n!=null?' · '+fmt(d.n)+' فعالیت':''}</title>`;
    s+=`<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h,2)}" rx="6" fill="${d.c||'#1d5bd8'}"/>`;
    s+=`<text x="${x+bw/2}" y="${y-7}" text-anchor="middle" font-size="11" font-weight="700" fill="#0f172a">${fmt(d.v)}</text>`;
    s+=`<text x="${x+bw/2}" y="${H-padB+17}" text-anchor="middle" direction="rtl" font-size="11.5" font-weight="700" fill="#334155">${esc(d.t)}</text>`;
    if(d.t2) s+=`<text x="${x+bw/2}" y="${H-padB+32}" text-anchor="middle" direction="rtl" font-size="10" fill="#64748b">${esc(d.t2)}</text>`;
    if(d.n!=null) s+=`<text x="${x+bw/2}" y="${H-8}" text-anchor="middle" direction="rtl" font-size="10.5" font-weight="700" fill="#1d5bd8">${fmt(d.n)} فعالیت</text>`;
    s+=`</g>`;
  });
  return s+'</svg>';
}

/* دایره‌ای (دونات) — حلقه SVG تمیز + راهنمای خوانای RTL */
function donut(data, opt={}){
  const total=data.reduce((a,d)=>a+d.v,0);
  if(!total) return emptyBox('داده‌ای برای نمایش نیست');
  const S=180, cx=90, cy=90, r=68, ir=45;
  const palette=opt.colors||COLORS;
  let a0=-Math.PI/2;
  let svg=`<svg class="donut-ring" viewBox="0 0 ${S} ${S}" style="direction:ltr">`;
  const nonZero=data.filter(d=>d.v>0);
  data.forEach((d,i)=>{
    if(d.v<=0) return;
    const c=palette[i%palette.length];
    const frac=d.v/total;
    if(frac>=0.9999 || nonZero.length===1){
      const rm=(r+ir)/2;
      svg+=`<circle cx="${cx}" cy="${cy}" r="${rm}" fill="none" stroke="${c}" stroke-width="${r-ir}"><title>${esc(d.t)}: ${fmt(d.v)} · ${actLabel(d.n||0)}</title></circle>`;
    } else {
      const a1=a0+frac*Math.PI*2;
      const large=(a1-a0)>Math.PI?1:0;
      const p=(ang,rad)=>[cx+rad*Math.cos(ang), cy+rad*Math.sin(ang)];
      const [x0,y0]=p(a0,r),[x1,y1]=p(a1,r),[x2,y2]=p(a1,ir),[x3,y3]=p(a0,ir);
      svg+=`<path d="M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${ir} ${ir} 0 ${large} 0 ${x3} ${y3} Z" fill="${c}" stroke="#ffffff" stroke-width="2"><title>${esc(d.t)}: ${fmt(d.v)} · ${actLabel(d.n||0)}</title></path>`;
      a0=a1;
    }
  });
  const centerTxt=opt.center!==undefined ? fmt(opt.center)+(opt.centerSuffix||'') : fmt(total);
  svg+=`<text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="22" font-weight="700" fill="#0f172a">${esc(centerTxt)}</text>`;
  if(opt.centerLabel){
    svg+=`<text x="${cx}" y="${cy+18}" text-anchor="middle" direction="rtl" font-size="11" fill="#475569">${esc(opt.centerLabel)}</text>`;
  }
  svg+='</svg>';

  let legend='<div class="donut-legend">';
  data.forEach((d,i)=>{
    const c=palette[i%palette.length];
    const pct=total>0 ? Math.round((d.v/total)*100) : 0;
    const unit=opt.unit||'';
    legend+=`<div class="donut-item">`+
      `<span class="donut-item-lbl"><span class="donut-dot" style="background:${c}"></span><span class="donut-name">${esc(d.t)}</span></span>`+
      `<span class="donut-meta"><b>${fmt(d.v)}${esc(unit)}</b> (${pct}%)`+
        (d.n!=null?`<small class="donut-count">${actLabel(d.n)}</small>`:'')+
      `</span>`+
    `</div>`;
  });
  legend+='</div>';
  return `<div class="donut-wrap">${svg}${legend}</div>`;
}

/* حبابی Value-Effort */
function bubbles(pts){
  if(!pts.length) return emptyBox('داده‌ای برای نمایش نیست');
  const W=520,H=300,padL=46,padR=18,padT=26,padB=44;
  const maxX=7.5,minX=.5,maxY=10.5,minY=.5;
  const maxH=Math.max(...pts.map(p=>p.h),1);
  const X=v=>padL+(W-padL-padR)*(v-minX)/(maxX-minX);
  const Y=v=>H-padB-(H-padT-padB)*(v-minY)/(maxY-minY);
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="direction:ltr">`;
  for(let g=1;g<=7;g++){
    s+=`<line x1="${X(g)}" y1="${padT}" x2="${X(g)}" y2="${H-padB}" stroke="#e2e8f0" stroke-opacity=".75"/>`;
    s+=`<text x="${X(g)}" y="${H-padB+16}" text-anchor="middle" font-size="10.5" fill="#475569">${g}</text>`;
  }
  for(let g=1;g<=10;g++){
    s+=`<line x1="${padL}" y1="${Y(g)}" x2="${W-padR}" y2="${Y(g)}" stroke="#e2e8f0" stroke-opacity=".75"/>`;
    s+=`<text x="${padL-9}" y="${Y(g)+4}" text-anchor="end" font-size="10.5" fill="#475569">${g}</text>`;
  }
  s+=`<line x1="${X(4.5)}" y1="${padT}" x2="${X(4.5)}" y2="${H-padB}" stroke="#94a3b8" stroke-dasharray="4 4"/>`;
  s+=`<line x1="${padL}" y1="${Y(5.5)}" x2="${W-padR}" y2="${Y(5.5)}" stroke="#94a3b8" stroke-dasharray="4 4"/>`;
  pts.forEach((p,i)=>{
    const rad=8+22*Math.sqrt(p.h/maxH);
    const col=COLORS[i%COLORS.length];
    s+=`<g><title>${esc(p.t)}: ${fmt(p.h)} ساعت · ${actLabel(p.n||0)} (ارزش ${p.x} · تلاش ${p.y})</title>`;
    s+=`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${rad}" fill="${col}" fill-opacity=".68" stroke="#ffffff" stroke-width="1.5"/>`;
    s+=`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${rad}" fill="none" stroke="${col}" stroke-width="1.2"/>`;
    if(p.h>=maxH*0.08) s+=`<text x="${X(p.x)}" y="${Y(p.y)+3.5}" text-anchor="middle" font-size="9.5" fill="#fff" font-weight="700" style="text-shadow:0 1px 2px rgba(15,23,42,.55)">${fmt(p.h)}</text>`;
    s+=`</g>`;
  });
  s+=`<text x="${(padL+W-padR)/2}" y="${H-6}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#334155">Value Score (ارزش) →</text>`;
  s+=`<text x="${padL}" y="14" text-anchor="start" font-size="11.5" font-weight="700" fill="#334155">↑ Effort (تلاش)</text>`;
  return s+'</svg>';
}

/* ================= رندر داشبورد ================= */
function render(){
  updateDemoUi();
  updateScopeNote();
  const data=dashboardData();
  const logs=filtered(true);
  const allMonth=filtered(false);         // برای روند (همه ماه‌ها با فیلتر نفر/دپارتمان)
  const y=Math.floor(state.month/100), m=state.month%100;

  // ---- KPI ----
  const {hours,count:events}=tally(logs);
  const docs=logs.reduce((a,l)=>a+Number(l.doc_count),0);
  const people=new Set(logs.map(l=>l.employee&&l.employee.id)).size;
  // ماه قبل
  let py=y, pm=m-1; if(pm<1){pm=12;py=y-1;}
  const prev=tally(allMonth.filter(l=>l.period_year===py&&l.period_month===pm));
  const prevH=prev.hours;
  const mom=prevH? (hours-prevH)/prevH*100 : null;
  const rk=roster();
  const eligible=new Set(rk.map(p=>p.id));
  const subm=data.submissions.filter(s=>s.period_year===y&&s.period_month===m&&s.status==='submitted')
              .filter(s=>eligible.has(s.employee_id));
  const subPct=rk.length? Math.round(subm.length/rk.length*100):0;

  $('#kpiHours').textContent=fmt(hours);
  $('#kpiHoursC').textContent=actLabel(events);
  $('#kpiHoursD').innerHTML= prevH? `<span class="${mom>=0?'up':'down'}">${mom>=0?'▲':'▼'} ${fmt(Math.abs(mom))}%</span> <span style="color:var(--muted)">ماه قبل: ${fmt(prevH)} نفرساعت · ${actLabel(prev.count)}</span>` : '<span style="color:var(--muted)">ماه قبل: —</span>';
  $('#kpiMom').textContent= mom===null? '—' : (mom>=0?'+':'')+fmt(mom)+'%';
  $('#kpiMom').style.color= mom===null? '' : (mom>=0?'#059669':'#dc2626');
  $('#kpiMomD').textContent= mom===null? 'ماه قبل داده‌ای ندارد' : `${FA_MONTHS[pm-1]} ${py}${state.demo?' ('+demoPeriodLabel(py*100+pm)+')':''}: ${fmt(prevH)} نفرساعت · ${actLabel(prev.count)}`;
  $('#kpiPeople').textContent=fmt(people);
  $('#kpiPeopleD').textContent=`از ${rk.length} نفر کل دپارتمان(ها) · ${actLabel(events)} در این ماه`;
  $('#kpiDocs').textContent=fmt(docs);
  $('#kpiDocsD').textContent=`میانگین ${people? fmt(hours/people):'—'} ساعت به ازای هر نفر فعال · ${fmt(events?hours/events:0)} ساعت/فعالیت`;
  $('#kpiSub').textContent=subPct+'%';
  $('#kpiSubD').textContent=`${subm.length} از ${rk.length} نفر گزارش داده‌اند`;

  // ---- روند ماهانه ----
  const byM={};
  allMonth.forEach(l=>{const k=l.period_year*100+l.period_month; if(!byM[k]) byM[k]={hours:0,count:0}; byM[k].hours+=Number(l.hours)||0; byM[k].count+=countOf(l);});
  const trend=(state.demo?DEMO_MONTHS:Object.keys(byM).sort().map(Number)).map(k=>({t:FA_MONTHS[k%100-1], t2:state.demo?demoPeriodLabel(k):Math.floor(k/100),
    v:(byM[k]||{}).hours||0, n:(byM[k]||{}).count||0, c:state.demo&&k!==140506?(k===state.month?'#ac5d06':'#cf8b35'):(k===state.month||state.demo?'#1d5bd8':'#9db8ec')}));
  $('#chTrend').innerHTML=vbar(trend);

  // ---- گزارش‌دهی ----
  const submitted=subm.length, missing=Math.max(rk.length-subm.length,0);
  $('#chSub').innerHTML=donut([
      {t:'گزارش داده‌اند', v:submitted},
      {t:'گزارش نداده‌اند', v:missing},
    ], {center:subPct, centerSuffix:'%', centerLabel:'درصد گزارش‌دهی', colors:['#10b981','#f43f5e'], unit:' نفر'});

  // ---- دپارتمان‌ها ----
  const deptAgg={};
  logs.forEach(l=>{
    const d=l.employee? l.employee.department.name_fa:'—';
    if(!deptAgg[d]) deptAgg[d]={hours:0,count:0};
    deptAgg[d].hours+=Number(l.hours)||0; deptAgg[d].count+=countOf(l);
  });
  const deptData=Object.entries(deptAgg).sort((a,b)=>b[1].hours-a[1].hours).map(([d,a])=>{
    const head=data.personnel.filter(p=>p.active&&p.department.name_fa===d).length;
    return {t:d, v:a.hours, n:a.count, sub:`${faN(percent(a.hours,hours))}٪ از کل · ظرفیت ${fmt(head*180)} ساعت · ${head} نفر`};
  });
  $('#chDept').innerHTML=hbar(deptData,{unit:' ساعت', labelW:240, rowH:38});

  // ---- Value-Effort ----
  const veAgg={};
  logs.forEach(l=>{ if(!l.activity) return;
    const deptId=l.employee?.department?.id||'',deptName=l.employee?.department?.name_fa||'';
    const k=[l.activity_id||l.activity.id,l.activity.general_fa,l.activity.specific_title||'',deptId,l.activity.effort_score,l.activity.value_score].join('||');
    if(!veAgg[k]) veAgg[k]={x:Number(l.activity.value_score), y:Number(l.activity.effort_score),
      h:0, n:0, t:(l.activity.specific_title||l.activity.general_fa)+(['admin','management'].includes(state.role)&&deptName?` · ${deptName}`:'')};
    veAgg[k].h+=Number(l.hours); veAgg[k].n+=countOf(l);
  });
  $('#chVE').innerHTML=bubbles(Object.values(veAgg));
  const groups=renderPriorities(Object.values(veAgg),hours);
  const portfolio=portfolioForScope(); renderPortfolio(portfolio);

  // ---- فعالیت‌ها ----
  const actAgg={};
  logs.forEach(l=>{ if(!l.activity) return;
    const k=(l.activity.specific_title||l.activity.general_fa);
    if(!actAgg[k]) actAgg[k]={hours:0,count:0};
    actAgg[k].hours+=Number(l.hours)||0; actAgg[k].count+=countOf(l);
  });
  const actRows=Object.entries(actAgg).sort((a,b)=>b[1].hours-a[1].hours).slice(0,12)
    .map(([t,a])=>({t,v:a.hours,n:a.count}));
  $('#chAct').innerHTML=hbar(actRows, {unit:' ساعت', rowH:34});

  // ---- ذینفعان ----
  const stkAgg={};
  logs.forEach(l=>{ const k=l.stakeholder? l.stakeholder.name_fa:'(بدون ذینفع)';
    if(!stkAgg[k]) stkAgg[k]={hours:0,count:0};
    stkAgg[k].hours+=Number(l.hours)||0; stkAgg[k].count+=countOf(l); });
  const stkRows=Object.entries(stkAgg).sort((a,b)=>b[1].hours-a[1].hours).slice(0,12)
    .map(([t,a])=>({t,v:a.hours,n:a.count}));
  $('#chStk').innerHTML=hbar(stkRows, {unit:' ساعت', rowH:34, labelW:250});

  // ---- منابع ----
  const srcAgg={};
  logs.forEach(l=>{ const k=SRC_FA[l.source]||l.source;
    if(!srcAgg[k]) srcAgg[k]={hours:0,count:0};
    srcAgg[k].hours+=Number(l.hours)||0; srcAgg[k].count+=countOf(l); });
  $('#chSrc').innerHTML=donut(Object.entries(srcAgg).sort((a,b)=>b[1].hours-a[1].hours)
    .map(([t,a])=>({t,v:a.hours,n:a.count})),
    {center:fmt(hours), centerLabel:actLabel(events)});

  printMetrics={hours,events,prevH,prevCount:prev.count,docs,people,mom,submitted,
    eligible:rk.length,subPct,deptData,groups,portfolio,ve:Object.values(veAgg),act:actRows,stk:stkRows};

  if(['admin','head'].includes(state.role)&&!state.demo) renderTable(logs);
  if(state.role==='admin') renderMyRows();
}

const QUADRANTS=[
  {t:'ارزش بالا · تلاش پایین',action:'گزینهٔ اول برای تسریع یا گسترش',match:(v,e)=>v>=5&&e<=5},
  {t:'ارزش بالا · تلاش بالا',action:'برای ظرفیت و گلوگاه‌ها برنامه‌ریزی شود',match:(v,e)=>v>=5&&e>=6},
  {t:'ارزش پایین · تلاش بالا',action:'نامزد ساده‌سازی یا بازبینی فرایند',match:(v,e)=>v<=4&&e>=6},
  {t:'ارزش پایین · تلاش پایین',action:'استانداردسازی یا تجمیع بررسی شود',match:(v,e)=>v<=4&&e<=5},
];
const percent=(a,b)=>b>0?100*a/b:0;
const sumHours=rows=>rows.reduce((sum,r)=>sum+Number(r.hours),0);
const descending=m=>[...m.values()].sort((a,b)=>b.hours-a.hours||a.name.localeCompare(b.name,'fa'));
const faNum=new Intl.NumberFormat('fa-IR',{maximumFractionDigits:2});
const faN=n=>faNum.format(n);
const asciiDigits=s=>s.replace(/[۰-۹٠-٩]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.includes(c)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(c):'٠١٢٣٤٥٦٧٨٩'.indexOf(c)));

/* ================= شمارش فعالیت‌ها در کنار نفرساعت ================= */
/* هر ردیف گزارش (activity_log) یک فعالیت ثبت‌شده است؛ ردیف‌های خام جدول ادمین هر رویداد را جدا دارند. */
const isEventRow=l=>l.event_count!=null;
const countOf=r=>isEventRow(r)?Number(r.event_count)||0:1;
function tally(rows){
  let hours=0,count=0;
  for(const r of rows){ hours+=Number(r.hours)||0; count+=countOf(r); }
  return {hours,count};
}
/* متن کنار نفرساعت: «۸۴ فعالیت» */
const actLabel=n=>`${faN(n)} فعالیت`;

function renderPriorities(items,hours){
  const groups=QUADRANTS.map(q=>{
    const group=items.filter(p=>p.x>=1&&p.x<=7&&p.y>=1&&p.y<=10&&q.match(p.x,p.y)).sort((a,b)=>b.h-a.h);
    return {...q,count:group.length,hours:group.reduce((s,p)=>s+p.h,0),
      events:group.reduce((s,p)=>s+(p.n||0),0),leading:group.find(p=>p.h>0)?.t};
  });
  $('#priorityGrid').innerHTML=groups.map(q=>`<div class="priority-tile"><strong>${esc(q.t)}</strong><div class="measure">${faN(q.hours)} ساعت · ${faN(percent(q.hours,hours))}٪</div><div class="measure-count">${faN(q.events)} فعالیت · ${faN(q.count)} گروه فعالیت</div><small>${esc(q.action)}</small>${q.leading?`<small>بیشترین بار: ${esc(q.leading)}</small>`:''}</div>`).join('');
  return groups;
}

function portfolioForScope(){
  const items=dashboardData().projectLoad;
  if(!Array.isArray(items)) return null;
  const rows=items.filter(x=>x.period_year*100+x.period_month===state.month&&(!state.dept||x.department===state.dept)&&(!state.person||String(x.employee_id)===state.person));
  const project=new Map(),stakeholder=new Map();
  const add=(map,id,name,dept,h,code)=>{
    if(!map.has(id)) map.set(id,{id,name,hours:0,events:0,units:new Map(),code});
    const a=map.get(id);a.hours+=h;a.events+=1;a.units.set(dept,(a.units.get(dept)||0)+h);
  };
  let unassigned=0, unassignedStake=0;
  for(const r of rows){
    const h=Number(r.hours); if(r.project_id==null) unassigned+=h;
    if(r.stakeholder_id==null) unassignedStake+=h;
    add(project,r.project_id,r.project||'بدون پروژه',r.department,h,r.project_code);
    add(stakeholder,r.stakeholder_id,r.stakeholder||'بدون ذینفع',r.department,h);
  }
  return {project:descending(project),stakeholder:descending(stakeholder),unassigned,unassignedStake,hours:sumHours(rows),events:rows.length};
}
function renderPortfolio(p=portfolioForScope()){
  if(!p){ $('#portfolioSummary').textContent='';$('#portfolioTable').innerHTML=emptyBox('تحلیل بار کاری فعلاً در دسترس نیست.');return; }
  const project=$('#portfolioBy').value==='project',unassigned=project?p.unassigned:p.unassignedStake;
  $('#portfolioSummary').innerHTML=`<span>کل بار: <b>${faN(p.hours)}</b> ساعت · <b>${actLabel(p.events)}</b></span><span>${project?'بدون پروژه':'بدون ذینفع'}: <b>${faN(unassigned)}</b> ساعت (${faN(percent(unassigned,p.hours))}٪)</span><span>نمایش حداکثر ۱۰ مورد بر اساس نفرساعت</span>`;
  const rows=(project?p.project:p.stakeholder).slice(0,10);
  if(!rows.length){$('#portfolioTable').innerHTML=emptyBox('در این محدوده داده‌ای ثبت نشده است.');return;}
  const seg=r=>[...r.units.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([d,h])=>`${esc(d)}: ${faN(h)}`).join('، ');
  $('#portfolioTable').innerHTML=`<table><thead><tr><th>${project?'پروژه':'ذینفع'}</th><th>نفرساعت</th><th>تعداد فعالیت</th><th>سهم از کل</th><th>واحدهای دارای بیشترین بار (تا ۳ واحد)</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}${r.code?` <span class="hint" dir="auto">(${esc(r.code)})</span>`:''}</td><td>${faN(r.hours)}</td><td>${faN(r.events)}</td><td>${faN(percent(r.hours,p.hours))}٪</td><td>${seg(r)}</td></tr>`).join('')}</tbody></table>`;
}

let printMetrics=null;
function printReport(){
  if(!['admin','management','head'].includes(state.role)||state.tab!=='dash'||!printMetrics) return;
  const {hours,events,prevH,prevCount,docs,people,mom,submitted,eligible,subPct,deptData,groups,portfolio,ve,act,stk}=printMetrics;
  const p=$('#printReport');
  const noData=!filtered(true).length;
  const person=state.person?dashboardData().personnel.find(x=>String(x.id)===state.person)?.name_en:null;
  const source=state.demo?(state.month===140506?'شهریور واقعی در نمای آزمایشی؛ مقایسهٔ رشد با مرداد ساختگی است.':'دادهٔ ماه انتخابی ساختگی است؛ برای ارزیابی افراد استفاده نشود.'):'داده‌های واقعی';
  const months=$('#fMonth').selectedOptions[0]?.textContent||'—';
  const scopeTxt=state.role==='head'&&Array.isArray(state.deptScope?.departments)?` · محدودهٔ واحد: ${state.deptScope.departments.join('، ')}`:'';
  const pairs=[['نفرساعت',faN(hours)],['تعداد فعالیت',faN(events)],
    ['رشد ماهانه',mom===null?'—':`${faN(mom)}٪`],['افراد دارای فعالیت',faN(people)],
    ['مدرک یا موضوع',faN(docs)],['گزارش‌دهی',eligible?`${faN(subPct)}٪`:'—']];
  const cut=s=>esc(trunc(s,70));
  const list=(rows,name,v,n)=>rows.slice(0,5).map(r=>`<tr><td>${cut(name(r))}</td><td>${faN(v(r))}</td><td>${n?faN(n(r)):'—'}</td></tr>`).join('');
  const table=(title,rows)=>`<section><h2>${title}</h2>${rows?`<table><thead><tr><th>عنوان</th><th>نفرساعت</th><th>تعداد فعالیت</th></tr></thead><tbody>${rows}</tbody></table>`:'<p>داده‌ای برای نمایش نیست.</p>'}</section>`;
  const summary=[];
  if(eligible&&submitted<eligible) summary.push(`${faN(eligible-submitted)} نفر از فهرست فعال در این محدوده گزارش نهایی ندارند.`);
  if(portfolio?.unassigned>0) summary.push(`${faN(portfolio.unassigned)} نفرساعت بدون پروژهٔ مشخص ثبت شده است (${faN(percent(portfolio.unassigned,portfolio.hours))}٪).`);
  const leadingStake=portfolio?.stakeholder.find(r=>r.id!=null&&r.hours>0);
  if(leadingStake) summary.push(`ذینفع با بیشترین بار: ${trunc(leadingStake.name,70)}، ${faN(leadingStake.hours)} نفرساعت در ${actLabel(leadingStake.events)}.`);
  if(groups[2].hours>0) summary.push(`${faN(groups[2].hours)} نفرساعت و ${faN(groups[2].events)} فعالیت در گروه «ارزش پایین، تلاش بالا» است؛ برای بازبینی فرایند بررسی شود.`);
  if(!summary.length) summary.push(noData?'در محدودهٔ انتخابی فعالیتی برای تحلیل وجود ندارد.':'بر اساس شاخص‌های این خلاصه، مورد خاصی برای پیگیری علامت نخورده است.');
  p.innerHTML=`<header><h1>گزارش مدیریتی عملکرد معاونت مهندسی</h1><p class="print-meta">دوره: ${esc(months)} · واحد: ${esc(state.dept||'همه')} · کارشناس: ${esc(person||'همه')}${esc(scopeTxt)}</p><p class="print-meta">نوع داده: ${esc(source)} · تاریخ تهیه: ${esc(new Intl.DateTimeFormat('fa-IR-u-ca-persian').format(new Date()))}</p></header>`+
    (state.demo?'<p class="print-alert">نمای آزمایشی — این گزارش مبنای ارزیابی عملکرد نیست.</p>':'')+
    `<section class="print-kpis">${pairs.map(([k,v])=>`<div><strong>${esc(v)}</strong>${esc(k)}</div>`).join('')}</section>`+
    (prevH?`<p class="print-meta">ماه قبل: ${faN(prevH)} نفرساعت · ${actLabel(prevCount)}</p>`:'')+
    `<section><h2>اولویت ارزش و تلاش</h2><ul>${groups.map(q=>`<li>${esc(q.t)}: ${faN(q.hours)} نفرساعت · ${actLabel(q.events)} (${faN(percent(q.hours,hours))}٪)</li>`).join('')}</ul></section>`+
    `<div class="print-grid">${table('واحدهای دارای بیشترین بار',list(deptData,r=>r.t,r=>r.v,r=>r.n))}${table('پروژه‌های دارای بیشترین بار',list((portfolio?.project||[]).filter(r=>r.id!=null),r=>r.name,r=>r.hours,r=>r.events))}</div>`+
    `<div class="print-grid">${table('فعالیت‌های دارای بیشترین نفرساعت',list(act,r=>r.t,r=>r.v,r=>r.n))}${table('ذینفعان دارای بیشترین نفرساعت',list(stk,r=>r.t,r=>r.v,r=>r.n))}</div>`+
    `<section><h2>موارد قابل پیگیری</h2><ul>${summary.map(t=>`<li>• ${esc(t)}</li>`).join('')}</ul></section><small>گزارش‌های نهایی: ${faN(submitted)} از ${faN(eligible)} نفر فعال.${state.role==='admin'&&!state.demo?' نمای ادمین ممکن است شامل پیش‌نویس‌ها باشد.':''} نفرساعت، حجم کار ثبت‌شده است و به‌تنهایی معیار کیفیت نیست؛ تعداد فعالیت در کنار آن، حجم رخدادهای ثبت‌شده را نشان می‌دهد.</small>`;
  p.dataset.ready='true';
  window.print();
}

/* ================= جدول ================= */
function renderTable(logs){
  const rows=logs.slice(0,300);
  if(!rows.length){ $('#tblWrap').innerHTML=emptyBox('رکوردی با این فیلترها یافت نشد'); return; }
  const readOnly=state.role!=='admin';
  let h=`<table><tr><th>#</th><th>کارشناس</th><th>دپارتمان</th><th>ماه</th><th>منبع</th><th>فعالیت</th>`+
        `<th>ذینفع</th><th>نفرساعت</th><th>تعداد</th>${readOnly?'':'<th>تاریخ نامه</th><th>توضیح کنترل کیفیت</th>'}</tr>`;
  rows.forEach((l,i)=>{
    h+=`<tr><td>${i+1}</td><td>${esc(l.employee? l.employee.name_en:'—')}</td>`+
       `<td>${esc(l.employee? l.employee.department.name_fa:'—')}</td>`+
       `<td>${FA_MONTHS[l.period_month-1]} ${l.period_year}</td>`+
       `<td>${esc(SRC_FA[l.source]||l.source)}</td>`+
       `<td>${esc(l.activity? (l.activity.specific_title||l.activity.general_fa):'—')}</td>`+
       `<td>${esc(l.stakeholder? l.stakeholder.name_fa:'—')}</td>`+
       `<td><b>${fmt(l.hours)}</b></td><td>${fmt(l.doc_count)}</td>`+
       (readOnly?'':`<td class="ltr">${esc(l.letter_date||'—')}</td><td class="quality-note">${esc(l.quality_reason||'—')}</td>`)+`</tr>`;
  });
  const t=tally(logs);
  h+=`</table><div class="tbl-total"><span>جمع این فیلتر: <b>${faN(t.hours)}</b> نفرساعت · <b>${actLabel(t.count)}</b></span>`+
     `<span>نمایش ${faN(rows.length)} از ${faN(logs.length)} ردیف</span></div>`;
  $('#tblWrap').innerHTML=h;
}

/* ================= فرم ورود ================= */
function sourceActivities(src){
  const g=a=>a.general_fa, s=a=>a.specific_title;
  const rules={
    pargar:a=>g(a)==='طراحی پایه'||['WPS-PQR','QCP-ITP'].includes(g(a)),
    pmis:a=>g(a)==='طراحی پایه'||['WPS-PQR','QCP-ITP'].includes(g(a)),
    inquiry:a=>g(a)==='استعلام مهندسی',
    meeting_mission_committee:a=>['جلسات','کمیته ها','مأموریت'].includes(g(a)),
    procedure:a=>g(a)==='تهیه دستورالعمل',
    gis:a=>['بررسی فنی','آماده','تهیه بانک','پاسخگویی به استعلامات حریم','تهیه نقشه'].some(k=>g(a).includes(k)),
    other:a=>g(a)==='سایر',
  };
  return state.activities.filter(rules[src]||(()=>true));
}
function refreshActivities(){
  const src=$('#eSource').value;
  const list=sourceActivities(src);
  fillSelect('#eActivity', list.map(a=>({v:String(a.id),
    t:(a.specific_title? `${a.general_fa} — ${a.specific_title}` : a.general_fa)})), list.length?String(list[0].id):'');
  updateHint();
}
function currentActivity(){ return state.activities.find(a=>String(a.id)===$('#eActivity').value); }
function activityEffort(a){
  if(state.role==='admin'){
    const person=state.personnel.find(p=>String(p.id)===$('#ePerson').value),deptId=person?.department?.id;
    const score=state.activityScoreMap.find(x=>Number(x.activity_id)===Number(a.id)&&Number(x.department_id)===Number(deptId));
    if(score) return score.effort_score;
  }
  return a.effort_score;
}
function updateHint(){
  const a=currentActivity(); if(!a) { $('#eHint').textContent='—'; return; }
  let t=`💡 Effort: ${activityEffort(a)} · Value: ${a.value_score}`;
  if(a.avg_hours_doc) t+=` · میانگین ${a.avg_hours_doc} ساعت/مدرک`;
  if(a.avg_hours_doc && Number($('#eDocs').value)>0) t+=` → پیشنهاد ${fmt(Number($('#eDocs').value)*Number(a.avg_hours_doc))} نفرساعت`;
  $('#eHint').textContent=t;
}
function applySuggestedHours(){
  const a=currentActivity();
  if(a && a.avg_hours_doc && Number($('#eDocs').value)>0)
    $('#eHours').value=fmt(Number($('#eDocs').value)*Number(a.avg_hours_doc)).replace(/,/g,'');
}

/* تبدیل شمسی → میلادی (الگوریتم نجفی) */
function j2g_exact(Jy,Jm,Jd){
  const jy=Jy+1595;
  let days=-355668+365*jy+Math.floor(jy/33)*8+Math.floor(((jy%33)+3)/4)+Jd;
  days+= Jm<7? (Jm-1)*31 : (Jm-7)*30+186;
  let gy=400*Math.floor(days/146097); days%=146097;
  if(days>36524){ days--; gy+=100*Math.floor(days/36524); days%=36524; if(days>=365)days++; }
  gy+=4*Math.floor(days/1461); days%=1461;
  if(days>365){ gy+=Math.floor((days-1)/365); days=(days-1)%365; }
  let gd=days+1;
  const leap=(gy%4===0&&gy%100!==0)||gy%400===0;
  const mo=[0,31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  let gm=0;
  for(let i=1;i<13;i++){ if(gd<=mo[i]){gm=i;break;} gd-=mo[i]; }
  return `${String(gy).padStart(4,'0')}-${String(gm).padStart(2,'0')}-${String(gd).padStart(2,'0')}`;
}

let editing=null, reportBusy=false;
const formFields=['#eSource','#eActivity','#eStake','#eProject','#eHours','#eDocs','#eDay','#eMon','#eYearD','#eNotes'];
function reportPeriod(){ return {p_employee:Number($('#ePerson').value)||null,p_year:Number($('#eYear').value),p_month:Number($('#eMonth').value)}; }
function clearEntry(){
  editing=null;
  for(const s of ['#eHours','#eDocs','#eDay','#eMon','#eYearD','#eNotes','#eStake','#eProject']) $(s).value='';
  $('#eSource').value='pargar'; refreshActivities();
}
function reportMsg(text,error=false){ const el=$('#eMsg'); el.className='msg '+(error?'err':'ok'); el.textContent=text; }
async function runReport(action, extra, success){
  if(reportBusy) return;
  reportBusy=true; renderMyRows(); reportMsg('');
  try{
    await rpc('kpi_report_action',{p_action:action,...reportPeriod(),...extra});
    clearEntry();
    try{
      await loadAll();
      if(state.role==='admin') render();
      reportMsg(success);
    }catch(e){ reportMsg(success+' برای دریافت وضعیت جدید، صفحه را تازه کنید.',true); }
  }catch(e){ reportMsg(e.message,true); }
  finally{ reportBusy=false; renderMyRows(); }
}
async function submitLog(){
  try{
    const aid=Number($('#eActivity').value), hours=Number($('#eHours').value||0), docs=Number($('#eDocs').value||0);
    if(!reportPeriod().p_employee || !aid) throw new Error('کارشناس و فعالیت را انتخاب کنید.');
    if(!Number.isFinite(hours)||hours<0||!Number.isInteger(docs)||docs<0||(hours===0&&docs===0)) throw new Error('نفرساعت یا تعداد معتبر وارد کنید.');
    const d=+$('#eDay').value, mo=+$('#eMon').value, yy=+$('#eYearD').value;
    if((d||mo||yy)&&(![d,mo,yy].every(Number.isInteger)||d<1||d>31||mo<1||mo>12||yy<1300||yy>1500)) throw new Error('تاریخ نامه را کامل و معتبر وارد کنید.');
    let date=null;
    if(d&&mo&&yy){
      date=j2g_exact(yy,mo,d);
      const [yd,md,dd]=persianParts(date);
      if(yd!==yy||md!==mo||dd!==d) throw new Error('تاریخ نامه معتبر نیست.');
    }
    await reviewAndSave({activity_id:aid,source:$('#eSource').value,
      stakeholder_id:Number($('#eStake').value)||null,project_id:Number($('#eProject').value)||null,
      hours,doc_count:docs,letter_date:date,notes:$('#eNotes').value||null});
  }catch(e){ reportMsg(e.message,true); }
}
const persianDay=new Intl.DateTimeFormat('en-US-u-ca-persian',{timeZone:'UTC',year:'numeric',month:'numeric',day:'numeric'});
function persianParts(iso){
  const parts=persianDay.formatToParts(new Date(iso+'T12:00:00Z'));
  return ['year','month','day'].map(key=>Number(parts.find(p=>p.type===key).value));
}
function editEntry(l){
  clearEntry(); editing=l.id;
  $('#eSource').value=l.source; refreshActivities();
  for(const [sel,list,id] of [['#eActivity',state.activities,l.activity_id],['#eStake',state.stakeholders,l.stakeholder_id],['#eProject',state.projects,l.project_id]]){
    if(id!=null && ![...$(sel).options].some(o=>Number(o.value)===id)){
      const item=list.find(i=>i.id===id);
      $(sel).add(new Option(item?.name_fa||item?.specific_title||item?.general_fa||'گزینهٔ قبلی',id));
    }
    $(sel).value=id??'';
  }
  $('#eHours').value=l.hours; $('#eDocs').value=l.doc_count; $('#eNotes').value=l.notes||'';
  if(l.letter_date){ const [y,m,d]=persianParts(l.letter_date); $('#eDay').value=d; $('#eMon').value=m; $('#eYearD').value=y; }
  updateHint(); renderMyRows(); $('#eHours').focus();
}
function renderMyRows(){
  if(!['admin','expert'].includes(state.role)) return;
  const {p_employee:eid,p_year:y,p_month:m}=reportPeriod();
  const status=state.submissions.find(s=>s.employee_id===eid&&s.period_year===y&&s.period_month===m)?.status;
  const locked=status==='submitted';
  const editable=Boolean(eid)&&!locked&&!reportBusy;
  const rows=state.logs.filter(l=>l.employee?.id===eid&&l.period_year===y&&l.period_month===m);
  $('#reportState').textContent=!eid?'ابتدا کارشناس را انتخاب کنید.':locked?'ارسال نهایی شده؛ گزارش قفل است.':status==='draft'?'پیش‌نویس؛ هنوز ارسال نهایی نشده است.':'هنوز گزارشی برای این ماه ارسال نشده است.';
  for(const s of formFields) $(s).disabled=!editable;
  $('#eYear').disabled=$('#eMonth').disabled=reportBusy;
  $('#ePerson').disabled=state.role==='expert'||reportBusy;
  $('#eSubmit').disabled=!editable;
  $('#eSubmit').textContent=editing?'ذخیرهٔ ویرایش':'ذخیرهٔ فعالیت';
  $('#eCancelEdit').hidden=!editing||locked;
  $('#eCancelEdit').disabled=reportBusy;
  $('#eSubmitMonth').disabled=!editable||!rows.length||editing!==null;
  $('#eReopen').hidden=state.role!=='admin'||!locked;
  $('#eReopen').disabled=reportBusy;
  if(!rows.length){ $('#myRows').innerHTML=emptyBox(eid?'فعالیتی برای این دوره ثبت نشده است.':'کارشناس را انتخاب کنید.'); return; }
  let h='<table><tr><th>منبع</th><th>فعالیت</th><th>ذینفع</th><th>نفرساعت</th><th>تعداد</th><th>تاریخ نامه (میلادی)</th><th></th></tr>';
  rows.forEach((l,i)=>{
    h+=`<tr><td>${esc(SRC_FA[l.source]||l.source)}</td><td>${esc(l.activity?.specific_title||l.activity?.general_fa||'—')}</td><td>${esc(l.stakeholder?.name_fa||'—')}</td><td>${fmt(l.hours)}</td><td>${fmt(l.doc_count)}</td><td class="ltr">${esc(l.letter_date||'—')}</td>`+
      `<td>${editable?`<button class="ghost" data-edit="${i}">ویرایش</button><button class="del" data-delete="${i}">حذف</button>`:''}</td></tr>`;
  });
  const t=tally(rows);
  h+=`</table><div class="row-total">جمع این ماه: <b>${faN(t.hours)}</b> نفرساعت · <b>${actLabel(t.count)}</b> · ${faN(rows.length)} ردیف ثبت‌شده</div>`;
  $('#myRows').innerHTML=h;
  $('#myRows').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editEntry(rows[b.dataset.edit]));
  $('#myRows').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
    if(confirm('این فعالیت حذف شود؟')) runReport('delete',{p_id:rows[b.dataset.delete].id},'فعالیت حذف شد.');
  });
}

/* ================= حساب‌ها و نقش‌ها (ادمین) ================= */
function accMsg(text,error=false){ const el=$('#accMsg'); el.className='msg '+(error?'err':'ok'); el.textContent=text; }
function roleMsgText(text,error=false){ const el=$('#roleMsg'); el.className='msg '+(error?'err':'ok'); el.textContent=text; }
function randomPassword(len=12){
  const abc='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const buf=new Uint32Array(len); (crypto.getRandomValues?crypto.getRandomValues(buf):buf.fill(0));
  let out=''; for(const x of buf){ out+=abc[x%abc.length]; }
  return out;
}
async function loadAccounts(){
  if(state.role!=='admin') return;
  $('#accountsTable').innerHTML=emptyBox('در حال دریافت حساب‌ها…');
  try{
    const rows=await rpc('kpi_accounts');
    if(state.role!=='admin') return;
    renderAccounts(rows);
  }catch(e){ $('#accountsTable').innerHTML=emptyBox('دریافت فهرست حساب‌ها ناموفق بود: '+e.message); }
}
function renderAccounts(rows){
  if(!rows?.length){ $('#accountsTable').innerHTML=emptyBox('حسابی ثبت نشده است.'); return; }
  const now=faN(rows.length);
  $('#accountsTable').innerHTML=`<p class="hint">${now} حساب</p><table><thead><tr><th>نام کاربری</th><th>نقش</th><th>کد پرسنلی</th><th>نام / واحد</th><th>وضعیت ورود</th></tr></thead><tbody>${
    rows.map(r=>`<tr><td class="ltr" dir="auto">${esc(r.username||r.email||'—')}</td><td><span class="catalog-pill${r.role==='none'?' archived':''}">${esc(ROLE_LABEL[r.role]||'بدون نقش')}</span></td><td class="ltr">${esc(r.employee_no||'—')}</td><td dir="auto">${esc([r.name,r.department].filter(Boolean).join(' — ')||'—')}</td><td>${r.active===false?'<span class="catalog-pill archived">کارشناس بایگانی‌شده</span>':r.must_change_password?'<span class="catalog-pill archived">تعویض رمز در ورود اول</span>':'فعال'}</td></tr>`).join('')
  }</tbody></table>`;
}
function parseStaffBulk(text){
  const roles={expert:'expert',head:'head','کارشناس':'expert','رییس':'head','رییس دپارتمان':'head'};
  return String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    const parts=line.split(/[|,;\t]/).map(x=>x.trim());
    const employeeNo=asciiDigits(parts[0]||'').replace(/\D/g,'');
    const key=(parts[1]||'expert').toLowerCase();
    const role=roles[key]||null;
    return {employeeNo,role,error:!employeeNo?'کد پرسنلی وارد نشده':!role?'نقش نامعتبر':''};
  });
}
function renderStaffBulk(rows){
  if(!rows.length){ $('#staffBulkResult').innerHTML=emptyBox('خطی برای نمایش نیست.'); return; }
  $('#staffBulkResult').innerHTML=`<table><thead><tr><th>کد پرسنلی</th><th>نقش</th><th>نام کاربری / رمز اولیه</th><th>نتیجه</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="ltr">${esc(r.employeeNo)}</td><td>${esc(ROLE_LABEL[r.role]||'—')}</td><td class="ltr">${r.ok?esc(r.employeeNo):'—'}</td><td>${r.error?`<span class="catalog-pill archived">${esc(r.error)}</span>`:r.ok?'<span class="catalog-pill">ساخته/به‌روزرسانی شد؛ تغییر رمز اجباری است</span>':'—'}</td></tr>`).join('')}</tbody></table>`;
}
async function createStaffAccounts(e){
  e.preventDefault();
  if(state.role!=='admin') return;
  const msg=$('#staffBulkMsg'), btn=$('#staffBulkCreate'), rows=parseStaffBulk($('#staffBulkList').value);
  if(!rows.length){msg.className='msg err';msg.textContent='فهرست کدها را وارد کنید.';return;}
  if(rows.some(r=>r.error)){msg.className='msg err';msg.textContent='کد یا نقش نامعتبر است؛ ابتدا خطوط را اصلاح کنید.';renderStaffBulk(rows);return;}
  if(!confirm(`${faN(rows.length)} حساب پرسنلی ساخته یا به‌روزرسانی شود؟`))return;
  btn.disabled=true;msg.className='msg';msg.textContent='در حال پردازش…';
  for(const row of rows){try{await rpc('kpi_provision_employee_account',{p_employee_no:row.employeeNo,p_role:row.role});row.ok=true;}catch(err){row.error=err.message;}}
  const ok=rows.filter(r=>r.ok).length;
  msg.className='msg '+(ok===rows.length?'ok':'err');msg.textContent=`${faN(ok)} از ${faN(rows.length)} حساب آماده شد. رمز اولیه برابر کد پرسنلی است؛ آن را فقط به صاحب حساب تحویل دهید.`;
  renderStaffBulk(rows);btn.disabled=false;loadAccounts();
}
async function createAccount(e){
  e.preventDefault();
  if(state.role!=='admin') return;
  const btn=$('#accCreate'), email=$('#accEmail').value.trim(), password=$('#accPass').value;
  const role=$('#accRole').value, no=asciiDigits($('#accEmployee').value).trim();
  if(password.length<8){ accMsg('رمز عبور باید حداقل ۸ کاراکتر باشد.',true); return; }
  if((role==='expert'||role==='head')&&!no){ accMsg('برای این نقش، کد پرسنلی فعال لازم است.',true); return; }
  btn.disabled=true; accMsg('در حال ساخت حساب…');
  try{
    await rpc('kpi_create_account',{p_email:email,p_password:password,p_role:role,p_employee_no:no||null});
    $('#newAccountForm').reset(); $('#accEmployeeLabel').hidden=true;
    accMsg(`حساب ${email} با نقش «${ROLE_LABEL[role]}» ساخته شد. رمز را به‌صورت خصوصی به فرد بدهید.`);
    loadAccounts();
  }catch(err){ accMsg(err.message,true); }
  finally{ btn.disabled=false; }
}

async function createAccountsBulk(e){
  e.preventDefault();
  if(state.role!=='admin') return;
  const btn=$('#bulkCreate'), msg=$('#bulkMsg');
  const parsed=parseBulk($('#bulkList').value);
  const bad=parsed.filter(r=>r.error);
  if(!parsed.length){ msg.className='msg err'; msg.textContent='لیستی وارد نشده است.'; return; }
  if(bad.length){ msg.className='msg err'; msg.textContent=`${faN(bad.length)} خط نامعتبر است؛ ابتدا آن‌ها را اصلاح کنید.`; renderBulkResult(parsed); return; }
  if(!confirm(`${faN(parsed.length)} حساب ساخته شود؟`)) return;
  btn.disabled=true; msg.className='msg'; msg.textContent='در حال ساخت حساب‌ها…';
  const results=[];
  for(const row of parsed){
    const password=row.password||randomPassword(12);
    try{
      await rpc('kpi_create_account',{p_email:row.email,p_password:password,p_role:row.role,p_employee_no:row.employeeNo||null});
      results.push({...row,ok:true,password:row.password?null:password});
    }catch(err){ results.push({...row,ok:false,error:err.message}); }
  }
  const ok=results.filter(r=>r.ok).length;
  msg.className='msg '+(ok===results.length?'ok':'err');
  msg.textContent=`${faN(ok)} از ${faN(results.length)} حساب ساخته شد. رمزهای ساخته‌شده فقط همین یک‌بار نمایش داده می‌شوند؛ همین حالا ذخیره یا چاپ کنید.`;
  renderBulkResult(results.map(r=>({...r,error:r.ok?null:r.error})));
  btn.disabled=false;
  loadAccounts();
}
function parseBulk(text){
  const roles={management:'management',admin:'admin','مدیریت':'management','ادمین':'admin'};
  return String(text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map((line,i)=>{
    const parts=line.split(/[|,;\t]/).map(x=>x.trim());
    const email=(parts[0]||'').toLowerCase(), roleKey=(parts[1]||'').toLowerCase(), role=roles[roleKey]||roles[parts[1]]||null;
    const password=parts[2]||'';
    let error=null;
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) error='ایمیل نامعتبر';
    else if(!role) error='نقش باید management یا admin باشد؛ پرسنل را با کد بسازید';
    else if(password&&password.length<8) error='رمز کوتاه‌تر از ۸ کاراکتر';
    return {line:i+1,email,employeeNo:'',role,password,error};
  });
}
function renderBulkResult(rows){
  if(!rows.length){ $('#bulkResult').innerHTML=emptyBox('خطی برای نمایش نیست.'); return; }
  $('#bulkResult').innerHTML=`<table><thead><tr><th>#</th><th>ایمیل</th><th>کد پرسنلی</th><th>نقش</th><th>نتیجه</th><th>رمز اولیه</th></tr></thead><tbody>${
    rows.map(r=>`<tr><td>${r.line}</td><td class="ltr" dir="auto">${esc(r.email||'—')}</td><td class="ltr">${esc(r.employeeNo||'—')}</td><td>${esc(ROLE_LABEL[r.role]||'—')}</td><td>${r.error?`<span class="catalog-pill archived">${esc(r.error)}</span>`:r.ok?'<span class="catalog-pill">ساخته شد</span>':'—'}</td><td class="ltr">${r.ok?(r.password?`<b>${esc(r.password)}</b>`:'—'):'—'}</td></tr>`).join('')
  }</tbody></table>`;
}

async function loadActivityScores(){
  if(!['admin','management','head'].includes(state.role)) return;
  $('#scoresTable').innerHTML=emptyBox('در حال دریافت امتیازها…');
  try{
    state.activityScores=await rpc('kpi_activity_score_list');
    if(!['admin','management','head'].includes(state.role)) return;
    $('#scoreTitle').textContent=state.role==='head'?'تعیین Effort واحد':'تعیین Value فعالیت‌ها';
    $('#scoreScope').textContent=state.role==='head'
      ?`Effort فقط برای واحد «${state.deptScope?.departments?.join('، ')||'واحد شما'}» تغییر می‌کند؛ مقیاس ۱ تا ۱۰.`
      :state.role==='management'?'Value هر نوع فعالیت به‌صورت سراسری تنظیم می‌شود؛ مقیاس فعلی ۱ تا ۷ است. Effort را رییس هر واحد تعیین می‌کند.'
      :'ادمین می‌تواند Value سراسری را تنظیم کند؛ Effort هر واحد را رییس همان واحد تعیین می‌کند.';
    renderActivityScores();
  }catch(e){$('#scoresTable').innerHTML=emptyBox('دریافت فهرست امتیازها ناموفق بود: '+e.message);}
}
function renderActivityScores(){
  const term=$('#scoreSearch').value.trim().toLocaleLowerCase('fa');
  const rows=(state.activityScores||[]).filter(r=>!term||`${r.general_fa} ${r.specific_title||''}`.toLocaleLowerCase('fa').includes(term));
  if(!rows.length){$('#scoresTable').innerHTML=emptyBox('نوع فعالیتی با این جست‌وجو پیدا نشد.');return;}
  const canEffort=state.role==='head',canValue=['management','admin'].includes(state.role);
  $('#scoresTable').innerHTML=`<p class="hint">${faN(rows.length)} نوع فعالیت</p><table><thead><tr><th>نوع فعالیت</th>${canEffort?'<th>Effort · ۱ تا ۱۰</th>':''}<th>Value · ۱ تا ۷</th></tr></thead><tbody>${rows.map(r=>{
    const title=r.specific_title?`${r.general_fa} — ${r.specific_title}`:r.general_fa;
    const effortCell=canEffort?`<div class="score-edit"><input type="number" min="1" max="10" step="1" id="effortScore-${r.activity_id}" value="${Number(r.effort_score)}"><button type="button" class="ghost" data-score-action="effort" data-score-id="${r.activity_id}">ذخیره</button></div>`:`<span>${faN(r.effort_score??'—')}</span>`;
    const valueCell=canValue?`<div class="score-edit"><input type="number" min="1" max="7" step="1" id="valueScore-${r.activity_id}" value="${Number(r.value_score)}"><button type="button" class="ghost" data-score-action="value" data-score-id="${r.activity_id}">ذخیره</button></div>`:`<span>${faN(r.value_score??'—')}</span>`;
    return `<tr><td dir="auto">${esc(title)}</td>${canEffort?`<td>${effortCell}</td>`:''}<td>${valueCell}</td></tr>`;
  }).join('')}</tbody></table>`;
}
async function saveActivityScore(kind,id){
  if(!['effort','value'].includes(kind))return;
  const role=state.role,field=kind==='effort'?'effort':'value';
  const input=$(`#${field}Score-${id}`),score=Number(input?.value),max=kind==='effort'?10:7;
  if(!Number.isInteger(score)||score<1||score>max){$('#scoreMsg').className='msg err';$('#scoreMsg').textContent=`امتیاز باید عدد صحیح بین ۱ تا ${faN(max)} باشد.`;return;}
  const buttons=document.querySelectorAll(`[data-score-action="${kind}"][data-score-id="${id}"]`);buttons.forEach(b=>b.disabled=true);
  $('#scoreMsg').className='msg';$('#scoreMsg').textContent='در حال ذخیره…';
  try{
    await rpc(kind==='effort'?'kpi_set_activity_effort':'kpi_set_activity_value',kind==='effort'?{p_activity_id:Number(id),p_effort_score:score}:{p_activity_id:Number(id),p_value_score:score});
    await Promise.all([loadActivityScores(),loadAll()]);
    if(role!=='expert')render();
    $('#scoreMsg').className='msg ok';$('#scoreMsg').textContent=kind==='effort'?'Effort این فعالیت برای واحد شما ذخیره شد.':'Value این فعالیت ذخیره شد.';
  }catch(e){$('#scoreMsg').className='msg err';$('#scoreMsg').textContent=e.message;}
  finally{buttons.forEach(b=>b.disabled=false);}
}

let catalogRows=[],catalogSeq=0,catalogBusy=false;
function catMsg(text,error=false){const el=$('#catMsg');el.className='msg '+(error?'err':'ok');el.textContent=text;}
function setCatalogFields(){
  const kind=$('#catKind').value, isPerson=kind==='personnel',isProject=kind==='projects';
  for(const s of ['#catEmployeeField','#catDeptField']) $(s).hidden=!isPerson;
  for(const s of ['#catContractField','#catStakeField']) $(s).hidden=!isProject;
  $('#catEmployee').required=$('#catDept').required=isPerson;
  const head=state.role==='head';
  [...$('#catKind').options].forEach(o=>{ o.hidden=head&&o.value!=='personnel'; });
  if(head){
    $('#catKind').value='personnel';
    $('#catName').placeholder='نام و نام خانوادگی کارشناس';
    $('#catHeadNote').hidden=false;
  }
}
function renderCatalog(){
  const find=$('#catSearch').value.trim().toLocaleLowerCase('fa'), status=$('#catStatus').value;
  const rows=catalogRows.filter(x=>(status==='all'||(status==='active')===x.active)&&(!find||[x.name,x.employee_no,x.department,x.contract_no,x.stakeholder].some(a=>String(a||'').toLocaleLowerCase('fa').includes(find))));
  if(!rows.length){$('#catTable').innerHTML=emptyBox('موردی برای این فیلتر پیدا نشد.');return;}
  $('#catTable').innerHTML=`<p class="hint">${faN(rows.length)} مورد</p><table><thead><tr><th>نام</th><th>مشخصات</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td dir="auto">${esc(x.name)}</td><td>${[x.employee_no,x.department,x.contract_no,x.stakeholder].filter(Boolean).map(esc).join(' · ')||'—'}</td><td><span class="catalog-pill${x.active?'':' archived'}">${x.active?'فعال':'بایگانی‌شده'}</span></td><td><button type="button" class="ghost" data-cat-row="${i}"${catalogBusy?' disabled':''}>${x.active?'بایگانی':'بازیابی'}</button></td></tr>`).join('')}</tbody></table>`;
  $('#catTable').querySelectorAll('[data-cat-row]').forEach(b=>b.onclick=()=>{
    const item=rows[b.dataset.catRow],kind=$('#catKind').value;
    if(item.active&&!confirm(`«${item.name}» بایگانی شود؟ گزارش‌های قبلی حذف نمی‌شوند.`)) return;
    changeCatalog({p_kind:kind,p_action:item.active?'archive':'restore',p_id:item.id},item.active?'مورد بایگانی شد؛ سوابق قبلی محفوظ است.':'مورد بازیابی شد.');
  });
}
async function loadCatalog(){
  if(!['admin','head'].includes(state.role)) return;
  if(state.role==='head') $('#catKind').value='personnel';
  const ticket=++catalogSeq, kind=$('#catKind').value;
  const role=state.role;
  $('#catAdd').disabled=true;
  $('#catTable').innerHTML=emptyBox('در حال دریافت فهرست…');
  catalogRows=[];setCatalogFields();
  try{
    const [list,deps,stakes]=await Promise.all([
      rpc('kpi_catalog',{p_kind:kind}),
      kind==='personnel'?rpc('kpi_catalog',{p_kind:'departments'}):Promise.resolve([]),
      kind==='projects'?rpc('kpi_catalog',{p_kind:'stakeholders'}):Promise.resolve([]),
    ]);
    if(ticket!==catalogSeq||state.role!==role) return;
    catalogRows=list;
    if(kind==='personnel'){
      fillSelect('#catDept',[{v:'',t:'انتخاب دپارتمان'},...deps.filter(x=>x.active).map(x=>({v:x.id,t:x.name}))],'');
      $('#catDept').disabled=role==='head';
      if(role==='head'&&deps.length===1) $('#catDept').value=String(deps[0].id);
    }
    if(kind==='projects') fillSelect('#catStake',[{v:'',t:'بدون ذینفع'},...stakes.filter(x=>x.active).map(x=>({v:x.id,t:x.name}))],'');
    renderCatalog();
  }catch(e){ if(ticket===catalogSeq&&state.role===role){catMsg(e.message,true);$('#catTable').innerHTML=emptyBox('دریافت فهرست ناموفق بود.');} }
  finally{if(ticket===catalogSeq) $('#catAdd').disabled=catalogBusy;}
}
async function changeCatalog(params,success){
  if(!['admin','head'].includes(state.role)||catalogBusy) return;
  const scope=state.demoScope, role=state.role;
  catalogBusy=true;$('#catKind').disabled=true;$('#catAdd').disabled=true;renderCatalog();catMsg('');
  try{
    await rpc('kpi_catalog',params);
    if(scope!==state.demoScope||state.role!==role)return;
    if(params.p_action==='add'){
      for(const s of ['#catName','#catEmployee','#catContract','#catDept','#catStake']) $(s).value='';
      $('#catStatus').value='all'; $('#catSearch').value='';
    }
    state.demoData=null;
    await loadCatalog();
    try{await loadAll(); if(state.role!=='expert') render();}
    catch(e){catMsg(success+' برای تازه‌کردن فرم‌ها، صفحه را بازخوانی کنید.',true);return;}
    if(scope===state.demoScope) catMsg(success);
  }catch(e){ if(scope===state.demoScope) catMsg(e.message,true); }
  finally{if(scope===state.demoScope){catalogBusy=false;$('#catKind').disabled=false;$('#catAdd').disabled=false;renderCatalog();}}
}
function submitCatalog(e){
  e.preventDefault();
  const kind=$('#catKind').value,meta={};
  if(kind==='personnel') {meta.employee_no=asciiDigits($('#catEmployee').value).trim();meta.department_id=Number($('#catDept').value)||null;}
  if(kind==='projects'){meta.contract_no=$('#catContract').value.trim();meta.stakeholder_id=Number($('#catStake').value)||null;}
  changeCatalog({p_kind:kind,p_action:'add',p_name:$('#catName').value.trim(),p_meta:meta},'مورد جدید به فهرست اضافه شد.');
}

function askQualityReason(warnings){
  const dialog=$('#qualityDialog'),form=$('#qualityForm'),reason=$('#qualityReason');
  $('#qualityWarnings').replaceChildren(...warnings.map(w=>{const li=document.createElement('li');li.textContent=w;return li;}));
  form.reset();reason.setCustomValidity('');
  return new Promise(resolve=>{
    let answer=null;
    dialog.onclose=()=>{form.onsubmit=null;dialog.onclose=null;reason.value='';resolve(answer);};
    form.onsubmit=e=>{
      e.preventDefault();const val=reason.value.trim();
      if(val.length<5){reason.setCustomValidity('حداقل ۵ کاراکتر توضیح بنویسید.');reason.reportValidity();return;}
      answer=val;dialog.close();
    };
    reason.oninput=()=>reason.setCustomValidity('');
    dialog.showModal(); reason.focus();
  });
}
async function reviewAndSave(entry){
  if(reportBusy) return;
  const scope=state.demoScope, period=reportPeriod(), entryId=editing;
  reportBusy=true;renderMyRows();reportMsg('در حال کنترل ردیف…');
  try{
    const check=await rpc('kpi_review_activity',{...period,p_id:entryId,p_entry:entry});
    if(scope!==state.demoScope||!state.role) return;
    if(check.errors.length) throw new Error(check.errors.join(' '));
    if(check.warnings.length){
      const reason=await askQualityReason(check.warnings);
      if(scope!==state.demoScope||!state.role) return;
      if(!reason){reportMsg('ذخیره انجام نشد؛ ردیف را بررسی کنید.');return;}
      entry.quality_reason=reason;
    }
    reportBusy=false;
    await runReport('save',{...period,p_id:entryId,p_entry:entry},'فعالیت در پیش‌نویس ذخیره شد.');
  }catch(e){ if(scope===state.demoScope) reportMsg(e.message,true); }
  finally{if(scope===state.demoScope){reportBusy=false;renderMyRows();}}
}

/* ================= هماهنگی و رویدادها ================= */
function syncFilters(){ // حفظ مقادیر بعد از reload
  $('#fMonth').value=String(state.month);
  $('#fDept').value=state.dept;
  $('#fPerson').value=state.person;
}

function selectTab(tab){
  if(!ROLE_TABS[state.role]?.includes(tab)) return;
  document.querySelectorAll('.tab[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tabpane').forEach(p=>p.classList.toggle('active',p.id==='tab-'+tab));
  state.tab=tab;
  $('#btnPrint').hidden=tab!=='dash'||!['admin','management','head'].includes(state.role);
  if(tab!=='dash') exitDemo();
  updateDemoUi();
  updateScopeNote();
  $('#filters').style.display=tab==='dash'||tab==='table'?'flex':'none';
  if(tab==='form') renderMyRows();
  if(tab==='catalog') {catMsg('');loadCatalog();}
  if(tab==='accounts') {accMsg('');loadAccounts();}
  if(tab==='scores') {$('#scoreMsg').textContent='';loadActivityScores();}
}
async function startApp(){
  resetUi();
  const access=await rpc('kpi_access');
  if(access?.must_change_password){
    state.mustChangePassword=true;
    state.employeeNo=access.employee_no||session.username;
    $('#authScreen').style.display='none'; $('#appRoot').style.display='block';
    $('#appRoot').classList.add('force-password');
    $('#passwordTitle').textContent='برای ادامه، رمز اولیه را عوض کنید';
    $('#savePassword').textContent='تغییر رمز و ادامه';
    $('#cancelPassword').hidden=true;
    $('#passwordMsg').textContent='برای امنیت حساب، پیش از دسترسی به سامانه یک رمز جدیدِ حداقل ۱۲ کاراکتری انتخاب کنید.';
    $('#passwordDialog').showModal();
    return;
  }
  if(!Object.hasOwn(ROLE_TABS,access.role)) throw new Error('برای این حساب هنوز نقشی تعیین نشده است. با ادمین تماس بگیرید.');
  state.role=access.role; state.employeeId=access.employee_id; state.employeeNo=access.employee_no||null;
  const tabsNav = document.querySelector('nav.tabs');
  if(tabsNav) tabsNav.classList.toggle('single-tab', ROLE_TABS[state.role].length <= 1);
  await loadAll();
  if(state.role!=='expert') render();
  selectTab(ROLE_TABS[state.role][0]);
  showApp();
}
function resetUi(){
  Object.assign(state,{role:null,employeeId:null,employeeNo:null,mustChangePassword:false,ready:false,tab:null,demo:false,demoData:null,realFilters:null,demoScope:Symbol(),projectLoad:null,deptScope:null,month:null,dept:'',person:'',logs:[],personnel:[],activities:[],activityScoreMap:[],activityScores:[],stakeholders:[],projects:[],submissions:[]});
  $('#appRoot').classList.remove('force-password');
  $('#cancelPassword').hidden=false;
  $('#passwordTitle').textContent='تغییر رمز عبور';
  $('#savePassword').textContent='ذخیره و ورود دوباره';
  if($('#passwordDialog').open) $('#passwordDialog').close();
  editing=null;reportBusy=false;
  catalogSeq++;catalogRows=[];catalogBusy=false;$('#catKind').disabled=false;$('#catTable').textContent='';catMsg('');
  $('#catForm').reset();$('#catKind').value='personnel';$('#catStatus').value='all';$('#catSearch').value='';setCatalogFields();
  if($('#qualityDialog').open) $('#qualityDialog').close();
  printMetrics=null;$('#printReport').removeAttribute('data-ready');$('#printReport').textContent='';
  for(const i of ['#priorityGrid','#portfolioSummary','#portfolioTable','#kpiHoursC']) $(i).textContent='';
  updateDemoUi();
  $('#demoMsg').textContent='';
  for(const sel of ['#tblWrap','#myRows','#loadState','#whoami','#eMsg','#roleMsg','#reportState']) $(sel).textContent='';
  document.querySelectorAll('.chart,.kpi-v,.kpi-d,.kpi-count').forEach(el=>el.textContent='');
  document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('active'));
  for(const s of ['#eHours','#eDocs','#eDay','#eMon','#eYearD','#eNotes']) $(s).value='';
  $('#eSource').value='pargar';
  $('#roleForm').reset();
  $('#roleType').dispatchEvent(new Event('change'));
  $('#newAccountForm')?.reset(); $('#accountsTable').textContent=''; accMsg('');
  $('#scoresTable').textContent=''; $('#scoreMsg').textContent=''; $('#scoreSearch').value='';
  $('#bulkForm')?.reset(); $('#bulkResult').textContent=''; $('#bulkMsg').textContent='';
  $('#staffBulkForm')?.reset(); $('#staffBulkResult').textContent=''; $('#staffBulkMsg').textContent='';
  $('#scopeNote').hidden=true; $('#scopeNote').textContent='';
  $('#accEmployeeLabel').hidden=true; $('#catHeadNote').hidden=true; $('#catDept').disabled=false;
}

document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('.tab[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));
  $('#btnDemo').onclick=toggleDemo;
  $('#portfolioBy').onchange=()=>renderPortfolio();
  $('#catKind').onchange=()=>{$('#catForm').reset();$('#catSearch').value='';catMsg('');loadCatalog();};
  $('#catStatus').onchange=renderCatalog;
  $('#catSearch').oninput=renderCatalog;
  $('#catForm').onsubmit=submitCatalog;
  $('#qualityCancel').onclick=()=>$('#qualityDialog').close();
  $('#btnPrint').onclick=printReport;
  window.addEventListener('afterprint',()=>{ $('#printReport').removeAttribute('data-ready'); $('#printReport').textContent=''; });
  $('#fMonth').onchange=e=>{ state.month=+e.target.value; render(); };
  $('#fDept').onchange=e=>{ state.dept=e.target.value; render(); };
  $('#fPerson').onchange=e=>{ state.person=e.target.value; render(); };
  $('#fReset').onclick=()=>{ state.dept=''; state.person=''; syncFilters(); render(); };
  $('#eSource').onchange=refreshActivities;
  $('#eActivity').onchange=updateHint;
  $('#eDocs').onchange=applySuggestedHours;
  for(const sel of ['#ePerson','#eYear','#eMonth']) $(sel).onchange=()=>{ clearEntry(); reportMsg(''); renderMyRows(); };
  $('#eSubmit').onclick=submitLog;
  $('#eCancelEdit').onclick=()=>{ clearEntry(); renderMyRows(); };
  $('#eSubmitMonth').onclick=()=>{
    if(confirm('پس از ارسال نهایی، گزارش قفل می‌شود. ارسال شود؟')) runReport('submit',{},'گزارش ارسال و قفل شد.');
  };
  $('#eReopen').onclick=()=>{
    if(confirm('گزارش به پیش‌نویس برگردد تا قابل اصلاح باشد؟')) runReport('reopen',{},'گزارش برای اصلاح باز شد.');
  };
  $('#roleType').onchange=()=>{
    const needsEmployee=['expert','head'].includes($('#roleType').value);
    $('#roleEmployeeLabel').hidden=!needsEmployee; $('#roleEmployee').required=needsEmployee;
  };
  const accRoleChange=()=>{
    const needsEmployee=['expert','head'].includes($('#accRole').value);
    $('#accEmployeeLabel').hidden=!needsEmployee; $('#accEmployee').required=needsEmployee;
  };
  $('#accRole').onchange=accRoleChange; accRoleChange();
  $('#accPassGen').onclick=()=>{ $('#accPass').value=randomPassword(12); accMsg('رمز پیشنهادی ساخته شد؛ قبل از دادن به فرد، ذخیره‌اش کنید.'); };
  $('#newAccountForm').onsubmit=createAccount;
  $('#accRefresh').onclick=loadAccounts;
  $('#bulkForm').onsubmit=createAccountsBulk;
  $('#staffBulkForm').onsubmit=createStaffAccounts;
  $('#scoreSearch').oninput=renderActivityScores;
  $('#scoreRefresh').onclick=loadActivityScores;
  $('#scoresTable').onclick=e=>{const b=e.target.closest('[data-score-action]');if(b)saveActivityScore(b.dataset.scoreAction,b.dataset.scoreId);};
  $('#bulkPreview').onclick=()=>{
    const rows=parseBulk($('#bulkList').value), bad=rows.filter(r=>r.error).length;
    $('#bulkMsg').className='msg '+(bad?'err':'ok');
    $('#bulkMsg').textContent=rows.length?`${faN(rows.length)} خط، ${faN(bad)} خط نامعتبر.`:'لیستی وارد نشده است.';
    renderBulkResult(rows.map(r=>({...r,error:r.error})));
  };
  $('#roleForm').onsubmit=async e=>{
    e.preventDefault();
    const role=$('#roleType').value, rawLogin=$('#roleEmail').value.trim(), codeLogin=asciiDigits(rawLogin), email=/^\d+$/.test(codeLogin)?codeLogin:rawLogin, msg=$('#roleMsg');
    if((role==='admin'||role==='none')&&!confirm('نقش انتخاب‌شده برای این حساب اعمال شود؟')) return;
    $('#roleSave').disabled=true; msg.textContent='';
    try{
      await rpc('kpi_set_role',{p_email:email,p_role:role,p_employee_no:['expert','head'].includes(role)?asciiDigits($('#roleEmployee').value).trim():null});
      msg.className='msg ok'; msg.textContent=role==='none'?'دسترسی حساب لغو شد.':'نقش حساب ذخیره شد.';
    }catch(e){ msg.className='msg err'; msg.textContent=e.message; }
    finally{ $('#roleSave').disabled=false; }
  };
  $('#btnLogout').onclick=logout;
  const passwordDialog=$('#passwordDialog');
  $('#btnPassword').onclick=()=>{
    $('#passwordForm').reset(); $('#passwordMsg').textContent=''; passwordDialog.showModal();
  };
  $('#cancelPassword').onclick=()=>passwordDialog.close();
  passwordDialog.onclose=()=>$('#passwordForm').reset();
  passwordDialog.addEventListener('cancel',e=>{ if(state.mustChangePassword) e.preventDefault(); });
  $('#passwordForm').onsubmit=async e=>{
    e.preventDefault();
    const password=$('#newPass').value, msg=$('#passwordMsg'), button=$('#savePassword');
    if(password.length<12){ msg.textContent='رمز جدید باید حداقل ۱۲ کاراکتر باشد.'; return; }
    if(password!==$('#confirmPass').value){ msg.textContent='رمز جدید و تکرار آن یکسان نیستند.'; return; }
    if(!session || !session.access_token){ passwordDialog.close(); showLogin(); return; }
    button.disabled=true; msg.textContent='';
    try{
      await authFetch('user', {password}, 'PUT', session.access_token);
      if(state.mustChangePassword){
        await rpc('kpi_finish_first_login');
        state.mustChangePassword=false;
        passwordDialog.close();
        $('#appRoot').classList.remove('force-password');
        await startApp();
      }else{
        passwordDialog.close();
        await logout();
        $('#authMsg').className='msg ok';
        $('#authMsg').textContent='رمز تغییر کرد. با رمز جدید وارد شوید.';
      }
    }catch(e){ msg.textContent=state.mustChangePassword?'رمز ذخیره شد اما تکمیل فعال‌سازی انجام نشد؛ دوباره «تغییر رمز و ادامه» را بزنید. '+e.message:'تغییر رمز انجام نشد. اگر نشست منقضی شده است، دوباره وارد شوید.'; }
    finally{ button.disabled=false; }
  };

  $('#btnLogin').onclick=async ()=>{
    const msg=$('#authMsg'); msg.className='msg'; msg.textContent='…';
    if($('#btnLogin').disabled) return;
    $('#btnLogin').disabled=true;
    try{
      await login($('#authEmail').value.trim(), $('#authPass').value);
      $('#authPass').value='';
      await startApp();
    }catch(e){ clearSession(); showLogin(); msg.className='msg err'; msg.textContent='❌ '+e.message; }
    finally{ $('#btnLogin').disabled=false; }
  };
  $('#authPass').onkeydown=e=>{ if(e.key==='Enter') $('#btnLogin').click(); };

  // سوییچر دو طرح پیش‌زمینه
  const setBgTheme = bg => {
    const next = bg === 'energy' ? 'energy' : 'blueprint';
    document.body.dataset.bg = next;
    document.querySelectorAll('[data-bg-choice]').forEach(btn => {
      const active = btn.dataset.bgChoice === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    try{ localStorage.setItem('engkpi_bg', next); }catch(e){}
  };
  let savedBg = null;
  try{ savedBg = localStorage.getItem('engkpi_bg'); }catch(e){}
  setBgTheme(savedBg || 'blueprint');
  document.querySelectorAll('[data-bg-choice]').forEach(btn => {
    btn.onclick = () => setBgTheme(btn.dataset.bgChoice);
  });

  // وب‌اپلیکیشن قابل نصب (PWA + Service Worker + راهنمای iOS)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  let deferredInstall = null;
  const installBtns = [$('#btnInstall'), $('#authInstallBtn')].filter(Boolean);
  const iosDialog = $('#iosInstallDialog');
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosSafari = () => {
    const ua = navigator.userAgent || '';
    const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isIos && /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  };
  const syncInstallButtons = () => {
    const show = !isStandalone() && (Boolean(deferredInstall) || isIosSafari());
    installBtns.forEach(b => { b.hidden = !show; });
  };
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    syncInstallButtons();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    syncInstallButtons();
  });
  installBtns.forEach(btn => {
    btn.onclick = async () => {
      if(deferredInstall){
        deferredInstall.prompt();
        await deferredInstall.userChoice.catch(()=>null);
        deferredInstall = null;
        syncInstallButtons();
      } else if(isIosSafari() && iosDialog){
        iosDialog.showModal();
      }
    };
  });
  if($('#iosInstallClose') && iosDialog){
    $('#iosInstallClose').onclick = () => iosDialog.close();
  }
  syncInstallButtons();

  // راه‌انداز: بازیابی نشست قبلی یا نمایش صفحه ورود
  (async()=>{
    try{
      const ok=await restoreSession();
      if(ok){ await startApp(); }
      else { showLogin(); }
    }catch(e){ clearSession(); showLogin(); $('#authMsg').className='msg err'; $('#authMsg').textContent=e.message; }
  })();
});
