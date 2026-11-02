// @ts-nocheck
import fs from "node:fs";
import { grade } from "../../packages/grading/src/index";
import { L01Content } from "../../content/levels/L01.content";
import { L05Content } from "../../content/levels/L05.content";
import { L06Content } from "../../content/levels/L06.content";
import { L09Content } from "../../content/levels/L09.content";
const contentByLevel={L01:L01Content,L05:L05Content,L06:L06Content,L09:L09Content};
const files=fs.readdirSync("evidence").filter(n=>/-real-snapshot-.*\.json$/.test(n));
const rows=[];
for(const f of files){const m=/^l(\d+)-/.exec(f); const lvl="L"+String(Number(m?.[1]??0)).padStart(2,"0");const c=contentByLevel[lvl];if(!c)continue;const snap=JSON.parse(fs.readFileSync("evidence/"+f,"utf8"));const t=()=>performance.now();let report;const n=50;const s=t();for(let i=0;i<n;i++)report=grade(c.def,snap);const ms=(t()-s)/n;rows.push({file:f,lvl,blocks:Object.keys(snap.blocks??{}).length,events:(snap.events??[]).length,gradeMs:+ms.toFixed(3),passed:report?.passed});}
rows.sort((a,b)=>b.gradeMs-a.gradeMs);console.table(rows.slice(0,8));
