(function(root){
  const phases={scheduled:'Před zápasem',half1:'1. poločas',halftime:'Poločasová přestávka',half2:'2. poločas',fulltime:'Konec zápasu'};
  // clock: minute played ("34'", "90+3'") or empty when the source has none.
  const validClock=c=>typeof c==='string'&&(c===''||/^\d{1,3}(\+\d{1,2})?'$/.test(c));
  function validateSnapshot(data,matchId,now=Date.now()){
    if(!data||data.matchId!==matchId||!Number.isInteger(data.home)||data.home<0||data.home>20||!Number.isInteger(data.away)||data.away<0||data.away>20||!Object.hasOwn(phases,data.phase)||!validClock(data.clock)||typeof data.updatedAt!=='string'||data.final!==undefined&&typeof data.final!=='boolean'||data.final&&data.phase!=='fulltime')throw Error('Neplatný formát živých dat.');
    const timestamp=Date.parse(data.updatedAt);
    if(!Number.isFinite(timestamp)||timestamp>now+30000||now-timestamp>90000)throw Error('Živá data nejsou aktuální.');
    return {matchId,home:data.home,away:data.away,phase:data.phase,clock:data.clock,updatedAt:data.updatedAt,final:Boolean(data.final)};
  }
  // onlajny.com runs the live coverage linked from fcb.cz. Its match page is server-rendered with the current state,
  // but it sends no CORS headers, so the kiosk reads it through the Worker in worker.mjs (/api/live).
  const SOURCE_NAME='onlajny.com';
  const pageUrl=id=>`https://www.onlajny.com/match/index/id/${encodeURIComponent(id)}`;
  // Where the kiosk asks for the score. Relative = the Worker that serves the kiosk; set data-live-endpoint on <body>
  // to an absolute Worker URL when the kiosk itself is hosted elsewhere (e.g. GitHub Pages).
  const liveUrl=(endpoint,m)=>`${endpoint}?matchId=${encodeURIComponent(m.id)}&onlajny=${encodeURIComponent(m.onlajny)}`;
  const decode=s=>String(s).replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&amp;/g,'&').trim();
  function mainField(html,field){const m=new RegExp(`data-grid="main"[^>]*data-field="${field}"[^>]*>([^<]*)<`).exec(html);return m?decode(m[1]):null}
  function phaseOf(status,minute){
    const s=status.toLowerCase();
    if(/zruš|odlož|přeruš|kontum/.test(s))throw Error('Zápas byl podle onlajny.com zrušen, odložen nebo přerušen.');
    if(/před zápasem|nezahájen/.test(s))return 'scheduled';
    if(/konec|po zápase|^kon\.?$/.test(s))return 'fulltime';
    if(/1\.\s*(pol|poločas)/.test(s))return 'half1';
    if(/2\.\s*(pol|poločas)/.test(s))return 'half2';
    if(/poločas|přestáv|pauza/.test(s))return 'halftime';
    // No recognised status name: the minute played decides (stoppage time of the first half is "45+2").
    if(Number.isFinite(minute))return minute>45?'half2':'half1';
    if(s==='')return 'scheduled';
    throw Error('Neznámý stav zápasu ve zdroji onlajny.com.');
  }
  // Turns the onlajny.com match page into the normalized snapshot. Baník (OVA) always comes first.
  function fromOnlajny(html,{matchId,team='OVA'},now=Date.now()){
    const status=mainField(html,'status'),total=mainField(html,'total');
    if(status===null||total===null)throw Error('Stránka zápasu na onlajny.com nemá očekávaný formát.');
    const score=/^(\d+)\s*:\s*(\d+)$/.exec(total);
    if(!score)throw Error('Neplatné skóre ve zdroji onlajny.com.');
    const time=mainField(html,'timeScore')||'',minuteMatch=/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/.exec(time);
    const phase=phaseOf(status,minuteMatch?Number(minuteMatch[1]):NaN);
    const clock=(phase==='half1'||phase==='half2')&&minuteMatch?`${minuteMatch[1]}${minuteMatch[2]?'+'+minuteMatch[2]:''}'`:'';
    const team1=(/"team1abbr":"([^"]*)"/.exec(html)||[])[1],flip=Boolean(team1)&&team1.toUpperCase()!==team;
    const home=Number(score[1]),away=Number(score[2]);
    return validateSnapshot({matchId,home:flip?away:home,away:flip?home:away,phase,clock,updatedAt:new Date(now).toISOString(),final:phase==='fulltime'},matchId,now);
  }
  function createDemo(matchId,random=Math.random){
    const names=['Adam Novotný','Lucie Veselá','Petr Dvořák','Tereza Malá','Martin Král','Eva Horáková','Tomáš Černý','Jana Procházková'];
    for(let i=names.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[names[i],names[j]]=[names[j],names[i]]}
    const tips=[[2,1],[1,1],[3,1]].map(([home,away],i)=>({id:`demo-${i}`,matchId,name:names[i],home,away,outcome:home===away?'X':home>away?'1':'2',savedAt:'demo'}));
    const steps=[
      {home:0,away:0,phase:'scheduled',clock:'',note:'Tři návštěvníci odeslali své tipy.'},
      {home:0,away:0,phase:'half1',clock:"1'",note:'Úvodní hvizd! Průběžné pořadí se počítá z aktuálního skóre.'},
      {home:1,away:0,phase:'half1',clock:"23'",note:'Gól Baníku! Tabulka se přepočítává.'},
      {home:1,away:1,phase:'half1',clock:"41'",note:'Hosté vyrovnávají. Do čela míří tip na remízu.'},
      {home:1,away:1,phase:'halftime',clock:'',note:'Poločasová přestávka.'},
      {home:2,away:1,phase:'half2',clock:"58'",note:'Baník znovu vede. Lídr se mění.'},
      {home:2,away:1,phase:'half2',clock:"77'",note:'Jeden z tipů nyní přesně odpovídá skóre. Více lidí může mít stejnou odchylku.'},
      {home:2,away:1,phase:'half2',clock:"90+3'",note:'Nastavený čas. Pořadí je stále průběžné.'},
      {home:2,away:1,phase:'fulltime',clock:'',note:'Konec zápasu. Demo vyhodnocuje konečného vítěze.'}
    ];
    return {matchId,tips,steps,index:0,playing:true,lastStepAt:Date.now()};
  }
  const api={phases,validateSnapshot,createDemo,SOURCE_NAME,pageUrl,liveUrl,fromOnlajny};
  if(typeof module!=='undefined')module.exports=api;else root.LiveMatch=api;
})(globalThis);
