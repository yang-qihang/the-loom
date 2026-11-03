import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function openShell(page: Page, failEvents = false, realWizard = false) {
  await page.route("**/__desktop/**", async route => {
    const name = new URL(route.request().url()).pathname.split("/__desktop/")[1];
    if (name === "wizard.html" && !realWizard) {
      await route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body>向导测试<scr' + 'ipt>window.received=[];addEventListener("message",e=>received.push(e.data));</scr' + 'ipt></body></html>' });
      return;
    }
    if (!["index.html", "shell.js", "shell.css", "shell-policy.js", "wizard.html"].includes(name)) { await route.fulfill({ status: 404, body: "" }); return; }
    const body = await readFile(resolve(process.cwd(), "../desktop/shell", name));
    await route.fulfill({ body, contentType: name.endsWith(".js") ? "application/javascript" : name.endsWith(".css") ? "text/css" : "text/html" });
  });
  await page.route("http://127.0.0.1:4399/studio/index.html?*", route => route.fulfill({ contentType: "text/html", body: "<html><body>工坊测试</body></html>" }));
  await page.addInitScript(fail => {
    if (window.parent !== window) return;
    localStorage.setItem("loom.engineUrl", "http://127.0.0.1:4399");
    const env = {
      engine: { state: "ready", detail: "engine" }, paper: { state: "ready", detail: "paper" },
      bot: { state: "ready", detail: "bot" }, client: { state: "ready", detail: "client" },
      allReady: true, clientLost: false, sessionActive: false, launching: [], mock: false,
    };
    const calls: Array<{ command: string; args?: unknown }> = [];
    const topics: Record<string, (event: { payload?: unknown }) => void> = {};
    Object.assign(window, {
      shellProbe: { calls, topics, env },
      __TAURI__: {
        core: { invoke: async (command: string, args?: unknown) => {
          calls.push({ command, args });
          if (command === "get_settings") return { page: "wizard", mode: "workbench" };
          if (command === "env_probe") return { java: { ok: true, detail: "Java 25" }, node: { ok: true, detail: "Node 22" } };
          if (command === "env_state") return env;
          if (command === "engine_ready") return true;
          return { ok: true };
        } },
        event: { listen: async (topic: string, callback: (event: { payload?: unknown }) => void) => {
          if (fail) throw new Error("event IPC unavailable");
          topics[topic] = callback;
          return () => {};
        } },
      },
    });
  }, failEvents);
  await page.goto("/__desktop/index.html");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__loomShell))).toBe(true);
}

async function calls(page: Page) { return page.evaluate(() => (window as any).shellProbe.calls as Array<{ command: string; args?: unknown }>); }

test("真实 shell：环境同源、会话同步与掉线阻断", async ({ page }) => {
  await openShell(page);
  await expect(page.locator("#conn-engine")).toHaveAttribute("data-state", "ok");
  const frame = page.frames().find(frame => frame !== page.mainFrame())!;
  await frame.evaluate(() => parent.postMessage({ type: "loom:session", sessionId: "s-1", levelId: "L01" }, "*"));
  await expect.poll(async () => (await calls(page)).some(call => call.command === "set_game_session" && (call.args as any)?.sessionId === "s-1")).toBe(true);
  await page.evaluate(() => {
    const probe = (window as any).shellProbe;
    probe.env.clientLost = true;
    probe.topics["loom://env"]({ payload: probe.env });
  });
  await expect(page.locator("#client-lost-modal")).toBeVisible();
  await page.locator("#btn-client-reconnect").click();
  expect((await calls(page)).some(call => call.command === "restart_client_and_reconnect")).toBe(true);
  await page.evaluate(() => {
    const probe = (window as any).shellProbe;
    probe.env.clientLost = false;
    probe.topics["loom://env"]({ payload: probe.env });
  });
  await expect(page.locator("#client-lost-modal")).toBeHidden();
  await frame.evaluate(() => parent.postMessage({ type: "loom:session", sessionId: null, levelId: null, previousSessionId: "s-1" }, "*"));
  await expect.poll(async () => (await calls(page)).some(call => call.command === "set_game_session" && (call.args as any)?.sessionId === null)).toBe(true);
});

