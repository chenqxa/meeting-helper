const { AsyncLocalStorage, AsyncResource } = require('node:async_hooks'); globalThis.AsyncLocalStorage = AsyncLocalStorage; globalThis.AsyncResource = AsyncResource;
