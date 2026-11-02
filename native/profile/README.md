# native/profile · C/C++ 选型基准（2026-11-02）

> 状态：选型依据（原型，不参与构建）｜负责人：Lead｜上游：`docs/49-cpp-component-profile.md`、用户课程要求

这里不是生产代码，而是为「项目里哪个构件值得用 C/C++ 重写」做的可复现基准：

- `cpp/worlddigest.cpp`：自写 JSON 解析 + canonical（key 排序）+ OpenSSL SHA-256，对照 `packages/session/src/session.ts` 的 `digestSnapshot`；已与真实快照逐字节比对一致。
- `cpp/astar.cpp`：128×128 网格 A*（C++），用于与 `bench-astar.mjs` 的 JS A* 比较构件级加速。
- `bench-js.mjs`：真实快照的 JSON.parse/stringify/canonical/digest/gzip/brotli 基准。
- `bench-grade.ts`：真实快照上的 `grade()` 耗时。
- `bench-rpc.ts`：真实 Paper 插件 RPC 往返延迟（发现 ~50ms tick 下限）。
- `bench-real.ts`：真实 Paper 的 prepare/reset/snapshot RPC/寻路规划基准（需 Paper 25565 + RPC 8765）。

构建与运行：

```bash
g++ -O2 -std=c++20 native/profile/cpp/worlddigest.cpp -lcrypto -o /tmp/worlddigest
node native/profile/bench-js.mjs
npx tsx native/profile/bench-grade.ts
# 需先起 Paper（见 docs/02）
npx tsx native/profile/bench-rpc.ts
npx tsx native/profile/bench-real.ts
g++ -O2 -std=c++20 native/profile/cpp/astar.cpp -o /tmp/astar && /tmp/astar 100
node native/profile/bench-astar.mjs
```

实测数字与结论见 `docs/49-cpp-component-profile.md` §2–§3。
