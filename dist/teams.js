(function(root){
  const base='https://www.fcb.cz';
  // id = logo file name on fcb.cz/znaky, short = abbreviation used by onlajny.com and fcb.cz match lists.
  const rows=[
    ['ova','FC Baník Ostrava','OVA','png',['Baník','FC Baník Ostrava']],
    ['sla','SK Slavia Praha','SLA','png',['Slavia']],
    ['acs','AC Sparta Praha','SPA','png',['Sparta']],
    ['plz','FC Viktoria Plzeň','PLZ','png',['Plzeň']],
    ['lis','Artis Brno','LIS','png',['Artis Brno']],
    ['olo','SK Sigma Olomouc','OLO','png',['Olomouc']],
    ['prd','FK Pardubice','PCE','png',['Pardubice']],
    ['tep','FK Teplice','TEP','png',['Teplice']],
    ['hrk','FC Hradec Králové','HRK','png',['Hradec Králové']],
    ['jab','FK Jablonec','JAB','png',['Jablonec']],
    ['mlb','FK Mladá Boleslav','MBL','png',['Boleslav']],
    ['slo','1. FC Slovácko','SLO','png',['Slovácko']],
    ['boh','Bohemians Praha 1905','BOH','png',['Bohemians']],
    ['lib','FC Slovan Liberec','LIB','png',['Liberec']],
    ['brn','FC Zbrojovka Brno','BRN','svg',['Brno']],
    ['zln','FC Zlín','ZLN','png',['Zlín']]
  ];
  const teams=Object.fromEntries(rows.map(([id,name,short,ext,aliases])=>[id,{id,name,short,aliases,remoteLogo:`${base}/znaky/${id}.${ext}`,logo:`assets/teams/${id}.${ext}`}]));
  // Baník itself uses the full-resolution crest (cropped by scripts/sync-club-content.py), not the 100 px list icon.
  Object.assign(teams.ova,{logo:'assets/club-logo.png',remoteLogo:`${base}/img/fcb_logo_original.png`,own:true});
  if(typeof module!=='undefined')module.exports=teams;else root.FootballTeams=teams;
})(globalThis);
