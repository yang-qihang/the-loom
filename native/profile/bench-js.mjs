import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
const files = fs.readdirSync("evidence").filter(n => /-real-snapshot-.*\.json$/.test(n)).map(n => "evidence/" + n);
function stableStringify(v){if(v===null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(stableStringify).join(",")}]`;const k=Object.keys(v).sort();return `{${k.map(x=>`${JSON.stringify(x)}:${stableStringify(v[x])}`).join(",")}}`;}
const digest = o => "sha256:" + crypto.createHash("sha256").update(stableStringify(o)).digest("hex");
function bench(fn, n=100){const s=process.hrtime.bigint();for(let i=0;i<n;i++)fn();return Number(process.hrtime.bigint()-s)/1e6/n;}
const rows=[];
for (const f of files) {
  const raw=fs.readFileSync(f,"utf8");
  let o; const tParse=bench(()=>{o=JSON.parse(raw)},1);
  const canonical=stableStringify(o);
  const blocks=Object.keys(o.blocks??{}).length;
  rows.push({file:f.split("/").pop(), rawKB:+(raw.length/1024).toFixed(1), canonKB:+(canonical.length/1024).toFixed(1), blocks, events:(o.events??[]).length, agents:Object.keys(o.agents??{}).length, npcs:Object.keys(o.npcs??{}).length, parseMs:+tParse.toFixed(3)});
}
rows.sort((a,b)=>b.rawKB-a.rawKB);
console.log("TOP BY SIZE");
console.table(rows.slice(0,8));
const biggest = rows[0];
const raw=fs.readFileSync("evidence/"+biggest.file,"utf8");
const obj=JSON.parse(raw);
const n=200;
const r={
  rawKB:+(raw.length/1024).toFixed(1),
  jsonParseMs:+bench(()=>JSON.parse(raw),n).toFixed(3),
  jsonStringifyMs:+bench(()=>JSON.stringify(obj),n).toFixed(3),
  canonicalMs:+bench(()=>stableStringify(obj),n).toFixed(3),
  sha256Ms:+bench(()=>crypto.createHash("sha256").update(raw).digest("hex"),n).toFixed(3),
  digestMs:+bench(()=>digest(obj),n).toFixed(3),
  gzipKB:+(zlib.gzipSync(raw).length/1024).toFixed(1),
  brotliKB:+(zlib.brotliCompressSync(raw).length/1024).toFixed(1),
  blocks:Object.keys(obj.blocks??{}).length,
  events:(obj.events??[]).length,
};
console.log("BIGGEST", biggest.file, r);
fs.writeFileSync("tmp/cpp-profile/snapshot-js.json", JSON.stringify({rows,r},null,2));
