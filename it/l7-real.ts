// @ts-nocheck
// Real-MC e2e for L07 — reference solution + player beat + production grading + Mock digest comparison.
import { L07Content } from "../content/levels/L07.content";
import { runRealLevel } from "./real-harness";

await runRealLevel({ name: "l7", content: L07Content });
