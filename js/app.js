/* ============================================================
 *  Dirigentenschule – App-Logik
 * ============================================================ */

// ---------- State ----------
let session = null;
let currentPerson = null;          // Datensatz aus people (per E-Mail/auth_id)
let isStaff = false;               // lehrer | admin
let isAdmin = false;
const cache = { people:[], ann:[], practice:[], meetings:[], tasks:[], status:[], tests:[], grades:[] };

// ---------- Utils ----------
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const esc = s => (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fullName = p => p ? `${p.nachname}, ${p.vorname||''}`.replace(/,\s*$/,'') : '';
const fmtDate = d => d ? new Date(d).toLocaleDateString('de-DE') : '';
function toast(msg,type='ok'){
  const t=$('#toast'); t.textContent=msg; t.className='toast '+type; t.hidden=false;
  clearTimeout(t._t); t._t=setTimeout(()=>t.hidden=true,2800);
}
function parseNum(s){
  if(s==null) return null;
  const m=String(s).replace(/[^0-9,.\-]/g,'').replace(',','.');
  if(m==='') return null;
  const n=parseFloat(m); return isNaN(n)?null:n;
}

// ---------- Auth ----------
async function initAuth(){
  const { data } = await SB.auth.getSession();
  session = data.session;
  await afterSession();
  SB.auth.onAuthStateChange((_e,s)=>{ session=s; afterSession(); });
}
async function afterSession(){
  isStaff=false; isAdmin=false; currentPerson=null;
  if(session?.user){
    // Person über auth_id oder E-Mail zuordnen
    const email=session.user.email;
    const { data } = await SB.from('people').select('*')
      .or(`auth_id.eq.${session.user.id},email.eq.${email}`).limit(1);
    currentPerson = data?.[0]||null;
    if(currentPerson){
      isStaff = ['lehrer','admin'].includes(currentPerson.rolle);
      isAdmin = currentPerson.rolle==='admin';
      // auth_id nachtragen falls nur per E-Mail gematcht
      if(!currentPerson.auth_id){
        SB.from('people').update({auth_id:session.user.id}).eq('id',currentPerson.id).then(()=>{});
      }
    }
    $('#loginBtn').hidden=true; $('#logoutBtn').hidden=false;
    $('#userBadge').textContent = currentPerson ? fullName(currentPerson) : email;
  }else{
    $('#loginBtn').hidden=false; $('#logoutBtn').hidden=true; $('#userBadge').textContent='';
  }
  $$('.admin-only').forEach(el=>el.hidden=!isAdmin);
  await loadAll();
  renderActivePage();
}
async function login(){
  const email=$('#loginEmail').value.trim(), password=$('#loginPass').value;
  const { error } = await SB.auth.signInWithPassword({email,password});
  if(error){ $('#loginErr').textContent=error.message; return; }
  $('#loginModal').hidden=true; $('#loginErr').textContent='';
}

// ---------- Data ----------
async function loadAll(){
  // Öffentlich: Infos
  cache.ann = (await SB.from('announcements').select('*').order('datum',{ascending:false})).data||[];
  if(!session){ cache.people=[]; return; }
  const [people,practice,meetings,tasks,status,tests,grades] = await Promise.all([
    SB.from('people').select('*').order('sort'),
    SB.from('practice_times').select('*'),
    SB.from('theory_meetings').select('*').order('datum'),
    SB.from('theory_tasks').select('*').order('sort'),
    SB.from('theory_status').select('*'),
    SB.from('tests').select('*'),
    SB.from('grades').select('*'),
  ]);
  cache.people=people.data||[]; cache.practice=practice.data||[];
  cache.meetings=meetings.data||[]; cache.tasks=tasks.data||[];
  cache.status=status.data||[]; cache.tests=tests.data||[]; cache.grades=grades.data||[];
}
const personById = id => cache.people.find(p=>p.id===id);
const students = () => cache.people.filter(p=>p.rolle==='schueler'&&p.aktiv);

// ---------- Navigation ----------
function showPage(name){
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  $$('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+name));
  renderActivePage();
}
function renderActivePage(){
  const active = $('.page.active')?.id.replace('page-','');
  ({start:renderStart, ha:renderHA, kontakte:renderContacts,
    bewertung:renderBewertung, admin:renderAdmin}[active]||(()=>{}))();
}

// ---------- START ----------
function renderStart(){
  const cards=[
    {num:students().length, lbl:'Schüler'},
    {num:cache.meetings.length, lbl:'Theorie-Treffen'},
    {num:cache.practice.length, lbl:'Übezeiten-Einträge'},
    {num:cache.tests.length, lbl:'Tests erfasst'},
  ];
  $('#startCards').innerHTML = cards.map(c=>
    `<div class="stat-card"><div class="num">${c.num}</div><div class="lbl">${c.lbl}</div></div>`).join('');
  $('#announcementsList').innerHTML = cache.ann.length
    ? cache.ann.map(a=>`<div class="ann-item"><span class="date">${fmtDate(a.datum)}</span>
        <h4>${esc(a.titel)}</h4><p>${esc(a.text||'')}</p></div>`).join('')
    : '<p class="muted">Noch keine Infos.</p>';
}

// ---------- HAUSAUFGABEN ----------
function renderHA(){
  const sub = $('#page-ha .sub-btn.active')?.dataset.sub||'theorie';
  if(sub==='theorie') renderTheory(); else renderPractice();
}

// ----- Musiktheorie -----
function meetingPercent(meetingId, personId){
  const tasks = cache.tasks.filter(t=>t.meeting_id===meetingId);
  const total = tasks.reduce((s,t)=>s+(+t.gewicht||0),0);
  if(!total) return null;
  const done = tasks.filter(t=>cache.status.find(s=>s.task_id===t.id&&s.person_id===personId&&s.erledigt))
    .reduce((s,t)=>s+(+t.gewicht||0),0);
  return Math.round(done/total*100);
}
function renderTheory(){
  // Treffen-Karten mit Download + Abhaken
  $('#theoryMeetings').innerHTML = cache.meetings.length ? cache.meetings.map(m=>{
    const docs=(m.dokumente||[]);
    const links = [
      m.beschreibung_url?`<a class="dl-link" href="${esc(m.beschreibung_url)}" target="_blank">⬇ Aufgaben</a>`:'',
      ...docs.map(d=>`<a class="dl-link" href="${esc(d.url)}" target="_blank">⬇ ${esc(d.name||'PDF')}</a>`)
    ].join('');
    const tasks = cache.tasks.filter(t=>t.meeting_id===m.id);
    const taskRows = tasks.map(t=>{
      const st = currentPerson && cache.status.find(s=>s.task_id===t.id&&s.person_id===currentPerson.id);
      const checked = st?.erledigt?'checked':'';
      const dis = currentPerson?'':'disabled';
      return `<label class="task-row"><input type="checkbox" ${checked} ${dis}
        onchange="toggleTask('${t.id}',this.checked)"> ${esc(t.bezeichnung)}
        <span class="w">${+t.gewicht||0}%</span></label>`;
    }).join('');
    const pct = currentPerson?meetingPercent(m.id,currentPerson.id):null;
    return `<div class="meeting-card">
      <h4>${esc(m.titel||'Treffen')} ${pct!=null?`<span class="role-pill">${pct}%</span>`:''}</h4>
      <div class="date">${fmtDate(m.datum)}</div>
      <div class="dl-links">${links||'<span class="muted">Keine Dateien</span>'}</div>
      ${taskRows||'<p class="muted">Keine Aufgaben</p>'}
    </div>`;
  }).join('') : '<p class="muted">Noch keine Treffen angelegt.</p>';

  // Matrix: Zeilen Schüler, Spalten Treffen, % erledigt + Ø
  const ms=cache.meetings;
  const head = `<tr><th class="name">Schüler</th>${ms.map(m=>
    `<th>${esc(m.titel||fmtDate(m.datum))}<br><span class="muted">${fmtDate(m.datum)}</span></th>`).join('')}
    <th class="sum">Ø Gesamt</th></tr>`;
  const rows = students().map(p=>{
    const vals = ms.map(m=>meetingPercent(m.id,p.id));
    const known = vals.filter(v=>v!=null);
    const avg = known.length?Math.round(known.reduce((a,b)=>a+b,0)/known.length):null;
    return `<tr><td class="name">${esc(fullName(p))}</td>${vals.map(v=>
      `<td>${v==null?'–':v+'%'}</td>`).join('')}<td class="sum">${avg==null?'–':avg+'%'}</td></tr>`;
  }).join('');
  $('#theoryMatrix').innerHTML = ms.length
    ? `<table>${head}${rows}</table>` : '<p class="muted" style="padding:14px">Keine Daten.</p>';
}
async function toggleTask(taskId, val){
  if(!currentPerson) return;
  const { error } = await SB.from('theory_status')
    .upsert({task_id:taskId, person_id:currentPerson.id, erledigt:val, updated_at:new Date().toISOString()},
            {onConflict:'task_id,person_id'});
  if(error){ toast(error.message,'err'); return; }
  const ex=cache.status.find(s=>s.task_id===taskId&&s.person_id===currentPerson.id);
  if(ex) ex.erledigt=val; else cache.status.push({task_id:taskId,person_id:currentPerson.id,erledigt:val});
  renderTheory(); toast('Gespeichert');
}

// ----- Übezeiten -----
function practiceCellClass(min){
  if(min<=5) return 'cell-red';
  if(min===10) return 'cell-yellow';
  return 'cell-green';            // 15+
}
function gesamtClass(sum){ return sum>=4*PRACTICE_TARGET?'cell-green':sum>=2*PRACTICE_TARGET?'cell-yellow':'cell-red'; }
function fillPracticeFilters(){
  const years=[...new Set(cache.practice.map(r=>r.jahr))].sort((a,b)=>b-a);
  const weeks=[...new Set(cache.practice.map(r=>r.kw))].sort((a,b)=>b-a);
  const fill=(sel,arr,allLbl)=>{ const cur=sel.value;
    sel.innerHTML=`<option value="">${allLbl}</option>`+arr.map(v=>`<option>${v}</option>`).join('');
    if([...sel.options].some(o=>o.value===cur)) sel.value=cur; };
  fill($('#ptYear'),years,'Alle');
  fill($('#ptWeek'),weeks,'Alle');
  $('#ptStudent').innerHTML='<option value="">Alle</option>'+students().map(p=>`<option value="${p.id}">${esc(fullName(p))}</option>`).join('');
  // Standard: neueste KW
  if(!$('#ptYear').value && years[0]) $('#ptYear').value=years[0];
  if(!$('#ptWeek').value && weeks[0]) $('#ptWeek').value=weeks[0];
}
function renderPractice(){
  if(!$('#ptYear').options.length) fillPracticeFilters();
  const fy=$('#ptYear').value, fw=$('#ptWeek').value, fs=$('#ptStudent').value;
  let rows=cache.practice.filter(r=>
    (!fy||r.jahr==fy)&&(!fw||r.kw==fw)&&(!fs||r.person_id===fs));
  // Wenn eine konkrete KW gewählt: alle Schüler anzeigen (auch ohne Eintrag)
  rows.sort((a,b)=> b.jahr-a.jahr || b.kw-a.kw || (fullName(personById(a.person_id))>fullName(personById(b.person_id))?1:-1));

  const head=`<tr><th>Jahr</th><th>KW</th><th>Datum</th><th class="name">Name</th>
    ${SUBJECTS.map(s=>`<th>${s.label}</th>`).join('')}<th class="sum">Gesamt</th><th>Ferien</th></tr>`;
  const body = rows.map(r=>{
    const p=personById(r.person_id);
    const canEdit = isStaff || (currentPerson&&currentPerson.id===r.person_id);
    const sum=SUBJECTS.reduce((s,sub)=>s+(+r[sub.key]||0),0);
    const cells=SUBJECTS.map(sub=>{
      const v=+r[sub.key]||0;
      const inner = canEdit
        ? `<input class="cell-input" type="number" step="5" min="0" value="${v}"
             onchange="savePractice('${r.id}','${sub.key}',this.value)">`
        : v;
      return `<td class="${practiceCellClass(v)}">${inner} <span class="muted">Min</span></td>`;
    }).join('');
    return `<tr><td>${r.jahr}</td><td>${r.kw}</td><td>${fmtDate(r.datum)}</td>
      <td class="name">${esc(fullName(p))}</td>${cells}
      <td class="sum ${gesamtClass(sum)}">${sum} Min</td>
      <td><input type="checkbox" ${r.ferien?'checked':''} ${canEdit?'':'disabled'}
        onchange="savePractice('${r.id}','ferien',this.checked)"></td></tr>`;
  }).join('');
  $('#practiceTable').innerHTML = rows.length
    ? `<table>${head}${body}</table>` : '<p class="muted" style="padding:14px">Keine Einträge für diese Auswahl.</p>';
}
async function savePractice(id, field, value){
  const val = field==='ferien'?value:(parseInt(value)||0);
  const { error } = await SB.from('practice_times').update({[field]:val, updated_at:new Date().toISOString()}).eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  const r=cache.practice.find(x=>x.id===id); if(r) r[field]=val;
  renderPractice(); toast('Gespeichert');
}

// ---------- KONTAKTE ----------
function renderContacts(){
  if(!session){ $('#contactsGrid').innerHTML='<p class="muted">Bitte anmelden, um Kontakte zu sehen.</p>'; return; }
  const q=($('#contactSearch').value||'').toLowerCase();
  const list=cache.people.filter(p=>p.aktiv&&fullName(p).toLowerCase().includes(q))
    .sort((a,b)=>a.sort-b.sort);
  const roleLabel={schueler:'Schüler',lehrer:'Lehrer',admin:'Admin'};
  $('#contactsGrid').innerHTML = list.map(p=>{
    const img = p.bild_url?`<img src="${esc(p.bild_url)}" alt="">`:`<div class="contact-ph">👤</div>`;
    return `<div class="contact-card">${img}<div>
      <div class="nm">${esc(fullName(p))}</div>
      <div class="meta">
        ${p.gemeinde?esc(p.gemeinde)+'<br>':''}
        ${p.email?`<a href="mailto:${esc(p.email)}">${esc(p.email)}</a><br>`:''}
        ${p.telefon?`<a href="tel:${esc(p.telefon)}">${esc(p.telefon)}</a>`:''}
      </div>
      <span class="role-pill">${roleLabel[p.rolle]||p.rolle}</span>
    </div></div>`;
  }).join('')||'<p class="muted">Keine Kontakte gefunden.</p>';
}

// ---------- BEWERTUNGEN ----------
function renderBewertung(){
  const sub=$('#page-bewertung .sub-btn.active')?.dataset.sub||'harmonielehre';
  if(sub==='harmonielehre'){ renderTests('harmonielehre','#hlTests'); renderGrades('harmonielehre','#hlGrades'); }
  else { renderTests('gehoerbildung','#gbTests'); renderGrades('gehoerbildung','#gbGrades'); }
}
function renderTests(fach, sel){
  const rows=cache.tests.filter(t=>t.fach===fach);
  const months=[...new Map(rows.map(r=>[r.monat,r.monat_sort??0])).entries()]
    .sort((a,b)=>a[1]-b[1]).map(e=>e[0]);
  if(!months.length){ $(sel).innerHTML='<p class="muted" style="padding:14px">Keine Tests.</p>'; return; }
  const head=`<tr><th class="name">Schüler</th>${months.map(m=>`<th>${esc(m)}</th>`).join('')}<th class="sum">Ø</th></tr>`;
  const body=students().map(p=>{
    const vals=months.map(m=>{
      const r=rows.find(x=>x.person_id===p.id&&x.monat===m);
      return r?Math.round(r.ergebnis):null;
    });
    const known=vals.filter(v=>v!=null);
    const avg=known.length?Math.round(known.reduce((a,b)=>a+b,0)/known.length):null;
    return `<tr><td class="name">${esc(fullName(p))}</td>${vals.map(v=>
      `<td>${v==null?'–':v+'%'}</td>`).join('')}<td class="sum">${avg==null?'–':avg+'%'}</td></tr>`;
  }).join('');
  $(sel).innerHTML=`<table>${head}${body}</table>`;
}
function renderGrades(fach, sel){
  const rows=cache.grades.filter(g=>g.fach===fach);
  if(!rows.length){ $(sel).innerHTML='<p class="muted" style="padding:14px">Keine Gesamtbewertung.</p>'; return; }
  const head=`<tr><th class="name">Schüler</th><th>HA-Überpr.</th><th>Hausaufgaben</th>
    <th>Klausur 1</th><th>Klausur 2</th><th class="sum">Gesamt</th><th>Note</th></tr>`;
  const body=students().map(p=>{
    const g=rows.find(x=>x.person_id===p.id); if(!g) return '';
    const c=v=>v==null?'–':Math.round(v)+'%';
    return `<tr><td class="name">${esc(fullName(p))}</td>
      <td>${c(g.ha_ueberpruefung)}</td><td>${c(g.hausaufgaben)}</td>
      <td>${c(g.klausur1)}</td><td>${c(g.klausur2)}</td>
      <td class="sum">${c(g.gesamt)}</td><td>${esc(g.gesamtnote||'')}</td></tr>`;
  }).join('');
  $(sel).innerHTML=`<table>${head}${body}</table>`;
}

// ---------- ADMIN ----------
function renderAdmin(){
  // Infos-Liste
  $('#annAdminList').innerHTML = cache.ann.map(a=>
    `<div class="admin-row"><b>${esc(a.titel)}</b>
      <span class="muted">${fmtDate(a.datum)}</span>
      <button class="btn-ghost" style="margin-left:auto" onclick="delAnn('${a.id}')">Löschen</button></div>`).join('')
    || '<p class="muted">Keine Infos.</p>';
  // Personen
  $('#personAdminList').innerHTML = cache.people.map(p=>
    `<div class="admin-row"><span>${esc(fullName(p))}</span>
      <span class="muted">${esc(p.email||'—')}</span>
      <span class="role-pill">${esc(p.rolle)}</span></div>`).join('');
}
async function addAnn(){
  const titel=$('#annTitle').value.trim(); if(!titel) return;
  const text=$('#annText').value.trim();
  const { error } = await SB.from('announcements').insert({titel,text});
  if(error){ toast(error.message,'err'); return; }
  $('#annTitle').value=''; $('#annText').value='';
  await loadAll(); renderAdmin(); toast('Info hinzugefügt');
}
async function delAnn(id){
  await SB.from('announcements').delete().eq('id',id);
  await loadAll(); renderAdmin();
}

// ---------- TREFFEN anlegen ----------
async function saveMeeting(){
  const datum=$('#mDatum').value; if(!datum){ toast('Datum fehlt','err'); return; }
  const titel=$('#mTitel').value.trim();
  const { data, error } = await SB.from('theory_meetings').insert({datum,titel,sort:cache.meetings.length}).select().single();
  if(error){ toast(error.message,'err'); return; }
  const lines=$('#mTasks').value.split('\n').map(l=>l.trim()).filter(Boolean);
  const tasks=lines.map((l,i)=>{ const [b,w]=l.split('|'); return {meeting_id:data.id,bezeichnung:(b||'').trim(),gewicht:parseNum(w)||0,sort:i}; });
  if(tasks.length) await SB.from('theory_tasks').insert(tasks);
  $('#meetingModal').hidden=true; $('#mTitel').value=''; $('#mTasks').value='';
  await loadAll(); renderTheory(); toast('Treffen gespeichert');
}

// ---------- CSV-IMPORT ----------
function parseCSV(text){
  const rows=[]; let row=[], field='', q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else q=false; } else field+=c; }
    else { if(c==='"') q=true; else if(c===','){ row.push(field); field=''; }
      else if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c!=='\r') field+=c; }
  }
  if(field.length||row.length){ row.push(field); rows.push(row); }
  const head=rows.shift().map(h=>h.trim());
  return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]])));
}
async function runImport(){
  const file=$('#importFile').files[0]; if(!file){ toast('Keine Datei','err'); return; }
  const type=$('#importType').value;
  const log=m=>{ $('#importLog').textContent+=m+'\n'; };
  $('#importLog').textContent='';
  const text=await file.text();
  const rows=parseCSV(text);
  log(`${rows.length} Zeilen gelesen.`);
  const pMap=new Map(cache.people.filter(p=>p.legacy_id!=null).map(p=>[String(p.legacy_id),p.id]));
  let ok=0, skip=0;
  try{
    if(type==='zeiten'){
      const ups=[];
      for(const r of rows){
        const pid=pMap.get(r.user_raw); if(!pid){ skip++; continue; }
        const mw=(r.woche||'').match(/(\d{4}).*?KW\s*(\d+)/i); if(!mw){ skip++; continue; }
        ups.push({person_id:pid, jahr:+mw[1], kw:+mw[2], datum:(r.date_time||'').slice(0,10)||null,
          dirigieren:parseNum(r.dirigieren_raw)||0, stimmbildung:parseNum(r.stimmbildung_raw)||0,
          klavier:parseNum(r.klavier_raw)||0, gehoerbildung:parseNum(r.gehoerbildung_raw)||0});
      }
      for(let i=0;i<ups.length;i+=200){
        const { error }=await SB.from('practice_times').upsert(ups.slice(i,i+200),{onConflict:'person_id,jahr,kw'});
        if(error) throw error; ok+=Math.min(200,ups.length-i);
      }
    }
    else if(type==='hl_tests'||type==='gb_tests'){
      const fach=type==='hl_tests'?'harmonielehre':'gehoerbildung';
      const ins=[];
      for(const r of rows){
        const pid=pMap.get(r.user_raw); if(!pid){ skip++; continue; }
        ins.push({fach, person_id:pid, monat:r.monat||null, monat_sort:parseNum(r.monat_raw),
          datum:(r.date_time||'').slice(0,10)||null, ergebnis:parseNum(r.ergebnis_raw??r.ergebnis)});
      }
      // Saubere Neubefüllung dieses Fachs
      await SB.from('tests').delete().eq('fach',fach);
      for(let i=0;i<ins.length;i+=200){
        const { error }=await SB.from('tests').insert(ins.slice(i,i+200)); if(error) throw error;
        ok+=Math.min(200,ins.length-i);
      }
    }
    else if(type==='hl_grades'){
      const ups=[];
      for(const r of rows){
        const pid=pMap.get(r.user_raw); if(!pid){ skip++; continue; }
        ups.push({fach:'harmonielehre', person_id:pid,
          ha_ueberpruefung:parseNum(r.ha_ueberpruefung_raw), hausaufgaben:parseNum(r.hausaufgaben1_raw),
          klausur1:parseNum(r.klausur1_raw), klausur2:parseNum(r.klausur2_raw),
          gesamt:parseNum(r.gesamt_raw), gesamtnote:r.gesamtnote_raw||r.gesamtnote||null});
      }
      const { error }=await SB.from('grades').upsert(ups,{onConflict:'fach,person_id'}); if(error) throw error;
      ok=ups.length;
    }
    log(`Fertig: ${ok} importiert, ${skip} übersprungen (keine Person-Zuordnung).`);
    await loadAll(); toast('Import abgeschlossen');
  }catch(e){ log('FEHLER: '+e.message); toast('Import-Fehler','err'); }
}

