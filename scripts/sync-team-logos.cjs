const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const teams=require('../dist/teams.js');
const root=path.resolve(__dirname,'..');
const allowed=new Set(['www.fcb.cz','fcb.cz']);
async function get(url){
  if(!allowed.has(new URL(url).hostname))throw Error('Unrecognized logo source');
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'BanikVIP-LogoSync/1.0'}});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  if(!allowed.has(new URL(response.url).hostname))throw Error('Unexpected redirect');
  return response;
}
// Club crests come from fcb.cz/znaky/<id>.png|svg, the same files the club uses in its match lists.
async function main(){
  const output=path.join(root,'dist','assets','teams');
  await fs.mkdir(output,{recursive:true});
  const results=await Promise.allSettled(Object.values(teams).filter(team=>!team.own).map(async team=>{
    const source=team.remoteLogo;
    const response=await get(source),data=Buffer.from(await response.arrayBuffer());
    if(data.length>3*1024*1024)throw Error(`${team.id}: oversized logo`);
    const svg=team.logo.endsWith('.svg');
    if(svg?!/<svg[\s>]/i.test(data.toString('utf8')):data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error(`${team.id}: unexpected image format`);
    await fs.writeFile(path.join(root,'dist',team.logo),data);
    return {id:team.id,name:team.name,file:team.logo,source,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
  }));
  const successes=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  const failed=results.map((r,i)=>r.status==='rejected'?`${Object.values(teams).filter(team=>!team.own)[i].id}: ${r.reason.message}`:null).filter(Boolean);
  await fs.writeFile(path.join(output,'sources.json'),JSON.stringify({retrievedAt:new Date().toISOString(),teams:successes},null,2)+'\n');
  console.log(`Downloaded and validated ${successes.length}/${Object.values(teams).filter(team=>!team.own).length} opponent logos.`);
  if(failed.length)throw Error(failed.join('\n'));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
