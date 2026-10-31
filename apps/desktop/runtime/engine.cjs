#!/usr/bin/env node
"use strict";
// T3 spike：CJS 启动器把入口指到 engine.mjs（ESM 支持 top-level await），再动态 import。
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const entry = path.join(__dirname, "engine.mjs");
process.argv[1] = entry;
import(pathToFileURL(entry).href).catch(error => {
  console.error("[loom-engine] 启动失败：", error && error.stack ? error.stack : error);
  process.exit(1);
});
