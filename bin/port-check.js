"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createConnection } = require("node:net");

const DEFAULT_TIMEOUT_MS = 2_000;

function checkPortAvailable(port, host, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve();
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      const err = new Error(
        `Port ${port} is already in use on ${host}. ` +
          "Stop the existing process or choose a different port with --port.",
      );
      err.code = "EADDRINUSE";
      reject(err);
    });

    socket.once("error", (err) => {
      clearTimeout(timer);
      socket.destroy();
      if (err.code === "ECONNREFUSED") {
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

module.exports = { checkPortAvailable };
