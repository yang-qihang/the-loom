// @ts-nocheck
import { WsJsonRpcClient } from "../../packages/worldport/src/paper-port";
const t = () => performance.now();
const avg = (a) => a.reduce((x,y)=>x+y,0)/a.length;
const rpc = await WsJsonRpcClient.connect("ws://127.0.0.1:8765");
async function bench(name, fn, n=10) {
  const times=[]; for(let i=0;i<n;i++){const s=t(); await fn(); times.push(t()-s);} 
  const r={name,n,avgMs:+avg(times).toFixed(2),minMs:+Math.min(...times).toFixed(2),maxMs:+Math.max(...times).toFixed(2)}; console.log(JSON.stringify(r)); return r;
}
const out={};
out.health=await bench("health",()=>rpc.call("health"));
// invalid session snapshot to see pure RPC scheduling floor
out.snapshotInvalid=await bench("world.snapshot(invalid)",()=>rpc.call("world.snapshot",{sessionId:"nope",levelId:"L01"}).catch(()=>{}));
out.blocksSmall=await bench("world.blocks(1pos)",()=>rpc.call("world.blocks",{sessionId:"nope",positions:[[0,65,0]]}).catch(()=>{}));
out.blocksNoSession=await bench("world.blocks(no session?)",()=>rpc.call("world.blocks",{positions:[[0,65,0]]}).catch(()=>{}));
console.log("WROTE", JSON.stringify(out));
await rpc.close?.();
