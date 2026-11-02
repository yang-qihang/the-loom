#!/usr/bin/env node
/**
 * apps/desktop 构建前的资源准备：
 * 1) 构建 apps/studio（vite base './'，供 Tauri WebView 以相对路径加载）
 * 2) 把 studio dist 复制到 apps/desktop/dist/studio
 * 3) 复制桌面壳（wizard/companion/shell）到 apps/desktop/dist
 * 4) esbuild 打包 engine 单文件 CJS（apps/desktop/runtime/engine.cjs）
 * 5) 生成 Tauri 图标（暖色织纹）
 * 6) 对 engine.cjs 做冒烟测试（起服务 → /api/health → 退出）
 */
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopDir, "../..");
const studioDir = join(repoRoot, "apps", "studio");
const distDir = join(desktopDir, "dist");
const runtimeDir = join(desktopDir, "src-tauri", "runtime");
const iconDir = join(desktopDir, "src-tauri", "icons");

function log(message) {
  console.log(`[desktop/assets] ${message}`);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", code => (code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(" ")} exit ${code}`))));
  });
}

async function buildStudio() {
  // 不能用 node_modules/.bin/vite 直接 spawn：Windows 上它是无扩展名的 sh 脚本，spawn 会 ENOENT。
  // 用当前 Node 执行 vite.js，两个平台行为一致。
  const vite = join(studioDir, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(vite)) throw new Error("apps/studio 未安装依赖（缺少 vite）");
  log("构建 studio（vite build --base=./）…");
  await run(process.execPath, [vite, "build", "--base", "./"], { cwd: studioDir });
  const index = join(studioDir, "dist", "index.html");
  if (!existsSync(index)) throw new Error("studio 构建产物缺少 index.html");
  const html = await readFile(index, "utf8");
  if (!html.includes('src="./assets/') && !html.includes('href="./assets/')) {
    throw new Error("studio 构建产物不是相对路径（vite base './' 未生效）");
  }
  log("studio 构建完成（相对路径 asset 已校验）");
}

async function copyFrontend() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(join(distDir, "studio"), { recursive: true });
  await cp(join(studioDir, "dist"), join(distDir, "studio"), { recursive: true });
  await cp(join(desktopDir, "shell"), distDir, { recursive: true });
  // 自包含真实引擎使用同源 Studio/伴玩：把静态 UI 放进 runtime/real/studio。
  const realStudio = join(runtimeDir, "real", "studio");
  if (existsSync(join(runtimeDir, "real", "engine.mjs"))) {
    await rm(realStudio, { recursive: true, force: true });
    await mkdir(realStudio, { recursive: true });
    await cp(join(distDir, "studio"), realStudio, { recursive: true });
    let companion = await readFile(join(desktopDir, "shell", "companion.html"), "utf8");
    companion = companion.replaceAll('url("./studio/fonts/', 'url("./fonts/');
    await writeFile(join(realStudio, "companion.html"), companion, "utf8");
  }
  log("前端资源复制完成（dist/index.html + dist/studio/ + dist/companion.html）");
}

const PAPER_STUB = `// 桌面壳当前只接 Mock 世界（task-54）：不把 mineflayer/minecraft-protocol 打进桌面包。
// 真实 Paper 适配器由仓库内 npm run dev:engine:paper 运行（task-49 另验）。
const EXPLAIN = "桌面版当前只内置 Mock 世界；真实 Paper 联调请在仓库运行 npm run dev:engine:paper（task-49 另验）。";

export interface SceneHint {
  groundY?: number;
  floorY?: number;
  playerSpawn?: [number, number, number];
}

export interface GolemBotLike {
  readonly connected: boolean;
  connect(timeoutMs: number): Promise<void>;
  moveTo(x: number, z: number): Promise<void>;
  place(block: string, x: number, y: number, z: number): Promise<void>;
  say(text: string): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
}

export class WsJsonRpcClient {
  static async connect(_url: string, _timeoutMs = 1500): Promise<WsJsonRpcClient> {
    throw new Error(EXPLAIN);
  }
  async call<T>(_method: string, _params?: unknown, _timeoutMs?: number): Promise<T> {
    throw new Error(EXPLAIN);
  }
  close(): void {}
}

export class PaperWorldPort {
  constructor(_options: unknown) {
    throw new Error(EXPLAIN);
  }
}
`;

