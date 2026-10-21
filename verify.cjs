const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const Competition=require('./dist/competition.js');
const LiveMatch=require('./dist/live.js');
const FootballTeams=require('./dist/teams.js');
const ClubContent=require('./dist/club-content.js');
assert.equal(Object.keys(FootballTeams).length,16);
for(const team of Object.values(FootballTeams)){assert.ok(fs.statSync('dist/'+team.logo).size>100,team.id)}
const tip=(name,home,away)=>({name,home,away,outcome:Competition.resultOf(home,away)});
assert.equal(Competition.validate(tip('Petr Novák',2,1)),'');
assert.equal(Competition.validate(tip('Eva Nová',1,1)),'');
assert.equal(Competition.validate(tip('Eva Nová',0,0)),'');
assert.ok(Competition.validate({...tip('Eva Nová',1,1),outcome:'1'}));
assert.ok(Competition.validate(tip('A',2,1)));
assert.ok(Competition.validate(tip('Jan Novák',2.5,1)));
assert.ok(Competition.validate(tip('Jan Novák',21,1)));
assert.deepEqual(Competition.evaluate([tip('Petr Novák',2,1),tip('Eva Nová',3,1)],{home:2,away:1}).map(e=>e.name),['Petr Novák']);
// Same distance, no timestamps: both share the first place.
assert.deepEqual(Competition.evaluate([tip('Petr Novák',3,1),tip('Eva Nová',2,2)],{home:2,away:1}).map(e=>e.name),['Petr Novák','Eva Nová']);
assert.equal(Competition.evaluate([],{home:2,away:1}).length,0);
// Equal accuracy: the earlier tip wins; tips without a timestamp rank last.
assert.deepEqual(Competition.evaluate([{...tip('Pozdní Petr',2,1),savedAt:'2026-11-01T15:05:00+01:00'},{...tip('Brzká Eva',2,1),savedAt:'2026-11-01T14:35:00+01:00'}],{home:2,away:1}).map(e=>e.name),['Brzká Eva']);
assert.deepEqual(Competition.rank([{...tip('Bez času',2,1)},{...tip('S časem',2,1),savedAt:'2026-11-01T14:35:00+01:00'}],{home:2,away:1}).map(e=>e.name+e.position),['S časem1','Bez času2']);
assert.equal(Competition.evaluate([tip('Eva Nová',2,1)],null).length,0);
assert.equal(Competition.evaluate([tip('Eva Nová',2,1)],{home:-1,away:1}).length,0);
const elements=new Map();
const el=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',value:'',checked:false,setAttribute(){},focus(){},style:{},classList:{toggle(){},add(){},remove(){}},addEventListener(type,fn){this[type]=fn},showModal(){this.open=true},close(){this.open=false}});return elements.get(key)};
let now='2026-10-31T10:00:00+01:00';class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return new Date(now).getTime()}}
const storage=new Map();let failStorage=false;
const context={console,Competition,LiveMatch,FootballTeams,ClubContent,AbortController,fetch:async()=>({ok:false,status:503}),Date:TestDate,Intl,crypto:{randomUUID:()=>String(Math.random())},localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(failStorage)throw Error('full');storage.set(k,v)}},document:{querySelector:el,querySelectorAll:()=>[],addEventListener(){}},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},setTimeout(){},setInterval(fn){context.tick=fn},clearTimeout(){},addEventListener(){}};
vm.createContext(context);vm.runInContext(fs.readFileSync('dist/data.js','utf8'),context);vm.runInContext(fs.readFileSync('dist/club-ui.js','utf8'),context);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),context);
assert.match(el('#main').innerHTML,/Dotkni se obrazovky/);
assert.match(el('#main').innerHTML,/Zatím nikdo nehrál/);assert.match(el('#main').innerHTML,/CO MŮŽEŠ VYHRÁT/);assert.match(el('#main').innerHTML,/Podepsaný dres FC Baník Ostrava/);
assert.match(el('#main').innerHTML,/countdown/);assert.match(el('#main').innerHTML,/assets\/teams\/plz.png/);assert.match(el('#main').innerHTML,/assets\/club-logo.png/);
assert.doesNotMatch(el('#main').innerHTML,/id="match"/);
assert.equal(JSON.parse(storage.values().next().value).activeMatchId,'plz');
// Staff and direct staff route require the password. Test tips are never competition entries.
vm.runInContext('staff()',context);assert.equal(vm.runInContext('screen',context),'welcome');assert.match(el('#dialog-content').innerHTML,/admin-login-form/);
assert.match(el('#dialog-content').innerHTML,/class="osk osk-mode-login"/);assert.match(el('#dialog-content').innerHTML,/data-key="q"/);assert.doesNotMatch(el('#dialog-content').innerHTML,/data-key="[ěščřžýáíé]"/);
el('#admin-password').value='';context.document.querySelector=sel=>sel==='.osk'?{set outerHTML(v){}}:el(sel);for(const k of ['shift','d','i','g','i','2','0','2','x','backspace','6'])vm.runInContext(`pressKey(${JSON.stringify(k)})`,context);assert.equal(el('#admin-password').value,'Digi2026');vm.runInContext('pressKey("clear")',context);assert.equal(el('#admin-password').value,'');context.document.querySelector=el;
el('#admin-password').value='wrong';vm.runInContext('unlockAdmin()',context);assert.equal(vm.runInContext('adminAuthenticated',context),false);assert.match(el('#admin-login-error').textContent,/Nesprávné/);
el('#admin-password').value='Digi2026';vm.runInContext('unlockAdmin()',context);assert.equal(vm.runInContext('adminAuthenticated',context),true);assert.match(el('#main').innerHTML,/Spustit zkušební tipování/);
assert.doesNotMatch(el('#main').innerHTML,/prodloužení|nájezd|60 minut/);
const earlySnapshot=storage.values().next().value;
// Match simulation uses three fictional visitors and never touches real state.
vm.runInContext('startDemo()',context);assert.equal(vm.runInContext('demo.tips.length',context),3);assert.equal(new Set(vm.runInContext('demo.tips.map(e=>e.name)',context)).size,3);
assert.match(el('#main').innerHTML,/DEMOVERZE/);assert.match(el('#main').innerHTML,/score-table/);assert.doesNotMatch(el('#main').innerHTML,/Gratulujeme vítězi/);
vm.runInContext('demo.playing=false; demoScreen()',context);assert.match(el('#main').innerHTML,/Pokračovat/);
vm.runInContext('advanceDemo()',context);assert.equal(vm.runInContext('demo.index',context),1);assert.match(el('#main').innerHTML,/1\. poločas/);
const leaderAtDraw=vm.runInContext('Competition.evaluate(demo.tips,{home:1,away:1})[0].name',context);
const leaderAtHomeLead=vm.runInContext('Competition.evaluate(demo.tips,{home:2,away:1})[0].name',context);assert.notEqual(leaderAtDraw,leaderAtHomeLead);
vm.runInContext('while(demo.index<demo.steps.length-1)advanceDemo()',context);assert.match(el('#main').innerHTML,/Gratulujeme vítězi/);assert.match(el('#main').innerHTML,/Cenu si vyzvedněte ve VIP zóně/);assert.match(el('#main').innerHTML,/Konečný výsledek zápasu 2 : 1/);assert.equal(storage.values().next().value,earlySnapshot);
assert.equal(vm.runInContext('screen',context),'celebration');
const awardDeadline=vm.runInContext('celebration.expiresAt',context);
now=new Date(awardDeadline-1).toISOString();context.tick();assert.equal(vm.runInContext('screen',context),'celebration');
now=new Date(awardDeadline).toISOString();context.tick();assert.equal(vm.runInContext('screen',context),'demo');
vm.runInContext('showCelebration(true)',context);el('#main').click({target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'celebration-dismiss'}}:null}});assert.equal(vm.runInContext('celebration',context),null);assert.equal(vm.runInContext('screen',context),'demo');
vm.runInContext('staff()',context);assert.equal(vm.runInContext('demo',context),null);
now='2026-10-31T10:00:00+01:00';

