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
let ttSelectedDay = 'samstag';     // aktuell gewählter Tag im Stundenplan

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
const cache = { people:[], ann:[], practice:[], meetings:[], tasks:[], status:[], tests:[], grades:[], docs:[], tt:[], plans:[], gradeCols:[], rooms:[], timeSlots:[], absences:[], testCols:[] };

// ---------- Utils ----------
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const esc = s => (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fullName = p => p ? `${p.nachname}, ${p.vorname||''}`.replace(/,\s*$/,'') : '';
const fmtDate = d => d ? new Date(d).toLocaleDateString('de-DE') : '';
// wie fmtDate, aber Platzhalterdaten (Jahr < 2000, z.B. importierte Kapitel ohne echtes Datum) werden ausgeblendet
const fmtDateOpt = d => (d && new Date(d).getFullYear() >= 2000) ? fmtDate(d) : '';
function toast(msg,type='ok'){
  const t=$('#toast'); t.textContent=msg; t.className='toast '+type; t.hidden=false;
  clearTimeout(t._t); t._t=setTimeout(()=>t.hidden=true,2800);
}
// Bereinigt vom Editor gespeichertes HTML (entfernt Skripte & Event-Handler) – Schutz vor XSS
function sanitizeHtml(html){
  const tpl=document.createElement('template'); tpl.innerHTML=html||'';
  tpl.content.querySelectorAll('script,iframe,object,embed,link,meta,style,form').forEach(n=>n.remove());
  tpl.content.querySelectorAll('*').forEach(el=>{
    [...el.attributes].forEach(a=>{
      const n=a.name.toLowerCase();
      if(n.startsWith('on')) el.removeAttribute(a.name);
      else if((n==='href'||n==='src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });
  return tpl.innerHTML;
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
// nameOverride: fester Dateiname statt Zufalls-UUID (für Avatare nötig, siehe Storage-RLS
// in supabase_migration_v22_storage.sql – dort wird geprüft, dass avatars/<eigene-person-id>.*
// nur von der Person selbst oder Admin beschrieben werden darf).
async function uploadFile(file, prefix, nameOverride){
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const base=nameOverride || (crypto.randomUUID?crypto.randomUUID():Date.now());
  const path=`${prefix}/${base}.${ext}`;
  const { error }=await SB.storage.from('docs').upload(path, file, {upsert:true});
  if(error){ toast('Upload-Fehler: '+error.message,'err'); return null; }
  return SB.storage.from('docs').getPublicUrl(path).data.publicUrl;
}

// ---------- Auth ----------
// Wird direkt beim Laden ausgewertet (Reset-Link enthält #...&type=recovery bzw. ?...&type=recovery),
// damit wir die Erkennung nicht dem PASSWORD_RECOVERY-Event überlassen müssen – das kommt teils zu
// spät (nach der ersten getSession()/afterSession()) und die App würde sonst kurz normal einloggen.
const IS_PASSWORD_RECOVERY = /(^|[?#&])type=recovery(&|$)/.test(location.hash) || /(^|[?#&])type=recovery(&|$)/.test(location.search);
let inPasswordRecovery = IS_PASSWORD_RECOVERY;
async function initAuth(){
  if(inPasswordRecovery) showPasswordResetGate();
  const { data } = await SB.auth.getSession();
  session = data.session;
  if(!inPasswordRecovery) await afterSession();
  SB.auth.onAuthStateChange((e,s)=>{
    session=s;
    if(e==='PASSWORD_RECOVERY'){ inPasswordRecovery=true; showPasswordResetGate(); return; }
    if(!inPasswordRecovery) afterSession();
  });
}
// Passwort-Regeln: mind. 8 Zeichen, Groß-/Kleinbuchstabe, Zahl, Sonderzeichen
function validatePassword(pw){
  if(!pw || pw.length<8) return 'Mindestens 8 Zeichen.';
  if(!/[a-z]/.test(pw)) return 'Mindestens ein Kleinbuchstabe.';
  if(!/[A-Z]/.test(pw)) return 'Mindestens ein Großbuchstabe.';
  if(!/[0-9]/.test(pw)) return 'Mindestens eine Zahl.';
  if(!/[^A-Za-z0-9]/.test(pw)) return 'Mindestens ein Sonderzeichen.';
  return null;
}
async function gateForgotPassword(){
  const email = prompt('Für welche E-Mail-Adresse soll das Passwort zurückgesetzt werden?');
  if(!email) return;
  const { error } = await SB.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: location.origin + location.pathname
  });
  if(error){ toast(error.message,'err'); return; }
  toast('Falls die Adresse bekannt ist, wurde eine E-Mail mit einem Link zum Zurücksetzen verschickt.');
}
function showPasswordResetGate(){
  $('#authGate').hidden=true; $('#appHeader').hidden=true; $('#appMain').hidden=true;
  $('#pwResetGate').hidden=false;
}
async function savePasswordReset(){
  const pw=$('#pwrNew').value, pw2=$('#pwrNew2').value;
  $('#pwrErr').textContent='';
  const vErr=validatePassword(pw);
  if(vErr){ $('#pwrErr').textContent=vErr; return; }
  if(pw!==pw2){ $('#pwrErr').textContent='Passwörter stimmen nicht überein.'; return; }
  $('#pwrSaveBtn').disabled=true;
  const { error } = await SB.auth.updateUser({ password: pw });
  $('#pwrSaveBtn').disabled=false;
  if(error){ $('#pwrErr').textContent=error.message; return; }
  inPasswordRecovery=false;
  history.replaceState(null,'',location.pathname);
  $('#pwResetGate').hidden=true;
  toast('Passwort gespeichert.');
  applyAuthGate();
  await afterSession();
}
async function changeOwnPassword(){
  const body=`<label>Neues Passwort<input type="password" id="pcNew" autocomplete="new-password"></label>
    <label>Passwort wiederholen<input type="password" id="pcNew2" autocomplete="new-password"></label>
    <p class="muted" style="font-size:.85em">Mind. 8 Zeichen, Groß- und Kleinbuchstabe, Zahl und Sonderzeichen.</p>`;
  openDialog('Passwort ändern', body, async()=>{
    const pw=$('#pcNew').value, pw2=$('#pcNew2').value;
    const vErr=validatePassword(pw);
    if(vErr){ toast(vErr,'err'); return false; }
    if(pw!==pw2){ toast('Passwörter stimmen nicht überein.','err'); return false; }
    const { error } = await SB.auth.updateUser({ password: pw });
    if(error){ toast(error.message,'err'); return false; }
    toast('Passwort geändert.');
    return true;
  });
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
  // „Neues Treffen" entfällt: Hausaufgaben-Treffen leiten sich aus den allgemeinen Treffen ab.
  $('#annNewBtn').hidden = !canEdit('infos');
  $('#absNewBtn').hidden = !canEdit('abmeldungen');
  $('#ptAddBtn').hidden = !currentPerson;
  $('#ptWeekGenBtn').hidden = !isAdmin;
  $('#ttAddBtn').hidden = !canEdit('stundenplan');
  $('#ttTimesBtn').hidden = !isAdmin;   // „Zeiten" nur für Admin
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
    $('#pwChangeBtn').hidden=false;
    $('#userBadge').textContent = currentPerson ? fullName(currentPerson) : email;
  }else{
    $('#logoutBtn').hidden=true; $('#pwChangeBtn').hidden=true; $('#userBadge').textContent='';
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
  const [people,practice,meetings,tasks,status,tests,grades,tt,plans,gradeCols,rooms,timeSlots,absences,testCols] = await Promise.all([
    SB.from('people').select('*').order('sort'),
    SB.from('practice_times').select('*'),
    SB.from('theory_meetings').select('*').order('sort').order('datum'),
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
    SB.from('test_columns').select('*').order('sort'),
  ]);
  cache.people=people.data||[]; cache.practice=practice.data||[];
  cache.meetings=meetings.data||[]; cache.tasks=tasks.data||[];
  cache.status=status.data||[]; cache.tests=tests.data||[]; cache.grades=grades.data||[];
  cache.tt=tt.data||[]; cache.plans=plans.data||[]; cache.gradeCols=gradeCols.data||[]; cache.rooms=rooms.data||[];
  cache.timeSlots=timeSlots.data||[]; cache.absences=absences.data||[]; cache.testCols=testCols.data||[];
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
  // Kennzahlen
  const cards=[
    {n:students().length, l:'Schüler'},
    {n:cache.meetings.length, l:'Theorie-Treffen'},
    {n:cache.plans.filter(p=>!p.is_base).length, l:'Treffen'},
    {n:cache.tt.filter(r=>r.tag==='samstag'&&r.plan_id===basePlan()?.id).length, l:'Stunden (Grundplan)'},
  ];
  const sc=$('#startCards'); if(sc) sc.innerHTML=cards.map(c=>`<div class="stat-card"><div class="num">${c.n}</div><div class="lbl">${c.l}</div></div>`).join('');

  const canInfo=canEdit('infos');
  const today=new Date().toISOString().slice(0,10);
  const roleLabelMap=Object.fromEntries(ROLES.map(r=>[r.key,r.label]));
  const absLi=a=>{ const p=personById(a.person_id);
    const rolle=p?(roleLabelMap[primaryRole(p)]||'Schüler'):'Schüler';
    return `<li>${esc(p?fullName(p):'?')} <span class="muted">(${rolle})</span>${a.grund?` – ${esc(a.grund)}`:''}</li>`; };
  const infoHtml=a=>`<div class="ann-block"><h4>${esc(a.titel)} ${a.datum?`<span class="date">${fmtDate(a.datum)}</span>`:''}</h4>
      <div class="ann-body">${sanitizeHtml(a.text)}</div>
      ${canInfo?`<div class="ann-actions"><button class="btn-ghost" onclick="openAnnEditor('${a.id}')">Bearbeiten</button>
        <button class="btn-ghost" onclick="delAnn('${a.id}')">Löschen</button></div>`:''}</div>`;
  // Einheiten: pro Treffen (Info(s) + Abmeldungen), plus freie Infos ohne Treffen
  const units=[];
  cache.plans.filter(p=>!p.is_base).forEach(t=>{
    const infos=cache.ann.filter(a=>a.plan_id===t.id);
    const title=(infos[0]&&infos[0].titel)||defaultInfoTitle(t)||t.name||'Treffen';
    const body=infos.length ? infos.map(infoHtml).join('<hr class="ann-sep">')
      : `<div class="ann-block"><h4>${esc(title)}</h4><div class="ann-body muted">noch keine Infos</div></div>`;
    units.push({ kind:'treffen', plan:t, date:t.datum||'', title, body, abs:sortedAbsences(t.id) });
  });
  cache.ann.filter(a=>!a.plan_id).forEach(a=>units.push({ kind:'info', date:a.datum||'', title:a.titel||'Info', body:infoHtml(a), abs:[] }));

  const unitHtml=u=>`<div class="ann-item">${u.body}
    ${u.abs.length?`<div class="ann-abs"><b>Abmeldungen:</b><ul class="abs-ul">${u.abs.map(absLi).join('')}</ul></div>`:''}</div>`;
  const byDate=(a,b)=>(b.date||'').localeCompare(a.date||'');
  // aktuelles Treffen = nächstes anstehendes; nur dieses wird oben gezeigt
  const upcoming=units.filter(u=>u.kind==='treffen' && u.date && u.date>=today).sort((a,b)=>a.date.localeCompare(b.date));
  const activeId=upcoming.length?upcoming[0].plan.id:null;
  const top=units.filter(u=>u.kind==='info' || (u.plan&&u.plan.id===activeId)).sort(byDate);
  const below=units.filter(u=>u.kind==='treffen' && (!activeId || u.plan.id!==activeId)).sort(byDate);
  let html=top.length?top.map(unitHtml).join(''):'<p class="muted">Noch keine Infos.</p>';
  html+=below.map(u=>`<details class="past-termine"><summary>${esc(u.title)}${u.date?` · ${fmtDate(u.date)}`:''}</summary>${unitHtml(u)}</details>`).join('');
  $('#announcementsList').innerHTML = html;
}
// Datums-Anzeige eines Treffens: "20.11.-21.11.2026" (Fr+Sa) bzw. einzelnes Datum
function treffenDateLabel(plan){
  if(!plan||!plan.datum) return '';
  const d=new Date(plan.datum+'T00:00:00');
  const full=x=>`${x.getDate()}.${x.getMonth()+1}.${x.getFullYear()}`;
  if((plan.tage||'fr_sa')==='fr_sa'){
    const d0=new Date(d); d0.setDate(d.getDate()-1);
    return (d0.getMonth()===d.getMonth()&&d0.getFullYear()===d.getFullYear())
      ? `${d0.getDate()}.${d0.getMonth()+1}.-${full(d)}`
      : `${full(d0)}-${full(d)}`;
  }
  return full(d);
}
// Default-Titel: "<Nr> Dirigentenkurs am <Vortag>.-<Tag>.<Monat>.<Jahr>"
function defaultInfoTitle(plan){
  if(!plan) return '';
  const num=(plan.name||'').trim();
  if(!plan.datum) return (num?num+' ':'')+'Dirigentenkurs';
  const d=new Date(plan.datum+'T00:00:00'); const d0=new Date(d); d0.setDate(d.getDate()-1);
  const full=x=>`${x.getDate()}.${x.getMonth()+1}.${x.getFullYear()}`;
  const range=(d0.getMonth()===d.getMonth()&&d0.getFullYear()===d.getFullYear())
    ? `${d0.getDate()}.-${full(d)}`
    : `${d0.getDate()}.${d0.getMonth()+1}.-${full(d)}`;
  return `${num?num+' ':''}Dirigentenkurs am ${range}`;
}

// ---------- HAUSAUFGABEN ----------
function renderHA(){
  const sub = $('#page-ha .sub-btn.active')?.dataset.sub||'theorie';
  if(sub==='theorie') renderTheory(); else renderPractice();
}

// ----- Musiktheorie -----
function meetingPercent(meetingId, personId){
  const tasks = cache.tasks.filter(t=>t.meeting_id===meetingId);
  // Nur Aufgaben mit Status-Eintrag dieser Person zählen.
  // Fehlender Eintrag ("-"/leer beim Import) = für diese Person nicht relevant -> zieht das Treffen nicht auf 0 %.
  const rel = tasks.map(t=>({w:+t.gewicht||0, s:cache.status.find(s=>s.task_id===t.id&&s.person_id===personId)}))
    .filter(x=>x.s);
  const total = rel.reduce((s,x)=>s+x.w,0);
  if(!total) return null;
  const done = rel.filter(x=>x.s.erledigt).reduce((s,x)=>s+x.w,0);
  return Math.round(done/total*100);
}
// Ø über alle Theorie-Treffen (Hausaufgaben) einer Person – speist die Spalte „Hausaufgaben"
function hausaufgabenAvg(pid){
  const vals = cache.meetings.map(m=>meetingPercent(m.id,pid)).filter(v=>v!=null);
  return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
}
// Fleiß (Übezeiten) eines Faches in %: Summe der Minuten (pro Woche gedeckelt auf
// FLEISS_WEEK_CAP, inkl. Ferienwochen als Bonus) geteilt durch (Ziel × Anzahl
// Nicht-Ferien-Wochen), gedeckelt auf 100 %. Der Wochen-Cap verhindert, dass eine
// einzelne Woche mit sehr viel Übezeit beliebig viele andere Wochen ausgleicht –
// pro Woche zählt höchstens ein definierter Bonus über das Ziel hinaus.
const FLEISS_WEEK_CAP = PRACTICE_TARGET + 10;
function fleissAvg(pid, subjectKey){
  if(!SUBJECTS.some(s=>s.key===subjectKey)) return null;
  const rows = cache.practice.filter(r=>r.person_id===pid);
  let total=0, normalWeeks=0;
  rows.forEach(r=>{ total += Math.min(FLEISS_WEEK_CAP, +r[subjectKey]||0); if(!r.ferien) normalWeeks++; });
  if(!normalWeeks) return null;
  return Math.min(100, Math.round(total/(PRACTICE_TARGET*normalWeeks)*100));
}
// Ampelfarbe für Hausaufgaben-Prozente (wie in der Praktische-Fächer-Tabelle):
// bis 49 % rot, 50–80 % gelb, über 80 % grün.
function haCellClass(v){ return v==null?'':(v<50?'cell-red':v<=80?'cell-yellow':'cell-green'); }
// Das zu einem allgemeinen Treffen (plan) gehörende Theorie-Treffen
function meetingForPlan(planId){ return cache.meetings.find(m=>m.plan_id===planId); }
function renderTheory(){
  const treffen = cache.plans.filter(p=>!p.is_base)
    .sort((a,b)=>(a.datum||'').localeCompare(b.datum||'') || ((a.sort||0)-(b.sort||0)));
  const edit = canEdit('theorie');

  $('#theoryMeetings').innerHTML = `<p class="muted">${edit
    ? 'Auf eine Zelle klicken, um für ein Treffen die Aufgaben eines Schülers einzutragen. Neue Aufgaben (mit Beschreibung) legst du direkt im Popup an – sie gelten für alle Schüler dieses Treffens.'
    : 'Auf deine Zelle klicken, um deine erledigten Aufgaben je Treffen abzuhaken.'}</p>`;

  if(!treffen.length){
    $('#theoryMatrix').innerHTML='<p class="muted" style="padding:14px">Noch keine Treffen angelegt. Treffen werden im Admin-Bereich verwaltet.</p>';
    return;
  }
  const head = `<tr><th class="name">Schüler</th>${treffen.map(t=>
    `<th class="treffen-col">${esc(t.name||'Treffen')}<br><span class="col-date">${esc(treffenDateLabel(t))}</span></th>`).join('')}
    <th class="sum">Ø Gesamt</th></tr>`;
  const rows = visibleStudents().map(p=>{
    const mayRow = edit || (currentPerson && currentPerson.id===p.id);
    const vals=[];
    const cells = treffen.map(t=>{
      const m=meetingForPlan(t.id);
      const v=m?meetingPercent(m.id,p.id):null; vals.push(v);
      return `<td class="${mayRow?'cell-edit ':''}${haCellClass(v)}" ${mayRow?`onclick="openHaCell('${t.id}','${p.id}')"`:''}>${v==null?'–':v+'%'}</td>`;
    }).join('');
    const known=vals.filter(v=>v!=null);
    const avg=known.length?Math.round(known.reduce((a,b)=>a+b,0)/known.length):null;
    return `<tr><td class="name">${esc(fullName(p))}</td>${cells}<td class="sum ${haCellClass(avg)}">${avg==null?'–':avg+'%'}</td></tr>`;
  }).join('');
  $('#theoryMatrix').innerHTML = `<table>${head}${rows}</table>`;
}
async function upsertStatus(taskId, personId, done){
  const { error } = await SB.from('theory_status')
    .upsert({task_id:taskId, person_id:personId, erledigt:done, updated_at:new Date().toISOString()},
            {onConflict:'task_id,person_id'});
  if(error){ toast(error.message,'err'); return false; }
  const ex=cache.status.find(s=>s.task_id===taskId&&s.person_id===personId);
  if(ex) ex.erledigt=done; else cache.status.push({task_id:taskId,person_id:personId,erledigt:done});
  return true;
}
function haTaskRowHtml(t, personId, manage){
  const done = t && cache.status.find(s=>s.task_id===t.id&&s.person_id===personId)?.erledigt;
  const desc = manage
    ? `<textarea class="ha-desc ta" rows="2" placeholder="Beschreibung der Aufgabe">${t?esc(t.bezeichnung):''}</textarea>`
    : `<span class="ha-desc-text">${t?esc(t.bezeichnung):''}</span>`;
  const del = manage?`<button type="button" class="btn-ghost ha-del" title="Aufgabe löschen">✕</button>`:'';
  return `<div class="ha-task" data-id="${t?t.id:''}">
    <input type="checkbox" class="ha-done" ${done?'checked':''}>${desc}${del}</div>`;
}
// Popup: Aufgaben eines Schülers für ein Treffen eintragen (Schüler nur eigene; Admin/Lehrer alle + Aufgaben verwalten)
function openHaCell(planId, personId){
  const plan = cache.plans.find(p=>p.id===planId);
  const person = personById(personId);
  if(!plan||!person) return;
  const manage = canEdit('theorie');
  const mayEdit = manage || (currentPerson && currentPerson.id===personId);
  if(!mayEdit){ toast('Keine Berechtigung','err'); return; }
  let meeting = meetingForPlan(planId);
  const tasks = meeting ? cache.tasks.filter(t=>t.meeting_id===meeting.id).sort((a,b)=>((a.sort||0)-(b.sort||0))) : [];
  const listHtml = tasks.map(t=>haTaskRowHtml(t,personId,manage)).join('');

  const body = `<div id="haTasks">${listHtml||(manage?'':'<p class="muted" id="haEmpty">Für dieses Treffen wurden noch keine Aufgaben angelegt.</p>')}</div>
    ${manage
      ? `<button type="button" class="btn-ghost" id="haAdd">+ Aufgabe</button>
         <p class="muted">Der Haken markiert die Erledigung für <b>${esc(fullName(person))}</b>. Aufgaben gelten für alle Schüler dieses Treffens.</p>`
      : `<p class="muted">Setze den Haken bei den Aufgaben, die du erledigt hast.</p>`}`;

  openDialog(`${esc(fullName(person))} · ${esc(plan.name||'Treffen')}${treffenDateLabel(plan)?' · '+esc(treffenDateLabel(plan)):''}`, body, async()=>{
    const rowsEls = $$('#haTasks .ha-task');
    if(manage){
      const active = rowsEls.filter(el=>el.dataset.del!=='1' && ($('.ha-desc',el)?.value||'').trim());
      if(!meeting && active.length){
        const {data,error}=await SB.from('theory_meetings')
          .insert({plan_id:planId, datum:plan.datum||'1900-01-01', titel:plan.name||'Treffen', sort:0}).select().single();
        if(error){ toast(error.message,'err'); return false; }
        meeting=data; cache.meetings.push(data);
      }
      let sort=0;
      for(const el of rowsEls){
        const id=el.dataset.id;
        if(el.dataset.del==='1'){
          if(id){ await SB.from('theory_tasks').delete().eq('id',id);
            cache.tasks=cache.tasks.filter(t=>t.id!==id);
            cache.status=cache.status.filter(s=>s.task_id!==id); }
          continue;
        }
        const descv=($('.ha-desc',el)?.value||'').trim(); if(!descv) continue;
        sort+=1; const done=$('.ha-done',el)?.checked;
        let taskId=id;
        if(taskId){
          await SB.from('theory_tasks').update({bezeichnung:descv,sort}).eq('id',taskId);
          const ct=cache.tasks.find(t=>t.id===taskId); if(ct){ct.bezeichnung=descv; ct.sort=sort;}
        } else {
          const {data,error}=await SB.from('theory_tasks').insert({meeting_id:meeting.id,bezeichnung:descv,gewicht:1,sort}).select().single();
          if(error){ toast(error.message,'err'); return false; }
          taskId=data.id; cache.tasks.push(data);
        }
        if(!(await upsertStatus(taskId, personId, !!done))) return false;
      }
    } else {
      for(const el of rowsEls){
        const taskId=el.dataset.id; if(!taskId) continue;
        if(!(await upsertStatus(taskId, personId, !!$('.ha-done',el)?.checked))) return false;
      }
    }
    renderTheory(); renderBewertung(); toast('Gespeichert');
  });

  // Handler nach dem Rendern binden (Aufgabe hinzufügen / löschen)
  if(manage){
    const add=$('#haAdd');
    if(add) add.onclick=()=>{
      $('#haEmpty')?.remove();
      $('#haTasks').insertAdjacentHTML('beforeend', haTaskRowHtml(null, personId, true));
      $('#haTasks .ha-task:last-child .ha-desc')?.focus();
    };
    $('#haTasks').addEventListener('click', e=>{
      const b=e.target.closest('.ha-del'); if(!b) return;
      const row=b.closest('.ha-task');
      if(row.dataset.id){ row.dataset.del='1'; row.style.display='none'; } else row.remove();
    });
  }
}

// ----- Übezeiten -----
function practiceCellClass(min, ferien){
  if(ferien) return '';
  if(min<PRACTICE_TARGET/2) return 'cell-red';
  if(min<PRACTICE_TARGET) return 'cell-yellow';
  return 'cell-green';
}
function gesamtClass(sum, ferien){ return ferien?'':sum>=4*PRACTICE_TARGET?'cell-green':sum>=2*PRACTICE_TARGET?'cell-yellow':'cell-red'; }
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
      return `<td class="${practiceCellClass(v,r.ferien)}">${v} <span class="muted">Min</span></td>`;
    }).join('');
    return `<tr class="${canEditRow?'cell-edit':''}" ${canEditRow?`onclick="editPractice('${r.id}')"`:''}>
      <td>${r.jahr}</td><td>${r.kw}</td><td>${kwRange(r.jahr,r.kw)}</td>
      <td class="name">${esc(fullName(p))}</td>${cells}
      <td class="sum ${gesamtClass(sum,r.ferien)}">${sum} Min</td>
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
    Object.assign(r,upd);
    // Ferien gilt für die ganze Woche: Status auf alle Schüler dieser KW übernehmen.
    if(isAdmin){
      const fer=upd.ferien;
      const {error:e2}=await SB.from('practice_times')
        .update({ferien:fer, updated_at:new Date().toISOString()})
        .eq('jahr',r.jahr).eq('kw',r.kw);
      if(e2){ toast(e2.message,'err'); return false; }
      cache.practice.forEach(x=>{ if(x.jahr===r.jahr && x.kw===r.kw) x.ferien=fer; });
    }
    renderPractice(); toast('Gespeichert');
  });
}
async function genPracticeWeek(){
  if(!isAdmin) return;
  const today=new Date().toISOString().slice(0,10);
  const { error } = await SB.rpc('ensure_practice_until', { p_end: today });
  if(error){ toast(error.message,'err'); return; }
  await loadAll(); fillPracticeFilters(); renderPractice(); toast('Fehlende Wocheneinträge bis heute erzeugt');
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
    if(f){ const url=await uploadFile(f,'avatars',p.id); if(url) upd.bild_url=url+'?v='+Date.now(); }
    const {error}=await SB.from('people').update(upd).eq('id',p.id);
    if(error){ toast(error.message,'err'); return false; }
    Object.assign(p,upd); renderContacts(); toast('Gespeichert');
  });
}

// ---------- INFO-TAB (Pläne) ----------
function renderInfoTab(){
  const sel=$('#infoDocSel');
  if(sel && !sel.options.length) sel.innerHTML=SITE_DOCS.map(d=>`<option value="${d.key}">${esc(d.label)}</option>`).join('');
  const key=sel?.value || SITE_DOCS[0].key;
  const d=SITE_DOCS.find(x=>x.key===key)||SITE_DOCS[0];
  const doc=cache.docs.find(x=>x.key===key);
  $('#infoUploadLbl').hidden = !isAdmin;
  $('#infoDocView').innerHTML = doc?.url
    ? `<div class="doc-card"><div class="doc-head"><h3>${esc(d.label)}</h3>
        <a class="dl-link" href="${esc(doc.url)}" target="_blank">⬇ Herunterladen</a></div>
        <iframe src="${esc(doc.url)}#toolbar=1" title="${esc(d.label)}"></iframe></div>`
    : `<div class="doc-card"><div class="doc-head"><h3>${esc(d.label)}</h3></div>
        <div class="doc-empty">Noch kein PDF hochgeladen.</div></div>`;
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
  const ordered=[...cache.plans].sort((a,b)=>
    (a.is_base!==b.is_base) ? (a.is_base?-1:1) : ((a.datum||'').localeCompare(b.datum||'') || (a.sort-b.sort)));
  sel.innerHTML=ordered.map(p=>`<option value="${p.id}">${esc(p.name)}${p.datum?` (${treffenDateLabel(p)})`:''}</option>`).join('');
  if([...sel.options].some(o=>o.value===cur)) sel.value=cur;
  else { const def=currentTreffen()||basePlan(); if(def) sel.value=def.id; }   // Standard: aktuelles/nächstes Treffen
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
// Pool für die Klavierbegleitung-Auswahl: Personen mit der Rolle Klavierbegleitung
// oder dem Fach Klavierbegleitung; sonst Fallback auf alle Aktiven.
function klavierbegleitPool(){
  const pool=cache.people.filter(p=>p.aktiv && (hasRole(p,'klavierbegleitung')||(p.faecher||[]).includes('Klavierbegleitung')));
  return (pool.length?pool:allActive()).slice().sort(byName);
}
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
  if(currentPerson && hasRole(currentPerson,'schueler') && /\balle\b/i.test(r.schueler||'')) return true;  // "Alle Schüler"
  // Stunde ohne zugeordneten Lehrer -> bei allen Lehrern/Klassenleitungen anzeigen (Default)
  if(currentPerson && (hasRole(currentPerson,'lehrer')||hasRole(currentPerson,'klassenleitung'))
     && r.fach!=='Pause' && !(r.lehrer_ids&&r.lehrer_ids.length) && !(r.lehrer&&(r.lehrer||'').trim())) return true;
  if(currentPerson && ((r.lehrer_ids||[]).includes(currentPerson.id)
    || (r.klavier_ids||[]).includes(currentPerson.id)
    || (r.schueler_ids||[]).includes(currentPerson.id))) return true;
  if(!token) return false; const t=token.toLowerCase();
  return [r.schueler,r.lehrer,r.klavier].some(x=>x&&x.toLowerCase().includes(t));
}
function lessonKey(r){ return `${r.zeit}|${r.fach}|${r.sort}`; }
function absentSetForPlan(planId){ return new Set(cache.absences.filter(a=>a.plan_id===planId).map(a=>a.person_id)); }
function absencesForPlan(planId){ return cache.absences.filter(a=>a.plan_id===planId); }
function sortedAbsences(planId){
  const staff=p=>p&&(hasRole(p,'lehrer')||hasRole(p,'klassenleitung')||hasRole(p,'admin'))?0:1;
  return absencesForPlan(planId).slice().sort((a,b)=>{
    const pa=personById(a.person_id), pb=personById(b.person_id);
    return staff(pa)-staff(pb) || fullName(pa).localeCompare(fullName(pb),'de');
  });
}
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
function buildDayHtml(day, planId, base, view, edit, token, diffMode){
  const baseRows = diffMode ? cache.tt.filter(r=>r.tag===day&&r.plan_id===base.id) : [];
  const baseById = new Map(baseRows.map(r=>[r.id,r]));
  const rows=cache.tt.filter(r=>r.tag===day && r.plan_id===planId);
  const planSourceIds = new Set(rows.map(r=>r.source_id).filter(Boolean));
  const planBySource = new Map(rows.filter(r=>r.source_id).map(r=>[r.source_id,r]));
  const slots=[...new Set(rows.concat(baseRows).map(r=>r.zeit))].sort((a,b)=>slotSortFor(a)-slotSortFor(b));
  const fachIdx=f=>{ const i=FACH_ORDER.indexOf(f); return i<0?99:i; };
  const absentSet = absentSetForPlan(planId);
  const line=(prefix,cur,old,changed,cls)=> changed
    ? `<div class="tt-meta tt-chg">${prefix}${old?`<s>${esc(old)}</s> `:''}${cur?esc(cur):'<em>–</em>'}</div>`
    : (cur?`<div class="${cls||'tt-meta'}">${prefix}${esc(cur)}</div>`:'');
  const lineH=(prefix,htmlVal,plainCur,plainOld,changed,cls)=> changed
    ? `<div class="tt-meta tt-chg">${prefix}${plainOld?`<s>${esc(plainOld)}</s> `:''}${plainCur?esc(plainCur):'<em>–</em>'}</div>`
    : (htmlVal?`<div class="${cls||'tt-meta'}">${prefix}${htmlVal}</div>`:'');
  const cellHtml=r=>{
    const baseR = diffMode ? baseById.get(r.source_id) : null;
    const isNew = diffMode && !baseR;
    const c=lessonFields(r), b=baseR?lessonFields(baseR):{};
    const ch=k=> !!baseR && (c[k]||'')!==(b[k]||'');
    const cancelled=lessonCancelled(r, absentSet);
    const stuR=tokensHtml(r.schueler_ids, r.schueler, absentSet, 'tt-absent');
    const lehR=tokensHtml(r.lehrer_ids, r.lehrer, absentSet, 'tt-absent-t');
    const klaR=tokensHtml(r.klavier_ids, r.klavier, absentSet, 'tt-absent-t');
    const lines=[];
    if(r.fach && r.fach!=='Pause' && !FACH_ORDER.includes(r.fach)) lines.push(`<div class="tt-fachname">${esc(r.fach)}</div>`);
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
    return `<div class="tt-cell tt-removed ${edit?'editable':''}" ${edit?`onclick="adoptBaseLesson('${r.id}','${planId}')" title="Neue Grundplan-Stunde in diesen Treffen-Plan übernehmen"`:''}><span class="tt-badge">entfällt</span>${lines.join('')}</div>`;
  };
  const subjectsHtml=(planRows,removedRows)=>{
    const fachs=[...new Set(planRows.concat(removedRows).map(r=>r.fach))].sort((a,b)=>fachIdx(a)-fachIdx(b));
    return fachs.map(f=>{
      const horiz=['Musiktheorie','Arrangieren'].includes(f)?' row':'';
      const pc=planRows.filter(r=>r.fach===f).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(cellHtml);
      const rc=removedRows.filter(r=>r.fach===f).map(removedCell);
      const header = FACH_ORDER.includes(f) ? `<div class="tt-fach">${esc(f)}</div>` : '';
      return `<div class="tt-subject">${header}<div class="tt-cells${horiz}">${pc.concat(rc).join('')}</div></div>`;
    }).join('');
  };
  const html=slots.map(zeit=>{
    let slotRows=rows.filter(r=>r.zeit===zeit);
    if(slotRows.length && slotRows.every(r=>r.fach==='Pause')){
      const pr=slotRows[0];
      return `<div class="tt-slot"><div class="tt-time">${esc(zeit)}</div>
        <div class="tt-pause ${edit?'editable':''}" ${edit?`onclick="editLesson('${pr.id}')"`:''}>Pause</div></div>`;
    }
    // entfallene Grundplan-Stunden in diesem Slot (im Treffenplan nicht mehr vorhanden)
    let removed = diffMode ? baseRows.filter(r=>r.zeit===zeit && !planSourceIds.has(r.id)) : [];
    if(token){
      slotRows=slotRows.filter(r=>r.fach!=='Pause' && lessonIsMine(r,token));
      removed = diffMode ? baseRows.filter(r=>r.zeit===zeit && r.fach!=='Pause' && lessonIsMine(r,token) && (()=>{
          const pr=planBySource.get(r.id); return !pr || !lessonIsMine(pr,token);
        })()) : [];
      if(!slotRows.length && !removed.length)
        return `<div class="tt-slot"><div class="tt-time">${esc(zeit)}</div><div class="tt-free">Freistunde</div></div>`;
    }
    return `<div class="tt-slot"><div class="tt-time">${esc(zeit)}</div><div class="tt-subjects">${subjectsHtml(slotRows,removed)}</div></div>`;
  }).join('');
  return { html, conflicts: edit?planConflicts(rows, absentSet):[], empty: slots.length===0 };
}
function renderStundenplan(){
  fillPlanSelect();
  const planId=currentPlanId(), base=basePlan();
  const plan=cache.plans.find(p=>p.id===planId);
  const view=$('#ttView')?.value||'all';
  const edit=canEdit('stundenplan') && view==='all';
  $('#ttAddBtn').hidden = !edit;
  const token=view==='mine'?myToken():null;
  const diffMode = !!(base && planId!==base.id);
  const planTage=(plan&&plan.tage)||'fr_sa';
  const availDays = planTage==='fr'?['freitag'] : planTage==='sa'?['samstag'] : ['freitag','samstag'];
  if(!availDays.includes(ttSelectedDay)) ttSelectedDay=availDays[0];
  const resetBtn=$('#ttResetBtn');
  resetBtn.hidden = !(isAdmin && edit && diffMode);
  if(!resetBtn.hidden) resetBtn.textContent = '↩ '+(ttSelectedDay==='freitag'?'Freitag':'Samstag')+' auf Grundplan zurücksetzen';
  renderDayButtons(availDays);
  const tt=$('#ttTitle'); if(tt) tt.textContent = 'Stundenplan' + (plan? ' · '+plan.name+(plan.datum?` (${treffenDateLabel(plan)})`:'') : '');
  if(view==='mine' && !token){
    $('#ttGrid').innerHTML='<p class="muted">Für diese Person ist kein Name hinterlegt – „Mein Plan" ist nicht verfügbar.</p>'; return;
  }
  const day=ttSelectedDay;
  const dayDiff = diffMode && day==='samstag';   // Freitag wird nicht gegen den Grundplan verglichen
  const res=buildDayHtml(day, planId, base, view, edit, token, dayDiff);
  let banner='';
  if(dayDiff) banner+=`<p class="muted">Vertretungsplan – <span class="tt-leg-chg">geändert</span> · <span class="tt-leg-new">neu</span> · <span class="tt-leg-rem">entfällt</span> (Vergleich zum Grundplan).${edit?' Veraltete Abweichung? Stunde öffnen → „Auf Grundplan zurücksetzen"; „entfällt"-Stunde anklicken zum Übernehmen.':''}</p>`;
  if(edit && res.conflicts.length) banner+=`<div class="tt-conflicts"><b>⚠ ${res.conflicts.length} Konflikt(e):</b><ul>${res.conflicts.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>`;
  $('#ttGrid').innerHTML = banner + (res.html || '<p class="muted" style="padding:6px 0">– keine Einträge –</p>');
}
function renderDayButtons(days){
  const c=$('#ttDayBtns'); if(!c) return;
  c.innerHTML = days.map(d=>`<button class="sub-btn ${d===ttSelectedDay?'active':''}" onclick="selectDay('${d}')">${d==='freitag'?'Freitag':'Samstag'}</button>`).join('');
}
function selectDay(d){ ttSelectedDay=d; renderStundenplan(); }
function planConflicts(planRows, absentSet){
  absentSet=absentSet||new Set();
  const out=[], byZeit={};
  planRows.forEach(r=>{ if(r.fach==='Pause'||lessonCancelled(r,absentSet))return; (byZeit[r.zeit]=byZeit[r.zeit]||[]).push(r); });
  Object.keys(byZeit).forEach(zeit=>{
    const rs=byZeit[zeit], pmap=new Map();
    const add=(ids,r)=> (ids||[]).forEach(id=>{ if(absentSet.has(id))return; if(!pmap.has(id)) pmap.set(id,new Map()); pmap.get(id).set(r.id,r.fach); });
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
function tageOpts(sel){ return [['fr_sa','Freitag + Samstag'],['fr','Nur Freitag (Zusatz)'],['sa','Nur Samstag']]
  .map(([v,l])=>`<option value="${v}" ${sel===v?'selected':''}>${l}</option>`).join(''); }
function tageLabel(t){ return t==='fr'?'nur Fr':t==='sa'?'nur Sa':'Fr+Sa'; }
async function createTreffen(name, datum, tage){
  const base=basePlan(); if(!base){ toast('Kein Grundplan vorhanden','err'); return null; }
  const {data:plan,error}=await SB.from('plans')
    .insert({name, datum:datum||null, tage:tage||'fr_sa', is_base:false, sort:(Math.max(0,...cache.plans.map(p=>p.sort||0))+1)})
    .select().single();
  if(error){ toast(error.message,'err'); return null; }
  const copies=cache.tt.filter(r=>r.plan_id===base.id).map(r=>({plan_id:plan.id, tag:r.tag, zeit:r.zeit,
    zeit_sort:r.zeit_sort, fach:r.fach, ueberschrift:r.ueberschrift, schueler:r.schueler, schueler_ids:r.schueler_ids,
    lehrer:r.lehrer, lehrer_ids:r.lehrer_ids, klavier:r.klavier, klavier_ids:r.klavier_ids, raum:r.raum, sort:r.sort,
    source_id:r.id}));
  if(copies.length){
    const {data:ins,error:e2}=await SB.from('timetable').insert(copies).select();
    if(e2){ toast(e2.message,'err'); } else cache.tt.push(...(ins||[]));
  }
  cache.plans.push(plan); return plan;
}
// Reset des aktuell gewählten Tages (Freitag ODER Samstag): Zeilen dieses Tages
// im abgeleiteten Plan löschen und frisch aus dem Grundplan ableiten.
async function resetPlanToBase(planId){
  const base=basePlan(); const plan=cache.plans.find(p=>p.id===planId);
  if(!base||!plan||plan.is_base){ toast('Nur für abgeleitete Pläne möglich','err'); return; }
  const tag=ttSelectedDay, tagLabel=tag==='freitag'?'Freitag':'Samstag';
  if(!confirm(`Den ${tagLabel}-Stundenplan von „${plan.name}" auf den Grundplan zurücksetzen?\n\nAlle manuellen Änderungen am ${tagLabel} dieses Treffens (Vertretungen, verschobene, entfallene oder neue Stunden) gehen verloren. Abmeldungen von Personen bleiben erhalten.`)) return;
  const {error:delErr}=await SB.from('timetable').delete().eq('plan_id',planId).eq('tag',tag);
  if(delErr){ toast(delErr.message,'err'); return; }
  cache.tt=cache.tt.filter(r=>!(r.plan_id===planId && r.tag===tag));
  const copies=cache.tt.filter(r=>r.plan_id===base.id && r.tag===tag).map(r=>({plan_id:planId, tag:r.tag, zeit:r.zeit,
    zeit_sort:r.zeit_sort, fach:r.fach, ueberschrift:r.ueberschrift, schueler:r.schueler, schueler_ids:r.schueler_ids,
    lehrer:r.lehrer, lehrer_ids:r.lehrer_ids, klavier:r.klavier, klavier_ids:r.klavier_ids, raum:r.raum, sort:r.sort,
    source_id:r.id}));
  if(copies.length){
    const {data,error}=await SB.from('timetable').insert(copies).select();
    if(error){ toast(error.message,'err'); return; }
    cache.tt.push(...(data||[]));
  }
  renderStundenplan(); toast(`${tagLabel}-Stundenplan auf Grundplan zurückgesetzt`);
}
function renderTreffen(){
  const list=cache.plans.filter(p=>!p.is_base)
    .sort((a,b)=>(b.datum||'').localeCompare(a.datum||'') || (a.name||'').localeCompare(b.name||''));
  $('#treffenList').innerHTML = list.map(p=>{
    const nAbs=cache.absences.filter(a=>a.plan_id===p.id).length;
    return `<div class="person-item">
      <span class="pi-name">${esc(p.name)}</span>
      <span class="muted">${p.datum?treffenDateLabel(p):'—'}</span>
      <span class="role-pill">${tageLabel(p.tage||'fr_sa')}</span>
      <span class="muted">${nAbs} Abmeldung(en)</span>
      <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-ghost" onclick="manageAbsences('${p.id}')">Abmeldungen</button>
        <button class="btn-ghost" onclick="editTreffen('${p.id}')">Bearbeiten</button>
        <button class="btn-ghost" style="color:#e88" onclick="delTreffen('${p.id}')">Löschen</button>
      </span></div>`;
  }).join('') || '<p class="muted">Noch keine Treffen.</p>';
}
function addTreffen(){
  openDialog('Neues Treffen', `<label>Name<input id="tr_name" placeholder="z.B. 14"></label>
    <label>Datum (Samstag)<input type="date" id="tr_datum"></label>
    <label>Tage<select id="tr_tage">${tageOpts('fr_sa')}</select></label>
    <p class="muted">Legt einen Vertretungsplan als Kopie des Grundplans an.</p>`, async()=>{
    const datum=$('#tr_datum').value;
    const name=$('#tr_name').value.trim()||(datum?`Treffen ${fmtDate(datum)}`:''); if(!name){ toast('Name oder Datum fehlt','err'); return false; }
    const plan=await createTreffen(name, datum, $('#tr_tage').value); if(!plan) return false;
    renderAdmin(); fillPlanSelect(); toast('Treffen angelegt');
  });
}
function editTreffen(id){
  const p=cache.plans.find(x=>x.id===id); if(!p) return;
  openDialog('Treffen bearbeiten', `<label>Name<input id="tr_name" value="${esc(p.name)}"></label>
    <label>Datum (Samstag)<input type="date" id="tr_datum" value="${p.datum||''}"></label>
    <label>Tage<select id="tr_tage">${tageOpts(p.tage||'fr_sa')}</select></label>`, async()=>{
    const name=$('#tr_name').value.trim(); if(!name){ toast('Name fehlt','err'); return false; }
    const datum=$('#tr_datum').value||null; const tage=$('#tr_tage').value;
    const {error}=await SB.from('plans').update({name,datum,tage}).eq('id',id);
    if(error){ toast(error.message,'err'); return false; }
    Object.assign(p,{name,datum,tage}); renderAdmin(); fillPlanSelect(); toast('Gespeichert');
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
  const list=sortedAbsences(planId);
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
function peopleSelectOpts(pool, selectedIds){
  const sel=new Set(selectedIds||[]);
  return peopleSelectHtml(pool, selectedIds)
    + `<option value="__other__" ${sel.has('__other__')?'selected':''}>— Sonstige (Freitext) —</option>`;
}
const withOther=(ids,free)=>{ const a=ids?[...ids]:[]; if((free||'').trim()) a.push('__other__'); return a; };
function zeitIsFreitag(label){ const m=(label||'').match(/^\s*(\d{1,2}):/); return !!m && parseInt(m[1])>=17; }
function zeitOptsForTag(tag, selected){
  const list=cache.timeSlots.slice().sort((a,b)=>(a.sort||0)-(b.sort||0))
    .filter(s=> tag==='freitag' ? zeitIsFreitag(s.label) : !zeitIsFreitag(s.label));
  const hasCur=list.some(s=>s.label===selected);
  return (selected&&!hasCur?`<option selected>${esc(selected)}</option>`:'')
    + list.map(s=>`<option ${selected===s.label?'selected':''}>${esc(s.label)}</option>`).join('');
}
function refreshLessonZeit(){ const t=$('#tl_tag').value; $('#tl_zeit').innerHTML=zeitOptsForTag(t, $('#tl_zeit').value); }
function lessonForm(r){
  r=r||{};
  const fach=r.fach||'Dirigieren';
  const fachList=[...new Set(FACH_ORDER.concat(['Pause'], cache.tt.map(x=>x.fach).filter(Boolean)))];
  const fachListOpts=fachList.map(f=>`<option value="${esc(f)}">`).join('');
  const roomOpts=cache.rooms.map(rm=>`<option value="${esc(rm.name)}">`).join('');
  const tg=r.tag||'samstag';
  return `<label>Tag<select id="tl_tag" onchange="refreshLessonZeit()">
      <option value="samstag" ${tg==='samstag'?'selected':''}>Samstag</option>
      <option value="freitag" ${tg==='freitag'?'selected':''}>Freitag</option></select></label>
    <label>Zeit<select id="tl_zeit">${zeitOptsForTag(tg, r.zeit)}</select></label>
    <label>Fach<input id="tl_fach" list="fachDatalist" value="${esc(fach)}" onchange="refreshLessonPools()">
      <datalist id="fachDatalist">${fachListOpts}</datalist></label>
    <label>Überschrift<input id="tl_head" value="${esc(r.ueberschrift||'')}" placeholder="z.B. Gruppe 1"></label>
    <label>Schüler (Mehrfachauswahl mit Strg/⌘)
      <select id="tl_stuids" multiple size="5" onchange="updateLessonDialogVis()">${peopleSelectOpts(students().slice().sort(byName), withOther(r.schueler_ids,r.schueler))}</select>
      <span><button type="button" class="btn-ghost mini" onclick="setAlleSchueler()">Alle Schüler</button>
      <button type="button" class="btn-ghost mini" onclick="clearMulti('tl_stuids');updateLessonDialogVis()">Auswahl leeren</button></span></label>
    <label id="wrapStuFree" style="display:none">Schüler-Freitext<input id="tl_stu" value="${esc(r.schueler||'')}"></label>
    <label>Lehrer (Mehrfachauswahl mit Strg/⌘)
      <select id="tl_lehids" multiple size="5" onchange="updateLessonDialogVis()">${peopleSelectOpts(peopleForSubject(fach,teacherPeople), withOther(r.lehrer_ids,r.lehrer))}</select>
      <button type="button" class="btn-ghost mini" onclick="clearMulti('tl_lehids');updateLessonDialogVis()">Auswahl leeren</button></label>
    <label id="wrapLehFree" style="display:none">Lehrer-Freitext<input id="tl_leh" value="${esc(r.lehrer||'')}" placeholder="z.B. AB, DP"></label>
    <label id="wrapKb">Klavierbegleitung (Mehrfachauswahl)
      <select id="tl_kbids" multiple size="4" onchange="updateLessonDialogVis()">${peopleSelectOpts(klavierbegleitPool(), withOther(r.klavier_ids,r.klavier))}</select>
      <button type="button" class="btn-ghost mini" onclick="clearMulti('tl_kbids');updateLessonDialogVis()">Auswahl leeren</button></label>
    <label id="wrapKlaFree" style="display:none">Klavierbegleitung-Freitext<input id="tl_kla" value="${esc(r.klavier||'')}"></label>
    <label>Raum<input id="tl_raum" list="roomsDatalist" value="${esc(r.raum||'')}">
      <datalist id="roomsDatalist">${roomOpts}</datalist></label>
    <label class="chk"><input type="checkbox" id="tl_entf" ${r.entfaellt?'checked':''}> Stunde entfällt</label>`;
}
function clearMulti(id){ const el=$('#'+id); if(el) [...el.options].forEach(o=>o.selected=false); }
function updateLessonDialogVis(){
  if(!$('#tl_fach')) return;
  const fach=$('#tl_fach').value;
  const hasOther=id=>{ const el=$('#'+id); return !!el && [...el.selectedOptions].some(o=>o.value==='__other__'); };
  const show=(id,c)=>{ const w=$('#'+id); if(w) w.style.display=c?'':'none'; };
  show('wrapStuFree', hasOther('tl_stuids'));
  show('wrapLehFree', hasOther('tl_lehids'));
  const kb=['Dirigieren','Stimmbildung'].includes(fach);   // Klavierbegleitung nur hier
  show('wrapKb', kb);
  show('wrapKlaFree', kb && hasOther('tl_kbids'));
}
function setAlleSchueler(){
  const sel=$('#tl_stuids'); if(!sel) return;
  [...sel.options].forEach(o=>{ o.selected = (o.value==='__other__'); });
  $('#tl_stu').value='Alle Schüler';
  updateLessonDialogVis();
}
function refreshLessonPools(){
  const fach=$('#tl_fach').value;
  const selL=[...$('#tl_lehids').selectedOptions].map(o=>o.value);
  const selK=[...$('#tl_kbids').selectedOptions].map(o=>o.value);
  $('#tl_lehids').innerHTML=peopleSelectOpts(peopleForSubject(fach,teacherPeople), selL);
  $('#tl_kbids').innerHTML=peopleSelectOpts(klavierbegleitPool(), selK);
  updateLessonDialogVis();
}
function readLessonForm(){
  const fach=$('#tl_fach').value;
  const kbHidden=['Klavier','Gehörbildung'].includes(fach);
  const raw=id=>[...$('#'+id).selectedOptions].map(o=>o.value);
  const rawStu=raw('tl_stuids'), rawLeh=raw('tl_lehids'), rawKb=raw('tl_kbids');
  const sids=rawStu.filter(v=>v!=='__other__'), ids=rawLeh.filter(v=>v!=='__other__'), kids=rawKb.filter(v=>v!=='__other__');
  return { tag:$('#tl_tag').value, zeit:$('#tl_zeit').value.trim(), fach,
    ueberschrift:$('#tl_head').value.trim()||null,
    schueler: rawStu.includes('__other__') ? ($('#tl_stu').value.trim()||null) : null,
    schueler_ids: sids.length?sids:null,
    lehrer_ids: ids.length?ids:null,
    lehrer: rawLeh.includes('__other__') ? ($('#tl_leh').value.trim()||null) : null,
    klavier_ids: kbHidden?null:(kids.length?kids:null),
    klavier: (kbHidden||!rawKb.includes('__other__')) ? null : ($('#tl_kla').value.trim()||null),
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
  const base=basePlan();
  const isBaseLesson = !!base && r.plan_id===base.id;
  const baseR=(base && !isBaseLesson && r.source_id) ? cache.tt.find(x=>x.id===r.source_id) : null;
  const differsFromBase = !!baseR && (()=>{ const c=lessonFields(r), b=lessonFields(baseR);
    return ['ueber','stu','leh','kla','raum'].some(k=>(c[k]||'')!==(b[k]||'')); })();
  let body=lessonForm(r)
    +(differsFromBase?`<button type="button" class="btn-ghost" style="margin-top:4px" onclick="resetLessonToBase('${id}')" title="Veraltete Kopie: Werte des Grundplans übernehmen">↩ Auf Grundplan zurücksetzen</button>`:'')
    +`<button class="btn-ghost" style="margin-top:4px" onclick="delLesson('${id}')">Eintrag löschen</button>`;
  const oldFields = isBaseLesson ? lessonFields(r) : null;
  openDialog('Stundenplan-Eintrag', body, async()=>{
    const upd=readLessonForm(); upd.zeit_sort=slotSortFor(upd.zeit); upd.updated_at=new Date().toISOString();
    await ensureRoom(upd.raum);
    const {error}=await SB.from('timetable').update(upd).eq('id',id);
    if(error){ toast(error.message,'err'); return false; }
    Object.assign(r,upd);
    let msg='Gespeichert';
    if(isBaseLesson){
      const children=cache.tt.filter(x=>x.source_id===id);
      // Nur Treffen aktualisieren, die noch unverändert dem alten Grundplan entsprachen –
      // Treffen mit einer echten manuellen Abweichung (Vertretung) bleiben unangetastet.
      const unchanged=children.filter(c=>{ const cf=lessonFields(c);
        return !['ueber','stu','leh','kla','raum'].some(k=>(cf[k]||'')!==(oldFields[k]||'')); });
      const skipped=children.length-unchanged.length;
      if(unchanged.length && confirm(`Diese Änderung auch bei ${unchanged.length} Treffen übernehmen, die diese Grundplan-Stunde unverändert übernommen haben?`
          +(skipped?`\n\n${skipped} weitere(s) Treffen mit manueller Abweichung (Vertretung) werden NICHT verändert.`:''))){
        const {ueberschrift,schueler,schueler_ids,lehrer,lehrer_ids,klavier,klavier_ids,raum,entfaellt,tag,zeit,zeit_sort,fach}=upd;
        const prop={ueberschrift,schueler,schueler_ids,lehrer,lehrer_ids,klavier,klavier_ids,raum,entfaellt,tag,zeit,zeit_sort,fach,updated_at:new Date().toISOString()};
        const {error:pErr}=await SB.from('timetable').update(prop).in('id',unchanged.map(c=>c.id));
        if(pErr){ toast(pErr.message,'err'); }
        else{ unchanged.forEach(c=>Object.assign(c,prop)); msg=`Gespeichert, für ${unchanged.length} Treffen übernommen`+(skipped?` (${skipped} mit Abweichung übersprungen)`:''); }
      } else if(skipped && children.length){
        msg='Gespeichert (Treffen mit manueller Abweichung unverändert gelassen)';
      }
    }
    renderStundenplan(); toast(msg);
  });
  updateLessonDialogVis();
}
function addLesson(){
  const planId=currentPlanId();
  openDialog('Neuer Stundenplan-Eintrag', lessonForm({tag:ttSelectedDay||'samstag'}), async()=>{
    const rec=readLessonForm(); rec.plan_id=planId; rec.zeit_sort=slotSortFor(rec.zeit);
    rec.sort=(Math.max(0,...cache.tt.filter(x=>x.plan_id===planId&&x.zeit===rec.zeit&&x.fach===rec.fach).map(x=>x.sort||0))+1);
    await ensureRoom(rec.raum);
    const {data,error}=await SB.from('timetable').insert(rec).select().single();
    if(error){ toast(error.message,'err'); return false; }
    cache.tt.push(data); renderStundenplan(); toast('Gespeichert');
  });
  updateLessonDialogVis();
}
async function delLesson(id){
  if(!confirm('Diesen Eintrag löschen?')) return;
  const {error}=await SB.from('timetable').delete().eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  cache.tt=cache.tt.filter(x=>x.id!==id); closeDialog(); renderStundenplan(); toast('Gelöscht');
}
// Veraltete Kopie einer abgeleiteten Stunde auf den aktuellen Grundplan-Stand bringen (echte Vertretungen bleiben unberührt).
async function resetLessonToBase(id){
  const r=cache.tt.find(x=>x.id===id); if(!r||!r.source_id) return;
  const b=cache.tt.find(x=>x.id===r.source_id);
  if(!b){ toast('Zugehörige Grundplan-Stunde nicht gefunden','err'); return; }
  const upd={ tag:b.tag, zeit:b.zeit, zeit_sort:b.zeit_sort, fach:b.fach, ueberschrift:b.ueberschrift,
    schueler:b.schueler, schueler_ids:b.schueler_ids, lehrer:b.lehrer, lehrer_ids:b.lehrer_ids,
    klavier:b.klavier, klavier_ids:b.klavier_ids, raum:b.raum, sort:b.sort, entfaellt:false,
    updated_at:new Date().toISOString() };
  const {error}=await SB.from('timetable').update(upd).eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  Object.assign(r,upd); closeDialog(); renderStundenplan(); toast('Auf Grundplan zurückgesetzt');
}
// Neue Grundplan-Stunde (im Treffen noch nicht vorhanden) in den abgeleiteten Plan übernehmen.
async function adoptBaseLesson(baseId, planId){
  const b=cache.tt.find(x=>x.id===baseId); if(!b) return;
  if(!confirm('Diese Grundplan-Stunde in den Treffen-Plan übernehmen?')) return;
  const rec={ plan_id:planId, tag:b.tag, zeit:b.zeit, zeit_sort:b.zeit_sort, fach:b.fach, ueberschrift:b.ueberschrift,
    schueler:b.schueler, schueler_ids:b.schueler_ids, lehrer:b.lehrer, lehrer_ids:b.lehrer_ids,
    klavier:b.klavier, klavier_ids:b.klavier_ids, raum:b.raum, sort:b.sort, source_id:b.id };
  const {data,error}=await SB.from('timetable').insert(rec).select().single();
  if(error){ toast(error.message,'err'); return; }
  cache.tt.push(data); renderStundenplan(); toast('Übernommen');
}

// ---------- BEWERTUNGEN ----------
function renderBewertung(){
  $$('.grades-cols-btn').forEach(b=>b.hidden=!canEdit('bewertung'));
  $$('.tests-cols-btn').forEach(b=>b.hidden=!canEdit('tests'));
  renderTests('harmonielehre','#hlTests');   renderGrades('harmonielehre','#hlGrades');
  renderTests('gehoerbildung','#gbTests');   renderGrades('gehoerbildung','#gbGrades');
}
function testColsFor(fach){
  const map=new Map();
  cache.testCols.filter(c=>c.fach===fach).forEach(c=>map.set(c.label,{sort:c.sort||0, plan_id:c.plan_id||null}));
  cache.tests.filter(t=>t.fach===fach&&t.monat).forEach(t=>{ if(!map.has(t.monat)) map.set(t.monat,{sort:t.monat_sort||0, plan_id:null}); });
  return [...map.entries()].sort((a,b)=>a[1].sort-b[1].sort).map(e=>({label:e[0],sort:e[1].sort,plan_id:e[1].plan_id}));
}
// Test-Spalte -> zugeordnetes Treffen (oder null). Anzeige = Treffen statt Monatslabel.
function testColPlan(c){ return c&&c.plan_id ? cache.plans.find(p=>p.id===c.plan_id) : null; }
function testColHeadHtml(c){
  const pl=testColPlan(c);
  return pl ? `${esc(pl.name||'Treffen')}<br><span class="col-date">${esc(treffenDateLabel(pl))}</span>` : esc(c.label);
}
function testColText(c){
  const pl=testColPlan(c);
  return pl ? `${pl.name||'Treffen'}${treffenDateLabel(pl)?' · '+treffenDateLabel(pl):''}` : c.label;
}
function renderTests(fach, sel){
  const rows=cache.tests.filter(t=>t.fach===fach);
  const cols=testColsFor(fach);
  const edit=canEdit('tests');
  if(!cols.length){ $(sel).innerHTML=`<p class="muted" style="padding:14px">${edit?'Noch keine Tests – über „Tests verwalten" anlegen.':'Keine Tests.'}</p>`; return; }
  const head=`<tr><th class="name">Schüler</th>${cols.map(c=>`<th class="treffen-col">${testColHeadHtml(c)}</th>`).join('')}<th class="sum">Ø</th></tr>`;
  const body=visibleStudents().map(p=>{
    const vals=cols.map(c=>{
      const r=rows.find(x=>x.person_id===p.id&&x.monat===c.label);
      const v=r?Math.round(r.ergebnis):null;
      const txt=v==null?'–':v+'%';
      const td=edit?`<td class="cell-edit" data-test-cell data-pid="${esc(p.id)}" data-fach="${esc(fach)}" data-label="${esc(c.label)}" data-sort="${esc(c.sort)}">${txt}</td>`:`<td>${txt}</td>`;
      return {v, html:td};
    });
    const known=vals.map(x=>x.v).filter(v=>v!=null);
    const avg=known.length?Math.round(known.reduce((a,b)=>a+b,0)/known.length):null;
    return `<tr><td class="name">${esc(fullName(p))}</td>${vals.map(x=>x.html).join('')}<td class="sum">${avg==null?'–':avg+'%'}</td></tr>`;
  }).join('');
  $(sel).innerHTML=`<table>${head}${body}</table>`;
  $(sel).onclick=e=>{
    const td=e.target.closest('[data-test-cell]'); if(!td) return;
    editTest(td.dataset.pid, td.dataset.fach, td.dataset.label, +td.dataset.sort);
  };
}
function editTest(personId, fach, monat, monatSort){
  const r=cache.tests.find(t=>t.fach===fach&&t.person_id===personId&&t.monat===monat);
  const col=testColsFor(fach).find(c=>c.label===monat);
  const lbl=col?testColText(col):monat;
  const body=`<label>${esc(lbl)} – Ergebnis (%)
    <input type="number" id="dt_e" min="0" max="100" value="${r?Math.round(r.ergebnis):''}"></label>
    <p class="muted">Leer lassen löscht den Eintrag.</p>`;
  openDialog(`${fullName(personById(personId))} – ${esc(lbl)}`, body, ()=>saveTest(personId,fach,monat,monatSort,$('#dt_e').value));
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
function testsAvg(fach, pid){
  const vs=cache.tests.filter(t=>t.fach===fach&&t.person_id===pid&&t.ergebnis!=null).map(t=>+t.ergebnis);
  return vs.length?Math.round(vs.reduce((a,b)=>a+b,0)/vs.length):null;
}
// IHK-Schlüssel: % -> Note
function ihkNote(p){ if(p==null)return ''; if(p>=92)return'1'; if(p>=81)return'2'; if(p>=67)return'3'; if(p>=50)return'4'; if(p>=30)return'5'; return'6'; }
function gesamtPct(g, fach, pid){
  let ws=0, sum=0;
  gradeColsFor(fach).filter(c=>(c.typ==='manual'||c.typ==='tests'||c.typ==='hausaufgaben'||c.typ==='fleiss')&&(+c.gewicht||0)>0).forEach(c=>{
    const v=c.typ==='tests'?testsAvg(fach,pid):c.typ==='hausaufgaben'?hausaufgabenAvg(pid):c.typ==='fleiss'?fleissAvg(pid,fach):gradeVal(g,c);
    if(v!=null){ const w=+c.gewicht||0; sum+=w*(+v); ws+=w; }
  });
  return ws>0?Math.round(sum/ws):null;
}
function colValue(g, col, fach, pid){
  if(col.typ==='tests')  return testsAvg(fach,pid);
  if(col.typ==='fleiss') return fleissAvg(pid,fach);
  if(col.typ==='hausaufgaben') return hausaufgabenAvg(pid);
  if(col.typ==='gesamt') return gesamtPct(g,fach,pid);
  if(col.typ==='note'){ const p=gesamtPct(g,fach,pid); return p==null?null:ihkNote(p); }
  return gradeVal(g,col);
}
function gradeTypOpts(sel){ return [['manual','Eingabe'],['tests','Tests-Ø'],['fleiss','Fleiß (Übezeiten)'],['hausaufgaben','Hausaufgaben Ø'],['gesamt','Gesamt %'],['note','Note (IHK)']]
  .map(([v,l])=>`<option value="${v}" ${sel===v?'selected':''}>${l}</option>`).join(''); }
// --- Test-Spalten-Verwaltung ---
// Options-HTML aller Treffen (plans, is_base=false), chronologisch.
function treffenOptions(selId){
  const treffen=cache.plans.filter(p=>!p.is_base)
    .sort((a,b)=>(a.datum||'').localeCompare(b.datum||'')||((a.sort||0)-(b.sort||0)));
  return `<option value="">— kein Treffen —</option>`+treffen.map(p=>
    `<option value="${p.id}" ${p.id===selId?'selected':''}>${esc(p.name||'Treffen')}${p.datum?' · '+esc(treffenDateLabel(p)):''}</option>`).join('');
}
// Stabiler, eindeutiger Label-Schlüssel für eine neue Test-Spalte (aus dem Treffen abgeleitet).
function tcLabelForPlan(fach, pl){
  const base=pl?(pl.name?pl.name+(pl.datum?' '+treffenDateLabel(pl):''):(treffenDateLabel(pl)||'Treffen')):'Test';
  const taken=new Set(cache.testCols.filter(c=>c.fach===fach).map(c=>c.label));
  let label=base, i=2; while(taken.has(label)){ label=base+' ('+i+')'; i++; }
  return label;
}
function tcAppendRow(){
  const wrap=document.createElement('div'); wrap.className='gc-row';
  wrap.innerHTML=`<select class="tc-plan">${treffenOptions('')}</select>
    <input class="tc-sort" type="number" style="width:70px" placeholder="Sort">
    <button type="button" class="btn-ghost" onclick="this.parentElement.remove()">✕</button>`;
  $('#tcList').appendChild(wrap);
}
async function delTestCol(id, fach, label){
  if(!confirm('Test-Spalte löschen? Die Werte dieser Spalte gehen verloren.')) return;
  await SB.from('test_columns').delete().eq('id',id);
  await SB.from('tests').delete().eq('fach',fach).eq('monat',label);
  cache.testCols=cache.testCols.filter(c=>c.id!==id);
  cache.tests=cache.tests.filter(t=>!(t.fach===fach&&t.monat===label));
  document.querySelector(`#tcList .gc-row[data-id="${id}"]`)?.remove();
  toast('Gelöscht');
}
function manageTestCols(fach){
  const cols=cache.testCols.filter(c=>c.fach===fach).sort((a,b)=>(a.sort||0)-(b.sort||0));
  const rowsHtml=cols.map(c=>`<div class="gc-row" data-id="${c.id}">
    <select class="tc-plan">${treffenOptions(c.plan_id||'')}</select>
    <input class="tc-sort" type="number" style="width:70px" value="${c.sort||0}">
    <button type="button" class="btn-ghost" onclick="delTestCol('${c.id}','${fach}','${esc(c.label)}')">✕</button></div>`).join('');
  const body=`<div id="tcList">${rowsHtml}</div>
    <button type="button" class="btn-ghost" onclick="tcAppendRow()">+ Test</button>
    <p class="muted">Jede Test-Spalte gehört zu einem Treffen. „Sort" bestimmt die Reihenfolge.</p>`;
  openDialog(`Tests – ${fach==='harmonielehre'?'Musiktheorie':'Gehörbildung'}`, body, async()=>{
    let sort=0;
    for(const el of $$('#tcList .gc-row')){
      const planId=$('.tc-plan',el)?.value||null;
      const s=parseInt($('.tc-sort',el)?.value); sort+=10;
      const sortv=isNaN(s)?sort:s; const id=el.dataset.id;
      if(id){
        await SB.from('test_columns').update({plan_id:planId||null, sort:sortv}).eq('id',id);
      } else if(planId){
        const label=tcLabelForPlan(fach, cache.plans.find(p=>p.id===planId));
        await SB.from('test_columns').insert({fach,label,sort:sortv,plan_id:planId});
      }
    }
    await loadAll(); renderBewertung(); toast('Tests gespeichert');
  });
}
function renderGrades(fach, sel){
  const cols=gradeColsFor(fach);
  const rows=cache.grades.filter(g=>g.fach===fach);
  const edit=canEdit('bewertung');
  if(!cols.length){ $(sel).innerHTML='<p class="muted" style="padding:14px">Keine Spalten definiert.</p>'; return; }
  if(!rows.length && !edit){ $(sel).innerHTML='<p class="muted" style="padding:14px">Keine Gesamtbewertung.</p>'; return; }
  const fmt=(col,v)=> v==null?'–':(col.typ==='note'||col.art==='text'?esc(String(v)):Math.round(v)+'%');
  const head=`<tr><th class="name">Schüler</th>${cols.map(c=>`<th class="treffen-col">${esc(c.label).replace(/ /g,'<br>')}</th>`).join('')}</tr>`;
  const body=visibleStudents().map(p=>{
    const g=rows.find(x=>x.person_id===p.id);
    if(!g && !edit) return '';
    return `<tr class="${edit?'cell-edit':''}" ${edit?`onclick="editGrade('${p.id}','${fach}')"`:''}>
      <td class="name">${esc(fullName(p))}</td>
      ${cols.map(c=>`<td class="${c.typ==='gesamt'?'sum':''}">${fmt(c, colValue(g||{},c,fach,p.id))}</td>`).join('')}</tr>`;
  }).join('');
  $(sel).innerHTML=`<table>${head}${body}</table>`;
}
function editGrade(personId, fach){
  const cols=gradeColsFor(fach).filter(c=>(c.typ||'manual')==='manual');
  const g=cache.grades.find(x=>x.fach===fach&&x.person_id===personId)||{};
  const auto=gradeColsFor(fach).filter(c=>c.typ&&c.typ!=='manual')
    .map(c=>`${esc(c.label)}: <b>${(()=>{const v=colValue(g,c,fach,personId);return v==null?'–':(c.typ==='note'?esc(String(v)):Math.round(v)+'%');})()}</b>`).join(' · ');
  const body=cols.map(c=>{
    const v=gradeVal(g,c);
    return c.art==='text'
      ? `<label>${esc(c.label)}<input id="gc_${c.id}" value="${v==null?'':esc(String(v))}"></label>`
      : `<label>${esc(c.label)} (%)<input id="gc_${c.id}" type="number" min="0" max="100" value="${v==null?'':Math.round(v)}"></label>`;
  }).join('') + (auto?`<p class="muted">Automatisch: ${auto}</p>`:'');
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
    <select class="gc-typ" onchange="updateGcSum()">${gradeTypOpts('manual')}</select>
    <input class="gc-gew" type="number" step="0.1" style="width:58px" value="1" title="Gewicht" oninput="updateGcSum()">
    <button type="button" class="btn-ghost" onclick="this.parentElement.remove();updateGcSum()">✕</button>`;
  $('#gcList').appendChild(wrap); updateGcSum();
}
// Summe der Gewichte (nur Spalten, die in „Gesamt %" zählen); warnt, wenn ≠ 100 %.
function updateGcSum(){
  const el=$('#gcSum'); if(!el) return;
  const contrib=new Set(['manual','tests','fleiss','hausaufgaben']);
  let sum=0; $$('#gcList .gc-row').forEach(r=>{ const typ=$('.gc-typ',r)?.value||'manual';
    if(contrib.has(typ)) sum+=(parseNum($('.gc-gew',r)?.value)||0); });
  const rounded=Math.round(sum*10)/10, ok=Math.abs(sum-100)<0.05;
  el.innerHTML=`Summe der Gewichte (zählt für „Gesamt %"): <b>${rounded} %</b>`
    + (ok?' ✓':` <span style="color:var(--err)">– sollte 100 % ergeben</span>`);
}
async function delGradeCol(id){
  if(!confirm('Spalte löschen? Die Werte dieser Spalte gehen verloren.')) return;
  const {error}=await SB.from('grade_columns').delete().eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  cache.gradeCols=cache.gradeCols.filter(c=>c.id!==id);
  document.querySelector(`#gcList .gc-row[data-id="${id}"]`)?.remove();
  updateGcSum(); toast('Spalte gelöscht');
}
function manageGradeCols(fach){
  const cols=gradeColsFor(fach);
  const rowsHtml=cols.map(c=>`<div class="gc-row" data-id="${c.id}">
    <input class="gc-label" value="${esc(c.label)}">
    <select class="gc-typ" onchange="updateGcSum()">${gradeTypOpts(c.typ||'manual')}</select>
    <input class="gc-gew" type="number" step="0.1" style="width:58px" value="${c.gewicht??1}" title="Gewicht" oninput="updateGcSum()">
    <button type="button" class="btn-ghost" onclick="delGradeCol('${c.id}')">✕</button>
  </div>`).join('');
  const body=`<div id="gcList">${rowsHtml}</div>
    <button type="button" class="btn-ghost" onclick="gcAppendRow()">+ Spalte</button>
    <div id="gcSum" class="muted" style="margin:6px 0"></div>
    <p class="muted">Typ: <b>Eingabe</b> = manuell, <b>Tests-Ø</b> = Mittel der 5-Min-Tests, <b>Fleiß (Übezeiten)</b> = Schnitt der Übe-Minuten (Ziel 30/Woche, max. 40 zählen pro Woche), <b>Hausaufgaben Ø</b> = Schnitt aus den Theorie-Treffen, <b>Gesamt %</b> = gewichteter Schnitt, <b>Note (IHK)</b> = aus Gesamt. „Gewicht" zählt als Prozentanteil für „Gesamt %".</p>`;
  openDialog(`Spalten – ${fach==='harmonielehre'?'Musiktheorie':'Gehörbildung'}`, body, async()=>{
    let sort=0;
    for(const el of $$('#gcList .gc-row')){
      const label=$('.gc-label',el)?.value.trim(); if(!label) continue;
      const typ=$('.gc-typ',el)?.value||'manual';
      const gw=parseNum($('.gc-gew',el)?.value); sort+=10; const id=el.dataset.id;
      const payload={label, typ, gewicht:(gw==null?1:gw), sort, art:(typ==='note'?'text':'zahl')};
      if(id) await SB.from('grade_columns').update(payload).eq('id',id);
      else   await SB.from('grade_columns').insert({fach,...payload});
    }
    await loadAll(); renderBewertung(); toast('Spalten gespeichert');
  });
  updateGcSum();
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
  fillAnnTreffen(plan.id); annTreffenChanged(); toast('Treffen angelegt');
}
function annTreffenChanged(){
  const plan=cache.plans.find(p=>p.id===$('#annTreffen').value);
  if(plan && !$('#annT').value.trim()) $('#annT').value=defaultInfoTitle(plan);
}
function openAnnEditor(id){
  _annEditId=id||null; _savedRange=null;
  const a=id?cache.ann.find(x=>x.id===id):null;
  $('#annModalTitle').textContent = id?'Info bearbeiten':'Neue Info';
  $('#annT').value = a?(a.titel||''):'';
  $('#annEditor').innerHTML = a?(a.text||''):'';
  if(a){ fillAnnTreffen(a.plan_id||''); }
  else { const t=currentTreffen(); fillAnnTreffen(t?t.id:''); annTreffenChanged(); }
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
  $('#gateForgotBtn').onclick=gateForgotPassword;
  $('#pwrSaveBtn').onclick=savePasswordReset;
  $('#pwrNew2').onkeydown=e=>{ if(e.key==='Enter') savePasswordReset(); };
  $('#pwChangeBtn').onclick=changeOwnPassword;
  $('#viewAs').onchange=function(){ setViewAs(this.value); };
  $('#contactSearch').oninput=renderContacts;
  $('#infoDocSel').onchange=renderInfoTab;
  $('#infoUploadFile').onchange=function(){ uploadSiteDoc($('#infoDocSel').value, this.files[0]); this.value=''; };
  $$('.grades-cols-btn').forEach(b=>b.onclick=()=>manageGradeCols(b.dataset.fach));
  $$('.tests-cols-btn').forEach(b=>b.onclick=()=>manageTestCols(b.dataset.fach));
  ['#ptYear','#ptWeek','#ptStudent'].forEach(s=>$(s).onchange=renderPractice);
  $('#paSearch').oninput=renderPersonAdmin;
  $('#paAddBtn').onclick=addPersonDialog;
  $('#trAddBtn').onclick=addTreffen;
  $('#ptAddBtn').onclick=createPractice;
  $('#ptWeekGenBtn').onclick=genPracticeWeek;
  $('#ttAddBtn').onclick=addLesson;
  $('#ttResetBtn').onclick=()=>resetPlanToBase(currentPlanId());
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
  $('#annTreffen').onchange=annTreffenChanged;
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
