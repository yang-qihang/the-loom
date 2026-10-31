// @ts-nocheck
// Real-MC e2e for L09 — reference solution + player beat + production grading + Mock digest comparison.
import { L09Content } from "../content/levels/L09.content";
import { runRealLevel } from "./real-harness";

await runRealLevel({ name: "l9", content: L09Content });