const BOT_STUB = `// 桌面壳 Mock-only：真实织偶 bot 不在桌面产物内（见 build-assets PAPER_STUB）。
const EXPLAIN = "桌面版当前只内置 Mock 世界；真实 Paper 联调请在仓库运行 npm run dev:engine:paper（task-49 另验）。";

export class GolemBot {
  constructor(_options: unknown) {
    throw new Error(EXPLAIN);
  }
}
`;

async function buildEngine() {
  log("打包 engine 单文件（esbuild bundle → engine.mjs + engine.cjs 启动器）…");
  // 干净 clone 里 runtime/ 是空目录，Git 不跟踪；不先创建会写 stub 时 ENOENT。
  await mkdir(runtimeDir, { recursive: true });
  const paperStub = join(runtimeDir, "paper-port.stub.ts");
  const botStub = join(runtimeDir, "bot-manager.stub.ts");
  await writeFile(paperStub, PAPER_STUB, "utf8");
  await writeFile(botStub, BOT_STUB, "utf8");
  await build({
    entryPoints: [join(repoRoot, "apps", "engine", "src", "server.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: join(runtimeDir, "engine.mjs"),
    // engine → session → runner 依赖 esbuild/typescript（原生/重型）；T3 spike 从仓库 node_modules 解析。
    external: ["esbuild", "typescript"],
    // 桌面版当前 Mock-only：Paper 适配器与织偶 bot 用 stub 顶替，避免把 mineflayer/minecraft-protocol 打进包（task-54）。
    plugins: [
      {
        name: "loom-desktop-paper-stub",
        setup(buildApi) {
          buildApi.onResolve({ filter: /worldport[/\\]src[/\\]paper-port$/ }, () => ({ path: paperStub }));
          buildApi.onResolve({ filter: /bot[/\\]manager\.mjs$/ }, () => ({ path: botStub }));
        },
      },
    ],
    logLevel: "warning",
  });
  const cjsLauncher = [
    "#!/usr/bin/env node",
    '"use strict";',
    "// T3 spike：CJS 启动器把入口指到 engine.mjs（ESM 支持 top-level await），再动态 import。",
    'const path = require("node:path");',
    'const { pathToFileURL } = require("node:url");',
    'const entry = path.join(__dirname, "engine.mjs");',
    "process.argv[1] = entry;",
    'import(pathToFileURL(entry).href).catch(error => {',
    '  console.error("[loom-engine] 启动失败：", error && error.stack ? error.stack : error);',
    "  process.exit(1);",
    "});",
    "",
  ].join("\n");
  await writeFile(join(runtimeDir, "engine.cjs"), cjsLauncher, "utf8");
  log("engine 打包完成：runtime/engine.mjs + runtime/engine.cjs");
  await copyRuntimeDependencies();
}

/** 打包版 engine 用 ESM external 引入 esbuild/typescript；复制到 runtime/node_modules 以便离线解析。 */
async function copyRuntimeDependencies() {
  const nodeModules = join(runtimeDir, "node_modules");
  await rm(nodeModules, { recursive: true, force: true });
  const rootModules = join(repoRoot, "node_modules");
  const packages = [join(rootModules, "typescript"), join(rootModules, "esbuild")];
  const esbuildScope = join(rootModules, "@esbuild");
  if (existsSync(esbuildScope)) {
    for (const entry of readdirSync(esbuildScope)) packages.push(join(esbuildScope, entry));
  }
  for (const source of packages) {
    const relative = source.slice(rootModules.length + 1);
    await mkdir(join(nodeModules, relative), { recursive: true });
    await cp(source, join(nodeModules, relative), { recursive: true, dereference: true });
  }
  log(`engine runtime 依赖已复制（typescript + esbuild + @esbuild/*，${packages.length} 个包）`);
}

async function smokeTestEngine() {
  const port = 4399;
  log(`engine.cjs 冒烟测试（PORT=${port}）…`);
  const child = spawn(process.execPath, [join(runtimeDir, "engine.cjs")], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), NODE_PATH: join(repoRoot, "node_modules") },
    stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 8000;
    for (;;) {
      if (Date.now() > deadline) throw new Error("engine.cjs 启动 8s 内未响应 /api/health");
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        const body = await response.json();
        if (body.ok) {
          log(`engine.cjs 健康检查通过：${JSON.stringify(body)}`);
          return;
        }
      } catch {
        // 尚未就绪
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 150));
    }
  } finally {
    child.kill("SIGTERM");
  }
}

