(function(root){
  function validScore(value){return Number.isInteger(value)&&value>=0&&value<=20}
  function resultOf(home,away){return home===away?'X':home>away?'1':'2'}
  function validate(entry){
    if(typeof entry.name!=='string'||entry.name.trim().length<2||entry.name.trim().length>60)return 'Napiš své jméno (2 až 60 znaků).';
    if(!['1','X','2'].includes(entry.outcome))return 'Vyber výhru Baníku, remízu nebo výhru hostů.';
    if(!validScore(entry.home)||!validScore(entry.away))return 'Zadej celé skóre od 0 do 20 gólů pro oba týmy.';
    if(resultOf(entry.home,entry.away)!==entry.outcome)return 'Skóre musí odpovídat vybranému výsledku.';
    return '';
  }
  // Football league matches end after 90 minutes plus stoppage time: the final score decides, a draw is a valid result.
  // 1. distance from the final score; 2. the earlier tip.
  function tipTime(entry){const t=Date.parse(entry.savedAt);return Number.isFinite(t)?t:Infinity}
  function rank(entries,result){
    if(!result||!validScore(result.home)||!validScore(result.away))return [];
    const sorted=entries.filter(e=>!validate(e)).map(e=>({...e,distance:Math.abs(e.home-result.home)+Math.abs(e.away-result.away)}));
    sorted.sort((a,b)=>a.distance-b.distance||tipTime(a)-tipTime(b));
    let previous=null,position=0;
    return sorted.map((entry,index)=>{if(!previous||entry.distance!==previous.distance||tipTime(entry)!==tipTime(previous))position=index+1;previous=entry;return {...entry,position}});
  }
  function evaluate(entries,result){return rank(entries,result).filter(entry=>entry.position===1)}
  const api={validScore,resultOf,validate,rank,evaluate,tipTime};
  if(typeof module!=='undefined')module.exports=api;else root.Competition=api;
})(globalThis);
