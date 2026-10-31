// @ts-nocheck
// Real-MC e2e for L08 — reference solution + player beat + production grading + Mock digest comparison.
import { L08Content } from "../content/levels/L08.content";
import { runRealLevel } from "./real-harness";

await runRealLevel({ name: "l8", content: L08Content });