el('#main').click({target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'test-start'}}:null}});
assert.match(el('#main').innerHTML,/ZKUŠEBNÍ REŽIM/);assert.match(el('#main').innerHTML,/id="entry-form"/);assert.match(el('#main').innerHTML,/Vyhraje Baník/);assert.doesNotMatch(el('#main').innerHTML,/id="decision"/);
vm.runInContext('outcome="1"',context);el('#guest-name').value='Test administrátora';el('#home-score').value='2';el('#away-score').value='1';vm.runInContext('submitEntry()',context);
assert.match(el('#main').innerHTML,/ZKUŠEBNÍ TIP JE V POŘÁDKU/);assert.equal(storage.values().next().value,earlySnapshot);assert.equal(vm.runInContext('practiceEntries.length',context),1);
vm.runInContext('home()',context);assert.equal(vm.runInContext('adminAuthenticated',context),false);assert.equal(vm.runInContext('testMode',context),false);assert.equal(vm.runInContext('practiceEntries.length',context),0);

vm.runInContext('form(); outcome="1"',context);
assert.doesNotMatch(el('#main').innerHTML,/id="match"/);
assert.doesNotMatch(el('#main').innerHTML,/id="entry-form"/);
vm.runInContext('submitEntry()',context);
assert.equal(JSON.parse(storage.values().next().value).entries.length,0);
assert.match(el('#toast').textContent,/otevře/);
// Countdown at the last second, then automatic opening (30 minutes before kick-off) without reloading.
now='2026-11-01T14:29:59+01:00';vm.runInContext('form(); lastActivity=Date.now()',context);context.tick();
assert.match(el('#countdown').textContent,/01 s$/);
now='2026-11-01T14:30:00+01:00';context.tick();
assert.match(el('#main').innerHTML,/id="entry-form"/);
assert.match(el('#main').innerHTML,/TIPOVÁNÍ OTEVŘENO/);
vm.runInContext('outcome="1"',context);
el('#guest-name').value='<b>Eva</b>';el('#home-score').value='2';el('#away-score').value='1';
vm.runInContext('submitEntry()',context);assert.match(el('#main').innerHTML,/&lt;b&gt;Eva&lt;\/b&gt;/);assert.equal(JSON.parse(storage.values().next().value).entries.length,1);
vm.runInContext('form(); outcome="1"',context);vm.runInContext('submitEntry()',context);assert.match(el('#toast').textContent,/už je/);
vm.runInContext('welcome()',context);assert.match(el('#main').innerHTML,/&lt;b&gt;Eva&lt;\/b&gt;/);assert.doesNotMatch(el('#main').innerHTML,/Zatím nikdo nehrál/);
vm.runInContext('adminAuthenticated=true;staff()',context);assert.match(el('#main').innerHTML,/id="prizes-form"/);
context.document.querySelectorAll=sel=>sel.startsWith('#prize-rows .prize-row')?[{querySelector:n=>({value:n==='[name=title]'?'  Zlatý  míč ':'VIP večeře'})},{querySelector:n=>({value:''})}]:[];
vm.runInContext('savePrizes()',context);assert.deepEqual(JSON.parse(storage.values().next().value).prizes.plz,[{title:'Zlatý míč',detail:'VIP večeře'}]);context.document.querySelectorAll=()=>[];
// The staff keyboard dock types into whichever field was focused last, keeps Czech letters and refuses letters in number fields.
assert.match(el('#main').innerHTML,/keyboard-toggle/);assert.match(el('#main').innerHTML,/Klávesnice: vypnuta/);
const titleField={type:'text',value:'',isConnected:true,disabled:false,focus(){},dispatchEvent(){},getAttribute(){return 'Cena 1'},matches:s=>s.includes('input[type=text]')};el('#dialog').open=false;vm.runInContext('keyboardDock=true;keyboardTarget=null',context);context.keyboardTargetStub=titleField;vm.runInContext('keyboardTarget=keyboardTargetStub',context);
for(const k of ['shift','ř','í','z','e','k',' ','2'])vm.runInContext(`pressKey(${JSON.stringify(k)})`,context);assert.equal(titleField.value,'Řízek 2');
const numberField={...titleField,type:'number',value:''};context.keyboardTargetStub=numberField;vm.runInContext('keyboardTarget=keyboardTargetStub',context);for(const k of ['a','3','ě','1','backspace'])vm.runInContext(`pressKey(${JSON.stringify(k)})`,context);assert.equal(numberField.value,'3');
vm.runInContext('keyboardDock=false;keyboardTarget=null',context);
vm.runInContext('welcome()',context);assert.match(el('#main').innerHTML,/Zlatý míč/);assert.doesNotMatch(el('#main').innerHTML,/Podepsaný dres/);vm.runInContext('adminAuthenticated=false;form();outcome="1"',context);
// A different visitor can still submit in the 10th minute; a score cannot be confirmed yet.
now='2026-11-01T15:09:00+01:00';el('#guest-name').value='Jiný člověk';vm.runInContext('submitEntry()',context);assert.equal(JSON.parse(storage.values().next().value).entries.length,2);
el('#result-home').value='2';el('#result-away').value='1';el('#result-confirm').checked=true;vm.runInContext('submitResult()',context);assert.equal(JSON.parse(storage.values().next().value).results.plz,undefined);
// Ten minutes after kick-off the kiosk locks itself: no late tips, result entry opens, the earlier exact tip wins alone.
now='2026-11-01T15:10:00+01:00';context.tick();assert.match(el('#main').innerHTML,/TIPY UZAVŘENY|uzamčen/);
vm.runInContext('adminLogin()',context);el('#admin-password').value='Digi2026';vm.runInContext('unlockAdmin()',context);assert.match(el('#main').innerHTML,/id="match"/);assert.match(el('#main').innerHTML,/Potvrzený konečný výsledek/);assert.doesNotMatch(el('#main').innerHTML,/result-decision/);
vm.runInContext('form();outcome="1"',context);el('#guest-name').value='Pozdní návštěvník';vm.runInContext('submitEntry()',context);assert.equal(JSON.parse(storage.values().next().value).entries.length,2);
vm.runInContext('submitResult()',context);assert.match(el('#main').innerHTML,/Gratulujeme vítězi!/);assert.match(el('#main').innerHTML,/&lt;b&gt;Eva&lt;\/b&gt;/);assert.doesNotMatch(el('#main').innerHTML,/Jiný člověk/);assert.match(el('#main').innerHTML,/Cenu si vyzvedněte ve VIP zóně/);
assert.deepEqual(JSON.parse(storage.values().next().value).results.plz.home,2);
assert.doesNotMatch(el('#main').innerHTML,/id="match"/);
// Active game remains pinned when loading later; it never jumps to the next fixture before the morning switch.
const reloaded={...context,setInterval(){},document:{...context.document,querySelector:()=>({innerHTML:'',addEventListener(){}})}};vm.createContext(reloaded);vm.runInContext(fs.readFileSync('dist/data.js','utf8'),reloaded);vm.runInContext(fs.readFileSync('dist/club-ui.js','utf8'),reloaded);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),reloaded);assert.equal(vm.runInContext('currentId',reloaded),'plz');assert.equal(vm.runInContext('open(current())',reloaded),false);assert.equal(vm.runInContext('adminAuthenticated',reloaded),false);
// At 6:00 the morning after the match the welcome screen moves on to the next home match by itself.
vm.runInContext('home()',context);el('#dialog').open=false;/* the mock's close() is replaced by the 'close' listener */now='2026-11-02T05:59:00+01:00';context.tick();assert.equal(vm.runInContext('currentId',context),'plz');
now='2026-11-02T06:00:00+01:00';context.tick();assert.equal(vm.runInContext('currentId',context),'tep');assert.equal(JSON.parse(storage.values().next().value).activeMatchId,'tep');
// Only staff can select and persist another game.
vm.runInContext('adminLogin()',context);el('#admin-password').value='Digi2026';vm.runInContext('unlockAdmin()',context);el('#main').change({target:{id:'match',value:'hrk'}});assert.equal(JSON.parse(storage.values().next().value).activeMatchId,'hrk');
now='2026-12-06T18:00:00+01:00';vm.runInContext('form(); outcome="X"',context);el('#guest-name').value='Jan Novák';el('#home-score').value='1';el('#away-score').value='1';failStorage=true;vm.runInContext('submitEntry()',context);assert.match(el('#toast').textContent,/Uložení se nezdařilo/);assert.equal(JSON.parse(storage.values().next().value).entries.length,2);
failStorage=false;vm.runInContext('staff(); lastActivity=Date.now()-91000',context);context.tick();assert.equal(vm.runInContext('adminAuthenticated',context),false);assert.equal(vm.runInContext('testMode',context),false);
for(const fn of ['welcome','form','resultScreen','staff','rules'])vm.runInContext(fn+'()',context);
// Missing or old live data must not invent a leader; only confirmed results are final.
vm.runInContext('home(); resultScreen()',context);assert.match(el('#main').innerHTML,/ČEKÁME NA AKTUÁLNÍ DATA/);assert.doesNotMatch(el('#main').innerHTML,/leading-row/);
const snapshot={matchId:'hrk',home:1,away:1,phase:'half2',clock:"67'",updatedAt:new Date(now).toISOString()};
assert.deepEqual(LiveMatch.validateSnapshot(snapshot,'hrk',new Date(now).getTime()),{...snapshot,final:false});
assert.deepEqual(LiveMatch.validateSnapshot({...snapshot,clock:"90+4'"},'hrk',new Date(now).getTime()).clock,"90+4'");
assert.throws(()=>LiveMatch.validateSnapshot(snapshot,'plz',new Date(now).getTime()));
assert.throws(()=>LiveMatch.validateSnapshot({...snapshot,phase:'period2'},'hrk',new Date(now).getTime()));
assert.throws(()=>LiveMatch.validateSnapshot({...snapshot,final:true},'hrk',new Date(now).getTime()));
assert.throws(()=>LiveMatch.validateSnapshot({...snapshot,updatedAt:'2020-01-01T00:00:00Z'},'hrk',new Date(now).getTime()));
assert.throws(()=>LiveMatch.validateSnapshot({...snapshot,home:-1},'hrk',new Date(now).getTime()));
const rank=Competition.rank([tip('Adam Novák',2,1),tip('Eva Nová',1,1),tip('Jan Malý',3,2)],{home:1,away:1});assert.equal(rank[0].name,'Eva Nová');assert.equal(rank[0].position,1);
// Downloaded profiles are complete, locally illustrated and navigable within the kiosk.
assert.ok(ClubContent.players.length>=20);assert.ok(ClubContent.partners.length>=50);
for(const p of ClubContent.players){assert.ok(p.name&&p.position&&p.source);if(p.photo)assert.ok(fs.statSync('dist/'+p.photo).size>100)}
assert.ok(ClubContent.players.filter(p=>p.photo).length>=ClubContent.players.length-2);
for(const p of ClubContent.partners)assert.ok(fs.statSync('dist/'+p.logo).size>100);
for(const m of ClubContent.history.milestones)for(const photo of m.photos||[])assert.ok(fs.statSync('dist/'+photo.file).size>100);
vm.runInContext('achievementsScreen()',context);assert.match(el('#main').innerHTML,/1975 \/ 1976/);assert.match(el('#main').innerHTML,/2003 \/ 2004/);assert.match(el('#main').innerHTML,/Výhra nad Bayernem/);
vm.runInContext('achievementsScreen("start")',context);assert.match(el('#main').innerHTML,/hostinci U dubu/);assert.doesNotMatch(el('#main').innerHTML,/Nečekaný třetí titul/);
const keeper=ClubContent.players.find(p=>p.position==='Brankář'),outfield=ClubContent.players.find(p=>p.position==='Záložník');
vm.runInContext('playersScreen("Brankář")',context);assert.match(el('#main').innerHTML,new RegExp(keeper.name));assert.doesNotMatch(el('#main').innerHTML,new RegExp(outfield.name));
vm.runInContext('playersScreen("Záložník")',context);assert.match(el('#main').innerHTML,new RegExp(outfield.name));
vm.runInContext(`playerScreen(${JSON.stringify(outfield.id)})`,context);assert.match(el('#main').innerHTML,new RegExp(outfield.name));assert.match(el('#main').innerHTML,/Národnost/);assert.match(el('#main').innerHTML,/Chance Liga/);
const noPhoto=ClubContent.players.find(p=>!p.photo);if(noPhoto){vm.runInContext(`playerScreen(${JSON.stringify(noPhoto.id)})`,context);assert.match(el('#main').innerHTML,/photo-fallback/)}
const generalPartner=ClubContent.partners.find(p=>p.category==='Generální partner');vm.runInContext('initPartners(); rotatePartners()',context);assert.match(el('#partners-strip').innerHTML,new RegExp(generalPartner.name));assert.match(el('#partner-frame').innerHTML,/partner-enter/);
const partnerIndex=vm.runInContext('partnerPage',context);el('#partners-pause').onclick();assert.equal(vm.runInContext('partnerPaused',context),true);vm.runInContext('partnerLastChange=Date.now()-9000;tickPartners()',context);assert.equal(vm.runInContext('partnerPage',context),partnerIndex);el('#partners-pause').onclick();assert.equal(vm.runInContext('partnerPaused',context),false);
assert.equal(vm.runInContext('partnerGroups().flat().length',context),ClubContent.partners.length-ClubContent.partners.filter(p=>p.category==='Generální partner').length);

console.log('PASS: exact/nearest winners, ties, validation, single-match visitor screens, countdown, automatic opening 30 min before kick-off, submissions until the 10th minute, automatic lock, late-tip rejection, earlier-tip tie-break, result gating, pinned match on reload, 6:00 switch to the next match, persistence failure. Password gating, isolated admin practice tips, logout/reload/idle lock verified. Club history, profiles (incl. missing photo), partner rotation/pause and five-minute/touch-dismiss trophy verified.');
