/* داشبورد عملکرد معاونت مهندسی — بدون وابستگی خارجی (SVG سفارشی) */
'use strict';

const FA_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const SRC_FA = {pargar:'پرگار', pmis:'PMIS', inquiry:'استعلام', meeting_mission_committee:'جلسات/مأموریت/کمیته',
                procedure:'دستورالعمل', gis:'GIS', other:'سایر'};
const COLORS = ['#1d5bd8','#12b886','#7048e8','#f59f00','#e64980','#15aabf','#2f9e44','#e8590c','#495057','#845ef7'];

const state = { logs:[], personnel:[], activities:[], stakeholders:[], projects:[], submissions:[],
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
async function login(email, password){
  const s = await authFetch('token?grant_type=password', {email, password});
  saveSession({access_token: s.access_token, refresh_token: s.refresh_token,
               email: email});
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
  $('#whoami').textContent = `${ROLE_LABEL[state.role]} · ${session.email}`;
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
  if(r.status === 401){ showLogin(); throw new Error('لطفاً دوباره وارد شوید'); }
  if(!r.ok){ let t=''; try{t=(await r.json()).message||''}catch(e){}; throw new Error(r.status+' '+t); }
  const t = await r.text(); return t? JSON.parse(t): null;
}

/* ================= بارگذاری بر اساس نقش ================= */
const ROLE_LABEL={admin:'ادمین',management:'مدیریت',expert:'کارشناس'};
const ROLE_TABS={admin:['dash','form','table','accounts'],management:['dash'],expert:['form']};
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
  const role=state.role, initial=!state.ready;
  let data;
  if(role==='management') data=await rpc('kpi_dashboard');
  else if(role==='expert') data=await rpc('kpi_expert_form');
  else if(role==='admin') {
    const [logs,personnel,activities,stakeholders,projects,submissions]=await Promise.all([
      allPages('activity_logs?select=id,period_year,period_month,hours,doc_count,source,letter_date,notes,activity_id,stakeholder_id,project_id,employee:personnel(id,department:departments(name_fa),name_en),activity:activities(general_fa,specific_title,effort_score,value_score),stakeholder:stakeholders(name_fa)&order=id'),
      allPages('personnel?select=id,employee_no,name_en,active,department:departments(name_fa)&order=name_en,id'),
      allPages('activities?select=id,general_fa,specific_title,effort_score,value_score,avg_hours_doc&order=general_fa,id'),
      allPages('stakeholders?select=id,name_fa&order=name_fa,id'),
      allPages('projects?select=id,name_fa&order=name_fa,id'),
      allPages('monthly_submissions?select=employee_id,period_year,period_month,status&order=id'),
    ]);
    data={logs,personnel,activities,stakeholders,projects,submissions};
  } else throw new Error('برای این حساب هنوز نقشی تعیین نشده است. با ادمین تماس بگیرید.');
  if(!session || state.role!==role) return;
  const {logs,personnel,activities=[],stakeholders=[],projects=[],submissions}=data;
  Object.assign(state,{logs,personnel,activities,stakeholders,projects,submissions});
  const months=[...new Set(logs.map(l=>l.period_year*100+l.period_month))].sort((a,b)=>a-b);
  const now=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'numeric'}).formatToParts(new Date());
  const yr=Number(now.find(p=>p.type==='year').value), mo=Number(now.find(p=>p.type==='month').value);
  state.month=months.includes(state.month)?state.month:(months.at(-1)||yr*100+mo);
  if(role!=='expert'){
    fillSelect('#fMonth',(months.length?months:[state.month]).map(m=>({v:m,t:`${FA_MONTHS[m%100-1]} ${Math.floor(m/100)}`})),state.month);
    const depts=[...new Set(personnel.map(p=>p.department.name_fa))].sort();
    fillSelect('#fDept',[{v:'',t:'همه'},...depts.map(d=>({v:d,t:d}))],state.dept);
    fillSelect('#fPerson',[{v:'',t:'همه'},...personnel.map(p=>({v:p.id,t:p.employee_no?`${p.name_en} (${p.employee_no})`:p.name_en}))],state.person);
  }
  if(role!=='management'){
    const year=initial?yr:Number($('#eYear').value)||yr, month=initial?mo:Number($('#eMonth').value)||mo;
    const person=role==='expert'?state.employeeId:(initial?'':$('#ePerson').value);
    const years=[...new Set([yr-1,yr,yr+1,year,...months.map(m=>Math.floor(m/100)),...submissions.map(s=>s.period_year)])].sort((a,b)=>a-b);
    fillSelect('#eYear',years.map(v=>({v,t:v})),year);
    fillSelect('#eMonth',FA_MONTHS.map((t,i)=>({v:i+1,t})),month);
    fillSelect('#ePerson',[...(role==='admin'?[{v:'',t:'انتخاب کارشناس'}]:[]),...personnel.map(p=>({v:p.id,t:`${p.name_en} (${p.employee_no}) — ${p.department.name_fa}`}))],person);
    $('#ePerson').disabled=role==='expert';
    fillSelect('#eStake',[{v:'',t:'—'},...stakeholders.map(s=>({v:s.id,t:s.name_fa}))],initial?'':$('#eStake').value);
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

/* ================= فیلترها ================= */
function filtered(useMonth=true){
  const y=Math.floor(state.month/100), m=state.month%100;
  return state.logs.filter(l=>
    (!useMonth || (l.period_year===y && l.period_month===m)) &&
    (!state.dept || (l.employee && l.employee.department.name_fa===state.dept)) &&
    (!state.person || (l.employee && String(l.employee.id)===state.person)));
}
function roster(){ // تعداد افراد فعال (با اعمال فیلتر دپارتمان/نفر)
  return state.personnel.filter(p=>p.active &&
    (!state.dept || p.department.name_fa===state.dept) &&
    (!state.person || String(p.id)===state.person));
}

/* ================= نمودارهای SVG ================= */
function emptyBox(msg){ return `<div class="empty">${esc(msg)}</div>`; }

/* نوار افقی RTL */
function hbar(data, opt={}){
  if(!data.length) return emptyBox('داده‌ای برای نمایش نیست');
  const W=opt.w||560, rowH=opt.rowH||30, padT=6, labelW=opt.labelW||190, valW=64;
  const H=padT+data.length*rowH+8;
  const max=Math.max(...data.map(d=>d.v),1);
  const barMax=W-labelW-valW-14;
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">`;
  data.forEach((d,i)=>{
    const y=padT+i*rowH, w=Math.max(2, d.v/max*barMax);
    const x=W-labelW-8-w;                      // شروع نوار از چپ برچسب (سمت راست صفحه)
    const c=d.c||COLORS[i%COLORS.length];
    s+=`<text x="${W-6}" y="${y+rowH/2+4}" text-anchor="end" font-size="12" fill="#26374f">${esc(trunc(d.t,30))}</text>`;
    s+=`<rect x="${x}" y="${y+5}" width="${w}" height="${rowH-12}" rx="5" fill="${c}" opacity=".92"/>`;
    s+=`<text x="${x-6}" y="${y+rowH/2+4}" text-anchor="end" font-size="11.5" fill="#68758c" font-weight="700">${fmt(d.v)}${opt.unit||''}</text>`;
    if(d.sub) s+=`<text x="${W-6}" y="${y+rowH/2+16}" text-anchor="end" font-size="9.5" fill="#9aa5b8">${esc(d.sub)}</text>`;
  });
  return s+'</svg>';
}
function trunc(s,n){ s=String(s??''); return s.length>n? s.slice(0,n-1)+'…':s; }

/* نوار عمودی (روند ماهانه) */
function vbar(data, opt={}){
  if(!data.length) return emptyBox('داده‌ای برای نمایش نیست');
  const W=opt.w||560, H=230, padL=42, padR=10, padT=14, padB=40;
  const max=Math.max(...data.map(d=>d.v),1);
  const bw=Math.min(64,(W-padL-padR)/data.length-14);
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">`;
  for(let g=0; g<=4; g++){
    const y=padT+(H-padT-padB)*g/4, val=max*(4-g)/4;
    s+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#eef1f6"/>`;
    s+=`<text x="${padL-6}" y="${y+4}" text-anchor="end" font-size="10" fill="#9aa5b8">${fmt(val)}</text>`;
  }
  const step=(W-padL-padR)/data.length;
  data.forEach((d,i)=>{
    const h=(H-padT-padB)*d.v/max, x=padL+step*i+(step-bw)/2, y=H-padB-h;
    s+=`<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h,1.5)}" rx="6" fill="${d.c||'#1d5bd8'}"/>`;
    s+=`<text x="${x+bw/2}" y="${y-5}" text-anchor="middle" font-size="11" font-weight="700" fill="#26374f">${fmt(d.v)}</text>`;
    s+=`<text x="${x+bw/2}" y="${H-padB+16}" text-anchor="middle" font-size="11" fill="#68758c">${esc(d.t)}</text>`;
    if(d.t2) s+=`<text x="${x+bw/2}" y="${H-padB+30}" text-anchor="middle" font-size="10" fill="#9aa5b8">${esc(d.t2)}</text>`;
  });
  return s+'</svg>';
}

/* دایره‌ای ( دونات ) */
function donut(data, opt={}){
  const total=data.reduce((a,d)=>a+d.v,0);
  if(!total) return emptyBox('داده‌ای برای نمایش نیست');
  const S=200, cx=100, cy=100, r=64, ir=38;
  let a0=-Math.PI/2, s=`<svg viewBox="0 0 ${S} ${S+ (opt.legend===false?0:18*Math.ceil(data.length/2))}" width="100%" style="max-width:230px;margin:0 auto">`;
  data.forEach((d,i)=>{
    const a1=a0+(d.v/total)*Math.PI*2, c=COLORS[i%COLORS.length];
    const large=(a1-a0)>Math.PI?1:0;
    const p=(ang,rad)=>[cx+rad*Math.cos(ang), cy+rad*Math.sin(ang)];
    const [x0,y0]=p(a0,r),[x1,y1]=p(a1,r),[x2,y2]=p(a1,ir),[x3,y3]=p(a0,ir);
    s+=`<path d="M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${ir} ${ir} 0 ${large} 0 ${x3} ${y3} Z" fill="${c}"/>`;
    a0=a1;
  });
  s+=`<text x="${cx}" y="${cy-4}" text-anchor="middle" font-size="22" font-weight="800" fill="#17233a">${fmt(opt.center??total)}</text>`;
  s+=`<text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="10.5" fill="#68758c">${esc(opt.centerLabel||'')}</text>`;
  let ly=S-4;
  data.forEach((d,i)=>{
    const col=i%2, row=Math.floor(i/2);
    const lx=col? 18: 118, yy=ly+row*18;
    s+=`<rect x="${lx}" y="${yy-9}" width="10" height="10" rx="3" fill="${COLORS[i%COLORS.length]}"/>`;
    s+=`<text x="${lx+14}" y="${yy}" font-size="10.5" fill="#26374f">${esc(trunc(d.t,18))} (${fmt(d.v)})</text>`;
  });
  return s+'</svg>';
}

/* حبابی Value-Effort */
function bubbles(pts){
  if(!pts.length) return emptyBox('داده‌ای برای نمایش نیست');
  const W=520,H=260,padL=44,padR=16,padT=16,padB=40;
  const maxX=7.5,minX=.5,maxY=7.5,minY=.5;
  const maxH=Math.max(...pts.map(p=>p.h),1);
  const X=v=>padL+(W-padL-padR)*(v-minX)/(maxX-minX);
  const Y=v=>H-padB-(H-padT-padB)*(v-minY)/(maxY-minY);
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">`;
  for(let g=1;g<=7;g++){
    s+=`<line x1="${X(g)}" y1="${padT}" x2="${X(g)}" y2="${H-padB}" stroke="#f1f4f9"/>`;
    s+=`<line x1="${padL}" y1="${Y(g)}" x2="${W-padR}" y2="${Y(g)}" stroke="#f1f4f9"/>`;
    s+=`<text x="${X(g)}" y="${H-padB+15}" text-anchor="middle" font-size="10" fill="#9aa5b8">${g}</text>`;
    s+=`<text x="${padL-8}" y="${Y(g)+4}" text-anchor="end" font-size="10" fill="#9aa5b8">${g}</text>`;
  }
  pts.forEach((p,i)=>{
    const rad=8+22*Math.sqrt(p.h/maxH);
    s+=`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${rad}" fill="${COLORS[i%COLORS.length]}" opacity=".55" stroke="${COLORS[i%COLORS.length]}"/>`;
    if(p.h>=maxH*0.08) s+=`<text x="${X(p.x)}" y="${Y(p.y)+3}" text-anchor="middle" font-size="8.5" fill="#fff" font-weight="700">${fmt(p.h)}</text>`;
  });
  s+=`<text x="${W/2}" y="${H-6}" text-anchor="middle" font-size="11" fill="#68758c">Value Score →</text>`;
  s+=`<text x="14" y="${padT+4}" font-size="11" fill="#68758c">↑ Effort</text>`;
  return s+'</svg>';
}

/* ================= رندر داشبورد ================= */
function render(){
  const logs=filtered(true);
  const allMonth=filtered(false);         // برای روند (همه ماه‌ها با فیلتر نفر/دپارتمان)
  const y=Math.floor(state.month/100), m=state.month%100;

  // ---- KPI ----
  const hours=logs.reduce((a,l)=>a+Number(l.hours),0);
  const docs=logs.reduce((a,l)=>a+Number(l.doc_count),0);
  const people=new Set(logs.map(l=>l.employee&&l.employee.id)).size;
  // ماه قبل
  let py=y, pm=m-1; if(pm<1){pm=12;py=y-1;}
  const prevH=allMonth.filter(l=>l.period_year===py&&l.period_month===pm).reduce((a,l)=>a+Number(l.hours),0);
  const mom=prevH? (hours-prevH)/prevH*100 : null;
  const rk=roster();
  const subm=state.submissions.filter(s=>s.period_year===y&&s.period_month===m&&s.status==='submitted')
              .filter(s=>!state.dept||rk.some(p=>p.id===s.employee_id))
              .filter(s=>!state.person||String(s.employee_id)===state.person);
  const subPct=rk.length? Math.round(subm.length/rk.length*100):0;

  $('#kpiHours').textContent=fmt(hours);
  $('#kpiHoursD').innerHTML= prevH? `<span class="${mom>=0?'up':'down'}">${mom>=0?'▲':'▼'} ${fmt(Math.abs(mom))}%</span> <span style="color:#9aa5b8">ماه قبل: ${fmt(prevH)}</span>` : '<span style="color:#9aa5b8">ماه قبل: —</span>';
  $('#kpiMom').textContent= mom===null? '—' : (mom>=0?'+':'')+fmt(mom)+'%';
  $('#kpiMom').style.color= mom===null? '' : (mom>=0?'#12b886':'#e03131');
  $('#kpiMomD').textContent= mom===null? 'ماه قبل داده‌ای ندارد' : `${FA_MONTHS[pm-1]} ${py}: ${fmt(prevH)} نفرساعت`;
  $('#kpiPeople').textContent=fmt(people);
  $('#kpiPeopleD').textContent=`از ${rk.length} نفر کل دپارتمان(ها)`;
  $('#kpiDocs').textContent=fmt(docs);
  $('#kpiDocsD').textContent=`میانگین ${people? fmt(hours/people):'—'} ساعت به ازای هر نفر فعال`;
  $('#kpiSub').textContent=subPct+'%';
  $('#kpiSubD').textContent=`${subm.length} از ${rk.length} نفر گزارش داده‌اند`;

  // ---- روند ماهانه ----
  const byM={};
  allMonth.forEach(l=>{const k=l.period_year*100+l.period_month; byM[k]=(byM[k]||0)+Number(l.hours)});
  const trend=Object.keys(byM).sort().map(k=>({t:FA_MONTHS[k%100-1], t2:Math.floor(k/100),
    v:byM[k], c: Number(k)===state.month? '#1d5bd8':'#9db8ec'}));
  $('#chTrend').innerHTML=vbar(trend);

  // ---- گزارش‌دهی ----
  const submitted=subm.length, missing=Math.max(rk.length-subm.length,0);
  $('#chSub').innerHTML=donut([
      {t:'گزارش داده‌اند', v:submitted},
      {t:'گزارش نداده‌اند', v:missing},
    ], {center:subPct, centerLabel:'درصد گزارش‌دهی'});

  // ---- دپارتمان‌ها ----
  const deptAgg={};
  logs.forEach(l=>{
    const d=l.employee? l.employee.department.name_fa:'—';
    deptAgg[d]=(deptAgg[d]||0)+Number(l.hours);
  });
  const deptData=Object.entries(deptAgg).sort((a,b)=>b[1]-a[1]).map(([d,h])=>{
    const head=state.personnel.filter(p=>p.active&&p.department.name_fa===d).length;
    return {t:d, v:h, sub:`ظرفیت ${fmt(head*180)} ساعت · ${head} نفر`};
  });
  $('#chDept').innerHTML=hbar(deptData,{unit:' ساعت', labelW:210, rowH:34});

  // ---- Value-Effort ----
  const veAgg={};
  logs.forEach(l=>{ if(!l.activity) return;
    const k=l.activity.general_fa+'||'+(l.activity.specific_title||'');
    if(!veAgg[k]) veAgg[k]={x:Number(l.activity.value_score), y:Number(l.activity.effort_score),
      h:0, t:l.activity.specific_title||l.activity.general_fa};
    veAgg[k].h+=Number(l.hours);
  });
  $('#chVE').innerHTML=bubbles(Object.values(veAgg));

  // ---- فعالیت‌ها ----
  const actAgg={};
  logs.forEach(l=>{ if(!l.activity) return;
    const k=(l.activity.specific_title||l.activity.general_fa);
    actAgg[k]=(actAgg[k]||0)+Number(l.hours);
  });
  $('#chAct').innerHTML=hbar(Object.entries(actAgg).sort((a,b)=>b[1]-a[1]).slice(0,12)
    .map(([t,v])=>({t,v})), {unit:' ساعت', rowH:30});

  // ---- ذینفعان ----
  const stkAgg={};
  logs.forEach(l=>{ const k=l.stakeholder? l.stakeholder.name_fa:'(بدون ذینفع)'; stkAgg[k]=(stkAgg[k]||0)+Number(l.hours); });
  $('#chStk').innerHTML=hbar(Object.entries(stkAgg).sort((a,b)=>b[1]-a[1]).slice(0,12)
    .map(([t,v])=>({t,v})), {unit:' ساعت', rowH:30, labelW:230});

  // ---- منابع ----
  const srcAgg={};
  logs.forEach(l=>{ srcAgg[SRC_FA[l.source]||l.source]=(srcAgg[SRC_FA[l.source]||l.source]||0)+Number(l.hours); });
  $('#chSrc').innerHTML=donut(Object.entries(srcAgg).sort((a,b)=>b[1]-a[1]).map(([t,v])=>({t,v})),
    {center:fmt(hours), centerLabel:'نفرساعت'});

  if(state.role==='admin') renderTable(logs);
  if(state.role==='admin') renderMyRows();
}

/* ================= جدول ================= */
function renderTable(logs){
  const rows=logs.slice(0,300);
  if(!rows.length){ $('#tblWrap').innerHTML=emptyBox('رکوردی با این فیلترها یافت نشد'); return; }
  let h=`<table><tr><th>#</th><th>کارشناس</th><th>دپارتمان</th><th>ماه</th><th>منبع</th><th>فعالیت</th>`+
        `<th>ذینفع</th><th>نفرساعت</th><th>تعداد</th><th>تاریخ نامه</th></tr>`;
  rows.forEach((l,i)=>{
    h+=`<tr><td>${i+1}</td><td>${esc(l.employee? l.employee.name_en:'—')}</td>`+
       `<td>${esc(l.employee? l.employee.department.name_fa:'—')}</td>`+
       `<td>${FA_MONTHS[l.period_month-1]} ${l.period_year}</td>`+
       `<td>${esc(SRC_FA[l.source]||l.source)}</td>`+
       `<td>${esc(l.activity? (l.activity.specific_title||l.activity.general_fa):'—')}</td>`+
       `<td>${esc(l.stakeholder? l.stakeholder.name_fa:'—')}</td>`+
       `<td><b>${fmt(l.hours)}</b></td><td>${fmt(l.doc_count)}</td>`+
       `<td class="ltr">${esc(l.letter_date||'—')}</td></tr>`;
  });
  $('#tblWrap').innerHTML=h+`</table><div class="hint" style="margin-top:8px">نمایش ${rows.length} از ${logs.length} ردیف</div>`;
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
function updateHint(){
  const a=currentActivity(); if(!a) { $('#eHint').textContent='—'; return; }
  let t=`💡 Effort: ${a.effort_score} · Value: ${a.value_score}`;
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
    await runReport('save',{p_id:editing,p_entry:{activity_id:aid,source:$('#eSource').value,
      stakeholder_id:Number($('#eStake').value)||null,project_id:Number($('#eProject').value)||null,
      hours,doc_count:docs,letter_date:date,notes:$('#eNotes').value||null}},'فعالیت در پیش‌نویس ذخیره شد.');
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
  $('#myRows').innerHTML=h+'</table>';
  $('#myRows').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editEntry(rows[b.dataset.edit]));
  $('#myRows').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
    if(confirm('این فعالیت حذف شود؟')) runReport('delete',{p_id:rows[b.dataset.delete].id},'فعالیت حذف شد.');
  });
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
  $('#filters').style.display=tab==='dash'||tab==='table'?'flex':'none';
  if(tab==='form') renderMyRows();
}
async function startApp(){
  resetUi();
  const access=await rpc('kpi_access');
  if(!Object.hasOwn(ROLE_TABS,access.role)) throw new Error('برای این حساب هنوز نقشی تعیین نشده است. با ادمین تماس بگیرید.');
  state.role=access.role; state.employeeId=access.employee_id;
  document.querySelectorAll('.tab[data-tab]').forEach(b=>b.hidden=!ROLE_TABS[state.role].includes(b.dataset.tab));
  await loadAll();
  if(state.role!=='expert') render();
  selectTab(ROLE_TABS[state.role][0]);
  showApp();
}
function resetUi(){
  Object.assign(state,{role:null,employeeId:null,ready:false,month:null,dept:'',person:'',logs:[],personnel:[],activities:[],stakeholders:[],projects:[],submissions:[]});
  editing=null;
  for(const sel of ['#tblWrap','#myRows','#loadState','#whoami','#eMsg','#roleMsg','#reportState']) $(sel).textContent='';
  document.querySelectorAll('.chart,.kpi-v,.kpi-d').forEach(el=>el.textContent='');
  document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('active'));
  for(const s of ['#eHours','#eDocs','#eDay','#eMon','#eYearD','#eNotes']) $(s).value='';
  $('#eSource').value='pargar';
  $('#roleForm').reset();
  $('#roleType').dispatchEvent(new Event('change'));
}

