// @ts-nocheck
// T2 real-MC e2e for L04 (麦田的咒语): derived scene + reference solution + testMode playerBeat
// + production grading (3 stars) + MockWorld report/digest comparison + REQ-EPOCH + REQ-RESET-01.
import { L04Content } from "../content/levels/L04.content";
import { runRealLevel } from "./real-harness";

await runRealLevel({ name: "l4", content: L04Content });