// ---------- Events ----------
function bind(){
  $$('.nav-btn').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
  $$('.subnav').forEach(nav=>$$('.sub-btn',nav).forEach(b=>b.onclick=()=>{
    $$('.sub-btn',nav).forEach(x=>x.classList.toggle('active',x===b));
    const sp=nav.parentElement;
    $$('.subpage',sp).forEach(p=>p.classList.toggle('active',p.id==='sub-'+b.dataset.sub));
    renderActivePage();
  }));
  $('#loginBtn').onclick=()=>{ $('#loginModal').hidden=false; };
  $('#loginCancel').onclick=()=>{ $('#loginModal').hidden=true; };
  $('#loginSubmit').onclick=login;
  $('#logoutBtn').onclick=()=>SB.auth.signOut();
  $('#contactSearch').oninput=renderContacts;
  ['#ptYear','#ptWeek','#ptStudent'].forEach(s=>$(s).onchange=renderPractice);
  $('#newMeetingBtn').onclick=()=>{ $('#meetingModal').hidden=false; };
  $('#meetingCancel').onclick=()=>{ $('#meetingModal').hidden=true; };
  $('#meetingSave').onclick=saveMeeting;
  $('#importBtn').onclick=runImport;
  $('#annAddBtn').onclick=addAnn;
}

// ---------- Start ----------
bind();
initAuth();