document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('.tab[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));
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
    const expert=$('#roleType').value==='expert';
    $('#roleEmployeeLabel').hidden=!expert; $('#roleEmployee').required=expert;
  };
  $('#roleForm').onsubmit=async e=>{
    e.preventDefault();
    const role=$('#roleType').value, email=$('#roleEmail').value.trim(), msg=$('#roleMsg');
    if((role==='admin'||role==='none')&&!confirm('نقش انتخاب‌شده برای این حساب اعمال شود؟')) return;
    $('#roleSave').disabled=true; msg.textContent='';
    try{
      await rpc('kpi_set_role',{p_email:email,p_role:role,p_employee_no:role==='expert'?$('#roleEmployee').value.trim():null});
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
  $('#passwordForm').onsubmit=async e=>{
    e.preventDefault();
    const password=$('#newPass').value, msg=$('#passwordMsg'), button=$('#savePassword');
    if(password!==$('#confirmPass').value){ msg.textContent='رمز جدید و تکرار آن یکسان نیستند.'; return; }
    if(!session || !session.access_token){ passwordDialog.close(); showLogin(); return; }
    button.disabled=true; msg.textContent='';
    try{
      await authFetch('user', {password}, 'PUT', session.access_token);
      passwordDialog.close();
      await logout();
      $('#authMsg').className='msg ok';
      $('#authMsg').textContent='رمز تغییر کرد. با رمز جدید وارد شوید.';
    }catch(e){ msg.textContent='تغییر رمز انجام نشد. اگر نشست منقضی شده است، دوباره وارد شوید.'; }
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

  // راه‌انداز: بازیابی نشست قبلی یا نمایش صفحه ورود
  (async()=>{
    try{
      const ok=await restoreSession();
      if(ok){ await startApp(); }
      else { showLogin(); }
    }catch(e){ clearSession(); showLogin(); $('#authMsg').className='msg err'; $('#authMsg').textContent=e.message; }
  })();
});
