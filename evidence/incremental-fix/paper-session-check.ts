import { GameSession } from '../../packages/session/src/session';
import { createWorldRuntime } from '../../apps/engine/src/world';
import { L01Content } from '../../content/levels/L01.content';
import { writeFileSync } from 'node:fs';
const runtime=createWorldRuntime({...process.env,LOOM_WORLD:'paper',LOOM_RPC_URL:'ws://127.0.0.1:8869',LOOM_MC_PORT:'25619',LOOM_MC_HOST:'127.0.0.1',LOOM_BOT_NAME:'IncrementalBot'});
const partial='golem.moveTo(lamp1)\ngolem.place("lantern",lamp1)\ngolem.moveTo(lamp2)\ngolem.place("lantern",lamp2)\ngolem.moveTo(lamp3)\ngolem.place("lantern",lamp3)';
const rows:any[]=[];
let session:GameSession|undefined;
try {
 await runtime.init();
 const port=await runtime.createPort(L01Content);
 session=await GameSession.create(L01Content,port,{runTimeoutMs:180000});
 const run=async(source:string)=>{
  let done!:()=>void;const finished=new Promise<void>(r=>{done=r});
  const off=session!.subscribe(e=>{if(e.type==='result'){rows.push(e);console.log(JSON.stringify({phase:'result',...e}));done()}});
  await session!.run(source);await finished;off();
 };
 await run(partial);
 const beat=await session.playerBeat();rows.push(beat.result);
 console.log('BEAT',JSON.stringify(beat.result));
 await run(partial+'\ngolem.moveTo(eira)');
 const snapshot=await session.snapshot();
 writeFileSync(process.argv[2],JSON.stringify({rows,state:session.state,snapshot},null,2)+'\n');
 console.log('FINAL',session.state,session.lastResult?.failures);
} finally {await session?.dispose();await runtime.close();}
