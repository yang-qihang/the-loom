import { chromium } from '../../apps/studio/node_modules/@playwright/test/index.mjs';
import { writeFileSync } from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
await page.addInitScript(()=>{
 window.rangeReads=0;
 const original=Range.prototype.getClientRects;
 Range.prototype.getClientRects=function(){window.rangeReads++;return original.call(this);};
});
await page.goto('http://127.0.0.1:5193/?scale=0.8');
await page.getByTestId('prologue-overlay').waitFor();
await page.evaluate(()=>document.fonts.ready);
await page.evaluate(()=>new Promise(requestAnimationFrame));
const result=await page.evaluate(async()=>{
 window.rangeReads=0;
 document.fonts.dispatchEvent(new Event('loadingdone'));
 await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
 return {engine:navigator.userAgent,rangeReads:window.rangeReads,paragraphs:document.querySelectorAll('.stage-lines-text p').length};
});
writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(result);
await browser.close();
