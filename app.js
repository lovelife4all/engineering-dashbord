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
async function api(path, opts={}){
  opts.headers = Object.assign({}, opts.headers||{});
  if(window.SUPA){ // حالت مستقیم (مثلاً GitHub Pages) — کلید publishable سمت کلاینت
    opts.headers['apikey']=window.SUPA.key;
    opts.headers['Authorization']='Bearer '+window.SUPA.key;
  }
  const r = await fetch(BASE+path, opts);
  if(!r.ok){ let t=''; try{t=(await r.json()).message||''}catch(e){}; throw new Error(r.status+' '+t); }
  const t = await r.text(); return t? JSON.parse(t): null;
}

/* ================= بارگذاری اولیه ================= */
async function loadAll(){
  const [logs, personnel, activities, stakeholders, projects, submissions] = await Promise.all([
    api(`activity_logs?select=id,period_year,period_month,hours,doc_count,source,letter_date,notes,`+
        `employee:personnel(id,employee_no,name_en,department_id,department:departments(name_fa)),`+
        `activity:activities(general_fa,specific_title,effort_score,value_score,avg_hours_doc),`+
        `stakeholder:stakeholders(name_fa),project:projects(name_fa)&order=period_year,period_month`),
    api(`personnel?select=id,employee_no,name_en,active,department_id,discipline_code,department:departments(name_fa)`),
    api(`activities?select=id,general_fa,specific_title,effort_score,value_score,avg_hours_doc&order=general_fa`),
    api(`stakeholders?select=id,name_fa&order=name_fa`),
    api(`projects?select=id,name_fa&order=name_fa`),
    api(`monthly_submissions?select=employee_id,period_year,period_month,status`),
  ]);
  state.logs=logs; state.personnel=personnel; state.activities=activities;
  state.stakeholders=stakeholders; state.projects=projects; state.submissions=submissions;

  const months = [...new Set(logs.map(l=>l.period_year*100+l.period_month))].sort((a,b)=>a-b);
  state.month = months[months.length-1] || 1405*100+6;

  fillSelect('#fMonth', months.map(m=>({v:m, t:`${FA_MONTHS[m%100-1]} ${Math.floor(m/100)}`})), state.month);
  fillSelect('#eMonth', FA_MONTHS.map((m,i)=>({v:i+1, t:m})), state.month%100);
  const depts=[...new Set(personnel.map(p=>p.department.name_fa))].sort();
  fillSelect('#fDept', [{v:'',t:'همه'}].concat(depts.map(d=>({v:d,t:d}))), '');
  fillSelect('#fPerson', [{v:'',t:'همه'}].concat(personnel.map(p=>({v:String(p.id), t:`${p.name_en} (${p.employee_no})`}))), '');
  fillSelect('#ePerson', personnel.filter(p=>p.active).map(p=>({v:String(p.id), t:`${p.name_en} (${p.employee_no}) — ${p.department.name_fa}`})), '');
  fillSelect('#eStake', stakeholders.map(s=>({v:String(s.id), t:s.name_fa})), '');
  fillSelect('#eProject', [{v:'',t:'—'}].concat(projects.map(p=>({v:String(p.id), t:p.name_fa}))), '');
  refreshActivities();
  $('#loadState').textContent = `${fmt(logs.length)} رویداد · ${personnel.length} نفر · آخرین ماه: ${FA_MONTHS[state.month%100-1]} ${Math.floor(state.month/100)}`;
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

  renderTable(logs);
  renderMyRows();
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

async function submitLog(){
  const msg=$('#eMsg'); msg.className='msg'; msg.textContent='';
  try{
    const eid=$('#ePerson').value, aid=$('#eActivity').value;
    if(!eid||!aid) throw new Error('کارشناس و فعالیت را انتخاب کنید');
    const hours=Number($('#eHours').value||0), docs=Number($('#eDocs').value||0);
    if(hours<=0 && docs<=0) throw new Error('نفرساعت یا تعداد را وارد کنید');
    let ldate=null;
    const d=+$('#eDay').value, mo=+$('#eMon').value, yy=+$('#eYearD').value;
    if(d&&mo&&yy) ldate=j2g_exact(yy,mo,d);
    const body={
      period_year:+$('#eYear').value, period_month:+$('#eMonth').value,
      employee_id:+eid, activity_id:+aid, source:$('#eSource').value,
      stakeholder_id:$('#eStake').value? +$('#eStake').value : null,
      project_id:$('#eProject').value? +$('#eProject').value : null,
      hours, doc_count:docs, letter_date:ldate, notes:$('#eNotes').value||null,
    };
    await api('activity_logs', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify([body])});
    // ثبت خودکار وضعیت گزارش ماه
    try{
      await api(`monthly_submissions?on_conflict=employee_id,period_year,period_month`,
        {method:'POST', headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
         body:JSON.stringify([{employee_id:+eid, period_year:body.period_year, period_month:body.period_month,
           status:'submitted', submitted_at:new Date().toISOString()}])});
    }catch(e){}
    msg.className='msg ok'; msg.textContent='✅ با موفقیت ثبت شد';
    $('#eHours').value=''; $('#eDocs').value=''; $('#eNotes').value='';
    $('#eDay').value=''; $('#eMon').value=''; $('#eYearD').value='';
    await loadAll(); syncFilters(); render();
  }catch(e){ msg.className='msg err'; msg.textContent='❌ '+e.message; }
}