// ---- 图标：暖色织纹 PNG（纯 zlib，无图像依赖；C 工具存在时优先用原生实现） ----
export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** 暖色底 + 金色织线菱形纹样的正方形图标。 */
export function makeIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = [22, 17, 12];
  const warm = [214, 168, 92];
  const glow = [245, 205, 128];
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const dx = Math.abs(x - size / 2) / (size / 2);
      const dy = Math.abs(y - size / 2) / (size / 2);
      const diamond = dx + dy;
      const onWeave = Math.abs(((dx + dy) % 0.34)) < 0.045 || Math.abs(((dx - dy) % 0.34)) < 0.045;
      const rim = size * 0.06;
      const border = x < rim || y < rim || x > size - rim - 1 || y > size - rim - 1;
      let color = bg;
      if (border) color = [58, 42, 26];
      else if (onWeave && diamond < 1.05) color = warm;
      if (!border && diamond < 0.14) color = glow;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const ICON_SPECS = [
  [32, "32x32.png"],
  [128, "128x128.png"],
  [256, "128x128@2x.png"],
  [512, "icon.png"],
  [1024, "icon-1024.png"],
];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 校验 5 个图标存在、PNG 签名有效、IHDR 尺寸正确。 */
async function verifyGeneratedIcons(source) {
  for (const [size, name] of ICON_SPECS) {
    const file = join(iconDir, name);
    if (!existsSync(file)) throw new Error(`${source} 未生成 ${name}`);
    const buffer = await readFile(file);
    if (buffer.length < 24 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error(`${source} 生成的 ${name} 不是 PNG（签名校验失败）`);
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width !== size || height !== size) {
      throw new Error(`${source} 生成的 ${name} 为 ${width}x${height}，期望 ${size}x${size}`);
    }
  }
}

export async function generateIcons() {
  // 保持既有行为：创建一个未使用的 icons/icons 子目录（同时保证 iconDir 存在）。
  await mkdir(join(iconDir, "icons"), { recursive: true });
  log("生成 Tauri 图标（JS makeIcon）…");
  for (const [size, name] of ICON_SPECS) {
    await writeFile(join(iconDir, name), makeIcon(size));
  }
  await verifyGeneratedIcons("JS makeIcon");
  const icon = await readFile(join(iconDir, "icon.png"));
  log(
    `图标生成完成（${ICON_SPECS.length} 个 PNG）sha256=${createHash("sha256").update(icon).digest("hex").slice(0, 12)}`,
  );
}

async function main() {
  await buildStudio();
  await copyFrontend();
  await buildEngine();
  await generateIcons();
  await smokeTestEngine();
  log("全部资源准备完成");
}

const isDirectRun =
  process.argv[1] !== undefined &&
  (process.platform === "win32"
    ? resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
    : resolve(process.argv[1]) === fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch(error => {
    console.error(`[desktop/assets] FAILED: ${error.message}`);
    process.exit(1);
  });
}
