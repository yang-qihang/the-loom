// @ts-nocheck
// Real-MC e2e for L05 — reference solution + player beat + production grading + Mock digest comparison.
import { L05Content } from "../content/levels/L05.content";
import { runRealLevel } from "./real-harness";

await runRealLevel({ name: "l5", content: L05Content });
