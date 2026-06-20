/* ============================================================
 *  Dirigentenschule – App-Logik
 * ============================================================ */

// ---------- State ----------
let session = null;
let currentPerson = null;          // Datensatz aus people (per E-Mail/auth_id)
let isStaff = false;               // lehrer | admin
let isAdmin = false;
let seesAll = false;               // Lehrer & Admin sehen alle Schüler

// Darf der aktuelle Nutzer einen Bereich bearbeiten?
function canEdit(area){
  if(isAdmin) return true;
  if(currentPerson?.rolle==='lehrer') return currentPerson.permissions?.[area]===true;
  return false;
}
// Welche Schüler-Zeilen sind sichtbar? (Schüler nur sich selbst)
function visibleStudents(){
  if(seesAll || !currentPerson || currentPerson.rolle!=='schueler') return students();
  return students().filter(p=>p.id===currentPerson.id);
}
const cache = { people:[], ann:[], practice:[], meetings:[], tasks:[], status:[], tests:[], grades:[], docs:[], tt:[], plans:[] };

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
async function afterSession(){
  isStaff=false; isAdmin=false; seesAll=false; currentPerson=null;
  applyAuthGate();
  if(session?.user){
    // Person über auth_id oder E-Mail zuordnen
    const email=session.user.email;
    const { data } = await SB.from('people').select('*')
      .or(`auth_id.eq.${session.user.id},email.eq.${email}`).limit(1);
    currentPerson = data?.[0]||null;
    if(currentPerson){
      isStaff = ['lehrer','admin'].includes(currentPerson.rolle);
      isAdmin = currentPerson.rolle==='admin';
      seesAll = isStaff;
      // auth_id nachtragen falls nur per E-Mail gematcht
      if(!currentPerson.auth_id){
        SB.from('people').update({auth_id:session.user.id}).eq('id',currentPerson.id).then(()=>{});
      }
    }
    $('#logoutBtn').hidden=false;
    $('#userBadge').textContent = currentPerson ? fullName(currentPerson) : email;
  }else{
    $('#logoutBtn').hidden=true; $('#userBadge').textContent='';
  }
  $$('.admin-only').forEach(el=>el.hidden=!isAdmin);
  $('#newMeetingBtn').hidden = !canEdit('theorie');
  $('#annNewBtn').hidden = !canEdit('infos');
  $('#ptAddBtn').hidden = !currentPerson;
  $('#ttAddBtn').hidden = !canEdit('stundenplan');
  $('#ttNewPlanBtn').hidden = !canEdit('stundenplan');
  await loadAll();
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
  const [people,practice,meetings,tasks,status,tests,grades,tt,plans] = await Promise.all([
    SB.from('people').select('*').order('sort'),
    SB.from('practice_times').select('*'),
    SB.from('theory_meetings').select('*').order('datum'),
    SB.from('theory_tasks').select('*').order('sort'),
    SB.from('theory_status').select('*'),
    SB.from('tests').select('*'),
    SB.from('grades').select('*'),
    SB.from('timetable').select('*'),
    SB.from('plans').select('*').order('sort'),
  ]);
  cache.people=people.data||[]; cache.practice=practice.data||[];
  cache.meetings=meetings.data||[]; cache.tasks=tasks.data||[];
  cache.status=status.data||[]; cache.tests=tests.data||[]; cache.grades=grades.data||[];
  cache.tt=tt.data||[]; cache.plans=plans.data||[];
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
  ({start:renderStart, ha:renderHA, info:renderInfoTab, stundenplan:renderStundenplan,
    kontakte:renderContacts, bewertung:renderBewertung, admin:renderAdmin}[active]||(()=>{}))();
}

