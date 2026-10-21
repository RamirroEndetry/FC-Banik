import LiveMatch from './dist/live.js';

// Live score for the kiosk: onlajny.com sends no CORS headers, so the Worker reads the match page server-side
// and returns the normalized snapshot. On GitHub Pages alone (without this Worker) staff enter the result by hand.
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname!=='/api/live')return env.ASSETS.fetch(request);
    const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
    if(request.method!=='GET')return reply({error:'METHOD_NOT_ALLOWED'},405);
    const matchId=url.searchParams.get('matchId')||'',onlajny=url.searchParams.get('onlajny')||'';
    if(!/^[a-z0-9-]{1,20}$/.test(matchId)||!/^\d{4,9}$/.test(onlajny))return reply({error:'INVALID_MATCH'},400);
    try{
      const response=await fetch(LiveMatch.pageUrl(onlajny),{headers:{Accept:'text/html','User-Agent':'BanikVIP-Kiosk/1.0'},signal:AbortSignal.timeout(7000),cache:'no-store'});
      if(!response.ok)return reply({error:'LIVE_FEED_UNAVAILABLE'},502);
      return reply(LiveMatch.fromOnlajny(await response.text(),{matchId}));
    }catch(error){return reply({error:'LIVE_FEED_UNAVAILABLE',detail:String(error?.message||error)},502)}
  }
};
