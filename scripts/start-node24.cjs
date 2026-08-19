// Next 16.1.1 兼容补丁：强制注入 globalThis.AsyncLocalStorage
// （Next 检测 globalThis.AsyncLocalStorage，某些 Node/镜像里未挂全局，导致启动崩溃）
const path = require('node:path');
const { AsyncLocalStorage, AsyncResource } = require('node:async_hooks');
// 强制注入（不判断是否已存在，确保 Next 检测一定命中）
globalThis.AsyncLocalStorage = AsyncLocalStorage;
globalThis.AsyncResource = AsyncResource;
console.log('[start-patch] AsyncLocalStorage 已注入，启动服务...');
require(path.join(__dirname, '..', 'dist', 'server.js'));
