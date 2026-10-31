import type { LevelContent } from "../../../packages/worldport/src/index";
import { L01Content } from "../../../content/levels/L01.content";
import { L02Content } from "../../../content/levels/L02.content";
import { L03Content } from "../../../content/levels/L03.content";
import { L04Content } from "../../../content/levels/L04.content";
import { L08Content } from "../../../content/levels/L08.content";
import { L09Content } from "../../../content/levels/L09.content";
import { L07Content } from "../../../content/levels/L07.content";
import { L06Content } from "../../../content/levels/L06.content";
import { L05Content } from "../../../content/levels/L05.content";
import { L10Content } from "../../../content/levels/L10.content";

/**
 * T1 关卡目录：Engine 启动时静态注册。
 * 其他关卡由内容线提供 `content/levels/LXX.content.ts` 后在此追加（只加一行 import）。
 */
const CATALOG: LevelContent[] = [L01Content, L02Content, L03Content, L04Content, L05Content, L06Content, L07Content, L08Content, L09Content, L10Content];

export function listLevels(): Array<{ id: string; title: string; act: number; order: number; priority: string }> {
  return CATALOG.map(content => ({
    id: content.def.id,
    title: content.def.meta.title.zh,
    act: content.def.meta.act,
    order: content.def.meta.order,
    priority: content.def.meta.priority,
  }));
}

export function findLevelContent(id: string): LevelContent | undefined {
  return CATALOG.find(content => content.def.id === id);
}