test("真实 shell：消息桥拒绝伪造来源/命令，退出须确认，恢复伴玩页面", async ({ page }) => {
  await openShell(page);
  const frame = page.frames().find(frame => frame !== page.mainFrame())!;
  await frame.evaluate(() => parent.postMessage({ type: "loom:invoke", id: 1, command: "window_force_close" }, "*"));
  await page.evaluate(() => window.postMessage({ type: "loom:invoke", id: 2, command: "open_logs" }, "*"));
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { source: document.querySelector<HTMLIFrameElement>("iframe")!.contentWindow, origin: "https://untrusted.example", data: { type: "loom:invoke", id: 3, command: "open_logs" } })));
  await frame.evaluate(() => parent.postMessage({ type: "loom:invoke", id: 4, command: "env_state" }, "*"));
  await expect.poll(() => frame.evaluate(() => (window as any).received.some((message: any) => message.type === "loom:invoke-result" && message.id === 4 && message.ok))).toBe(true);
  expect((await calls(page)).some(call => ["window_force_close", "open_logs"].includes(call.command))).toBe(false);
  await page.evaluate(() => (window as any).shellProbe.topics["loom://quit-requested"]({}));
  await expect(page.locator("#quit-modal")).toBeVisible();
  expect((await calls(page)).some(call => call.command === "quit_ack")).toBe(true);
  expect((await calls(page)).some(call => call.command === "quit_game")).toBe(false);
  await page.locator("#btn-quit-cancel").click();
  await expect(page.locator("#quit-modal")).toBeHidden();
  expect((await calls(page)).some(call => call.command === "quit_cancel")).toBe(true);
  await page.evaluate(() => (window as any).shellProbe.topics["loom://quit-requested"]({}));
  await page.locator("#btn-quit-confirm").click();
  expect((await calls(page)).some(call => call.command === "quit_game")).toBe(true);
  await page.evaluate(() => { document.getElementById("quit-modal")!.hidden = true; (window as any).shellProbe.topics["loom://restore-companion"]({}); });
  await expect(page.locator("iframe")).toHaveAttribute("src", /studio\/index\.html/);
  await expect(page.locator("body")).not.toHaveClass(/companion/);
});

test("真实 shell：事件订阅失败仍能初始化和关闭；缩放消息即时下发", async ({ page }) => {
  await openShell(page, true);
  await expect(page.locator("#boot-splash")).toHaveClass(/is-hidden/);
  await page.locator("#btn-settings").click();
  await page.locator("#set-scale").selectOption("1.1");
  const frame = page.frames().find(frame => frame !== page.mainFrame())!;
  await expect.poll(() => frame.evaluate(() => (window as any).received.some((message: any) => message.type === "loom:scale" && message.scale === 1.1))).toBe(true);
  await page.locator("#btn-close-settings").click();
  await page.locator("#btn-win-close").click();
  expect((await calls(page)).some(call => call.command === "window_close")).toBe(true);
});

test("跨源 Studio 接收父壳缩放，不刷新页面", async ({ page }) => {
  // 静态服务器只监听 IPv4；代理 localhost 请求，浏览器端仍保持两个不同 origin。
  await page.route("http://localhost:5186/**", async route => {
    const response = await route.fetch({ url: route.request().url().replace("http://localhost:5186", "http://127.0.0.1:5186") });
    await route.fulfill({ response });
  });
  await page.route("**/__zoom-shell", route => route.fulfill({ contentType: "text/html", body: '<iframe src="http://localhost:5186/?scale=0.8" style="width:1200px;height:800px"></iframe>' }));
  await page.goto("/__zoom-shell");
  const iframe = page.frameLocator("iframe");
  await expect(iframe.getByTestId("prologue-overlay")).toBeVisible();
  await page.locator("iframe").evaluate((el: HTMLIFrameElement) => el.contentWindow!.postMessage({ type: "loom:scale", scale: 1.1 }, "*"));
  await expect.poll(async () => page.frames().find(frame => frame.url().startsWith("http://localhost:5186/"))!.evaluate(() => document.documentElement.style.zoom)).toBe("1.1");
  await expect(iframe.getByTestId("prologue-overlay")).toBeVisible();
});

test("静止壳状态不重复下发；时间戳变化不触发 Studio 更新", async ({ page }) => {
  await openShell(page);
  const frame = page.frames().find(frame => frame !== page.mainFrame())!;
  const messages = () => frame.evaluate(() => (window as any).received.filter((event: any) => event.type === "loom:env").length);
  await expect.poll(messages).toBeGreaterThan(0);
  const before = await messages();
  await page.evaluate(async () => {
    const probe = (window as any).shellProbe;
    for (let index = 0; index < 10; index++) {
      probe.env.updatedAt = index;
      window.dispatchEvent(new Event("loom:status"));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  });
  await frame.evaluate(() => new Promise(requestAnimationFrame));
  expect(await messages()).toBe(before);
  await page.evaluate(() => {
    const probe = (window as any).shellProbe;
    probe.env.bot.detail = "new bot status";
    probe.topics["loom://env"]({ payload: probe.env });
  });
  await expect.poll(messages).toBe(before + 1);
});

test("启动页自动刷新只读灯态，不定时重跑版本检测", async ({ page }) => {
  await page.clock.install();
  await openShell(page, false, true);
  const probeCount = async () => (await calls(page)).filter(call => call.command === "env_probe").length;
  await expect.poll(probeCount).toBe(1);
  await page.clock.fastForward(30_000);
  await expect.poll(async () => (await calls(page)).filter(call => call.command === "env_state").length).toBeGreaterThan(1);
  expect(await probeCount()).toBe(1);
  const frame = page.frameLocator("iframe");
  await frame.locator("#btn-probe").click();
  await expect.poll(probeCount).toBe(2);
});
