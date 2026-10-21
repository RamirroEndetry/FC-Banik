const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(d,opts)=>new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',...opts}).format(new Date(d));
const key='banik-vip-kiosk-v1';
let state={entries:[],results:{},closedMatches:{}};
try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&Array.isArray(saved.entries)&&saved.results&&typeof saved.results==='object')state=saved}catch{}
state.closedMatches=state.closedMatches&&typeof state.closedMatches==='object'?state.closedMatches:{};
let currentId=matches.some(m=>m.id===state.activeMatchId)?state.activeMatchId:(matches.find(m=>new Date(m.date)>new Date())?.id||matches.at(-1).id);
state.activeMatchId=currentId;
try{localStorage.setItem(key,JSON.stringify(state))}catch{}

let outcome='',screen='welcome',timer,lastActivity=Date.now();
let adminAuthenticated=false,testMode=false;
let practiceEntries=[];
let demo=null;
let celebration=null;
const WINNER_DURATION=5*60*1000;
const liveSnapshots=new Map(),liveErrors=new Map();
let liveRequest=null,lastLivePoll=0,livePollGap=15000;
// Live score comes through the Worker (worker.mjs); <body data-live-endpoint="https://…/api/live"> points a kiosk hosted elsewhere to it.
const LIVE_ENDPOINT=document.body?.dataset?.liveEndpoint||'api/live';
const ADMIN_PASSWORD='Digi2026';
const current=()=>matches.find(m=>m.id===currentId);
// Tipping window: opens 30 minutes before the scheduled start and locks 10 minutes after it.
const TIP_OPENS_BEFORE=30*60*1000,TIP_LOCKS_AFTER=10*60*1000;
const opensAt=m=>new Date(m.date).getTime()-TIP_OPENS_BEFORE;
const locksAt=m=>new Date(m.date).getTime()+TIP_LOCKS_AFTER;
const started=m=>Date.now()>=new Date(m.date).getTime();
const closed=m=>Boolean(state.closedMatches[m.id]||state.results[m.id])||Date.now()>=locksAt(m);
const manualOpen=m=>Boolean(state.manualOpen?.[m.id]);
const open=m=>(Date.now()>=opensAt(m)||manualOpen(m))&&!closed(m);
const clock=ms=>{const seconds=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(seconds/86400)} d : ${String(Math.floor(seconds/3600)%24).padStart(2,'0')} h : ${String(Math.floor(seconds/60)%60).padStart(2,'0')} m : ${String(seconds%60).padStart(2,'0')} s`};
const tipText=e=>`${e.home} : ${e.away}`;
const tipTimeText=e=>e.savedAt&&!isNaN(new Date(e.savedAt))?fmt(e.savedAt,{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';

const canTip=m=>open(m)||(adminAuthenticated&&testMode);
const entries=id=>state.entries.filter(e=>e.matchId===id);
function persist(next){try{localStorage.setItem(key,JSON.stringify(next));state=next;return true}catch{message('Uložení se nezdařilo. Požádej obsluhu o pomoc.');return false}}
// Backup: everything lives only in this browser, so staff can download it (JSON to restore, CSV for Excel)
// and merge a backup back in. Restoring only adds what is missing; nothing on the kiosk is overwritten.
const BACKUP_APP='banik-vip-kiosk';
const count=(n,one,few,many)=>`${n} ${n===1?one:n>=2&&n<=4?few:many}`;
const fileStamp=()=>{const p=n=>String(n).padStart(2,'0'),d=new Date();return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`};
function backupJson(){return JSON.stringify({app:BACKUP_APP,version:1,exportedAt:new Date().toISOString(),state},null,2)}
function backupCsv(){
  const cell=v=>{let text=v==null?'':String(v);if(/^[-=+@]/.test(text))text="'"+text;return /[;"\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text};
  const rows=[['Zápas','Datum zápasu','Pořadí','Jméno','Tip','Odchylka','Čas tipu','Konečný výsledek']];
  for(const m of matches){
    const tips=entries(m.id),result=state.results[m.id];if(!tips.length)continue;
    const ranked=result?Competition.rank(tips,result):tips.slice().sort((a,b)=>Competition.tipTime(a)-Competition.tipTime(b)).map(e=>({...e,position:null,distance:null}));
    for(const e of ranked)rows.push([m.opponent,fmt(m.date,{day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}),e.position??'',e.name,`${e.home}:${e.away}`,e.distance??'',e.savedAt&&!isNaN(new Date(e.savedAt))?fmt(e.savedAt,{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'',result?`${result.home}:${result.away}`:'']);
  }
  return '\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n');
}
function downloadFile(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function downloadBackup(kind){
  if(!adminAuthenticated)return;
  if(kind==='csv')downloadFile(`banik-vip-tipy-${fileStamp()}.csv`,backupCsv(),'text/csv;charset=utf-8');
  else{downloadFile(`banik-vip-zaloha-${fileStamp()}.json`,backupJson(),'application/json');persist({...state,lastBackupAt:new Date().toISOString()});staff()}
}
// Returns what a backup would add, without saving anything; throws on a file that is not a kiosk backup.
function mergeBackup(text){
  let data;try{data=JSON.parse(text)}catch{throw Error('Soubor není platná záloha (JSON).')}
  const saved=data?.app===BACKUP_APP?data.state:null;
  if(!saved||!Array.isArray(saved.entries))throw Error('Soubor není záloha VIP kiosku.');
  const known=new Set(matches.map(m=>m.id)),ids=new Set(state.entries.map(e=>e.id));
  const addedEntries=saved.entries.filter(e=>e&&typeof e.id==='string'&&!ids.has(e.id)&&known.has(e.matchId)&&!Competition.validate(e));
  const addedResults={};
  for(const [id,r] of Object.entries(saved.results&&typeof saved.results==='object'?saved.results:{}))if(known.has(id)&&!state.results[id]&&Competition.validScore(r?.home)&&Competition.validScore(r?.away))addedResults[id]=r;
  const closed={...(saved.closedMatches&&typeof saved.closedMatches==='object'?saved.closedMatches:{}),...state.closedMatches};
  const prizes={...(saved.prizes&&typeof saved.prizes==='object'?saved.prizes:{}),...(state.prizes||{})};
  return {exportedAt:data.exportedAt,addedEntries,addedResults,next:{...state,entries:[...state.entries,...addedEntries],results:{...state.results,...addedResults},closedMatches:closed,prizes}};
}
function restoreBackup(file){
  if(!adminAuthenticated||!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    let merge;try{merge=mergeBackup(String(reader.result))}catch(error){message(error.message);return}
    const results=Object.keys(merge.addedResults).length;
    if(!merge.addedEntries.length&&!results){message('Záloha neobsahuje nic, co by na kiosku chybělo.');return}
    const when=merge.exportedAt&&!isNaN(new Date(merge.exportedAt))?` z ${fmt(merge.exportedAt,{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}`:'';
    if(!confirm(`Obnovit ze zálohy${when}: přidat ${count(merge.addedEntries.length,'tip','tipy','tipů')} a ${count(results,'výsledek','výsledky','výsledků')}? Nic stávajícího se nepřepíše.`))return;
    if(persist(merge.next)){message(`Obnoveno: ${count(merge.addedEntries.length,'tip','tipy','tipů')} a ${count(results,'výsledek','výsledky','výsledků')}.`);staff()}
  };
  reader.onerror=()=>message('Soubor se nepodařilo přečíst.');
  reader.readAsText(file);
}
// Staff tools for the selected match: open tipping by hand and delete tips (e.g. after a test).
function manualOpenAdmin(m){
  const on=manualOpen(m),regular=Date.now()>=opensAt(m);
  const status=closed(m)?'Tipování tohoto zápasu je už uzamčené, ručně ho otevřít nejde.':on?'Tipování je <b>ručně otevřené</b>. Tipy se ukládají do soutěže jako skutečné a uvidí je i návštěvníci.':regular?'Tipování je otevřené podle běžného časového okna.':'Tipování se podle časového okna zatím neotevřelo.';
  return `<section class="admin-preview manual-open-admin"><h2>Ruční otevření tipování</h2><p class="hint">${status} Zamčení 10 minut po začátku zápasu platí vždy. Testovací tipy pak smažte v seznamu níže.</p>${closed(m)?'':`<button class="${on?'text-button':'primary'}" data-action="manual-open-toggle">${on?'Zrušit ruční otevření':'Otevřít tipování ručně →'}</button>`}</section>`;
}
function tipsAdmin(m){
  const list=entries(m.id).slice().sort((a,b)=>Competition.tipTime(a)-Competition.tipTime(b));
  const rows=list.map(e=>`<li><div><strong>${esc(e.name)}</strong><small>${tipText(e)} · ${tipTimeText(e)}</small></div><button class="text-button tip-delete" data-action="delete-tip" data-id="${esc(e.id)}" aria-label="Smazat tip: ${esc(e.name)}">Smazat</button></li>`).join('');
  return `<section class="admin-preview tips-admin"><h2>Tipy tohoto zápasu (${list.length})</h2>${list.length?`<ul class="tips-admin-list">${rows}</ul><button class="text-button tip-delete-all" data-action="delete-all-tips">Smazat všechny tipy tohoto zápasu</button>`:'<p class="hint">Zatím žádné tipy.</p>'}${state.results[m.id]?'<p class="hint">Zápas už má výsledek – smazáním tipu se změní pořadí i vítěz.</p>':''}</section>`;
}
function toggleManualOpen(){
  if(!adminAuthenticated)return;const m=current();if(closed(m))return;
  const next={...(state.manualOpen||{})};if(next[m.id])delete next[m.id];else next[m.id]=new Date().toISOString();
  if(persist({...state,manualOpen:next})){message(next[m.id]?'Tipování je ručně otevřené.':'Ruční otevření tipování je zrušené.');staff()}
}
function deleteTips(id){
  if(!adminAuthenticated)return;const m=current();
  const victims=entries(m.id).filter(e=>id==null||e.id===id);if(!victims.length)return;
  const question=id==null?`Opravdu smazat všech ${victims.length} tipů zápasu s týmem ${m.opponent}? Nejde to vrátit (jen obnovou ze zálohy).`:`Opravdu smazat tip „${victims[0].name}“ (${tipText(victims[0])})?`;
  if(!confirm(question))return;
  const gone=new Set(victims.map(e=>e.id));
  if(persist({...state,entries:state.entries.filter(e=>!gone.has(e.id))})){message(id==null?'Všechny tipy zápasu jsou smazané.':'Tip je smazaný.');staff()}
}
function backupAdmin(){const last=state.lastBackupAt&&!isNaN(new Date(state.lastBackupAt))?fmt(state.lastBackupAt,{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'zatím žádná';return `<section class="admin-preview backup-admin"><h2>Záloha tipů a výsledků</h2><p class="hint">Tipy a výsledky jsou uložené jen v tomto prohlížeči. Po každém zápase si stáhněte zálohu a uložte ji mimo kiosek (např. na USB disk nebo do e-mailu). Celkem ${count(state.entries.length,'tip','tipy','tipů')} · poslední záloha: <b>${last}</b></p><div class="backup-actions"><button class="primary" data-action="backup-json">Stáhnout zálohu →</button><button class="text-button" data-action="backup-csv">Tabulka tipů pro Excel (CSV)</button><label class="text-button backup-restore">Obnovit ze zálohy…<input type="file" id="backup-file" accept=".json,application/json"></label></div><p class="hint">Obnova jen doplní chybějící tipy a výsledky, nic stávajícího nepřepíše.</p></section>`}
function message(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('#toast').style.display='none',5000)}
function matchLine(m){return `Baník Ostrava <span class="versus">vs.</span> ${esc(m.opponent)}`}
function selectMatch(){return `<label class="field-label" for="match">Aktivní zápas pro celý kiosek</label><select id="match">${matches.map(m=>`<option value="${m.id}" ${m.id===currentId?'selected':''}>${fmt(m.date,{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})} · ${esc(m.opponent)}</option>`).join('')}</select><p class="hint">Změna se uloží pro všechny další návštěvníky tohoto zařízení. Návštěvníci zápas nevybírají. Po oficiálním výsledku a vyhlášení kiosek v 6:00 ráno po zápase sám přepne na nejbližší další zápas.</p>`}
function teamBadge(id){const team=FootballTeams[id];if(!team)return '<span class="team-badge team-logo-fallback">FC</span>';return `<span class="team-badge" role="img" aria-label="Logo ${esc(team.name)}"><img class="team-logo" src="${esc(team.logo)}" alt="" data-remote-logo="${esc(team.remoteLogo)}"><span class="team-logo-fallback" hidden>${esc(team.short)}</span></span>`}
function matchCard(){const m=current();return `<section class="hero featured-match" aria-label="Zápas této VIP soutěže"><div class="hero-top"><span>DNEŠNÍ VIP SOUTĚŽ · ${m.round}. KOLO</span><span class="live" id="match-status">${closed(m)?'● TIPOVÁNÍ UZAVŘENO':open(m)?(manualOpen(m)&&Date.now()<opensAt(m)?'● TIPOVÁNÍ OTEVŘENO OBSLUHOU':'● TIPOVÁNÍ OTEVŘENO'):'● ČEKÁME NA OTEVŘENÍ'}</span></div><div class="matchup"><div class="team">${teamBadge('ova')}<strong>BANÍK OSTRAVA</strong><small>DOMÁCÍ</small></div><span class="versus">VS</span><div class="team">${teamBadge(m.awayTeamId)}<strong>${esc(m.short)}</strong><small>HOSTÉ</small></div></div><div class="match-info">${fmt(m.date,{day:'numeric',month:'long',year:'numeric'})} &nbsp; / &nbsp; ${fmt(m.date,{hour:'2-digit',minute:'2-digit'})} &nbsp; / &nbsp; Městský stadion</div><div class="countdown"><span id="countdown-label">${state.results[m.id]?'Soutěž tohoto zápasu skončila':closed(m)?'Tipy jsou uzamčené · zápas běží':open(m)?'Tipování se zamkne za':'Tipování se otevře za'}</span><b id="countdown" role="timer">${countdownText(m)}</b></div></section>`}
function countdownText(m){if(closed(m))return 'TIPY UZAVŘENY';if(open(m))return clock(locksAt(m)-Date.now());return clock(opensAt(m)-Date.now())}

function winnersMarkup(m){const result=state.results[m.id];if(!result)return '<p>Výsledek zatím není potvrzený. Po vyhodnocení zde vyhlásíme vítěze.</p>';const winners=Competition.evaluate(entries(m.id),result);return `<div class="final-score">${result.home} : ${result.away}</div><p>Konečný výsledek zápasu</p>${winners.length?`<span class="eyebrow">${winners[0].distance===0?'PŘESNÝ TIP':'NEJBLIŽŠÍ TIP'}</span><h1>${winners.length===1?'Gratulujeme vítězi!':'Gratulujeme vítězům!'}</h1><div class="winner-names">${winners.map(e=>`<div>${esc(e.name)} <small>tip ${tipText(e)} · odesláno ${tipTimeText(e)}</small></div>`).join('')}</div><p class="prize">Výhra: ${esc(prizesFor(m.id)[0].title)} · cenu si vyzvedněte ve VIP zóně.</p>`:'<h1>Tento zápas nemá žádné tipy.</h1>'}`}
// Prizes are set by staff per match; until then the kiosk shows this default set.
const DEFAULT_PRIZES=[{title:'Podepsaný dres FC Baník Ostrava',detail:'Za přesný tip konečného skóre'},{title:'Dvě vstupenky do VIP zóny',detail:'Na další domácí zápas'},{title:'Klubový balíček z fanshopu',detail:'Šála, čepice a míč'}];
const prizesFor=id=>Array.isArray(state.prizes?.[id])&&state.prizes[id].length?state.prizes[id]:DEFAULT_PRIZES;
const customPrizes=id=>Array.isArray(state.prizes?.[id])&&state.prizes[id].length>0;
function prizesPanel(m){const list=prizesFor(m.id);return `<aside class="side-panel prizes-panel" aria-label="Ceny pro vítěze"><span class="eyebrow">CO MŮŽEŠ VYHRÁT</span><h2>Ceny pro tento zápas</h2><ol class="prize-list">${list.map((p,i)=>`<li><span class="prize-place">${i+1}.</span><div><strong>${esc(p.title)}</strong>${p.detail?`<small>${esc(p.detail)}</small>`:''}</div></li>`).join('')}</ol><p class="side-note">Vyhrává nejpřesnější tip konečného skóre; při shodě ten dřívější. Cenu si vítěz vyzvedne ve VIP zóně.</p></aside>`}
function participantsPanel(m){const list=entries(m.id).slice().sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt));const shown=list.slice(0,4);const more=list.length-shown.length;const moreText=more===1?'a další 1 soutěžící':more<5?`a další ${more} soutěžící`:`a dalších ${more} soutěžících`;const body=list.length?`<ul class="participant-list">${shown.map(e=>`<li><span class="participant-avatar">${esc(e.name.trim().charAt(0).toUpperCase()||'?')}</span><div><strong>${esc(e.name)}</strong><small>${e.savedAt&&!isNaN(new Date(e.savedAt))?fmt(e.savedAt,{hour:'2-digit',minute:'2-digit'}):'tip uložen'}</small></div><b>${tipText(e)}</b></li>`).join('')}</ul>${more>0?`<p class="side-note">… ${moreText}</p>`:''}`:`<div class="participants-empty"><span class="participants-empty-icon">⚽</span><strong>Zatím nikdo nehrál.</strong><p>Buď první a tipuj!</p>${open(m)?'<button class="primary" data-action="start">Tipnout jako první →</button>':`<small>${closed(m)?'Tipování tohoto zápasu je uzamčené.':'Tipování se otevře 30 minut před začátkem.'}</small>`}</div>`;return `<aside class="side-panel participants-panel" aria-label="Soutěžící"><div class="side-head"><div><span class="eyebrow">KDO UŽ TIPUJE</span><h2>Soutěžící</h2></div><span class="count-badge" id="participant-count">${list.length}</span></div>${body}</aside>`}
function refreshParticipants(){const panel=$('.participants-panel');if(!panel||screen!=='welcome')return;const m=current();if(String(entries(m.id).length)!==$('#participant-count')?.textContent)panel.outerHTML=participantsPanel(m)}
function prizeRowsMarkup(rows){return rows.map((p,i)=>`<div class="prize-row"><span class="prize-place">${i+1}.</span><input type="text" name="title" maxlength="80" placeholder="Cena (např. Podepsaný dres)" value="${esc(p.title||'')}" aria-label="Cena ${i+1}"><input type="text" name="detail" maxlength="100" placeholder="Doplněk (volitelné)" value="${esc(p.detail||'')}" aria-label="Poznámka k ceně ${i+1}"><button type="button" class="text-button" data-action="prize-remove" data-index="${i}" aria-label="Odebrat cenu ${i+1}">×</button></div>`).join('')}
function readPrizeRows(){return [...document.querySelectorAll('#prize-rows .prize-row')].map(row=>({title:row.querySelector('[name=title]').value.trim().replace(/\s+/g,' '),detail:row.querySelector('[name=detail]').value.trim().replace(/\s+/g,' ')}))}
function prizesAdmin(m){const custom=customPrizes(m.id);return `<section class="admin-preview prizes-admin"><h2>Ceny pro tento zápas</h2><p class="hint">${custom?'Ceny upravené obsluhou. Zobrazují se na úvodní obrazovce a při vyhlášení vítěze.':'Zatím výchozí ceny. Uprav je pro tento zápas — každý zápas má vlastní seznam.'}</p><form id="prizes-form"><div id="prize-rows">${prizeRowsMarkup(prizesFor(m.id))}</div><div class="prize-actions"><button type="button" class="text-button" data-action="prize-add">+ Přidat cenu</button><button class="primary">Uložit ceny →</button></div></form></section>`}
function addPrizeRow(){const rows=readPrizeRows();if(rows.length>=6){message('Maximálně šest cen na zápas.');return}rows.push({title:'',detail:''});$('#prize-rows').innerHTML=prizeRowsMarkup(rows);[...document.querySelectorAll('#prize-rows [name=title]')].at(-1)?.focus()}
function removePrizeRow(index){const rows=readPrizeRows();rows.splice(index,1);$('#prize-rows').innerHTML=prizeRowsMarkup(rows)}
function savePrizes(){if(!adminAuthenticated)return;const m=current();const rows=readPrizeRows().filter(p=>p.title);if(!rows.length){message('Zadej alespoň jednu cenu.');return}if(persist({...state,prizes:{...(state.prizes||{}),[m.id]:rows}})){message(`Ceny pro zápas s ${m.short} jsou uložené.`);staff()}}
function welcome(){screen='welcome';updateKeyboardDock();outcome='';const m=current();$('#main').innerHTML=`<section class="attract"><img class="attract-logo" src="${logo}" alt="FC Baník Ostrava"><span class="eyebrow">EXKLUZIVNĚ PRO HOSTY VIP ZÓNY</span><h1>Na trávníku tým.<br>Ve hře ty.</h1><p>Tipni skóre. Užij si zápas. Vyhraj cenu.</p><div class="attract-grid"><div class="attract-center">${matchCard()}<button class="touch-start" data-action="start">☝ <span>Dotkni se obrazovky<small>${open(m)?'a zapoj se do tipovací soutěže':'a prohlédni si dnešní zápas'}</small></span> →</button><button class="text-button" data-action="winners">Průběžné pořadí a vítězové →</button></div><div class="side-panels">${prizesPanel(m)}${participantsPanel(m)}</div></div>${clubNav()}<div class="attract-bottom">MODROBÍLÉ SRDCE OSTRAVY <span>FC BANÍK OSTRAVA</span></div></section>`}
function form(){screen='form';updateKeyboardDock();outcome='';const m=current();$('#main').innerHTML=`<div class="kiosk-head"><button class="text-button" data-action="home">← Úvod</button><span class="eyebrow">VIP TIPOVACÍ SOUTĚŽ</span><button class="text-button" data-action="rules">Pravidla</button></div><section class="kiosk-card"><span class="eyebrow">${testMode?'ADMIN · ZKUŠEBNÍ TIP':open(m)?'TVŮJ TIP NA DOMÁCÍ ZÁPAS':closed(m)?'TIPOVÁNÍ UZAVŘENO':'TIPOVÁNÍ SE BRZY OTEVŘE'}</span><h1>${matchLine(m)}</h1><p class="hint">${fmt(m.date,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})} · Vyhodnocujeme konečné skóre po 90 minutách včetně nastaveného času. Remíza je platný tip. Tipy přijímáme od 30 minut před výkopem do 10. minuty zápasu.</p>${matchCard()}${testMode?'<div class="notice test-notice">ZKUŠEBNÍ REŽIM · Tip se nezapočítá do soutěže. Můžeš vyzkoušet celý formulář i před začátkem zápasu.<br><button type="button" class="text-button" data-action="admin-panel">Ukončit test a vrátit se do administrace →</button></div>':''}${!canTip(m)?`<div class="notice">${closed(m)?'Tipování tohoto zápasu je uzamčené — tipy přijímáme jen od 30 minut před začátkem do 10. minuty hry. Podívej se na pořadí a vítěze.':`Tipování se otevře ${fmt(opensAt(m),{hour:'2-digit',minute:'2-digit'})}, tedy 30 minut před začátkem, a poběží do 10. minuty zápasu.`}</div><button class="primary" data-action="winners">Průběžné pořadí a vítězové →</button>`:`<form id="entry-form" autocomplete="off"><label class="field-label" for="guest-name">1. Jak se jmenuješ?</label><input id="guest-name" name="name" type="text" minlength="2" maxlength="60" required autocomplete="off" placeholder="Tvé jméno a příjmení"><label class="field-label">2. Jak zápas dopadne?</label><div class="choices">${[['1','Vyhraje Baník'],['X','Remíza'],['2','Vyhrají hosté']].map(([v,label])=>`<button type="button" data-outcome="${v}" class="choice" aria-pressed="false"><b>${v}</b>${label}</button>`).join('')}</div><label class="field-label" for="home-score">3. Tipni přesné konečné skóre</label><div class="score"><div><input id="home-score" aria-label="Góly Baníku" type="number" inputmode="numeric" min="0" max="20" required placeholder="0"><small>Baník</small></div><span>:</span><div><input id="away-score" aria-label="Góly soupeře" type="number" inputmode="numeric" min="0" max="20" required placeholder="0"><small>Hosté</small></div></div><p class="hint">Jméno použijeme k vyhlášení vítěze na této obrazovce. Jeden tip na jméno a zápas na tomto kiosku. Při shodě vyhrávají všichni stejně úspěšní.</p><div class="submit-row"><button type="button" class="text-button" data-action="rules">Jak vybíráme vítěze?</button><button class="primary">${testMode?'Odeslat zkušební tip':'Potvrdit můj tip'} →</button></div></form>`}</section>`}
function resultScreen(){screen='winners';const m=current();$('#main').innerHTML=`<div class="kiosk-head"><button class="text-button" data-action="home">← Úvod</button><span class="eyebrow">VIP TIPOVACÍ SOUTĚŽ</span><button class="text-button" data-action="rules">Pravidla</button></div><section class="kiosk-card results-screen">${matchCard()}<h2>${matchLine(m)}</h2><div id="live-board-content">${realBoardMarkup()}</div>${state.results[m.id]?winnersMarkup(m)+'<button class="primary" data-action="award">Zobrazit pohár →</button>':''}<button class="primary" data-action="home">Zpět na úvod →</button></section>`;pollLive()}
function rankingTable(tips,snapshot,final=false){
  const ranked=snapshot?Competition.rank(tips,snapshot):tips.map(e=>({...e,position:null,distance:null}));
  if(!ranked.length)return '<div class="empty">Zatím tu není žádný tip. Zapoj se do soutěže a najdi zde své jméno.</div>';
  return `<div class="table-scroll"><table class="score-table"><caption>${final?'Konečné pořadí tipů':'Jak si stojí tipy v tomto zápase'}</caption><thead><tr><th scope="col">Pořadí</th><th scope="col">Jméno</th><th scope="col">Tip</th><th scope="col">Odchylka</th><th scope="col">Čas tipu</th><th scope="col">Stav</th></tr></thead><tbody>${ranked.map(e=>`<tr class="${e.position===1?'leading-row':''}"><td>${e.position?e.position+'.':'—'}</td><th scope="row">${esc(e.name)}</th><td class="table-score">${tipText(e)}</td><td>${e.distance===null?'—':e.distance}</td><td class="table-time">${tipTimeText(e)}</td><td>${e.position===1?(final?'Vítěz':e.distance===0?'Průběžný lídr · přesný tip':'Průběžný lídr'):snapshot?'Ve hře':'Čeká na skóre'}</td></tr>`).join('')}</tbody></table></div><p class="hint">Odchylka = součet rozdílů obou skóre. Menší je lepší. Při shodě rozhoduje dřívější čas tipu.</p>`;
}
function realBoardMarkup(){
  const m=current(),final=state.results[m.id],raw=liveSnapshots.get(m.id);
  const stale=raw&&Date.now()-Date.parse(raw.updatedAt)>90000;
  const snapshot=final||(!liveErrors.has(m.id)&&!stale?raw:null);
  const status=final?(final.source?`Oficiální konečný výsledek · zdroj ${final.source}`:'Potvrzený konečný výsledek'):snapshot?[LiveMatch.phases[snapshot.phase],snapshot.clock,`zdroj ${LiveMatch.SOURCE_NAME}`].filter(Boolean).join(' · '):raw?`${liveErrors.get(m.id)||'Aktualizace skóre je nedostupná.'} Pořadí nyní nepočítáme.`:(liveErrors.get(m.id)||`Načítáme skóre z ${LiveMatch.SOURCE_NAME}…`);
  return `<div class="live-score-panel"><span class="eyebrow">${final?'KONEČNÝ VÝSLEDEK':snapshot?'PRŮBĚŽNÝ STAV':'ČEKÁME NA AKTUÁLNÍ DATA'}</span><div class="live-score">${snapshot?`${snapshot.home} : ${snapshot.away}`:'— : —'}</div><p>${esc(status)}</p>${raw?`<small>Poslední přijatá aktualizace: ${fmt(raw.updatedAt,{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small>`:''}</div>${!final?'<div class="notice">Průběžný lídr není konečný vítěz. Pořadí se mění s každým gólem; vítěze vyhlásíme automaticky po oficiálním konci zápasu.</div>':''}${rankingTable(entries(m.id),snapshot,Boolean(final))}`;
}
function refreshBoard(){if(screen==='winners'&&$('#live-board-content')){const markup=realBoardMarkup();if($('#live-board-content').innerHTML!==markup)$('#live-board-content').innerHTML=markup}}
async function pollLive(){
  const id=currentId;
  if(demo||liveRequest||!started(current())||state.results[id]||!current().onlajny||Date.now()-lastLivePoll<livePollGap)return;
  lastLivePoll=Date.now();const controller=new AbortController();liveRequest=controller;
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(LiveMatch.liveUrl(LIVE_ENDPOINT,current()),{cache:'no-store',signal:controller.signal});
    // Without the Worker (e.g. plain GitHub Pages) there is no live score: ask once a minute, staff enter the result.
    if(response.status===404||response.status===405){livePollGap=60000;throw Error('Živé skóre tu není k dispozici. Výsledek po zápase zapíše obsluha.')}
    if(!response.ok)throw Error(`Zdroj ${LiveMatch.SOURCE_NAME} je dočasně nedostupný.`);
    livePollGap=15000;
    const snapshot=LiveMatch.validateSnapshot(await response.json(),id,Date.now());
    if(demo)return;
    const previous=liveSnapshots.get(id);
    if(previous&&Date.parse(snapshot.updatedAt)<Date.parse(previous.updatedAt))throw Error('Čekáme na novější skóre.');
    liveSnapshots.set(id,snapshot);liveErrors.delete(id);
    if(snapshot.final&&!state.results[id]){
      // Official end of the match: the final score decides the winners without staff input.
      const result={home:snapshot.home,away:snapshot.away,confirmedAt:snapshot.updatedAt,source:LiveMatch.SOURCE_NAME};
      if(persist({...state,results:{...state.results,[id]:result},closedMatches:{...state.closedMatches,[id]:state.closedMatches[id]||snapshot.updatedAt}})&&currentId===id&&!adminAuthenticated&&['welcome','winners'].includes(screen)){if(screen==='winners')resultScreen();showCelebration(false)}
    }else if(snapshot.phase==='fulltime'&&!state.closedMatches[id])persist({...state,closedMatches:{...state.closedMatches,[id]:snapshot.updatedAt}});
  }catch(error){liveErrors.set(id,error.message||'Aktualizace skóre je nedostupná.')}
  finally{clearTimeout(timeout);liveRequest=null;if(currentId===id)refreshBoard()}
}
function startDemo(){if(!adminAuthenticated)return;if(liveRequest)liveRequest.abort();testMode=false;demo=LiveMatch.createDemo(currentId);demoScreen()}
function demoScreen(){
  if(!adminAuthenticated||!demo)return;screen='demo';
  const step=demo.steps[demo.index],final=step.phase==='fulltime';
  const winners=final?Competition.evaluate(demo.tips,step):[];
  $('#main').innerHTML=`<div class="kiosk-head"><button class="text-button" data-action="demo-exit">← Administrace</button><span class="eyebrow">DEMO · SIMULOVANÝ ZÁPAS</span><button class="text-button" data-action="home">Ukončit a zamknout</button></div><section class="kiosk-card results-screen"><div class="notice test-notice">DEMOVERZE · Náhodná jména, ukázkové tipy a simulované skóre. Žádná data skutečné soutěže se nemění.</div><h1>${matchLine(current())}</h1><div class="live-score-panel"><span class="eyebrow">${LiveMatch.phases[step.phase]}</span><div class="live-score">${step.home} : ${step.away}</div><p>${[step.clock,esc(step.note)].filter(Boolean).join(' · ')}</p></div><div class="demo-progress"><span style="width:${100*demo.index/(demo.steps.length-1)}%"></span></div><div class="demo-controls"><button data-action="demo-toggle" ${final?'disabled':''}>${demo.playing?'Pozastavit':'Pokračovat'}</button><button data-action="demo-next" ${final?'disabled':''}>Další událost →</button><button data-action="demo-restart">Spustit znovu</button></div><p class="hint">Událost ${demo.index+1} / ${demo.steps.length} · automatický posun každých 5 sekund</p>${rankingTable(demo.tips,step,final)}${final?`<div class="demo-winners"><span class="eyebrow">KONEČNÝ VÝSLEDEK DEMOVERZE</span><h1>${winners.length===1?'Gratulujeme vítězi!':'Gratulujeme vítězům!'}</h1>${winners.map(e=>`<h2>${esc(e.name)}</h2>`).join('')}<p>Cenu si vyzvedněte ve VIP zóně.</p></div>`:'<p class="hint">Zvýrazněné jméno je pouze průběžný lídr. S dalším gólem se může změnit.</p>'}</section>`;
}
function advanceDemo(){if(!adminAuthenticated||!demo||demo.index>=demo.steps.length-1)return;demo.index++;demo.lastStepAt=Date.now();if(demo.index===demo.steps.length-1)demo.playing=false;demoScreen();if(demo.index===demo.steps.length-1)showCelebration(true)}

function showCelebration(isDemo=false){
  const result=isDemo?demo?.steps[demo.index]:state.results[currentId];
  if(!result||(isDemo&&result.phase!=='fulltime'))return false;
  const winners=Competition.evaluate(isDemo?demo.tips:entries(currentId),result);
  if(!winners.length)return false;
  celebration={isDemo,expiresAt:Date.now()+WINNER_DURATION};screen='celebration';
  awardBackground(true);
  if(!isDemo){adminAuthenticated=false;testMode=false;practiceEntries=[]}
  const trophy='<svg class="winner-trophy" viewBox="0 0 200 220" role="img" aria-label="Vítězný pohár"><defs><linearGradient id="cup-gold" x2="1" y2="1"><stop stop-color="#fff2b3"/><stop offset=".5" stop-color="#e8bd5e"/><stop offset="1" stop-color="#a36a1d"/></linearGradient></defs><path d="M55 30H25v35c0 30 25 45 48 45M145 30h30v35c0 30-25 45-48 45" fill="none" stroke="#dfb45c" stroke-width="12"/><path d="M50 15h100v65c0 35-22 55-50 55S50 115 50 80zM91 130h18v40H91zM65 170h70v17H65zM45 187h110v20H45z" fill="url(#cup-gold)"/><path d="m100 42 8 17 19 3-14 13 3 19-16-9-16 9 3-19-14-13 19-3z" fill="#fff4c5"/></svg>';
  $('#main').innerHTML=`<section class="winner-celebration" role="dialog" aria-modal="true" aria-labelledby="winner-title"><div class="winner-glow"></div><div class="winner-content">${isDemo?'<span class="demo-award-label">DEMOVERZE · UKÁZKOVÉ VYHLÁŠENÍ</span>':''}${trophy}<span class="eyebrow">${winners[0].distance===0?'PŘESNÝ TIP':'NEJBLIŽŠÍ TIP'}</span><h1 id="winner-title">${winners.length===1?'Gratulujeme vítězi!':'Gratulujeme vítězům!'}</h1><div class="celebration-names">${winners.map(w=>`<div>${esc(w.name)}<small>Tip ${tipText(w)} · odchylka ${w.distance}</small></div>`).join('')}</div><p class="celebration-result">Konečný výsledek zápasu ${result.home} : ${result.away}</p><p class="celebration-prize">Cenu si vyzvedněte ve VIP zóně.</p></div><button class="celebration-dismiss" id="winner-dismiss" data-action="celebration-dismiss"><span>Dotkni se obrazovky pro zavření poháru</span></button></section>`;
  $('#winner-dismiss').focus();return true;
}
function dismissCelebration(){
  if(!celebration)return;
  awardBackground(false);
  const wasDemo=celebration.isDemo;celebration=null;lastActivity=Date.now();
  if(wasDemo&&demo&&adminAuthenticated)demoScreen();else resultScreen();
}
function awardBackground(inert){document.querySelectorAll('body > header, body > footer, #partners-strip, #admin-access, #dialog').forEach(node=>node.inert=inert)}

function thanks(entry){screen='thanks';$('#main').innerHTML=`<section class="attract confirmation"><span class="confirmation-icon">✓</span><span class="eyebrow">${testMode?'ZKUŠEBNÍ TIP JE V POŘÁDKU':'TIP JE ULOŽENÝ'}</span><h1>Díky za tip,<br>${esc(entry.name)}!</h1><p>${matchLine(current())}</p><div class="final-score">${entry.home} : ${entry.away}</div><p>${testMode?'Test proběhl úspěšně.<br>Tento tip neovlivní soutěž ani vítěze.':'Po zápase vyhlásíme vítěze.<br>Cenu si vítěz vyzvedne ve VIP zóně.'}</p>${testMode?'<button class="primary" data-action="admin-panel">Zpět do administrace →</button>':''}<button class="touch-start" data-action="home">${testMode?'Ukončit test a zamknout administraci':'Další návštěvník'} →</button><small>Za 12 sekund se obrazovka vrátí na úvod.</small></section>`;setTimeout(()=>{if(screen==='thanks')home()},12000)}
function rules(){ $('#dialog-content').innerHTML='<span class="eyebrow">PRAVIDLA VIP SOUTĚŽE</span><h1>Jak vybereme vítěze?</h1><ol><li>Vyber výsledek 1 / X / 2 a přesné konečné skóre zápasu. Počítá se stav po 90 minutách včetně nastaveného času. Remíza je platný tip.</li><li>Vyhrává přesné skóre. Pokud jej nikdo netrefí, vyhrává nejmenší součet odchylek obou skóre. Pro výsledek 2:1 má tip 3:1 odchylku 1 a tip 1:1 také odchylku 1.</li><li>Při stejné odchylce vyhrává dřívější tip — rozhoduje čas odeslání tipu na tomto kiosku. Kdo tipuje dřív a přesně, má výhodu.</li><li>Jeden tip na jméno a utkání na tomto zařízení. Tip nelze po potvrzení měnit. Jméno není ověřená totožnost.</li><li>Tipování se otevírá 30 minut před plánovaným výkopem a automaticky se zamyká 10 minut po něm. Potom už kiosek žádný tip nepřijme, aby to bylo férové pro všechny. Při odložení zápasu musí pořadatel termín nejprve opravit.</li></ol><p>Místní prototyp: tipy zůstávají v tomto prohlížeči. Výsledek se po konci zápasu načte automaticky z onlajny.com, jinak ho zapíše obsluha. Ceny a finální pravidla schvaluje pořadatel.</p>';$('#dialog').showModal()}
function staff(){awardBackground(false);celebration=null;demo=null;if(!adminAuthenticated){welcome();adminLogin();return}testMode=false;screen='staff';updateKeyboardDock();const m=current();$('#main').innerHTML=`<div class="kiosk-head"><button class="text-button" data-action="home">← Kiosek</button><span class="eyebrow">OBSLUHA · MÍSTNÍ PROTOTYP</span><button class="text-button keyboard-toggle" data-action="keyboard-toggle" aria-pressed="${keyboardDock}">⌨ Klávesnice: ${keyboardDock?'zapnuta':'vypnuta'}</button></div><section class="kiosk-card"><h1>Administrace VIP zóny</h1><div class="notice">Místní heslová brána prototypu. Pro ostrý provoz je potřeba serverové přihlášení obsluhy. Výsledek zadejte až po konečném hvizdu.</div><section class="admin-preview"><h2>Demoverze zápasu</h2><p class="hint">Tři ukázkové tipy, průběh obou poločasů, měnící se pořadí a vyhlášení vítěze.</p><button class="primary" data-action="demo-start">Spustit demo zápasu →</button><hr class="admin-divider"><h2>Vyzkoušej tipování</h2><p class="hint">Otevři formulář i před začátkem zápasu. Zkušební tipy neovlivní skutečnou soutěž.</p><button class="primary" data-action="test-start">Spustit zkušební tipování →</button><p class="hint">${practiceEntries.length} zkušebních tipů během tohoto přihlášení</p></section>${selectMatch()}${manualOpenAdmin(m)}${tipsAdmin(m)}${prizesAdmin(m)}${backupAdmin()}<p class="hint">Tipování tohoto zápasu: <b>${fmt(opensAt(m),{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})} – ${fmt(locksAt(m),{hour:'2-digit',minute:'2-digit'})}</b> (30 minut před začátkem až 10 minut po něm). Poté se kiosek automaticky zamkne, nic není potřeba potvrzovat.</p><p class="hint">${entries(m.id).length} přijatých tipů na tomto zařízení</p>${state.results[m.id]?`<h2>Potvrzený výsledek: ${state.results[m.id].home} : ${state.results[m.id].away}</h2>${state.results[m.id].source?`<p class="hint">Zapsáno automaticky ze zdroje ${esc(state.results[m.id].source)}.</p>`:''}<p class="hint">Výsledek je uzamčený. Vyhlášení vítězů najdete v kiosku.</p><button class="primary" data-action="winners">Zobrazit vítěze →</button>`:`<p class="hint">Konečný výsledek se zapíše automaticky z ${LiveMatch.SOURCE_NAME}, jakmile zápas skončí – pokud kiosek běží přes Cloudflare Worker (viz README). Jinak nebo při výpadku zdroje jej zadejte ručně.</p><form id="result-form"><label class="field-label">Potvrzený konečný výsledek (po 90 minutách včetně nastavení)</label><div class="score"><input id="result-home" aria-label="Skutečné góly Baníku" type="number" min="0" max="20" inputmode="numeric" required><span>:</span><input id="result-away" aria-label="Skutečné góly soupeře" type="number" min="0" max="20" inputmode="numeric" required></div><label class="confirm-label"><input id="result-confirm" type="checkbox" required> Ověřil/a jsem konečný výsledek a chci vyhlásit vítěze.</label><button class="primary" ${!closed(m)?'disabled':''}>Potvrdit výsledek a vyhodnotit →</button><p class="hint">${!closed(m)?'Výsledek lze zadat až po automatickém uzamčení tipů (10 minut po výkopu) a po konečném hvizdu.':'Tipy jsou uzamčené. Potvrďte výsledek po konečném hvizdu.'}</p></form>`}</section>`}
function submitEntry(){const m=current();if(!canTip(m)){message(closed(m)?'Tipování je už uzamčené.':'Tipování se otevře 30 minut před začátkem zápasu.');form();return}const h=$('#home-score').value,a=$('#away-score').value;const entry={id:crypto.randomUUID(),matchId:m.id,name:$('#guest-name').value.trim().replace(/\s+/g,' '),outcome,home:h===''?null:Number(h),away:a===''?null:Number(a),savedAt:new Date().toISOString()};const error=Competition.validate(entry);if(error){message(error);return}const normalized=s=>s.normalize('NFKC').toLocaleLowerCase('cs-CZ');if(!testMode&&entries(m.id).some(e=>normalized(e.name)===normalized(entry.name))){message('Na toto jméno už je pro tento zápas tip uložený. Při shodě jmen se obrať na obsluhu.');return}if(testMode&&adminAuthenticated){practiceEntries.push(entry);thanks(entry);return}if(persist({...state,entries:[...state.entries,entry]}))thanks(entry)}
function submitResult(){if(!adminAuthenticated)return;const m=current();if(!closed(m)||state.results[m.id]){message('Tento zápas teď nelze vyhodnotit.');return}const h=$('#result-home').value,a=$('#result-away').value;const result={home:h===''?null:Number(h),away:a===''?null:Number(a),confirmedAt:new Date().toISOString()};if(!Competition.validScore(result.home)||!Competition.validScore(result.away)||!$('#result-confirm').checked){message('Vyplň skóre a potvrď ověření výsledku.');return}if(persist({...state,results:{...state.results,[m.id]:result}})){resultScreen();showCelebration(false)}}
function home(){awardBackground(false);celebration=null;demo=null;adminAuthenticated=false;testMode=false;practiceEntries=[];currentId=state.activeMatchId;lastActivity=Date.now();if($('#dialog').open)$('#dialog').close();if(location.hash)history.replaceState(null,'',location.pathname+location.search);welcome()}
$('#main').addEventListener('submit',event=>{event.preventDefault();if(event.target.id==='entry-form')submitEntry();if(event.target.id==='result-form')submitResult();if(event.target.id==='prizes-form')savePrizes()});
$('#main').addEventListener('change',event=>{if(event.target.id==='backup-file'){restoreBackup(event.target.files?.[0]);event.target.value='';return}if(event.target.id==='match'&&screen==='staff'&&adminAuthenticated&&matches.some(m=>m.id===event.target.value)){if(persist({...state,activeMatchId:event.target.value,activeMatchSetAt:new Date().toISOString()})){currentId=event.target.value;staff()}else event.target.value=currentId}});
$('#main').addEventListener('click',event=>{const b=event.target.closest('[data-outcome]');if(b){outcome=b.dataset.outcome;document.querySelectorAll('[data-outcome]').forEach(el=>{el.classList.toggle('selected',el.dataset.outcome===outcome);el.setAttribute('aria-pressed',String(el.dataset.outcome===outcome))})}const player=event.target.closest('[data-player-id]');if(player)playerScreen(player.dataset.playerId);const group=event.target.closest('[data-player-group]');if(group)playersScreen(group.dataset.playerGroup);const era=event.target.closest('[data-era]');if(era)achievementsScreen(era.dataset.era);const prizeButton=event.target.closest('[data-action=prize-add],[data-action=prize-remove]');if(prizeButton){if(prizeButton.dataset.action==='prize-add')addPrizeRow();else removePrizeRow(Number(prizeButton.dataset.index));return}const action=event.target.closest('[data-action]')?.dataset.action;if(action==='manual-open-toggle')toggleManualOpen();if(action==='delete-tip')deleteTips(event.target.closest('[data-action]').dataset.id);if(action==='delete-all-tips')deleteTips(null);if(action==='award')showCelebration(false);if(action==='achievements')achievementsScreen();if(action==='players')playersScreen();if(action==='celebration-dismiss')dismissCelebration();if(action==='demo-start')startDemo();if(action==='backup-json')downloadBackup('json');if(action==='backup-csv')downloadBackup('csv');if(action==='demo-next'&&adminAuthenticated)advanceDemo();if(action==='demo-toggle'&&adminAuthenticated&&demo&&demo.index<demo.steps.length-1){demo.playing=!demo.playing;demo.lastStepAt=Date.now();demoScreen()}if(action==='demo-restart'&&adminAuthenticated)startDemo();if(action==='demo-exit'&&adminAuthenticated)staff();if(action==='test-start'&&adminAuthenticated){testMode=true;form()}if(action==='admin-panel'&&adminAuthenticated)staff();if(action==='keyboard-toggle'&&adminAuthenticated)toggleKeyboardDock();if(action==='start')form();if(action==='home')home();if(action==='winners')resultScreen();if(action==='rules')rules()});
// Touch keyboard for the staff login: ASCII letters and digits only, Shift for capitals.
let keyboardShift=false,keyboardTarget=null;
const KEYBOARD_ROWS=['1234567890','qwertyuiop','asdfghjkl','zxcvbnm'];
const KEYBOARD_CZECH='ěščřžýáíéúůďťň';
// Kiosk-wide dock for staff (prizes, result) and visitors (name); remembered on the device.
let keyboardDock=false;try{keyboardDock=localStorage.getItem('kiosk-keyboard')==='on'}catch{}
function keyboardMarkup(mode='login'){const letter=c=>keyboardShift?c.toUpperCase():c;const rows=mode==='dock'?[KEYBOARD_ROWS[0],KEYBOARD_CZECH,...KEYBOARD_ROWS.slice(1)]:KEYBOARD_ROWS;const last=rows.length-1;return `<div class="osk osk-mode-${mode}" aria-label="Dotyková klávesnice">${rows.map((row,i)=>`<div class="osk-row">${i===last?`<button type="button" class="osk-key osk-wide osk-shift" data-key="shift" aria-pressed="${keyboardShift}" aria-label="Shift">⇧</button>`:''}${[...row].map(c=>`<button type="button" class="osk-key" data-key="${letter(c)}">${letter(c)}</button>`).join('')}${i===last?'<button type="button" class="osk-key osk-wide osk-back" data-key="backspace" aria-label="Smazat znak">⌫</button>':''}</div>`).join('')}<div class="osk-row osk-bottom"><button type="button" class="osk-key osk-clear" data-key="clear">Smazat vše</button><button type="button" class="osk-key osk-space" data-key=" " aria-label="Mezera"></button>${mode==='login'?'<button type="submit" class="osk-key osk-enter" form="admin-login-form">Odemknout →</button>':'<button type="button" class="osk-key osk-enter" data-key="next">Další pole →</button>'}</div></div>`}
function keyboardInput(){if($('#dialog').open)return $('#admin-password');if(keyboardTarget&&keyboardTarget.isConnected&&!keyboardTarget.disabled)return keyboardTarget;return null}
function typeable(el){return el&&el.matches&&el.matches('input[type=text],input[type=password],input[type=number]')&&!el.readOnly&&!el.disabled}
function rerenderKeyboard(){const dock=$('#keyboard-dock .osk');if(dock)dock.outerHTML=keyboardMarkup('dock');const login=$('#dialog .osk');if(login)login.outerHTML=keyboardMarkup('login')}
function focusNextField(input){const fields=[...document.querySelectorAll('#main input:not([type=checkbox]):not([disabled]),#main select:not([disabled])')];const next=fields[fields.indexOf(input)+1];if(next){next.focus();if(typeable(next))keyboardTarget=next}else input.blur()}
function pressKey(key){const input=keyboardInput();if(!input)return;lastActivity=Date.now();
  if(key==='shift'){keyboardShift=!keyboardShift;rerenderKeyboard();input.focus();return}
  if(key==='next'){focusNextField(input);return}
  if(key==='backspace')input.value=input.value.slice(0,-1);
  else if(key==='clear')input.value='';
  else{const char=keyboardShift&&/^[a-zěščřžýáíéúůďťň]$/.test(key)?key.toUpperCase():key;if(input.type==='number'&&!/^\d$/.test(char))return;input.value+=char;if(keyboardShift){keyboardShift=false;rerenderKeyboard()}}
  if(typeof Event!=='undefined'&&input.dispatchEvent)input.dispatchEvent(new Event('input',{bubbles:true}));const error=$('#admin-login-error');if(error)error.textContent='';input.focus()}
function updateKeyboardDock(){if(!document.body||!document.createElement)return;let dock=$('#keyboard-dock');if(!dock){dock=document.createElement('div');dock.id='keyboard-dock';dock.className='osk-dock';dock.setAttribute('aria-label','Klávesnice na obrazovce');dock.innerHTML=`<div class="osk-dock-head"><span>⌨ Klávesnice na obrazovce</span><span class="osk-dock-target" id="keyboard-dock-target"></span></div>${keyboardMarkup('dock')}`;document.body.append(dock);dock.addEventListener('mousedown',event=>event.preventDefault());dock.addEventListener('click',event=>{const key=event.target.closest('[data-key]');if(key)pressKey(key.dataset.key)})}
  const visible=keyboardDock&&(screen==='staff'||screen==='form')&&!$('#dialog').open;dock.hidden=!visible;document.body.classList.toggle('keyboard-docked',visible);
  if(visible){const input=keyboardInput();$('#keyboard-dock-target').textContent=input?(input.getAttribute('aria-label')||input.placeholder||'Aktivní pole'):'Klepni do pole, do kterého chceš psát'}}
function toggleKeyboardDock(){keyboardDock=!keyboardDock;try{localStorage.setItem('kiosk-keyboard',keyboardDock?'on':'off')}catch{}keyboardTarget=null;updateKeyboardDock();if(screen==='staff')staff()}
document.addEventListener('focusin',event=>{if(typeable(event.target)&&event.target.closest('#main')){keyboardTarget=event.target;updateKeyboardDock()}});
function adminLogin(){
  if(adminAuthenticated){if($('#dialog').open)$('#dialog').close();staff();return}
  lastActivity=Date.now();
  keyboardShift=false;$('#dialog').classList.add('admin-dialog');
  $('#dialog-content').innerHTML=`<div class="admin-login-head"><img src="${logo}" alt=""><div><span class="eyebrow">POUZE PRO OBSLUHU</span><h1>Administrace</h1></div></div><div class="admin-login-body"><form id="admin-login-form"><label class="field-label" for="admin-password">Heslo obsluhy</label><input id="admin-password" type="password" required autocomplete="off" inputmode="none" placeholder="Zadej heslo na klávesnici níže"><p id="admin-login-error" role="alert"></p><button class="primary">Odemknout administraci →</button></form>${keyboardMarkup('login')}</div>`;
  $('#dialog').showModal();$('#admin-password').focus();
}
function unlockAdmin(){
  const password=$('#admin-password').value;$('#admin-password').value='';
  if(password!==ADMIN_PASSWORD){$('#admin-login-error').textContent='Nesprávné heslo. Zkus to znovu.';$('#admin-password').focus();return}
  adminAuthenticated=true;lastActivity=Date.now();$('#dialog').close();staff();
}
$('#dialog').addEventListener('submit',event=>{if(event.target.id==='admin-login-form'){event.preventDefault();unlockAdmin()}});
$('#dialog').addEventListener('click',event=>{const key=event.target.closest('[data-key]');if(key)pressKey(key.dataset.key)});
$('#dialog').addEventListener('close',()=>{$('#dialog').classList.remove('admin-dialog');updateKeyboardDock()});
document.addEventListener('error',event=>{
  const image=event.target;
  if(!image.matches?.('.team-logo'))return;
  if(!image.dataset.retried&&image.dataset.remoteLogo){image.dataset.retried='true';image.src=image.dataset.remoteLogo;return}
  image.hidden=true;if(image.nextElementSibling)image.nextElementSibling.hidden=false;
},true);
$('#admin-access').onclick=adminLogin;
document.addEventListener('keydown',event=>{if(screen==='celebration'&&event.key==='Escape'){event.preventDefault();dismissCelebration()}});
$('#rules').onclick=rules;$('.close').onclick=()=>$('#dialog').close();
for(const type of ['pointerdown','keydown','input'])document.addEventListener(type,()=>lastActivity=Date.now());
// After the official result and the winner announcement the kiosk moves on by itself: at 6:00 the morning after
// the match (never sooner than the five-minute announcement) it switches to the nearest match still to come.
// A finished match that staff pick by hand after that moment stays pinned.
const SWITCH_HOUR=6;
function nextMatchAt(m){
  const result=state.results[m.id];if(!result)return Infinity;
  const morning=new Date(m.date);morning.setDate(morning.getDate()+1);morning.setHours(SWITCH_HOUR,0,0,0);
  const announced=Date.parse(result.confirmedAt);
  return Math.max(morning.getTime(),Number.isFinite(announced)?announced+WINNER_DURATION:0);
}
function upcomingMatch(){return matches.filter(m=>!state.results[m.id]&&Date.now()<locksAt(m)).sort((a,b)=>new Date(a.date)-new Date(b.date))[0]}
function autoAdvanceMatch(){
  if(screen!=='welcome'||adminAuthenticated||celebration||demo||$('#dialog').open)return false;
  const m=matches.find(x=>x.id===state.activeMatchId);if(!m)return false;
  const switchAt=nextMatchAt(m),pinned=Date.parse(state.activeMatchSetAt);
  if(Date.now()<switchAt||Number.isFinite(pinned)&&pinned>=switchAt)return false;
  const next=upcomingMatch();if(!next||next.id===m.id)return false;
  if(!persist({...state,activeMatchId:next.id,activeMatchSetAt:null}))return false;
  currentId=next.id;welcome();return true;
}
let lastMatchPhase=closed(current())?'closed':open(current())?'open':'waiting';
setInterval(()=>{
  tickPartners();
  if(screen==='celebration'){if(celebration&&Date.now()>=celebration.expiresAt)dismissCelebration();return}
  if((screen!=='welcome'||adminAuthenticated||$('#dialog').open)&&Date.now()-lastActivity>90000)home();
  if(screen==='demo'&&demo?.playing&&Date.now()-demo.lastStepAt>=5000)advanceDemo();
  if(autoAdvanceMatch())lastMatchPhase=null;
  pollLive();refreshBoard();refreshParticipants();updateKeyboardDock();
  const m=current(),phase=closed(m)?'closed':open(m)?'open':'waiting';
  if($('#countdown'))$('#countdown').textContent=countdownText(m);
  if(lastMatchPhase&&phase!==lastMatchPhase){if(screen==='form')form();if(screen==='welcome')welcome();if(screen==='staff')staff()}
  lastMatchPhase=phase;
},1000);
addEventListener('hashchange',()=>location.hash==='#obsluha'?staff():home());
location.hash==='#obsluha'?staff():welcome();

initPartners();
