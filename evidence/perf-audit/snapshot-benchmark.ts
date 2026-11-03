import { startEngine } from '../../apps/engine/src/server';
import { createWorldRuntime } from '../../apps/engine/src/world';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
const engine = await startEngine({port:0,world:createWorldRuntime({...process.env,LOOM_WORLD:'mock'})});
const results=[];
try {
 for(const level of ['L01','L05','L10']) {
  const created=await fetch(engine.url+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({levelId:level})});
  const {sessionId}=await created.json() as {sessionId:string};
  const row:any={level};
  for(const view of ['full','hud']) {
   const response=await fetch(`${engine.url}/api/session/${sessionId}/snapshot${view==='hud'?'?view=hud':''}`);
   const text=await response.text();
   for(let i=0;i<20;i++)JSON.parse(text);
   const start=performance.now();for(let i=0;i<500;i++)JSON.parse(text);
   row[view]={bytes:Buffer.byteLength(text),parse500Ms:Number((performance.now()-start).toFixed(2))};
  }
  results.push(row);
 }
} finally{await engine.close();}
const result={node:process.version,world:'MockWorld',results};
writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify(result));
