// @ts-nocheck
// T2 real-MC e2e for L02 (会数数的织偶): derived scene + reference solution + testMode playerBeat
// + production grading (3 stars) + MockWorld report/digest comparison + REQ-EPOCH + REQ-RESET-01.
import { L02Content } from "../content/levels/L02.content";
import { runRealLevel } from "./real-harness";

await runRealLevel({ name: "l2", content: L02Content });
