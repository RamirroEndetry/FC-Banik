import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from './worker.mjs';
import Competition from './dist/competition.js';
import LiveMatch from './dist/live.js';
import FootballTeams from './dist/teams.js';
import ClubContent from './dist/club-content.js';

// Minimal copy of the onlajny.com match page markup (fields as served for OVA–SPA on 18 Oct 2026: "konec", "90+5", "0:0").
const page=({status='konec',time='90+5',total='0:0',team1='OVA',team2='SPA'}={})=>`<script>matchJson = {"id":"533864","sport":"football","team1abbr":"${team1}","team2abbr":"${team2}"}</script>
<span data-source="lightstreamer" data-grid="main" data-item="item_1072239" data-field="status">${status}</span>
(<span data-source="lightstreamer" data-grid="main" data-item="item_1072239" data-field="timeScore">${time}</span>)
<span data-source="lightstreamer" data-grid="main2" data-item="item_1" data-field="total" class="hideIfEmpty">5:0</span>
<span class="hlavniSkore" data-source="lightstreamer" data-grid="main" data-item="item_1072239" data-field="total">${total}</span>`;
const at=Date.parse('2026-11-01T17:00:00+01:00'),snap=o=>LiveMatch.fromOnlajny(page(o),{matchId:'plz'},at);
assert.deepEqual({...snap(),updatedAt:0},{matchId:'plz',home:0,away:0,phase:'fulltime',clock:'',updatedAt:0,final:true});
assert.deepEqual([snap({status:'před zápasem',time:''}).phase,snap({status:'před zápasem',time:''}).final],['scheduled',false]);
const live=snap({status:'1. poločas',time:'34',total:'1:0'});assert.deepEqual([live.phase,live.home,live.away,live.clock,live.final],['half1',1,0,"34'",false]);
assert.equal(snap({status:'1. poločas',time:'45+2',total:'1:0'}).clock,"45+2'");
assert.equal(snap({status:'poločas',time:'45',total:'1:1'}).phase,'halftime');
assert.equal(snap({status:'přestávka',time:'',total:'1:1'}).phase,'halftime');
assert.equal(snap({status:'2. poločas',time:'90+3',total:'2:1'}).clock,"90+3'");
assert.equal(snap({status:'',time:'67',total:'2:1'}).phase,'half2','without a status name the minute decides');
assert.equal(snap({status:'',time:'12',total:'0:0'}).phase,'half1');
// Baník away (not used by the home kiosk, but the source might list it second): Baník always comes first.
const away=snap({team1:'SPA',team2:'OVA',total:'1:3',status:'2. poločas',time:'80'});assert.deepEqual([away.home,away.away],[3,1]);
assert.throws(()=>snap({status:'odloženo'}),/zrušen|odložen/);
assert.throws(()=>LiveMatch.fromOnlajny('<html>bez dat</html>',{matchId:'plz'},at),/očekávaný formát/);
assert.throws(()=>snap({total:'-:-'}),/Neplatné skóre/);
assert.equal(LiveMatch.pageUrl('533874'),'https://www.onlajny.com/match/index/id/533874');
assert.equal(LiveMatch.liveUrl('api/live',{id:'plz',onlajny:'533874'}),'api/live?matchId=plz&onlajny=533874');
// Every kiosk match is linked to its onlajny.com record.
const matchesSource=fs.readFileSync('dist/data.js','utf8');assert.equal((matchesSource.match(/onlajny:'\d+'/g)||[]).length,(matchesSource.match(/awayTeamId:/g)||[]).length);

const request=q=>new Request(`https://kiosk.example/api/live?${q}`);
assert.equal((await worker.fetch(request('matchId=plz'),{})).status,400);
assert.equal((await worker.fetch(request('matchId=plz&onlajny=abc'),{})).status,400);
assert.equal((await worker.fetch(new Request('https://kiosk.example/api/live?matchId=plz',{method:'POST'}),{})).status,405);
const originalFetch=globalThis.fetch;
try{
  let requested;
  globalThis.fetch=async url=>{requested=String(url);return new Response(page({status:'2. poločas',time:'71',total:'2:1'}))};
  const response=await worker.fetch(request('matchId=plz&onlajny=533874'),{});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
  const json=await response.json();assert.deepEqual([json.home,json.away,json.phase,json.final],[2,1,'half2',false]);assert.equal(requested,LiveMatch.pageUrl('533874'));
  globalThis.fetch=async()=>new Response('down',{status:500});assert.equal((await worker.fetch(request('matchId=plz&onlajny=533874'),{})).status,502);
  let assetRequest;await worker.fetch(new Request('https://kiosk.example/'),{ASSETS:{fetch:r=>{assetRequest=r;return new Response('app')}}});assert.equal(assetRequest.url,'https://kiosk.example/');
}finally{globalThis.fetch=originalFetch}

