// @ts-nocheck
// Real-MC e2e for L06 — reference solution + player beat + production grading + Mock digest comparison.
import { L06Content } from "../content/levels/L06.content";
import { runRealLevel } from "./real-harness";

await runRealLevel({ name: "l6", content: L06Content });
