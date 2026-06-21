/* ============================================================
 *  Dirigentenschule – App-Logik
 * ============================================================ */

// ---------- State ----------
let session = null;
let currentPerson = null;          // Datensatz aus people (per E-Mail/auth_id)
let isStaff = false;               // lehrer | admin
let isAdmin = false;
let seesAll = false;               // Lehrer/Klassenleitung/Admin sehen alle Schüler
let realPerson = null;             // tatsächlich eingeloggte Person (für Admin-Ansicht-als)
let realIsAdmin = false;
let viewAsId = null;               // Admin schaut als diese Person

// Rollen einer Person (Array 'roles' bevorzugt, Fallback altes 'rolle')
function personRoles(p){
  if(!p) return [];
  if(Array.isArray(p.roles) && p.roles.length) return p.roles;
  return p.rolle?[p.rolle]:[];
}
function hasRole(p, r){ return personRoles(p).includes(r); }

// Darf der aktuelle Nutzer einen Bereich bearbeiten?
function canEdit(area){
  if(isAdmin) return true;
  if(hasRole(currentPerson,'lehrer') || hasRole(currentPerson,'klassenleitung'))
    return currentPerson.permissions?.[area]===true;
  return false;
}
// Welche Schüler-Zeilen sind sichtbar? (reine Schüler nur sich selbst)
function visibleStudents(){
  if(seesAll || !currentPerson) return students();
  if(hasRole(currentPerson,'schueler')) return students().filter(p=>p.id===currentPerson.id);
  return students();
}
const cache = { people:[], ann:[], practice:[], meetings:[], tasks:[], status:[], tests:[], grades:[], docs:[], tt:[], plans:[], gradeCols:[], rooms:[], timeSlots:[], absences:[] };

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

// ---------- Generischer Dialog ----------
let _dlgSave=null;
function openDialog(title, bodyHtml, onSave){
  $('#dlgTitle').textContent=title;
  $('#dlgBody').innerHTML=bodyHtml;
  _dlgSave=onSave;
  $('#dlg').hidden=false;
}
function closeDialog(){ $('#dlg').hidden=true; _dlgSave=null; }

// ---------- Datei-Upload (Storage-Bucket 'docs') ----------
async function uploadFile(file, prefix){
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const path=`${prefix}/${(crypto.randomUUID?crypto.randomUUID():Date.now())}.${ext}`;
  const { error }=await SB.storage.from('docs').upload(path, file, {upsert:true});
  if(error){ toast('Upload-Fehler: '+error.message,'err'); return null; }
  return SB.storage.from('docs').getPublicUrl(path).data.publicUrl;
}

// ---------- Auth ----------
async function initAuth(){
  const { data } = await SB.auth.getSession();
  session = data.session;
  await afterSession();
  SB.auth.onAuthStateChange((_e,s)=>{ session=s; afterSession(); });
}
function applyAuthGate(){
  const inApp = !!session;
  $('#authGate').hidden = inApp;
  $('#appHeader').hidden = !inApp;
  $('#appMain').hidden = !inApp;
}
function applyRoleFlags(){
  isAdmin = hasRole(currentPerson,'admin');
  isStaff = isAdmin || hasRole(currentPerson,'lehrer') || hasRole(currentPerson,'klassenleitung');
  seesAll = isStaff;
  $$('.admin-only').forEach(el=>el.hidden=!isAdmin);
  $('#newMeetingBtn').hidden = !canEdit('theorie');
  $('#annNewBtn').hidden = !canEdit('infos');
  $('#absNewBtn').hidden = !canEdit('abmeldungen');
  $('#ptAddBtn').hidden = !currentPerson;
  $('#ptWeekGenBtn').hidden = !isAdmin;
  $('#ttAddBtn').hidden = !canEdit('stundenplan');
  $('#ttNewPlanBtn').hidden = !canEdit('stundenplan');
  $('#ttTimesBtn').hidden = !canEdit('stundenplan');
  // Lehrer/Schüler standardmäßig „Mein Plan", Admin „Gesamtplan"
  const tv=$('#ttView'); if(tv) tv.value = isAdmin ? 'all' : 'mine';
}
async function afterSession(){
  isStaff=false; isAdmin=false; seesAll=false; currentPerson=null;
  realPerson=null; realIsAdmin=false; viewAsId=null;
  applyAuthGate();
  if(session?.user){
    const email=session.user.email;
    const { data } = await SB.from('people').select('*')
      .or(`auth_id.eq.${session.user.id},email.eq.${email}`).limit(1);
    currentPerson = data?.[0]||null;
    realPerson = currentPerson;
    if(currentPerson && !currentPerson.auth_id){
      SB.from('people').update({auth_id:session.user.id}).eq('id',currentPerson.id).then(()=>{});
    }
    $('#logoutBtn').hidden=false;
    $('#userBadge').textContent = currentPerson ? fullName(currentPerson) : email;
  }else{
    $('#logoutBtn').hidden=true; $('#userBadge').textContent='';
  }
  applyRoleFlags();
  realIsAdmin = isAdmin;
  await loadAll();
  fillViewAs();
  renderActivePage();
}
function fillViewAs(){
  const wrap=$('#viewAsWrap'); if(!wrap) return;
  wrap.hidden = !realIsAdmin;
  if(!realIsAdmin) return;
  $('#viewAs').innerHTML = ['<option value="">Ansicht: Admin (ich)</option>']
    .concat(cache.people.slice().sort(byName).map(p=>
      `<option value="${p.id}" ${p.id===viewAsId?'selected':''}>als ${esc(fullName(p))} (${personRoles(p).join('/')||'–'})</option>`)).join('');
}
function setViewAs(id){
  viewAsId = id||null;
  currentPerson = viewAsId ? personById(viewAsId) : realPerson;
  applyRoleFlags();
  if(viewAsId && !isAdmin && $('.page.active')?.id==='page-admin') showPage('start');
  $('#userBadge').textContent = viewAsId ? `Ansicht als: ${fullName(currentPerson)}` : (realPerson?fullName(realPerson):'');
  renderActivePage();
}
async function gateLogin(){
  const email=$('#gateEmail').value.trim(), password=$('#gatePass').value;
  $('#gateErr').textContent='';
  if(!email||!password){ $('#gateErr').textContent='E-Mail und Passwort eingeben.'; return; }
  $('#gateLogin').disabled=true;
  const { error } = await SB.auth.signInWithPassword({email,password});
  $('#gateLogin').disabled=false;
  if(error){ $('#gateErr').textContent=error.message; return; }
  $('#gatePass').value='';
  // Erfolg: onAuthStateChange → afterSession → applyAuthGate blendet die App ein
}

// ---------- Data ----------
async function loadAll(){
  // Öffentlich: Infos + Pläne
  cache.ann  = (await SB.from('announcements').select('*').order('datum',{ascending:false})).data||[];
  cache.docs = (await SB.from('site_docs').select('*')).data||[];
  if(!session){ cache.people=[]; return; }
  const [people,practice,meetings,tasks,status,tests,grades,tt,plans,gradeCols,rooms,timeSlots,absences] = await Promise.all([
    SB.from('people').select('*').order('sort'),
    SB.from('practice_times').select('*'),
    SB.from('theory_meetings').select('*').order('datum'),
    SB.from('theory_tasks').select('*').order('sort'),
    SB.from('theory_status').select('*'),
    SB.from('tests').select('*'),
    SB.from('grades').select('*'),
    SB.from('timetable').select('*'),
    SB.from('plans').select('*').order('sort'),
    SB.from('grade_columns').select('*').order('sort'),
    SB.from('rooms').select('*').order('name'),
    SB.from('time_slots').select('*').order('sort'),
    SB.from('absences').select('*'),
  ]);
  cache.people=people.data||[]; cache.practice=practice.data||[];
  cache.meetings=meetings.data||[]; cache.tasks=tasks.data||[];
  cache.status=status.data||[]; cache.tests=tests.data||[]; cache.grades=grades.data||[];
  cache.tt=tt.data||[]; cache.plans=plans.data||[]; cache.gradeCols=gradeCols.data||[]; cache.rooms=rooms.data||[];
  cache.timeSlots=timeSlots.data||[]; cache.absences=absences.data||[];
}
const personById = id => cache.people.find(p=>p.id===id);
const students = () => cache.people.filter(p=>hasRole(p,'schueler')&&p.aktiv);

