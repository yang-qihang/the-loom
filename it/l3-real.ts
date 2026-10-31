// @ts-nocheck
// T2 real-MC e2e for L03 (岔路与钟声): derived scene + reference solution + testMode playerBeat
// + production grading (3 stars) + MockWorld report/digest comparison + REQ-EPOCH + REQ-RESET-01.
import { L03Content } from "../content/levels/L03.content";
import { runRealLevel } from "./real-harness";

await runRealLevel({ name: "l3", content: L03Content });
