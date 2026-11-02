#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <queue>
#include <vector>
#include <random>
#include <algorithm>
struct State { float f; int x,y; bool operator>(const State&o)const{return f>o.f;} };
int W=128,H=128;
static bool blocked(const std::vector<unsigned char>& g,int x,int y){return x<0||y<0||x>=W||y>=H||g[y*W+x];}
static float h(int x,int y,int tx,int ty){int dx=std::abs(x-tx),dy=std::abs(y-ty);return (dx+dy)+(std::sqrt(2.f)-2)*std::min(dx,dy);}
int astar(const std::vector<unsigned char>& g,int sx,int sy,int tx,int ty){
  std::vector<float> dist((size_t)W*H,1e30f); std::vector<int> prev((size_t)W*H,-1);
  std::priority_queue<State,std::vector<State>,std::greater<State>> pq;
  dist[sy*W+sx]=0; pq.push({h(sx,sy,tx,ty),sx,sy});
  const int dx[8]={1,-1,0,0,1,1,-1,-1},dy[8]={0,0,1,-1,1,-1,1,-1};
  while(!pq.empty()){
    State s=pq.top();pq.pop();
    if(s.x==tx&&s.y==ty)break;
    for(int k=0;k<8;k++){int nx=s.x+dx[k],ny=s.y+dy[k]; if(blocked(g,nx,ny))continue; if(k>=4){if(blocked(g,s.x+dx[k],s.y)||blocked(g,s.x,s.y+dy[k]))continue;} float nd=dist[s.y*W+s.x]+((k<4)?1.f:1.41421356f); if(nd<dist[ny*W+nx]-1e-6f){dist[ny*W+nx]=nd;prev[ny*W+nx]=s.y*W+s.x;pq.push({nd+h(nx,ny,tx,ty),nx,ny});}}
  }
  return dist[ty*W+tx]>=1e29f?-1:0;
}
int main(int argc,char**argv){
  int iters=argc>1?atoi(argv[1]):100; std::mt19937 rng(42); std::uniform_real_distribution<float> u(0,1);
  std::vector<unsigned char> g((size_t)W*H,0); for(auto&v:g)v=u(rng)<0.2f;
  int n=0; auto t0=std::chrono::steady_clock::now();
  for(int i=0;i<iters;i++){int sx=0,sy=0,tx=W-1,ty=H-1; while(blocked(g,sx,sy)){sx=rng()%W;sy=rng()%H;} while(blocked(g,tx,ty)){tx=rng()%W;ty=rng()%H;} n+=astar(g,sx,sy,tx,ty)>=0;}
  auto t1=std::chrono::steady_clock::now(); double ms=std::chrono::duration<double,std::milli>(t1-t0).count()/iters;
  printf("{\"iterations\":%d,\"reachable\":%d,\"msPerAstar\":%.3f}\n",iters,n,ms); return 0;
}