let now=Date.parse('2026-11-01T15:30:00+01:00');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
const nodes=new Map();const el=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',style:{},value:'',open:false,addEventListener(){},focus(){},showModal(){this.open=true},close(){this.open=false}});return nodes.get(key)};
const initial={activeMatchId:'plz',entries:[{id:'real-1',matchId:'plz',name:'Jan Novák',home:2,away:1,outcome:'1',savedAt:'2026-11-01T14:40:00+01:00'}],results:{},closedMatches:{}};
const stored=new Map([['banik-vip-kiosk-v1',JSON.stringify(initial)]]);
// The kiosk receives the Worker's JSON; the Worker itself is tested above.
let state={status:'2. poločas',time:'52',total:'2:1'},status=200,fetchedUrl='';
const context={console,Intl,Date:Clock,Competition,LiveMatch,FootballTeams,ClubContent,AbortController,crypto:{randomUUID:()=>String(Math.random())},fetch:async url=>{fetchedUrl=String(url);return {ok:status===200,status,json:async()=>LiveMatch.fromOnlajny(page(state),{matchId:'plz'},now)}},setTimeout(){},clearTimeout(){},setInterval(){},localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},document:{querySelector:el,querySelectorAll:()=>[],addEventListener(){}},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},addEventListener(){}};
vm.createContext(context);vm.runInContext(fs.readFileSync('dist/data.js','utf8'),context);vm.runInContext(fs.readFileSync('dist/club-ui.js','utf8'),context);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),context);
const saved=()=>JSON.parse(stored.get('banik-vip-kiosk-v1')),board=()=>vm.runInContext('realBoardMarkup()',context);
await vm.runInContext('pollLive()',context);
assert.equal(fetchedUrl,'api/live?matchId=plz&onlajny=533874');
assert.match(board(),/Průběžný lídr/);assert.match(board(),/2\. poločas · 52&#39; · zdroj onlajny\.com/);assert.doesNotMatch(board(),/Gratulujeme/);
now+=16000;status=503;await vm.runInContext('pollLive()',context);assert.doesNotMatch(board(),/leading-row/);
// Without the Worker (plain GitHub Pages) the kiosk says so and asks only once a minute.
now+=16000;status=404;await vm.runInContext('pollLive()',context);assert.match(board(),/Výsledek po zápase zapíše obsluha/);assert.equal(vm.runInContext('livePollGap',context),60000);
const quiet=vm.runInContext('lastLivePoll',context);now+=30000;await vm.runInContext('pollLive()',context);assert.equal(vm.runInContext('lastLivePoll',context),quiet);
now+=31000;status=200;state={status:'2. poločas',time:'90+4',total:'3:1'};await vm.runInContext('pollLive()',context);
assert.equal(vm.runInContext('livePollGap',context),15000);assert.equal(saved().results.plz,undefined,'no winner before the final whistle');
now+=16000;state={status:'konec',time:'90+6',total:'3:1'};await vm.runInContext('pollLive()',context);
assert.deepEqual([saved().results.plz.home,saved().results.plz.away,saved().results.plz.source],[3,1,'onlajny.com'],'final score is written automatically');
assert.ok(saved().closedMatches.plz);assert.equal(vm.runInContext('screen',context),'celebration');
const polled=vm.runInContext('lastLivePoll',context);now+=16000;await vm.runInContext('pollLive()',context);assert.equal(vm.runInContext('lastLivePoll',context),polled,'polling stops after the result');
// Morning switch to the next match after the official result.
vm.runInContext('home()',context);assert.equal(vm.runInContext('autoAdvanceMatch()',context),false,'the result stays on screen the evening after the match');
now=Date.parse('2026-11-02T05:59:00+01:00');assert.equal(vm.runInContext('autoAdvanceMatch()',context),false);
now=Date.parse('2026-11-02T06:00:00+01:00');assert.equal(vm.runInContext('adminAuthenticated=true;autoAdvanceMatch()',context),false,'never while staff work');
vm.runInContext('adminAuthenticated=false',context);assert.equal(vm.runInContext('autoAdvanceMatch()',context),true);
assert.equal(saved().activeMatchId,'tep');assert.equal(vm.runInContext('currentId',context),'tep');assert.equal(vm.runInContext('screen',context),'welcome');
// A finished match that staff pin by hand after the switch time stays on the kiosk.
vm.runInContext("persist({...state,activeMatchId:'plz',activeMatchSetAt:new Date().toISOString()});currentId='plz';home()",context);now+=3600000;
assert.equal(vm.runInContext('autoAdvanceMatch()',context),false);assert.equal(saved().activeMatchId,'plz');
// A result recorded late (e.g. the next morning) still gets its five-minute announcement first.
vm.runInContext("persist({...state,activeMatchSetAt:null,results:{...state.results,plz:{...state.results.plz,confirmedAt:new Date().toISOString()}}})",context);
assert.equal(vm.runInContext('autoAdvanceMatch()',context),false);now+=5*60*1000;assert.equal(vm.runInContext('autoAdvanceMatch()',context),true);
// Backup: download as JSON/CSV and merge back in without overwriting anything.
const csv=vm.runInContext('backupCsv()',context);
assert.ok(csv.startsWith('﻿'));assert.match(csv,/Zápas;Datum zápasu;Pořadí;Jméno;Tip;Odchylka;Čas tipu;Konečný výsledek/);assert.match(csv,/FC Viktoria Plzeň;.*;1;Jan Novák;2:1;1;.*;3:1$/m);
const backup=vm.runInContext('backupJson()',context);assert.equal(JSON.parse(backup).app,'banik-vip-kiosk');
assert.equal(vm.runInContext(`mergeBackup(${JSON.stringify(backup)}).addedEntries.length`,context),0,'nothing to add from an up-to-date backup');
vm.runInContext("persist({...state,entries:[],results:{}})",context);
const merged=vm.runInContext(`(()=>{const m=mergeBackup(${JSON.stringify(backup)});persist(m.next);return JSON.stringify([m.addedEntries.length,Object.keys(m.addedResults)])})()`,context);
assert.deepEqual(JSON.parse(merged),[1,['plz']]);assert.equal(saved().entries[0].name,'Jan Novák');assert.equal(saved().results.plz.home,3);
vm.runInContext("persist({...state,results:{plz:{...state.results.plz,home:9}}})",context);
vm.runInContext(`persist(mergeBackup(${JSON.stringify(backup)}).next)`,context);assert.equal(saved().results.plz.home,9,'restore never overwrites');
assert.throws(()=>vm.runInContext("mergeBackup('není json')",context),/platná záloha/);
assert.throws(()=>vm.runInContext("mergeBackup('{\"a\":1}')",context),/záloha VIP kiosku/);
vm.runInContext("persist({...state,entries:[...state.entries,{id:'x',matchId:'tep',name:'=SUM(A1)',home:1,away:0,outcome:'1',savedAt:new Date().toISOString()}]})",context);
assert.match(vm.runInContext('backupCsv()',context),/;'=SUM\(A1\);/,'no spreadsheet formulas from visitor names');
// Staff: open tipping by hand for the upcoming match and delete tips again.
context.confirm=()=>true;
vm.runInContext("persist({...state,activeMatchId:'tep',manualOpen:{}});currentId='tep';adminAuthenticated=true",context);
now=Date.parse('2026-11-20T12:00:00+01:00');
assert.equal(vm.runInContext("open(current())",context),false,'regular window not open yet');
vm.runInContext('toggleManualOpen()',context);assert.equal(vm.runInContext("open(current())",context),true);assert.ok(saved().manualOpen.tep);
vm.runInContext("persist({...state,entries:[...state.entries,{id:'t1',matchId:'tep',name:'Test Jedna',home:2,away:1,outcome:'1',savedAt:new Date().toISOString()},{id:'t2',matchId:'tep',name:'Test Dva',home:3,away:2,outcome:'1',savedAt:new Date().toISOString()},{id:'t3',matchId:'plz',name:'Jiný zápas',home:1,away:1,outcome:'X',savedAt:new Date().toISOString()}]})",context);
assert.match(vm.runInContext("tipsAdmin(current())",context),/Tipy tohoto zápasu \(\d+\)/);
const tepTips=()=>saved().entries.filter(e=>e.matchId==='tep').map(e=>e.id);
vm.runInContext("deleteTips('t1')",context);assert.ok(!tepTips().includes('t1'));assert.ok(tepTips().includes('t2'));
vm.runInContext('deleteTips(null)',context);assert.deepEqual(tepTips(),[]);assert.ok(saved().entries.some(e=>e.id==='t3'),'other matches keep their tips');
vm.runInContext('adminAuthenticated=false',context);vm.runInContext("deleteTips('t3')",context);assert.ok(saved().entries.some(e=>e.id==='t3'),'only staff can delete');
vm.runInContext('adminAuthenticated=true;toggleManualOpen()',context);assert.equal(vm.runInContext("open(current())",context),false,'manual opening can be withdrawn');
vm.runInContext('toggleManualOpen()',context);now=Date.parse('2026-11-21T15:11:00+01:00');assert.equal(vm.runInContext("open(current())",context),false,'the lock 10 minutes after kick-off always applies');
console.log('PASS: onlajny.com adapter (halves, half-time, stoppage time, full time, away orientation, postponed, malformed page), Worker proxy, live ranking, outage handling, no-Worker fallback with slower polling, automatic official result and winner announcement; morning switch to the next match (not before 6:00, not during staff work, staff pin respected); backup JSON/CSV export and non-destructive restore; manual opening by staff (lock still applies) and staff-only tip deletion.');