async function submitMonthStatus(){
  const msg=$('#eMsg'); msg.className='msg'; msg.textContent='';
  try{
    const eid=$('#ePerson').value; if(!eid) throw new Error('اول خودتان را انتخاب کنید');
    await api(`monthly_submissions?on_conflict=employee_id,period_year,period_month`,
      {method:'POST', headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
       body:JSON.stringify([{employee_id:+eid, period_year:+$('#eYear').value,
         period_month:+$('#eMonth').value, status:'submitted', submitted_at:new Date().toISOString()}])});
    msg.className='msg ok'; msg.textContent='✅ وضعیت «گزارش ماه» ثبت شد';
    await loadAll(); syncFilters(); render();
  }catch(e){ msg.className='msg err'; msg.textContent='❌ '+e.message; }
}

function renderMyRows(){
  const eid=$('#ePerson').value, y=+$('#eYear').value, m=+$('#eMonth').value;
  if(!eid){ $('#myRows').innerHTML=emptyBox('کارشناس را انتخاب کنید'); return; }
  const rows=state.logs.filter(l=>l.employee&&l.employee.id===+eid&&l.period_year===y&&l.period_month===m);
  if(!rows.length){ $('#myRows').innerHTML=emptyBox('هنوز فعالیتی ثبت نکرده‌اید'); return; }
  let h=`<table><tr><th>منبع</th><th>فعالیت</th><th>ذینفع</th><th>نفرساعت</th><th>تعداد</th><th>تاریخ نامه</th><th></th></tr>`;
  rows.forEach(l=>{
    h+=`<tr><td>${esc(SRC_FA[l.source]||l.source)}</td>`+
       `<td>${esc(l.activity? (l.activity.specific_title||l.activity.general_fa):'—')}</td>`+
       `<td>${esc(l.stakeholder? l.stakeholder.name_fa:'—')}</td>`+
       `<td><b>${fmt(l.hours)}</b></td><td>${fmt(l.doc_count)}</td>`+
       `<td class="ltr">${esc(l.letter_date||'—')}</td>`+
       `<td><button class="del" data-id="${l.id}" title="حذف">✕</button></td></tr>`;
  });
  $('#myRows').innerHTML=h+'</table>';
  $('#myRows').querySelectorAll('.del').forEach(b=>b.onclick=async()=>{
    if(!confirm('این ردیف حذف شود؟')) return;
    await api('activity_logs?id=eq.'+b.dataset.id, {method:'DELETE'});
    await loadAll(); syncFilters(); render();
  });
}

/* ================= هماهنگی و رویدادها ================= */
function syncFilters(){ // حفظ مقادیر بعد از reload
  $('#fMonth').value=String(state.month);
  $('#fDept').value=state.dept;
  $('#fPerson').value=state.person;
}

function initTabs(){
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $('#tab-'+b.dataset.tab).classList.add('active');
    $('#filters').style.display= b.dataset.tab==='form'? 'none':'flex';
    if(b.dataset.tab==='form') renderMyRows();
  });
}

document.addEventListener('DOMContentLoaded', async()=>{
  initTabs();
  $('#fMonth').onchange=e=>{ state.month=+e.target.value; render(); };
  $('#fDept').onchange=e=>{ state.dept=e.target.value; render(); };
  $('#fPerson').onchange=e=>{ state.person=e.target.value; render(); };
  $('#fReset').onclick=()=>{ state.dept=''; state.person=''; syncFilters(); render(); };
  $('#eSource').onchange=refreshActivities;
  $('#eActivity').onchange=updateHint;
  $('#eDocs').onchange=applySuggestedHours;
  $('#ePerson').onchange=renderMyRows;
  $('#eYear').onchange=renderMyRows;
  $('#eMonth').onchange=renderMyRows;
  $('#eSubmit').onclick=submitLog;
  $('#eSubmitMonth').onclick=submitMonthStatus;
  try{
    await loadAll();
    $('#filters').style.display='flex';
    render();
  }catch(e){
    $('#loadState').textContent='خطا در بارگذاری: '+e.message;
    document.querySelectorAll('.chart').forEach(c=>c.innerHTML=emptyBox('ارتباط با سرور داده برقرار نشد'));
  }
});
