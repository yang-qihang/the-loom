const W=128,H=128;
function makeGrid(seed=42){let s=seed;const rnd=()=>((s=(s*1664525+1013904223)>>>0)/4294967296);const g=new Uint8Array(W*H);for(let i=0;i<g.length;i++)g[i]=rnd()<0.2?1:0;return g;}
const g=makeGrid();
const blocked=(x,y)=>x<0||y<0||x>=W||y>=H||g[y*W+x]===1;
function h(x,y,tx,ty){const dx=Math.abs(x-tx),dy=Math.abs(y-ty);return (dx+dy)+(Math.SQRT2-2)*Math.min(dx,dy);}
class Heap{constructor(){this.a=[];}push(n){const a=this.a;a.push(n);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p].f<=a[i].f)break;[a[p],a[i]]=[a[i],a[p]];i=p;}}pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;for(;;){let l=2*i+1,r=l+1,s=i;if(l<a.length&&a[l].f<a[s].f)s=l;if(r<a.length&&a[r].f<a[s].f)s=r;if(s===i)break;[a[s],a[i]]=[a[i],a[s]];i=s;}}return top;}get size(){return this.a.length;}}
const dx=[1,-1,0,0,1,1,-1,-1],dy=[0,0,1,-1,1,-1,1,-1];
function astar(sx,sy,tx,ty){const dist=new Float32Array(W*H).fill(1e30);const pq=new Heap();dist[sy*W+sx]=0;pq.push({f:h(sx,sy,tx,ty),x:sx,y:sy});while(pq.size){const s=pq.pop();if(s.x===tx&&s.y===ty)break;for(let k=0;k<8;k++){const nx=s.x+dx[k],ny=s.y+dy[k];if(blocked(nx,ny))continue;if(k>=4&&(blocked(s.x+dx[k],s.y)||blocked(s.x,s.y+dy[k])))continue;const nd=dist[s.y*W+s.x]+(k<4?1:Math.SQRT2);if(nd<dist[ny*W+nx]-1e-6){dist[ny*W+nx]=nd;pq.push({f:nd+h(nx,ny,tx,ty),x:nx,y:ny});}}}return dist[ty*W+tx]>=1e29?-1:0;}
const iters=100;let n=0,seed=1;const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
const t0=performance.now();for(let i=0;i<iters;i++){let sx=0,sy=0,tx=W-1,ty=H-1;while(blocked(sx,sy)){sx=Math.floor(rnd()*W);sy=Math.floor(rnd()*H);}while(blocked(tx,ty)){tx=Math.floor(rnd()*W);ty=Math.floor(rnd()*H);}n+=astar(sx,sy,tx,ty)>=0;}const t1=performance.now();
console.log(JSON.stringify({iterations:iters,reachable:n,msPerAstar:+((t1-t0)/iters).toFixed(3)}));