// ---------- START ----------
function renderStart(){
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
  // Standard: neueste KW
  if(!$('#ptYear').value && years[0]) $('#ptYear').value=years[0];
  if(!$('#ptWeek').value && weeks[0]) $('#ptWeek').value=weeks[0];
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
      <td>${r.jahr}</td><td>${r.kw}</td><td>${fmtDate(r.datum)}</td>
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
  const body=SUBJECTS.map(s=>`<label>${s.label} (Min)<select id="dp_${s.key}">${minOpts(+r[s.key]||0)}</select></label>`).join('')
    +`<label class="chk"><input type="checkbox" id="dp_ferien" ${r.ferien?'checked':''}> Ferien</label>`;
  openDialog(`${fullName(personById(r.person_id))} – KW ${r.kw}/${r.jahr}`, body, async()=>{
    const upd={ferien:$('#dp_ferien').checked, updated_at:new Date().toISOString()};
    SUBJECTS.forEach(s=>upd[s.key]=parseInt($('#dp_'+s.key).value)||0);
    const {error}=await SB.from('practice_times').update(upd).eq('id',r.id);
    if(error){ toast(error.message,'err'); return false; }
    Object.assign(r,upd); renderPractice(); toast('Gespeichert');
  });
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
    <label class="chk"><input type="checkbox" id="dp_ferien"> Ferien</label>`;
  openDialog('Neuer Übezeit-Eintrag', body, async()=>{
    const pid=lockSelf?me.id:$('#dp_person').value;
    const rec={person_id:pid, jahr:parseInt($('#dp_jahr').value)||now.getFullYear(),
      kw:parseInt($('#dp_kw').value)||isoWeek(now), datum:new Date().toISOString().slice(0,10),
      ferien:$('#dp_ferien').checked};
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
  const list=cache.people.filter(p=>p.aktiv&&fullName(p).toLowerCase().includes(q))
    .sort((a,b)=>a.sort-b.sort);
  const roleLabel={schueler:'Schüler',lehrer:'Lehrer',admin:'Admin'};
  $('#contactsGrid').innerHTML = list.map(p=>{
    const img = p.bild_url?`<img src="${esc(p.bild_url)}" alt="">`:`<div class="contact-ph">👤</div>`;
    const mayEdit = isAdmin || (currentPerson&&currentPerson.id===p.id);
    return `<div class="contact-card">${img}<div>
      <div class="nm">${esc(fullName(p))}</div>
      <div class="meta">
        ${p.gemeinde?esc(p.gemeinde)+'<br>':''}
        ${p.email?`<a href="mailto:${esc(p.email)}">${esc(p.email)}</a><br>`:''}
        ${p.telefon?`<a href="tel:${esc(p.telefon)}">${esc(p.telefon)}</a>`:''}
      </div>
      <span class="role-pill">${roleLabel[p.rolle]||p.rolle}</span>
      ${mayEdit?`<div><button class="btn-ghost edit-btn" onclick="editContact('${p.id}')">Bearbeiten</button></div>`:''}
    </div></div>`;
  }).join('')||'<p class="muted">Keine Kontakte gefunden.</p>';
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
  sel.innerHTML=ordered.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if([...sel.options].some(o=>o.value===cur)) sel.value=cur;
  else { const b=basePlan(); if(b) sel.value=b.id; }
}
function myToken(){
  if(!currentPerson) return null;
  const v=(currentPerson.vorname||'').trim(), n=(currentPerson.nachname||'').trim();
  return (v&&n)?`${v} ${n[0]}.`:null;
}
function lessonIsMine(r, token){
  if(!token) return false; const t=token.toLowerCase();
  return [r.schueler,r.lehrer,r.klavier].some(x=>x&&x.toLowerCase().includes(t));
}
function renderStundenplan(){
  fillPlanSelect();
  const planId=currentPlanId();
  const view=$('#ttView')?.value||'all';
  const edit=canEdit('stundenplan') && view==='all';
  $('#ttAddBtn').hidden = !edit;
  const token=view==='mine'?myToken():null;
  const rows=cache.tt.filter(r=>r.tag==='samstag' && r.plan_id===planId);
  const slots=[...new Map(rows.map(r=>[r.zeit,r.zeit_sort??0])).entries()].sort((a,b)=>a[1]-b[1]).map(e=>e[0]);
  const fachIdx=f=>{ const i=FACH_ORDER.indexOf(f); return i<0?99:i; };
  const cellHtml=r=>{
    const meta=[
      r.lehrer?`<div class="tt-meta">L: ${esc(r.lehrer)}</div>`:'',
      r.klavier?`<div class="tt-meta">K: ${esc(r.klavier)}</div>`:'',
      r.raum?`<div class="tt-room">R: ${esc(r.raum)}</div>`:'',
    ].join('');
    return `<div class="tt-cell ${edit?'editable':''}" ${edit?`onclick="editLesson('${r.id}')"`:''}>
      ${r.schueler?`<div class="tt-stu">${esc(r.schueler)}</div>`:''}${meta}</div>`;
  };
  const subjectsHtml=slotRows=>{
    const fachs=[...new Set(slotRows.map(r=>r.fach))].sort((a,b)=>fachIdx(a)-fachIdx(b));
    return fachs.map(f=>{
      const horiz=['Musiktheorie','Arrangieren'].includes(f)?' row':'';
      const cells=slotRows.filter(r=>r.fach===f).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(cellHtml).join('');
      return `<div class="tt-subject"><div class="tt-fach">${esc(f)}</div><div class="tt-cells${horiz}">${cells}</div></div>`;
    }).join('');
  };
  if(view==='mine' && !token){
    $('#ttGrid').innerHTML='<p class="muted">Für deinen Account ist kein Name hinterlegt – „Mein Plan" ist nicht verfügbar.</p>';
    return;
  }
  let html=slots.map(zeit=>{
    let slotRows=rows.filter(r=>r.zeit===zeit);
    if(slotRows.length && slotRows.every(r=>r.fach==='Pause'))
      return `<div class="tt-slot"><div class="tt-time">${esc(zeit)}</div><div class="tt-pause">Pause</div></div>`;
    if(token){
      const mine=slotRows.filter(r=>lessonIsMine(r,token));
      if(!mine.length) return `<div class="tt-slot"><div class="tt-time">${esc(zeit)}</div><div class="tt-free">Freistunde</div></div>`;
      slotRows=mine;
    }
    return `<div class="tt-slot"><div class="tt-time">${esc(zeit)}</div><div class="tt-subjects">${subjectsHtml(slotRows)}</div></div>`;
  }).join('');
  $('#ttGrid').innerHTML = html || '<p class="muted">Dieser Plan ist leer.</p>';
}
async function copyPlan(){
  const base=basePlan(); if(!base){ toast('Kein Grundplan vorhanden','err'); return; }
  const body=`<label>Name<input id="cp_name" placeholder="z.B. Treffen 14.06.2026"></label>
    <label>Datum<input type="date" id="cp_datum"></label>
    <p class="muted">Erstellt eine Kopie des Grundplans, die du anpassen kannst (Vertretung/Ausfall).</p>`;
  openDialog('Neuen Plan anlegen (Kopie Grundplan)', body, async()=>{
    const name=$('#cp_name').value.trim(); if(!name){ toast('Name fehlt','err'); return false; }
    const {data:plan,error}=await SB.from('plans')
      .insert({name, datum:$('#cp_datum').value||null, is_base:false, sort:(Math.max(0,...cache.plans.map(p=>p.sort||0))+1)})
      .select().single();
    if(error){ toast(error.message,'err'); return false; }
    const copies=cache.tt.filter(r=>r.plan_id===base.id).map(r=>({plan_id:plan.id, tag:r.tag, zeit:r.zeit,
      zeit_sort:r.zeit_sort, fach:r.fach, schueler:r.schueler, lehrer:r.lehrer, klavier:r.klavier, raum:r.raum, sort:r.sort}));
    if(copies.length){
      const {data:ins,error:e2}=await SB.from('timetable').insert(copies).select();
      if(e2){ toast(e2.message,'err'); return false; } cache.tt.push(...(ins||[]));
    }
    cache.plans.push(plan); fillPlanSelect(); $('#ttPlan').value=plan.id; renderStundenplan(); toast('Plan angelegt');
  });
}
function lessonForm(r){
  r=r||{};
  const fachOpts=FACH_ORDER.concat(['Pause']).map(f=>`<option ${r.fach===f?'selected':''}>${f}</option>`).join('');
  return `<label>Zeit<input id="tl_zeit" value="${esc(r.zeit||'')}" placeholder="z.B. 10:00 - 10:45"></label>
    <label>Fach<select id="tl_fach">${fachOpts}</select></label>
    <label>Schüler / Gruppe<input id="tl_stu" value="${esc(r.schueler||'')}"></label>
    <label>Lehrer<input id="tl_leh" value="${esc(r.lehrer||'')}"></label>
    <label>Klavierbegleitung<input id="tl_kla" value="${esc(r.klavier||'')}"></label>
    <label>Raum<input id="tl_raum" value="${esc(r.raum||'')}"></label>`;
}
function readLessonForm(){
  return { zeit:$('#tl_zeit').value.trim(), fach:$('#tl_fach').value,
    schueler:$('#tl_stu').value.trim()||null, lehrer:$('#tl_leh').value.trim()||null,
    klavier:$('#tl_kla').value.trim()||null, raum:$('#tl_raum').value.trim()||null };
}
function slotSortFor(zeit){ const r=cache.tt.find(x=>x.zeit===zeit); return r?r.zeit_sort:(Math.max(0,...cache.tt.map(x=>x.zeit_sort||0))+1); }
function editLesson(id){
  const r=cache.tt.find(x=>x.id===id); if(!r) return;
  let body=lessonForm(r)+`<button class="btn-ghost" style="margin-top:4px" onclick="delLesson('${id}')">Eintrag löschen</button>`;
  openDialog('Stundenplan-Eintrag', body, async()=>{
    const upd=readLessonForm(); upd.zeit_sort=slotSortFor(upd.zeit); upd.updated_at=new Date().toISOString();
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
function renderGrades(fach, sel){
  const rows=cache.grades.filter(g=>g.fach===fach);
  const edit=canEdit('bewertung');
  const list=visibleStudents();
  if(!rows.length && !edit){ $(sel).innerHTML='<p class="muted" style="padding:14px">Keine Gesamtbewertung.</p>'; return; }
  const head=`<tr><th class="name">Schüler</th><th>HA-Überpr.</th><th>Hausaufgaben</th>
    <th>Klausur 1</th><th>Klausur 2</th><th class="sum">Gesamt</th><th>Note</th></tr>`;
  const c=v=>v==null?'–':Math.round(v)+'%';
  const body=list.map(p=>{
    const g=rows.find(x=>x.person_id===p.id);
    if(!g && !edit) return '';
    const gg=g||{};
    return `<tr class="${edit?'cell-edit':''}" ${edit?`onclick="editGrade('${p.id}','${fach}')"`:''}>
      <td class="name">${esc(fullName(p))}</td>
      <td>${c(gg.ha_ueberpruefung)}</td><td>${c(gg.hausaufgaben)}</td>
      <td>${c(gg.klausur1)}</td><td>${c(gg.klausur2)}</td>
      <td class="sum">${c(gg.gesamt)}</td><td>${esc(gg.gesamtnote||'')}</td></tr>`;
  }).join('');
  $(sel).innerHTML=`<table>${head}${body}</table>`;
}
function editGrade(personId, fach){
  const g=cache.grades.find(x=>x.fach===fach&&x.person_id===personId)||{};
  const f=(id,lbl,val)=>`<label>${lbl}<input type="number" id="${id}" min="0" max="100" value="${val==null?'':Math.round(val)}"></label>`;
  const body=f('dg_ha','HA-Überprüfung (%)',g.ha_ueberpruefung)+f('dg_hu','Hausaufgaben (%)',g.hausaufgaben)
    +f('dg_k1','Klausur 1 (%)',g.klausur1)+f('dg_k2','Klausur 2 (%)',g.klausur2)+f('dg_ges','Gesamt (%)',g.gesamt)
    +`<label>Note<input id="dg_note" value="${esc(g.gesamtnote||'')}"></label>`;
  openDialog(`${fullName(personById(personId))} – Gesamtbewertung`, body, async()=>{
    const payload={fach,person_id:personId,
      ha_ueberpruefung:parseNum($('#dg_ha').value), hausaufgaben:parseNum($('#dg_hu').value),
      klausur1:parseNum($('#dg_k1').value), klausur2:parseNum($('#dg_k2').value),
      gesamt:parseNum($('#dg_ges').value), gesamtnote:$('#dg_note').value||null};
    const {data,error}=await SB.from('grades').upsert(payload,{onConflict:'fach,person_id'}).select().single();
    if(error){ toast(error.message,'err'); return false; }
    const i=cache.grades.findIndex(x=>x.fach===fach&&x.person_id===personId);
    if(i>=0) cache.grades[i]=data; else cache.grades.push(data);
    renderBewertung(); toast('Gespeichert');
  });
}

// ---------- ADMIN ----------
function renderAdmin(){
  renderPersonAdmin();
}
function renderPersonAdmin(){
  const roleOpts=r=>['schueler','lehrer','admin'].map(x=>
    `<option value="${x}" ${r===x?'selected':''}>${({schueler:'Schüler',lehrer:'Lehrer',admin:'Admin'})[x]}</option>`).join('');
  $('#personAdminList').innerHTML = cache.people.map(p=>{
    const perms = p.rolle==='lehrer'
      ? `<div class="perm-row">${EDIT_AREAS.map(a=>
          `<label><input type="checkbox" ${p.permissions?.[a.key]?'checked':''}
            onchange="savePermission('${p.id}','${a.key}',this.checked)"> ${a.label}</label>`).join('')}</div>`
      : '';
    return `<div class="person-item ${p.aktiv?'':'inactive'}">
      <div class="pi-head">
        <span class="pi-name">${esc(fullName(p))}</span>
        <input class="pi-email" type="email" value="${esc(p.email||'')}" placeholder="E-Mail"
          onchange="savePerson('${p.id}','email',this.value)">
        <select onchange="savePerson('${p.id}','rolle',this.value)">${roleOpts(p.rolle)}</select>
        <label class="pi-active"><input type="checkbox" ${p.aktiv?'checked':''}
          onchange="savePerson('${p.id}','aktiv',this.checked)"> aktiv</label>
      </div>${perms}</div>`;
  }).join('');
}
async function savePerson(id, field, value){
  const {error}=await SB.from('people').update({[field]:value}).eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  const p=cache.people.find(x=>x.id===id); if(p) p[field]=value;
  if(field==='rolle') renderPersonAdmin();          // Rechte-Block ein-/ausblenden
  if(id===currentPerson?.id) afterSession();          // eigene Rechte sofort anwenden
  toast('Gespeichert');
}
async function savePermission(id, area, value){
  const p=cache.people.find(x=>x.id===id); if(!p) return;
  const perms={...(p.permissions||{}), [area]:value};
  const {error}=await SB.from('people').update({permissions:perms}).eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  p.permissions=perms;
  if(id===currentPerson?.id) currentPerson.permissions=perms;
  toast('Gespeichert');
}
async function addPerson(){
  const vorname=$('#npVorname').value.trim(), nachname=$('#npNachname').value.trim();
  const email=$('#npEmail').value.trim(), rolle=$('#npRolle').value;
  if(!nachname){ toast('Nachname fehlt','err'); return; }
  const {error}=await SB.from('people').insert({vorname,nachname,email:email||null,rolle,
    sort:(Math.max(0,...cache.people.map(p=>p.sort||0))+10)});
  if(error){ toast(error.message,'err'); return; }
  $('#npVorname').value=$('#npNachname').value=$('#npEmail').value='';
  await loadAll(); renderAdmin(); toast('Person angelegt');
}
// ---------- INFOS (Rich-Text-Editor) ----------
let _annEditId=null, _savedRange=null;
function saveSel(){ const s=window.getSelection(); if(s.rangeCount && $('#annEditor').contains(s.anchorNode)) _savedRange=s.getRangeAt(0); }
function restoreSel(){ const ed=$('#annEditor'); ed.focus(); if(_savedRange){ const s=window.getSelection(); s.removeAllRanges(); s.addRange(_savedRange); } }
function rteCmd(cmd,val){ restoreSel(); document.execCommand(cmd,false,val||null); saveSel(); }
function openAnnEditor(id){
  _annEditId=id||null; _savedRange=null;
  const a=id?cache.ann.find(x=>x.id===id):null;
  $('#annModalTitle').textContent = id?'Info bearbeiten':'Neue Info';
  $('#annT').value = a?(a.titel||''):'';
  $('#annEditor').innerHTML = a?(a.text||''):'';
  $('#annErr').textContent='';
  $('#annModal').hidden=false;
}
function closeAnnEditor(){ $('#annModal').hidden=true; _annEditId=null; }
async function saveAnn(){
  const titel=$('#annT').value.trim();
  if(!titel){ $('#annErr').textContent='Titel fehlt'; return; }
  const text=$('#annEditor').innerHTML;
  const res = _annEditId
    ? await SB.from('announcements').update({titel,text}).eq('id',_annEditId)
    : await SB.from('announcements').insert({titel,text});
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
  $('#gateLogin').onclick=gateLogin;
  $('#gatePass').onkeydown=e=>{ if(e.key==='Enter') gateLogin(); };
  $('#gateEmail').onkeydown=e=>{ if(e.key==='Enter') gateLogin(); };
  $('#logoutBtn').onclick=()=>SB.auth.signOut();
  $('#contactSearch').oninput=renderContacts;
  ['#ptYear','#ptWeek','#ptStudent'].forEach(s=>$(s).onchange=renderPractice);
  $('#newMeetingBtn').onclick=()=>{ $('#meetingModal').hidden=false; };
  $('#meetingCancel').onclick=()=>{ $('#meetingModal').hidden=true; };
  $('#meetingSave').onclick=saveMeeting;
  $('#importBtn').onclick=runImport;
  $('#npAddBtn').onclick=addPerson;
  $('#ptAddBtn').onclick=createPractice;
  $('#ttAddBtn').onclick=addLesson;
  $('#ttNewPlanBtn').onclick=copyPlan;
  $('#ttPlan').onchange=renderStundenplan;
  $('#ttView').onchange=renderStundenplan;

  // Generischer Dialog
  $('#dlgCancel').onclick=closeDialog;
  $('#dlgSave').onclick=async()=>{ if(_dlgSave){ const r=await _dlgSave(); if(r!==false) closeDialog(); } else closeDialog(); };

  // Info-Rich-Editor
  $('#annNewBtn').onclick=()=>openAnnEditor();
  $('#annCancel').onclick=closeAnnEditor;
  $('#annSave').onclick=saveAnn;
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