// ---------- Navigation ----------
function showPage(name){
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  $$('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+name));
  renderActivePage();
}
function renderActivePage(){
  const active = $('.page.active')?.id.replace('page-','');
  ({start:renderStart, ha:renderHA, info:renderInfoTab, stundenplan:renderStundenplan,
    kontakte:renderContacts, bewertung:renderBewertung, admin:renderAdmin}[active]||(()=>{}))();
}

// ---------- START ----------
function renderStart(){
  // Abmeldungen je Treffen – aktuelles Treffen sichtbar, vergangene als Anhang
  const absBlock=t=>{
    const list=absencesForPlan(t.id);
    const items=list.length?list.map(a=>{ const p=personById(a.person_id);
      const rolle=p&&(hasRole(p,'lehrer')||hasRole(p,'klassenleitung'))?'Lehrer':(p&&hasRole(p,'admin')?'Admin':'Schüler');
      return `<li>${esc(p?fullName(p):'?')} <span class="muted">(${rolle})</span>${a.grund?` – ${esc(a.grund)}`:''}</li>`; }).join('')
      : '<li class="muted">Keine Abmeldungen.</li>';
    return `<div class="ann-item"><h4>${esc(t.name)} ${t.datum?`<span class="date">${fmtDate(t.datum)}</span>`:''}</h4>
      <ul class="abs-ul">${items}</ul></div>`;
  };
  const cur=currentTreffen();
  const others=cache.plans.filter(p=>!p.is_base && (!cur||p.id!==cur.id))
    .sort((a,b)=>(b.datum||'').localeCompare(a.datum||''));
  let absHtml = cur?absBlock(cur):'<p class="muted">Kein aktuelles Treffen.</p>';
  if(others.length) absHtml += `<details class="past-termine"><summary>Vergangene Termine (${others.length})</summary>${others.map(absBlock).join('')}</details>`;
  $('#absencesList').innerHTML = absHtml;

  const canInfo=canEdit('infos');
  $('#announcementsList').innerHTML = cache.ann.length
    ? cache.ann.map(a=>`<div class="ann-item"><span class="date">${fmtDate(a.datum)}</span>
        <h4>${esc(a.titel)}</h4><div class="ann-body">${a.text||''}</div>
        ${canInfo?`<div class="ann-actions">
          <button class="btn-ghost" onclick="openAnnEditor('${a.id}')">Bearbeiten</button>
          <button class="btn-ghost" onclick="delAnn('${a.id}')">Löschen</button></div>`:''}</div>`).join('')
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
  const rows = visibleStudents().map(p=>{
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
  // Standard: neuestes Jahr, KW = Alle
  if(!$('#ptYear').value && years[0]) $('#ptYear').value=years[0];
}
// Datumsbereich (Mo–So) einer ISO-Kalenderwoche, z.B. "15.6.-21.6."
function kwRange(jahr, kw){
  const simple=new Date(Date.UTC(jahr,0,1+(kw-1)*7));
  const dow=simple.getUTCDay();
  const monday=new Date(simple);
  if(dow<=4) monday.setUTCDate(simple.getUTCDate()-dow+1); else monday.setUTCDate(simple.getUTCDate()+8-dow);
  const sunday=new Date(monday); sunday.setUTCDate(monday.getUTCDate()+6);
  const f=d=>`${d.getUTCDate()}.${d.getUTCMonth()+1}.`;
  return `${f(monday)}-${f(sunday)}`;
}
function renderPractice(){
  if(!$('#ptYear').options.length) fillPracticeFilters();
  const fy=$('#ptYear').value, fw=$('#ptWeek').value, fs=$('#ptStudent').value;
  const allowed=new Set(visibleStudents().map(p=>p.id));
  let rows=cache.practice.filter(r=>
    allowed.has(r.person_id)&&(!fy||r.jahr==fy)&&(!fw||r.kw==fw)&&(!fs||r.person_id===fs));
  // Wenn eine konkrete KW gewählt: alle Schüler anzeigen (auch ohne Eintrag)
  rows.sort((a,b)=> b.jahr-a.jahr || b.kw-a.kw || (fullName(personById(a.person_id))>fullName(personById(b.person_id))?1:-1));

  const head=`<tr><th>Jahr</th><th>KW</th><th>Datum</th><th class="name">Name</th>
    ${SUBJECTS.map(s=>`<th>${s.label}</th>`).join('')}<th class="sum">Gesamt</th><th>Ferien</th></tr>`;
  const body = rows.map(r=>{
    const p=personById(r.person_id);
    const canEditRow = canEdit('zeiten') || (currentPerson&&currentPerson.id===r.person_id);
    const sum=SUBJECTS.reduce((s,sub)=>s+(+r[sub.key]||0),0);
    const cells=SUBJECTS.map(sub=>{
      const v=+r[sub.key]||0;
      return `<td class="${practiceCellClass(v)}">${v} <span class="muted">Min</span></td>`;
    }).join('');
    return `<tr class="${canEditRow?'cell-edit':''}" ${canEditRow?`onclick="editPractice('${r.id}')"`:''}>
      <td>${r.jahr}</td><td>${r.kw}</td><td>${kwRange(r.jahr,r.kw)}</td>
      <td class="name">${esc(fullName(p))}</td>${cells}
      <td class="sum ${gesamtClass(sum)}">${sum} Min</td>
      <td>${r.ferien?'✓':'–'}</td></tr>`;
  }).join('');
  $('#practiceTable').innerHTML = rows.length
    ? `<table>${head}${body}</table>` : '<p class="muted" style="padding:14px">Keine Einträge für diese Auswahl.</p>';
}
function isoWeek(d){
  d=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const day=d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-day);
  const ys=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil(((d-ys)/86400000+1)/7);
}
function minOpts(v){ return MIN_OPTIONS.map(n=>`<option ${n==v?'selected':''}>${n}</option>`).join(''); }
function editPractice(id){
  const r=cache.practice.find(x=>x.id===id); if(!r) return;
  const ferienHtml = isAdmin
    ? `<label class="chk"><input type="checkbox" id="dp_ferien" ${r.ferien?'checked':''}> Ferien</label>`
    : (r.ferien?`<p class="muted">Diese Woche ist als Ferien markiert (nur Admin änderbar).</p>`:'');
  const body=SUBJECTS.map(s=>`<label>${s.label} (Min)<select id="dp_${s.key}">${minOpts(+r[s.key]||0)}</select></label>`).join('')+ferienHtml;
  openDialog(`${fullName(personById(r.person_id))} – KW ${r.kw}/${r.jahr}`, body, async()=>{
    const upd={updated_at:new Date().toISOString()};
    if(isAdmin) upd.ferien=$('#dp_ferien').checked;
    SUBJECTS.forEach(s=>upd[s.key]=parseInt($('#dp_'+s.key).value)||0);
    const {error}=await SB.from('practice_times').update(upd).eq('id',r.id);
    if(error){ toast(error.message,'err'); return false; }
    Object.assign(r,upd); renderPractice(); toast('Gespeichert');
  });
}
async function genPracticeWeek(){
  if(!isAdmin) return;
  const { error } = await SB.rpc('ensure_practice_current');
  if(error){ toast(error.message,'err'); return; }
  await loadAll(); fillPracticeFilters(); renderPractice(); toast('Wocheneinträge für aktuelle KW erzeugt');
}
function createPractice(){
  if(!currentPerson){ toast('Bitte anmelden','err'); return; }
  const lockSelf=!canEdit('zeiten'), me=currentPerson;
  const persons=lockSelf?[me]:students();
  const now=new Date();
  const body=`<label>Schüler<select id="dp_person" ${lockSelf?'disabled':''}>
      ${persons.map(p=>`<option value="${p.id}" ${p.id===me.id?'selected':''}>${esc(fullName(p))}</option>`).join('')}</select></label>
    <label>Jahr<input type="number" id="dp_jahr" value="${now.getFullYear()}"></label>
    <label>KW<input type="number" id="dp_kw" min="1" max="53" value="${isoWeek(now)}"></label>
    ${SUBJECTS.map(s=>`<label>${s.label} (Min)<select id="dp_${s.key}">${minOpts(0)}</select></label>`).join('')}
    ${isAdmin?`<label class="chk"><input type="checkbox" id="dp_ferien"> Ferien</label>`:''}`;
  openDialog('Neuer Eintrag (praktische Fächer)', body, async()=>{
    const pid=lockSelf?me.id:$('#dp_person').value;
    const rec={person_id:pid, jahr:parseInt($('#dp_jahr').value)||now.getFullYear(),
      kw:parseInt($('#dp_kw').value)||isoWeek(now), datum:new Date().toISOString().slice(0,10),
      ferien:isAdmin?$('#dp_ferien').checked:false};
    SUBJECTS.forEach(s=>rec[s.key]=parseInt($('#dp_'+s.key).value)||0);
    const {data,error}=await SB.from('practice_times').upsert(rec,{onConflict:'person_id,jahr,kw'}).select().single();
    if(error){ toast(error.message,'err'); return false; }
    const i=cache.practice.findIndex(x=>x.person_id===pid&&x.jahr===rec.jahr&&x.kw===rec.kw);
    if(i>=0) cache.practice[i]=data; else cache.practice.push(data);
    fillPracticeFilters(); renderPractice(); toast('Gespeichert');
  });
}

// ---------- KONTAKTE ----------
function renderContacts(){
  if(!session){ $('#contactsGrid').innerHTML='<p class="muted">Bitte anmelden, um Kontakte zu sehen.</p>'; return; }
  const q=($('#contactSearch').value||'').toLowerCase();
  const list=cache.people.filter(p=>p.aktiv&&fullName(p).toLowerCase().includes(q));
  const roleLabel=Object.fromEntries(ROLES.map(r=>[r.key,r.label]));
  const card=p=>{
    const img = p.bild_url?`<img src="${esc(p.bild_url)}" alt="">`:`<div class="contact-ph">👤</div>`;
    const mayEdit = isAdmin || (currentPerson&&currentPerson.id===p.id);
    const pills = personRoles(p).map(r=>`<span class="role-pill">${roleLabel[r]||r}</span>`).join(' ');
    return `<div class="contact-card">${img}<div>
      <div class="nm">${esc(fullName(p))}</div>
      <div class="meta">
        ${p.gemeinde?esc(p.gemeinde)+'<br>':''}
        ${p.email?`<a href="mailto:${esc(p.email)}">${esc(p.email)}</a><br>`:''}
        ${p.telefon?`<a href="tel:${esc(p.telefon)}">${esc(p.telefon)}</a>`:''}
      </div>
      <div>${pills}</div>
      ${mayEdit?`<div><button class="btn-ghost edit-btn" onclick="editContact('${p.id}')">Bearbeiten</button></div>`:''}
    </div></div>`;
  };
  // nach Rollen gruppieren (Person erscheint in ihrer höchsten Rolle)
  const html = ROLES.map(role=>{
    const grp=list.filter(p=>primaryRole(p)===role.key).sort((a,b)=>fullName(a).localeCompare(fullName(b),'de'));
    if(!grp.length) return '';
    return `<h3 class="section-h sm">${role.label}</h3><div class="contacts-grid">${grp.map(card).join('')}</div>`;
  }).join('');
  $('#contactsGrid').innerHTML = html || '<p class="muted">Keine Kontakte gefunden.</p>';
}
function primaryRole(p){
  for(const r of ROLES){ if(hasRole(p,r.key)) return r.key; }
  return 'schueler';
}
function editContact(personId){
  const p=personById(personId); if(!p) return;
  const body=`<label>Gemeinde<input type="text" id="dc_gem" value="${esc(p.gemeinde||'')}"></label>
    <label>E-Mail<input type="email" id="dc_mail" value="${esc(p.email||'')}"></label>
    <label>Telefon<input type="text" id="dc_tel" value="${esc(p.telefon||'')}"></label>
    <label>Bild ${p.bild_url?'(neues ersetzt das alte)':''}<input type="file" id="dc_img" accept="image/*"></label>`;
  openDialog(`${fullName(p)} – Kontakt bearbeiten`, body, async()=>{
    const upd={gemeinde:$('#dc_gem').value||null, email:$('#dc_mail').value||null, telefon:$('#dc_tel').value||null};
    const f=$('#dc_img').files[0];
    if(f){ const url=await uploadFile(f,'avatars'); if(url) upd.bild_url=url; }
    const {error}=await SB.from('people').update(upd).eq('id',p.id);
    if(error){ toast(error.message,'err'); return false; }
    Object.assign(p,upd); renderContacts(); toast('Gespeichert');
  });
}

// ---------- INFO-TAB (Pläne) ----------
function renderInfoTab(){
  $('#infoDocs').innerHTML = SITE_DOCS.map(d=>{
    const doc=cache.docs.find(x=>x.key===d.key);
    const viewer = doc?.url
      ? `<iframe src="${esc(doc.url)}#toolbar=1" title="${esc(d.label)}"></iframe>
         <div style="margin-top:8px"><a class="dl-link" href="${esc(doc.url)}" target="_blank">⬇ Herunterladen</a></div>`
      : `<div class="doc-empty">Noch kein PDF hochgeladen.</div>`;
    const upload = isAdmin
      ? `<label class="btn-primary" style="cursor:pointer">PDF hochladen
          <input type="file" accept="application/pdf" hidden onchange="uploadSiteDoc('${d.key}',this.files[0])"></label>`
      : '';
    return `<div class="doc-card"><div class="doc-head"><h3>${esc(d.label)}</h3>${upload}</div>${viewer}</div>`;
  }).join('');
}
async function uploadSiteDoc(key, file){
  if(!file) return;
  const url=await uploadFile(file,'plaene'); if(!url) return;
  const {error}=await SB.from('site_docs').upsert({key,url,updated_at:new Date().toISOString()},{onConflict:'key'});
  if(error){ toast(error.message,'err'); return; }
  const i=cache.docs.findIndex(x=>x.key===key);
  if(i>=0) cache.docs[i].url=url; else cache.docs.push({key,url});
  renderInfoTab(); toast('Hochgeladen');
}

// ---------- STUNDENPLAN ----------
function basePlan(){ return cache.plans.find(p=>p.is_base)||cache.plans[0]; }
function currentPlanId(){ const v=$('#ttPlan')?.value; return v||basePlan()?.id; }
function fillPlanSelect(){
  const sel=$('#ttPlan'); if(!sel) return; const cur=sel.value;
  const ordered=[...cache.plans].sort((a,b)=>(b.is_base?1:0)-(a.is_base?1:0) || (a.sort-b.sort));
  sel.innerHTML=ordered.map(p=>`<option value="${p.id}">${esc(p.name)}${p.datum?` (${fmtDate(p.datum)})`:''}</option>`).join('');
  if([...sel.options].some(o=>o.value===cur)) sel.value=cur;
  else { const b=basePlan(); if(b) sel.value=b.id; }
}
function myToken(){
  if(!currentPerson) return null;
  const v=(currentPerson.vorname||'').trim(), n=(currentPerson.nachname||'').trim();
  return (v&&n)?`${v} ${n[0]}.`:null;
}
function personToken(p){ const v=(p.vorname||'').trim(), n=(p.nachname||'').trim(); return (v&&n)?`${v} ${n[0]}.`:(v||n||''); }
function teacherPeople(){
  return cache.people.filter(p=>p.aktiv && (hasRole(p,'lehrer')||hasRole(p,'klassenleitung')||hasRole(p,'admin')))
    .sort((a,b)=>fullName(a).localeCompare(fullName(b),'de'));
}
function byName(a,b){ return fullName(a).localeCompare(fullName(b),'de'); }
function peopleForSubject(subject, fallback){
  const assigned=cache.people.filter(p=>p.aktiv && (p.faecher||[]).includes(subject));
  return (assigned.length?assigned:fallback()).slice().sort(byName);
}
function lehrerDisplay(r){
  const ids=(r.lehrer_ids||[]).map(id=>personById(id)).filter(Boolean).map(personToken);
  return ids.length?ids.join(', '):(r.lehrer||'');
}
function klavierDisplay(r){
  const ids=(r.klavier_ids||[]).map(id=>personById(id)).filter(Boolean).map(personToken);
  return ids.length?ids.join(', '):(r.klavier||'');
}
function schuelerDisplay(r){
  const ids=(r.schueler_ids||[]).map(id=>personById(id)).filter(Boolean).map(personToken);
  return ids.length?ids.join(', '):(r.schueler||'');
}
function peopleSelectHtml(pool, selectedIds){
  const sel=new Set(selectedIds||[]);
  return pool.map(p=>`<option value="${p.id}" ${sel.has(p.id)?'selected':''}>${esc(fullName(p))}</option>`).join('');
}
function lessonIsMine(r, token){
  if(currentPerson && ((r.lehrer_ids||[]).includes(currentPerson.id)
    || (r.klavier_ids||[]).includes(currentPerson.id)
    || (r.schueler_ids||[]).includes(currentPerson.id))) return true;
  if(!token) return false; const t=token.toLowerCase();
  return [r.schueler,r.lehrer,r.klavier].some(x=>x&&x.toLowerCase().includes(t));
}
function lessonKey(r){ return `${r.zeit}|${r.fach}|${r.sort}`; }
function absentSetForPlan(planId){ return new Set(cache.absences.filter(a=>a.plan_id===planId).map(a=>a.person_id)); }
function absencesForPlan(planId){ return cache.absences.filter(a=>a.plan_id===planId); }
function lessonCancelled(r, absentSet){
  if(r.entfaellt) return true;
  if(!INDIVIDUAL_FAECHER.includes(r.fach)) return false;
  const sids=r.schueler_ids||[];
  return sids.length>0 && sids.every(id=>absentSet.has(id));
}
function tokensHtml(ids, freetext, absentSet, absCls){
  const parts=(ids||[]).map(id=>{ const p=personById(id); if(!p) return null;
    const tk=esc(personToken(p));
    return absentSet&&absentSet.has(id)?`<span class="${absCls}">${tk}</span>`:tk; }).filter(Boolean);
  return parts.length?parts.join(', '):(freetext?esc(freetext):'');
}
function lessonFields(r){
  return { ueber:r.ueberschrift||'', stu:schuelerDisplay(r), leh:lehrerDisplay(r), kla:klavierDisplay(r), raum:r.raum||'' };
}
function renderStundenplan(){
  fillPlanSelect();
  const planId=currentPlanId(), base=basePlan();
  const view=$('#ttView')?.value||'all';
  const edit=canEdit('stundenplan') && view==='all';
  $('#ttAddBtn').hidden = !edit;
  const token=view==='mine'?myToken():null;
  const diffMode = !!(base && planId!==base.id);
  const baseRows = diffMode ? cache.tt.filter(r=>r.tag==='samstag'&&r.plan_id===base.id) : [];
  const baseByKey = new Map(baseRows.map(r=>[lessonKey(r),r]));
  const rows=cache.tt.filter(r=>r.tag==='samstag' && r.plan_id===planId);
  const planKeys=new Set(rows.map(lessonKey));
  const planByKey=new Map(rows.map(r=>[lessonKey(r),r]));
  const slots=[...new Map(rows.concat(baseRows).map(r=>[r.zeit,r.zeit_sort??0])).entries()].sort((a,b)=>a[1]-b[1]).map(e=>e[0]);
  const fachIdx=f=>{ const i=FACH_ORDER.indexOf(f); return i<0?99:i; };
  const absentSet = absentSetForPlan(planId);
  const line=(prefix,cur,old,changed,cls)=> changed
    ? `<div class="tt-meta tt-chg">${prefix}${old?`<s>${esc(old)}</s> `:''}${cur?esc(cur):'<em>–</em>'}</div>`
    : (cur?`<div class="${cls||'tt-meta'}">${prefix}${esc(cur)}</div>`:'');
  const lineH=(prefix,htmlVal,plainCur,plainOld,changed,cls)=> changed
    ? `<div class="tt-meta tt-chg">${prefix}${plainOld?`<s>${esc(plainOld)}</s> `:''}${plainCur?esc(plainCur):'<em>–</em>'}</div>`
    : (htmlVal?`<div class="${cls||'tt-meta'}">${prefix}${htmlVal}</div>`:'');
  const cellHtml=r=>{
    const baseR = diffMode ? baseByKey.get(lessonKey(r)) : null;
    const isNew = diffMode && !baseR;
    const c=lessonFields(r), b=baseR?lessonFields(baseR):{};
    const ch=k=> !!baseR && (c[k]||'')!==(b[k]||'');
    const cancelled=lessonCancelled(r, absentSet);
    const stuR=tokensHtml(r.schueler_ids, r.schueler, absentSet, 'tt-absent');
    const lehR=tokensHtml(r.lehrer_ids, r.lehrer, absentSet, 'tt-absent-t');
    const klaR=tokensHtml(r.klavier_ids, r.klavier, absentSet, 'tt-absent-t');
    const lines=[];
    if(c.ueber||ch('ueber')) lines.push(line('', c.ueber, b.ueber, ch('ueber'), 'tt-head'));
    if(stuR||ch('stu'))      lines.push(lineH('', stuR, c.stu, b.stu, ch('stu'), 'tt-stu'));
    if(lehR||ch('leh'))      lines.push(lineH('L: ', lehR, c.leh, b.leh, ch('leh')));
    if(klaR||ch('kla'))      lines.push(lineH('K: ', klaR, c.kla, b.kla, ch('kla')));
    if(c.raum||ch('raum'))   lines.push(line('R: ', c.raum, b.raum, ch('raum'), 'tt-room'));
    const pad=c.ueber?5:4; while(lines.length<pad) lines.push('<div class="tt-meta">&nbsp;</div>');
    const changed = isNew || (baseR && ['ueber','stu','leh','kla','raum'].some(ch));
    const cls = [cancelled?'tt-cancelled':'', isNew?'tt-new':(changed?'tt-changed':''), edit?'editable':''].filter(Boolean).join(' ');
    const badge = cancelled?'<span class="tt-badge">entfällt</span>':(isNew?'<span class="tt-badge">neu</span>':'');
    return `<div class="tt-cell ${cls}" ${edit?`onclick="editLesson('${r.id}')"`:''}>${badge}${lines.join('')}</div>`;
  };
  const removedCell=r=>{
    const c=lessonFields(r);
    const lines=[
      c.ueber?`<div class="tt-head"><s>${esc(c.ueber)}</s></div>`:'',
      c.stu?`<div class="tt-stu"><s>${esc(c.stu)}</s></div>`:'',
      c.leh?`<div class="tt-meta"><s>L: ${esc(c.leh)}</s></div>`:'',
      c.kla?`<div class="tt-meta"><s>K: ${esc(c.kla)}</s></div>`:'',
      c.raum?`<div class="tt-room"><s>R: ${esc(c.raum)}</s></div>`:'',
    ].filter(Boolean);
    const pad=c.ueber?5:4; while(lines.length<pad) lines.push('<div class="tt-meta">&nbsp;</div>');
    return `<div class="tt-cell tt-removed"><span class="tt-badge">entfällt</span>${lines.join('')}</div>`;
  };
  const subjectsHtml=(planRows,removedRows)=>{
    const fachs=[...new Set(planRows.concat(removedRows).map(r=>r.fach))].sort((a,b)=>fachIdx(a)-fachIdx(b));
    return fachs.map(f=>{
      const horiz=['Musiktheorie','Arrangieren'].includes(f)?' row':'';
      const pc=planRows.filter(r=>r.fach===f).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(cellHtml);
      const rc=removedRows.filter(r=>r.fach===f).map(removedCell);
      return `<div class="tt-subject"><div class="tt-fach">${esc(f)}</div><div class="tt-cells${horiz}">${pc.concat(rc).join('')}</div></div>`;
    }).join('');
  };
  if(view==='mine' && !token){
    $('#ttGrid').innerHTML='<p class="muted">Für diese Person ist kein Name hinterlegt – „Mein Plan" ist nicht verfügbar.</p>';
    return;
  }
  let html=slots.map(zeit=>{
    let slotRows=rows.filter(r=>r.zeit===zeit);
    if(slotRows.length && slotRows.every(r=>r.fach==='Pause')){
      const pr=slotRows[0];
      return `<div class="tt-slot"><div class="tt-time">${esc(zeit)}</div>
        <div class="tt-pause ${edit?'editable':''}" ${edit?`onclick="editLesson('${pr.id}')"`:''}>Pause</div></div>`;
    }
    // entfallene Grundplan-Stunden in diesem Slot
    let removed = diffMode ? baseRows.filter(r=>r.zeit===zeit && !planKeys.has(lessonKey(r))) : [];
    if(token){
      slotRows=slotRows.filter(r=>r.fach!=='Pause' && lessonIsMine(r,token));
      // für mich: Stunde komplett weg ODER ich aus bestehender Stunde rausgenommen
      removed = diffMode ? baseRows.filter(r=>r.zeit===zeit && r.fach!=='Pause' && lessonIsMine(r,token) && (()=>{
          const pk=planByKey.get(lessonKey(r)); return !pk || !lessonIsMine(pk,token);
        })()) : [];
      if(!slotRows.length && !removed.length)
        return `<div class="tt-slot"><div class="tt-time">${esc(zeit)}</div><div class="tt-free">Freistunde</div></div>`;
    }
    return `<div class="tt-slot"><div class="tt-time">${esc(zeit)}</div><div class="tt-subjects">${subjectsHtml(slotRows,removed)}</div></div>`;
  }).join('');
  let banner='';
  if(diffMode) banner+=`<p class="muted">Vertretungsplan – <span class="tt-leg-chg">geändert</span> · <span class="tt-leg-new">neu</span> · <span class="tt-leg-rem">entfällt</span> (Vergleich zum Grundplan).</p>`;
  if(edit){
    const conf=planConflicts(rows);
    if(conf.length) banner+=`<div class="tt-conflicts"><b>⚠ ${conf.length} Konflikt(e):</b><ul>${conf.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>`;
  }
  $('#ttGrid').innerHTML = banner + (html || '<p class="muted">Dieser Plan ist leer.</p>');
}
function planConflicts(planRows){
  const out=[], byZeit={};
  planRows.forEach(r=>{ if(r.fach==='Pause')return; (byZeit[r.zeit]=byZeit[r.zeit]||[]).push(r); });
  Object.keys(byZeit).forEach(zeit=>{
    const rs=byZeit[zeit], pmap=new Map();
    const add=(ids,r)=> (ids||[]).forEach(id=>{ if(!pmap.has(id)) pmap.set(id,new Map()); pmap.get(id).set(r.id,r.fach); });
    rs.forEach(r=>{ add(r.schueler_ids,r); add(r.lehrer_ids,r); add(r.klavier_ids,r); });
    pmap.forEach((lessons,pid)=>{ if(lessons.size>1){ const p=personById(pid);
      out.push(`${zeit}: ${p?fullName(p):'?'} in ${lessons.size} Stunden (${[...lessons.values()].join(', ')})`); }});
    const rmap=new Map();
    rs.forEach(r=>{ if(r.raum){ if(!rmap.has(r.raum)) rmap.set(r.raum,new Map()); rmap.get(r.raum).set(r.id,r.fach); }});
    rmap.forEach((lessons,rm)=>{ if(lessons.size>1) out.push(`${zeit}: Raum ${rm} doppelt belegt (${[...lessons.values()].join(', ')})`); });
  });
  return out;
}
function tsAppendRow(){
  const wrap=document.createElement('div'); wrap.className='gc-row';
  wrap.innerHTML=`<input class="ts-label" placeholder="z.B. 9:15 - 10:00">
    <input class="ts-sort" type="number" style="width:70px" placeholder="Sort">
    <button type="button" class="btn-ghost" onclick="this.parentElement.remove()">✕</button>`;
  $('#tsList').appendChild(wrap);
}
async function delTimeSlot(id){
  if(!confirm('Zeit löschen?')) return;
  const {error}=await SB.from('time_slots').delete().eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  cache.timeSlots=cache.timeSlots.filter(s=>s.id!==id);
  document.querySelector(`#tsList .gc-row[data-id="${id}"]`)?.remove();
  toast('Gelöscht');
}
function manageTimeSlots(){
  const list=cache.timeSlots.slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const rows=list.map(s=>`<div class="gc-row" data-id="${s.id}">
    <input class="ts-label" value="${esc(s.label)}">
    <input class="ts-sort" type="number" style="width:70px" value="${s.sort||0}">
    <button type="button" class="btn-ghost" onclick="delTimeSlot('${s.id}')">✕</button></div>`).join('');
  const body=`<div id="tsList">${rows}</div>
    <button type="button" class="btn-ghost" onclick="tsAppendRow()">+ Zeit</button>
    <p class="muted">„Sort" bestimmt die Reihenfolge im Plan.</p>`;
  openDialog('Zeiten verwalten', body, async()=>{
    for(const el of $$('#tsList .gc-row')){
      const label=$('.ts-label',el)?.value.trim(); if(!label) continue;
      const sort=parseInt($('.ts-sort',el)?.value)||0; const id=el.dataset.id;
      if(id) await SB.from('time_slots').update({label,sort}).eq('id',id);
      else   await SB.from('time_slots').insert({label,sort});
    }
    await loadAll(); renderStundenplan(); toast('Zeiten gespeichert');
  });
}
async function createTreffen(name, datum){
  const base=basePlan(); if(!base){ toast('Kein Grundplan vorhanden','err'); return null; }
  const {data:plan,error}=await SB.from('plans')
    .insert({name, datum:datum||null, is_base:false, sort:(Math.max(0,...cache.plans.map(p=>p.sort||0))+1)})
    .select().single();
  if(error){ toast(error.message,'err'); return null; }
  const copies=cache.tt.filter(r=>r.plan_id===base.id).map(r=>({plan_id:plan.id, tag:r.tag, zeit:r.zeit,
    zeit_sort:r.zeit_sort, fach:r.fach, ueberschrift:r.ueberschrift, schueler:r.schueler, schueler_ids:r.schueler_ids,
    lehrer:r.lehrer, lehrer_ids:r.lehrer_ids, klavier:r.klavier, klavier_ids:r.klavier_ids, raum:r.raum, sort:r.sort}));
  if(copies.length){
    const {data:ins,error:e2}=await SB.from('timetable').insert(copies).select();
    if(e2){ toast(e2.message,'err'); } else cache.tt.push(...(ins||[]));
  }
  cache.plans.push(plan); return plan;
}
function copyPlan(){
  openDialog('Neuen Plan anlegen (Kopie Grundplan)', `<label>Name<input id="cp_name" placeholder="z.B. Treffen 14.06.2026"></label>
    <label>Datum<input type="date" id="cp_datum"></label>
    <p class="muted">Erstellt eine Kopie des Grundplans, die du anpassen kannst (Vertretung/Ausfall).</p>`, async()=>{
    const name=$('#cp_name').value.trim(); if(!name){ toast('Name fehlt','err'); return false; }
    const plan=await createTreffen(name, $('#cp_datum').value); if(!plan) return false;
    fillPlanSelect(); $('#ttPlan').value=plan.id; renderStundenplan(); toast('Plan angelegt');
  });
}
function renderTreffen(){
  const list=cache.plans.filter(p=>!p.is_base)
    .sort((a,b)=>(b.datum||'').localeCompare(a.datum||'') || (a.name||'').localeCompare(b.name||''));
  $('#treffenList').innerHTML = list.map(p=>{
    const nAbs=cache.absences.filter(a=>a.plan_id===p.id).length;
    return `<div class="person-item">
      <span class="pi-name">${esc(p.name)}</span>
      <span class="muted">${p.datum?fmtDate(p.datum):'—'}</span>
      <span class="muted">${nAbs} Abmeldung(en)</span>
      <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-ghost" onclick="manageAbsences('${p.id}')">Abmeldungen</button>
        <button class="btn-ghost" onclick="editTreffen('${p.id}')">Bearbeiten</button>
        <button class="btn-ghost" style="color:#e88" onclick="delTreffen('${p.id}')">Löschen</button>
      </span></div>`;
  }).join('') || '<p class="muted">Noch keine Treffen.</p>';
}
function addTreffen(){
  openDialog('Neues Treffen', `<label>Name<input id="tr_name" placeholder="z.B. Treffen 12.07.2026"></label>
    <label>Datum<input type="date" id="tr_datum"></label>
    <p class="muted">Legt einen Vertretungsplan als Kopie des Grundplans an.</p>`, async()=>{
    const datum=$('#tr_datum').value;
    const name=$('#tr_name').value.trim()||(datum?`Treffen ${fmtDate(datum)}`:''); if(!name){ toast('Name oder Datum fehlt','err'); return false; }
    const plan=await createTreffen(name, datum); if(!plan) return false;
    renderAdmin(); fillPlanSelect(); toast('Treffen angelegt');
  });
}
function editTreffen(id){
  const p=cache.plans.find(x=>x.id===id); if(!p) return;
  openDialog('Treffen bearbeiten', `<label>Name<input id="tr_name" value="${esc(p.name)}"></label>
    <label>Datum<input type="date" id="tr_datum" value="${p.datum||''}"></label>`, async()=>{
    const name=$('#tr_name').value.trim(); if(!name){ toast('Name fehlt','err'); return false; }
    const datum=$('#tr_datum').value||null;
    const {error}=await SB.from('plans').update({name,datum}).eq('id',id);
    if(error){ toast(error.message,'err'); return false; }
    Object.assign(p,{name,datum}); renderAdmin(); fillPlanSelect(); toast('Gespeichert');
  });
}
async function delTreffen(id){
  if(!confirm('Treffen samt Vertretungsplan und Abmeldungen löschen?')) return;
  const {error}=await SB.from('plans').delete().eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  cache.plans=cache.plans.filter(p=>p.id!==id);
  cache.tt=cache.tt.filter(r=>r.plan_id!==id);
  cache.absences=cache.absences.filter(a=>a.plan_id!==id);
  renderAdmin(); fillPlanSelect(); toast('Gelöscht');
}
function manageAbsences(planId){
  const plan=cache.plans.find(p=>p.id===planId);
  const list=absencesForPlan(planId);
  const rows=list.map(a=>{ const p=personById(a.person_id);
    return `<div class="gc-row" data-id="${a.id}"><span style="flex:1">${esc(p?fullName(p):'?')}${a.grund?` – ${esc(a.grund)}`:''}</span>
      <button type="button" class="btn-ghost" onclick="delAbsence('${a.id}','${planId}')">✕</button></div>`; }).join('');
  const peopleOpts=cache.people.filter(p=>p.aktiv).sort(byName)
    .map(p=>`<option value="${p.id}">${esc(fullName(p))} (${personRoles(p).join('/')||'–'})</option>`).join('');
  const body=`<div id="absList">${rows||'<p class="muted">Keine Abmeldungen.</p>'}</div>
    <div class="gc-row" style="margin-top:8px">
      <select id="absPerson" style="flex:1">${peopleOpts}</select>
      <input id="absGrund" placeholder="Grund" style="width:120px">
      <button type="button" class="btn-primary" onclick="addAbsence('${planId}')">+</button>
    </div>`;
  openDialog(`Abmeldungen – ${esc(plan?plan.name:'')}`, body, ()=>{});
}
function currentTreffen(){
  const today=new Date().toISOString().slice(0,10);
  const dated=cache.plans.filter(p=>!p.is_base&&p.datum);
  const upcoming=dated.filter(p=>p.datum>=today).sort((a,b)=>a.datum.localeCompare(b.datum));
  if(upcoming.length) return upcoming[0];
  const past=[...dated].sort((a,b)=>b.datum.localeCompare(a.datum));
  if(past.length) return past[0];
  return cache.plans.filter(p=>!p.is_base)[0]||null;
}
function addAbsenceDialog(){
  const treffen=cache.plans.filter(p=>!p.is_base).sort((a,b)=>(b.datum||'').localeCompare(a.datum||''));
  if(!treffen.length){ toast('Kein Treffen vorhanden – bitte im Admin anlegen','err'); return; }
  const cur=currentTreffen();
  const tOpts=treffen.map(t=>`<option value="${t.id}" ${cur&&t.id===cur.id?'selected':''}>${esc(t.name)}${t.datum?' · '+fmtDate(t.datum):''}</option>`).join('');
  const pOpts=cache.people.filter(p=>p.aktiv).sort(byName)
    .map(p=>`<option value="${p.id}">${esc(fullName(p))} (${personRoles(p).join('/')||'–'})</option>`).join('');
  const body=`<label>Treffen<select id="ab_plan">${tOpts}</select></label>
    <label>Person<select id="ab_person">${pOpts}</select></label>
    <label>Grund<input id="ab_grund" placeholder="z.B. krank"></label>`;
  openDialog('Abmeldung hinzufügen', body, async()=>{
    const plan_id=$('#ab_plan').value, person_id=$('#ab_person').value, grund=$('#ab_grund').value.trim()||null;
    if(!plan_id||!person_id){ toast('Treffen/Person fehlt','err'); return false; }
    const {data,error}=await SB.from('absences').upsert({plan_id,person_id,grund},{onConflict:'plan_id,person_id'}).select().single();
    if(error){ toast(error.message,'err'); return false; }
    const i=cache.absences.findIndex(a=>a.plan_id===plan_id&&a.person_id===person_id);
    if(i>=0) cache.absences[i]=data; else cache.absences.push(data);
    renderStart(); toast('Abmeldung gespeichert');
  });
}
async function addAbsence(planId){
  const pid=$('#absPerson').value; if(!pid) return;
  const grund=$('#absGrund').value.trim();
  const {data,error}=await SB.from('absences').upsert({plan_id:planId,person_id:pid,grund:grund||null},{onConflict:'plan_id,person_id'}).select().single();
  if(error){ toast(error.message,'err'); return; }
  const i=cache.absences.findIndex(a=>a.plan_id===planId&&a.person_id===pid);
  if(i>=0) cache.absences[i]=data; else cache.absences.push(data);
  manageAbsences(planId); renderAdmin();
}
async function delAbsence(id, planId){
  const {error}=await SB.from('absences').delete().eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  cache.absences=cache.absences.filter(a=>a.id!==id);
  document.querySelector(`#absList .gc-row[data-id="${id}"]`)?.remove();
  renderAdmin();
}
const allActive=()=>cache.people.filter(p=>p.aktiv);
function lessonForm(r){
  r=r||{};
  const fach=r.fach||'Dirigieren';
  const fachOpts=FACH_ORDER.concat(['Pause']).map(f=>`<option ${r.fach===f?'selected':''}>${f}</option>`).join('');
  const roomOpts=cache.rooms.map(rm=>`<option value="${esc(rm.name)}">`).join('');
  const zeitList=cache.timeSlots.slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const hasCur=zeitList.some(s=>s.label===r.zeit);
  const zeitOpts=(r.zeit&&!hasCur?`<option selected>${esc(r.zeit)}</option>`:'')
    + zeitList.map(s=>`<option ${r.zeit===s.label?'selected':''}>${esc(s.label)}</option>`).join('');
  return `<label>Zeit<select id="tl_zeit">${zeitOpts}</select></label>
    <label>Fach<select id="tl_fach" onchange="refreshLessonPools()">${fachOpts}</select></label>
    <label>Überschrift<input id="tl_head" value="${esc(r.ueberschrift||'')}" placeholder="z.B. Gruppe 1"></label>
    <label>Schüler (Mehrfachauswahl mit Strg/⌘)
      <select id="tl_stuids" multiple size="5">${peopleSelectHtml(students().slice().sort(byName), r.schueler_ids)}</select>
      <button type="button" class="btn-ghost mini" onclick="clearMulti('tl_stuids')">Auswahl leeren</button></label>
    <label>Schüler-Freitext (optional)<input id="tl_stu" value="${esc(r.schueler||'')}" placeholder="falls nicht in der Liste"></label>
    <label>Lehrer (Mehrfachauswahl mit Strg/⌘)
      <select id="tl_lehids" multiple size="5">${peopleSelectHtml(peopleForSubject(fach,teacherPeople), r.lehrer_ids)}</select>
      <button type="button" class="btn-ghost mini" onclick="clearMulti('tl_lehids')">Auswahl leeren</button></label>
    <label>Lehrer-Kürzel/Freitext (optional)<input id="tl_leh" value="${esc(r.lehrer||'')}" placeholder="z.B. AB, DP"></label>
    <label>Klavierbegleitung (Mehrfachauswahl)
      <select id="tl_kbids" multiple size="4">${peopleSelectHtml(peopleForSubject('Klavierbegleitung',allActive), r.klavier_ids)}</select>
      <button type="button" class="btn-ghost mini" onclick="clearMulti('tl_kbids')">Auswahl leeren</button></label>
    <label>Klavierbegleitung-Freitext (optional)<input id="tl_kla" value="${esc(r.klavier||'')}" placeholder="falls nicht in der Liste"></label>
    <label>Raum<input id="tl_raum" list="roomsDatalist" value="${esc(r.raum||'')}">
      <datalist id="roomsDatalist">${roomOpts}</datalist></label>
    <label class="chk"><input type="checkbox" id="tl_entf" ${r.entfaellt?'checked':''}> Stunde entfällt</label>`;
}
function clearMulti(id){ const el=$('#'+id); if(el) [...el.options].forEach(o=>o.selected=false); }
function refreshLessonPools(){
  const fach=$('#tl_fach').value;
  const selL=[...$('#tl_lehids').selectedOptions].map(o=>o.value);
  const selK=[...$('#tl_kbids').selectedOptions].map(o=>o.value);
  $('#tl_lehids').innerHTML=peopleSelectHtml(peopleForSubject(fach,teacherPeople), selL);
  $('#tl_kbids').innerHTML=peopleSelectHtml(peopleForSubject('Klavierbegleitung',allActive), selK);
}
function readLessonForm(){
  const ids=[...$('#tl_lehids').selectedOptions].map(o=>o.value);
  const kids=[...$('#tl_kbids').selectedOptions].map(o=>o.value);
  const sids=[...$('#tl_stuids').selectedOptions].map(o=>o.value);
  return { zeit:$('#tl_zeit').value.trim(), fach:$('#tl_fach').value,
    ueberschrift:$('#tl_head').value.trim()||null,
    schueler:$('#tl_stu').value.trim()||null,
    schueler_ids: sids.length?sids:null,
    lehrer_ids: ids.length?ids:null,
    lehrer:$('#tl_leh').value.trim()||null,
    klavier_ids: kids.length?kids:null,
    klavier:$('#tl_kla').value.trim()||null,
    raum:$('#tl_raum').value.trim()||null,
    entfaellt:$('#tl_entf').checked };
}
async function ensureRoom(name){
  if(!name || cache.rooms.some(r=>r.name===name)) return;
  const {data}=await SB.from('rooms').insert({name}).select().single();
  if(data) cache.rooms.push(data);
}
function slotSortFor(zeit){
  const ts=cache.timeSlots.find(s=>s.label===zeit); if(ts) return ts.sort||0;
  const r=cache.tt.find(x=>x.zeit===zeit); return r?r.zeit_sort:(Math.max(0,...cache.tt.map(x=>x.zeit_sort||0))+1);
}
function editLesson(id){
  const r=cache.tt.find(x=>x.id===id); if(!r) return;
  let body=lessonForm(r)+`<button class="btn-ghost" style="margin-top:4px" onclick="delLesson('${id}')">Eintrag löschen</button>`;
  openDialog('Stundenplan-Eintrag', body, async()=>{
    const upd=readLessonForm(); upd.zeit_sort=slotSortFor(upd.zeit); upd.updated_at=new Date().toISOString();
    await ensureRoom(upd.raum);
    const {error}=await SB.from('timetable').update(upd).eq('id',id);
    if(error){ toast(error.message,'err'); return false; }
    Object.assign(r,upd); renderStundenplan(); toast('Gespeichert');
  });
}
function addLesson(){
  const planId=currentPlanId();
  openDialog('Neuer Stundenplan-Eintrag', lessonForm({tag:'samstag'}), async()=>{
    const rec=readLessonForm(); rec.tag='samstag'; rec.plan_id=planId; rec.zeit_sort=slotSortFor(rec.zeit);
    rec.sort=(Math.max(0,...cache.tt.filter(x=>x.plan_id===planId&&x.zeit===rec.zeit&&x.fach===rec.fach).map(x=>x.sort||0))+1);
    await ensureRoom(rec.raum);
    const {data,error}=await SB.from('timetable').insert(rec).select().single();
    if(error){ toast(error.message,'err'); return false; }
    cache.tt.push(data); renderStundenplan(); toast('Gespeichert');
  });
}
async function delLesson(id){
  if(!confirm('Diesen Eintrag löschen?')) return;
  const {error}=await SB.from('timetable').delete().eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  cache.tt=cache.tt.filter(x=>x.id!==id); closeDialog(); renderStundenplan(); toast('Gelöscht');
}

// ---------- BEWERTUNGEN ----------
function renderBewertung(){
  $$('.grades-cols-btn').forEach(b=>b.hidden=!canEdit('bewertung'));
  const sub=$('#page-bewertung .sub-btn.active')?.dataset.sub||'harmonielehre';
  if(sub==='harmonielehre'){ renderTests('harmonielehre','#hlTests'); renderGrades('harmonielehre','#hlGrades'); }
  else { renderTests('gehoerbildung','#gbTests'); renderGrades('gehoerbildung','#gbGrades'); }
}
function renderTests(fach, sel){
  const rows=cache.tests.filter(t=>t.fach===fach);
  const monthMap=[...new Map(rows.map(r=>[r.monat,r.monat_sort??0])).entries()].sort((a,b)=>a[1]-b[1]);
  const months=monthMap.map(e=>e[0]);
  if(!months.length){ $(sel).innerHTML='<p class="muted" style="padding:14px">Keine Tests.</p>'; return; }
  const edit=canEdit('tests');
  const head=`<tr><th class="name">Schüler</th>${months.map(m=>`<th>${esc(m)}</th>`).join('')}<th class="sum">Ø</th></tr>`;
  const body=visibleStudents().map(p=>{
    const vals=months.map((m,i)=>{
      const r=rows.find(x=>x.person_id===p.id&&x.monat===m);
      const v=r?Math.round(r.ergebnis):null;
      const sort=monthMap[i][1];
      const txt=(v==null?'–':v+'%');
      const td = edit
        ? `<td class="cell-edit" onclick="editTest('${p.id}','${fach}','${esc(m)}',${sort})">${txt}</td>`
        : `<td>${txt}</td>`;
      return {v, html:td};
    });
    const known=vals.map(x=>x.v).filter(v=>v!=null);
    const avg=known.length?Math.round(known.reduce((a,b)=>a+b,0)/known.length):null;
    return `<tr><td class="name">${esc(fullName(p))}</td>${vals.map(x=>x.html).join('')}<td class="sum">${avg==null?'–':avg+'%'}</td></tr>`;
  }).join('');
  $(sel).innerHTML=`<table>${head}${body}</table>`;
}
function editTest(personId, fach, monat, monatSort){
  const r=cache.tests.find(t=>t.fach===fach&&t.person_id===personId&&t.monat===monat);
  const body=`<label>${esc(monat)} – Ergebnis (%)
    <input type="number" id="dt_e" min="0" max="100" value="${r?Math.round(r.ergebnis):''}"></label>
    <p class="muted">Leer lassen löscht den Eintrag.</p>`;
  openDialog(`${fullName(personById(personId))} – ${monat}`, body, ()=>saveTest(personId,fach,monat,monatSort,$('#dt_e').value));
}
async function saveTest(personId, fach, monat, monatSort, value){
  const v=parseNum(value);
  let row=cache.tests.find(t=>t.fach===fach&&t.person_id===personId&&t.monat===monat);
  if(row){
    if(v==null){ await SB.from('tests').delete().eq('id',row.id); cache.tests=cache.tests.filter(t=>t!==row); }
    else { const {error}=await SB.from('tests').update({ergebnis:v}).eq('id',row.id); if(error){toast(error.message,'err');return false;} row.ergebnis=v; }
  } else if(v!=null){
    const {data,error}=await SB.from('tests').insert({fach,person_id:personId,monat,monat_sort:monatSort,
      datum:new Date().toISOString().slice(0,10),ergebnis:v}).select().single();
    if(error){toast(error.message,'err');return false;} cache.tests.push(data);
  }
  renderBewertung(); toast('Gespeichert');
}
function gradeColsFor(fach){ return cache.gradeCols.filter(c=>c.fach===fach).sort((a,b)=>(a.sort||0)-(b.sort||0)); }
function gradeVal(g, col){ const v=g?.werte?.[col.id]; return (v==null||v==='')?null:v; }
function renderGrades(fach, sel){
  const cols=gradeColsFor(fach);
  const rows=cache.grades.filter(g=>g.fach===fach);
  const edit=canEdit('bewertung');
  if(!cols.length){ $(sel).innerHTML='<p class="muted" style="padding:14px">Keine Spalten definiert.</p>'; return; }
  if(!rows.length && !edit){ $(sel).innerHTML='<p class="muted" style="padding:14px">Keine Gesamtbewertung.</p>'; return; }
  const fmt=(col,v)=> v==null?'–':(col.art==='text'?esc(String(v)):Math.round(v)+'%');
  const head=`<tr><th class="name">Schüler</th>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr>`;
  const body=visibleStudents().map(p=>{
    const g=rows.find(x=>x.person_id===p.id);
    if(!g && !edit) return '';
    return `<tr class="${edit?'cell-edit':''}" ${edit?`onclick="editGrade('${p.id}','${fach}')"`:''}>
      <td class="name">${esc(fullName(p))}</td>
      ${cols.map(c=>`<td>${fmt(c, gradeVal(g,c))}</td>`).join('')}</tr>`;
  }).join('');
  $(sel).innerHTML=`<table>${head}${body}</table>`;
}
function editGrade(personId, fach){
  const cols=gradeColsFor(fach);
  const g=cache.grades.find(x=>x.fach===fach&&x.person_id===personId)||{};
  const body=cols.map(c=>{
    const v=gradeVal(g,c);
    return c.art==='text'
      ? `<label>${esc(c.label)}<input id="gc_${c.id}" value="${v==null?'':esc(String(v))}"></label>`
      : `<label>${esc(c.label)} (%)<input id="gc_${c.id}" type="number" min="0" max="100" value="${v==null?'':Math.round(v)}"></label>`;
  }).join('');
  openDialog(`${fullName(personById(personId))} – Gesamtbewertung`, body, async()=>{
    const werte={...(g.werte||{})};
    cols.forEach(c=>{ const raw=($('#gc_'+c.id).value||'').trim();
      if(raw==='') delete werte[c.id]; else werte[c.id]= c.art==='text'?raw:parseNum(raw); });
    const {data,error}=await SB.from('grades').upsert({fach,person_id:personId,werte},{onConflict:'fach,person_id'}).select().single();
    if(error){ toast(error.message,'err'); return false; }
    const i=cache.grades.findIndex(x=>x.fach===fach&&x.person_id===personId);
    if(i>=0) cache.grades[i]=data; else cache.grades.push(data);
    renderBewertung(); toast('Gespeichert');
  });
}
function gcAppendRow(){
  const wrap=document.createElement('div'); wrap.className='gc-row';
  wrap.innerHTML=`<input class="gc-label" placeholder="Neue Spalte">
    <select class="gc-art"><option value="zahl">%</option><option value="text">Text</option></select>
    <button type="button" class="btn-ghost" onclick="this.parentElement.remove()">✕</button>`;
  $('#gcList').appendChild(wrap);
}
async function delGradeCol(id){
  if(!confirm('Spalte löschen? Die Werte dieser Spalte gehen verloren.')) return;
  const {error}=await SB.from('grade_columns').delete().eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  cache.gradeCols=cache.gradeCols.filter(c=>c.id!==id);
  document.querySelector(`#gcList .gc-row[data-id="${id}"]`)?.remove();
  toast('Spalte gelöscht');
}
function manageGradeCols(fach){
  const cols=gradeColsFor(fach);
  const rowsHtml=cols.map(c=>`<div class="gc-row" data-id="${c.id}">
    <input class="gc-label" value="${esc(c.label)}">
    <select class="gc-art"><option value="zahl" ${c.art!=='text'?'selected':''}>%</option><option value="text" ${c.art==='text'?'selected':''}>Text</option></select>
    <button type="button" class="btn-ghost" onclick="delGradeCol('${c.id}')">✕</button>
  </div>`).join('');
  const body=`<div id="gcList">${rowsHtml}</div>
    <button type="button" class="btn-ghost" onclick="gcAppendRow()">+ Spalte</button>
    <p class="muted">Reihenfolge = Anzeige (von oben). Mit „Speichern" übernehmen.</p>`;
  openDialog(`Spalten – ${fach==='harmonielehre'?'Harmonielehre':'Gehörbildung'}`, body, async()=>{
    let sort=0;
    for(const el of $$('#gcList .gc-row')){
      const label=$('.gc-label',el)?.value.trim(); if(!label) continue;
      const art=$('.gc-art',el)?.value||'zahl'; sort+=10; const id=el.dataset.id;
      if(id) await SB.from('grade_columns').update({label,art,sort}).eq('id',id);
      else   await SB.from('grade_columns').insert({fach,label,art,sort});
    }
    await loadAll(); renderBewertung(); toast('Spalten gespeichert');
  });
}

// ---------- ADMIN ----------
function renderAdmin(){
  renderPersonAdmin();
  renderTreffen();
}
function renderPersonAdmin(){
  const q=($('#paSearch')?.value||'').toLowerCase();
  const roleLabel=Object.fromEntries(ROLES.map(r=>[r.key,r.label]));
  const list=cache.people
    .filter(p=>fullName(p).toLowerCase().includes(q) || (p.email||'').toLowerCase().includes(q))
    .sort((a,b)=>fullName(a).localeCompare(fullName(b),'de'));
  $('#personAdminList').innerHTML = list.map(p=>{
    const pills=personRoles(p).map(r=>`<span class="role-pill">${roleLabel[r]||r}</span>`).join(' ');
    return `<div class="person-item ${p.aktiv?'':'inactive'}">
      <span class="pi-name">${esc(fullName(p))}</span>
      <span class="muted pi-email">${esc(p.email||'—')}</span>
      <span class="pi-roles">${pills}${p.aktiv?'':' <span class="role-pill">inaktiv</span>'}</span>
      <button class="btn-ghost" style="margin-left:auto" onclick="editPerson('${p.id}')">Bearbeiten</button>
    </div>`;
  }).join('') || '<p class="muted">Keine Treffer.</p>';
}
function personFormBody(p, withContact){
  p=p||{};
  const roleChecks=ROLES.map(r=>`<label class="chk"><input type="checkbox" id="pe_role_${r.key}" ${hasRole(p,r.key)?'checked':''}> ${r.label}</label>`).join('');
  const contact = withContact ? `<label>Gemeinde<input id="pe_gem" value="${esc(p.gemeinde||'')}"></label>
    <label>Telefon<input id="pe_tel" value="${esc(p.telefon||'')}"></label>` : '';
  const perms = withContact ? `<div class="dlg-group"><b>Bearbeitungsrechte (Lehrer/Klassenleitung)</b>
    ${EDIT_AREAS.map(a=>`<label class="chk"><input type="checkbox" id="pe_perm_${a.key}" ${p.permissions?.[a.key]?'checked':''}> ${a.label}</label>`).join('')}</div>` : '';
  const faecher = withContact ? `<div class="dlg-group"><b>Fächer (für Stundenplan-Auswahl)</b>
    ${ASSIGN_SUBJECTS.map((s,i)=>`<label class="chk"><input type="checkbox" id="pe_fach_${i}" ${(p.faecher||[]).includes(s)?'checked':''}> ${esc(s)}</label>`).join('')}</div>` : '';
  return `<label>Vorname<input id="pe_vor" value="${esc(p.vorname||'')}"></label>
    <label>Nachname<input id="pe_nach" value="${esc(p.nachname||'')}"></label>
    <label>E-Mail<input id="pe_mail" type="email" value="${esc(p.email||'')}"></label>
    ${contact}
    <div class="dlg-group"><b>Rollen</b>${roleChecks}</div>
    ${faecher}
    ${perms}
    ${withContact?`<label class="chk"><input type="checkbox" id="pe_aktiv" ${p.aktiv?'checked':''}> aktiv</label>`:''}`;
}
function readPersonForm(withContact){
  const roles=ROLES.filter(r=>$('#pe_role_'+r.key).checked).map(r=>r.key);
  const upd={ vorname:$('#pe_vor').value.trim()||null, nachname:$('#pe_nach').value.trim(),
    email:$('#pe_mail').value.trim()||null, roles, rolle:roles[0]||null };
  if(withContact){
    upd.gemeinde=$('#pe_gem').value.trim()||null; upd.telefon=$('#pe_tel').value.trim()||null;
    upd.aktiv=$('#pe_aktiv').checked;
    const permissions={}; EDIT_AREAS.forEach(a=>{ if($('#pe_perm_'+a.key).checked) permissions[a.key]=true; });
    upd.permissions=permissions;
    upd.faecher = ASSIGN_SUBJECTS.filter((s,i)=>$('#pe_fach_'+i).checked);
  }
  return upd;
}
function editPerson(id){
  const p=cache.people.find(x=>x.id===id); if(!p) return;
  const body=personFormBody(p,true)+`<button class="btn-ghost" style="margin-top:6px;color:#e88" onclick="deletePerson('${id}')">Benutzer löschen</button>`;
  openDialog(`${fullName(p)||'Person'} bearbeiten`, body, async()=>{
    const upd=readPersonForm(true);
    if(!upd.nachname){ toast('Nachname fehlt','err'); return false; }
    const {error}=await SB.from('people').update(upd).eq('id',id);
    if(error){ toast(error.message,'err'); return false; }
    Object.assign(p,upd);
    if(id===currentPerson?.id) afterSession();
    renderPersonAdmin(); toast('Gespeichert');
  });
}
async function deletePerson(id){
  if(!confirm('Diesen Benutzer wirklich löschen?')) return;
  const {error}=await SB.from('people').delete().eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  cache.people=cache.people.filter(x=>x.id!==id); closeDialog(); renderPersonAdmin(); toast('Gelöscht');
}
function addPersonDialog(){
  openDialog('Neue Person anlegen', personFormBody({roles:['schueler']},false), async()=>{
    const upd=readPersonForm(false);
    if(!upd.nachname){ toast('Nachname fehlt','err'); return false; }
    if(!upd.roles.length) upd.roles=['schueler'];
    upd.rolle=upd.roles[0]; upd.aktiv=true; upd.sort=(Math.max(0,...cache.people.map(p=>p.sort||0))+10);
    const {data,error}=await SB.from('people').insert(upd).select().single();
    if(error){ toast(error.message,'err'); return false; }
    cache.people.push(data); renderPersonAdmin(); toast('Person angelegt');
  });
}
// ---------- INFOS (Rich-Text-Editor) ----------
let _annEditId=null, _savedRange=null;
function saveSel(){ const s=window.getSelection(); if(s.rangeCount && $('#annEditor').contains(s.anchorNode)) _savedRange=s.getRangeAt(0); }
function restoreSel(){ const ed=$('#annEditor'); ed.focus(); if(_savedRange){ const s=window.getSelection(); s.removeAllRanges(); s.addRange(_savedRange); } }
function rteCmd(cmd,val){ restoreSel(); document.execCommand(cmd,false,val||null); saveSel(); }
function fillAnnTreffen(selId){
  const opts=['<option value="">(kein Treffen)</option>']
    .concat(cache.plans.filter(p=>!p.is_base).sort((a,b)=>(b.datum||'').localeCompare(a.datum||''))
      .map(p=>`<option value="${p.id}" ${p.id===selId?'selected':''}>${esc(p.name)}${p.datum?' · '+fmtDate(p.datum):''}</option>`));
  $('#annTreffen').innerHTML=opts.join('');
}
async function annNewTreffen(){
  const datum=prompt('Datum des Treffens (JJJJ-MM-TT)?'); if(datum===null) return;
  const name=prompt('Name des Treffens?', datum?`Treffen ${datum}`:'')||''; if(!name.trim()) return;
  const plan=await createTreffen(name.trim(), datum||null); if(!plan) return;
  fillAnnTreffen(plan.id); toast('Treffen angelegt');
}
function openAnnEditor(id){
  _annEditId=id||null; _savedRange=null;
  const a=id?cache.ann.find(x=>x.id===id):null;
  $('#annModalTitle').textContent = id?'Info bearbeiten':'Neue Info';
  $('#annT').value = a?(a.titel||''):'';
  $('#annEditor').innerHTML = a?(a.text||''):'';
  fillAnnTreffen(a?a.plan_id:'');
  $('#annErr').textContent='';
  $('#annModal').hidden=false;
}
function closeAnnEditor(){ $('#annModal').hidden=true; _annEditId=null; }
async function saveAnn(){
  const titel=$('#annT').value.trim();
  if(!titel){ $('#annErr').textContent='Titel fehlt'; return; }
  const text=$('#annEditor').innerHTML;
  const plan_id=$('#annTreffen').value||null;
  const res = _annEditId
    ? await SB.from('announcements').update({titel,text,plan_id}).eq('id',_annEditId)
    : await SB.from('announcements').insert({titel,text,plan_id});
  if(res.error){ $('#annErr').textContent=res.error.message; return; }
  closeAnnEditor(); await loadAll(); renderStart(); toast('Gespeichert');
}
async function delAnn(id){
  if(!confirm('Diese Info löschen?')) return;
  await SB.from('announcements').delete().eq('id',id);
  await loadAll(); renderStart();
}
let _rteFileMode='img';
function rteInsertFileTrigger(mode){ _rteFileMode=mode; saveSel();
  $('#rteFile').accept = mode==='img'?'image/*':'application/pdf'; $('#rteFile').value=''; $('#rteFile').click(); }
async function rteFilePicked(file){
  if(!file) return;
  const url=await uploadFile(file, _rteFileMode==='img'?'info-bilder':'info-pdfs'); if(!url) return;
  restoreSel();
  if(_rteFileMode==='img') document.execCommand('insertHTML',false,`<img src="${url}" alt="">`);
  else document.execCommand('insertHTML',false,`<a href="${url}" target="_blank">📄 ${esc(file.name)}</a>&nbsp;`);
  saveSel();
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

// ---------- Events ----------
function bind(){
  $$('.nav-btn').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
  $$('.subnav').forEach(nav=>$$('.sub-btn',nav).forEach(b=>b.onclick=()=>{
    $$('.sub-btn',nav).forEach(x=>x.classList.toggle('active',x===b));
    const sp=nav.parentElement;
    $$('.subpage',sp).forEach(p=>p.classList.toggle('active',p.id==='sub-'+b.dataset.sub));
    renderActivePage();
  }));
  $('#gateLogin').onclick=gateLogin;
  $('#gatePass').onkeydown=e=>{ if(e.key==='Enter') gateLogin(); };
  $('#gateEmail').onkeydown=e=>{ if(e.key==='Enter') gateLogin(); };
  $('#logoutBtn').onclick=()=>SB.auth.signOut();
  $('#viewAs').onchange=function(){ setViewAs(this.value); };
  $('#contactSearch').oninput=renderContacts;
  $$('.grades-cols-btn').forEach(b=>b.onclick=()=>manageGradeCols(b.dataset.fach));
  ['#ptYear','#ptWeek','#ptStudent'].forEach(s=>$(s).onchange=renderPractice);
  $('#newMeetingBtn').onclick=()=>{ $('#meetingModal').hidden=false; };
  $('#meetingCancel').onclick=()=>{ $('#meetingModal').hidden=true; };
  $('#meetingSave').onclick=saveMeeting;
  $('#paSearch').oninput=renderPersonAdmin;
  $('#paAddBtn').onclick=addPersonDialog;
  $('#trAddBtn').onclick=addTreffen;
  $('#ptAddBtn').onclick=createPractice;
  $('#ptWeekGenBtn').onclick=genPracticeWeek;
  $('#ttAddBtn').onclick=addLesson;
  $('#ttNewPlanBtn').onclick=copyPlan;
  $('#ttTimesBtn').onclick=manageTimeSlots;
  $('#ttPlan').onchange=renderStundenplan;
  $('#ttView').onchange=renderStundenplan;

  // Generischer Dialog
  $('#dlgCancel').onclick=closeDialog;
  $('#dlgSave').onclick=async()=>{ if(_dlgSave){ const r=await _dlgSave(); if(r!==false) closeDialog(); } else closeDialog(); };

  // Info-Rich-Editor
  $('#annNewBtn').onclick=()=>openAnnEditor();
  $('#absNewBtn').onclick=addAbsenceDialog;
  $('#annCancel').onclick=closeAnnEditor;
  $('#annSave').onclick=saveAnn;
  $('#annNewTreffen').onclick=annNewTreffen;
  const ed=$('#annEditor');
  ['keyup','mouseup','focus'].forEach(ev=>ed.addEventListener(ev,saveSel));
  $$('.rte-toolbar [data-cmd]').forEach(b=>{
    b.addEventListener('mousedown',e=>e.preventDefault());
    b.onclick=()=>rteCmd(b.dataset.cmd);
  });
  $('#rteFont').onchange=function(){ if(this.value) rteCmd('fontName',this.value); this.value=''; };
  $('#rteSize').onchange=function(){ if(this.value) rteCmd('fontSize',this.value); this.value=''; };
  $('#rteImg').addEventListener('mousedown',e=>e.preventDefault());
  $('#rtePdf').addEventListener('mousedown',e=>e.preventDefault());
  $('#rteImg').onclick=()=>rteInsertFileTrigger('img');
  $('#rtePdf').onclick=()=>rteInsertFileTrigger('pdf');
  $('#rteFile').onchange=function(){ rteFilePicked(this.files[0]); };
}

// ---------- Start ----------
bind();
initAuth();
