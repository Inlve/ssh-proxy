/**
 * @description 应用引导程序
 */
const process = require("process");
const { spawn } = require("child_process");

const logger = require('./logger');

/**
 * 标准输入/标准输出配置
 * @typedef StdioOpts
 * @property {boolean} [stdioString] - 以字符串而不是缓冲区的形式返回标准输入/标准输出
 * @property {string} stdio
 */

/**
 * 执行结果
 * @template {string} T
 * @template {ReadonlyArray<string>} P
 *
 * @typedef SpawnResult
 * @property {T} cmd - 执行的命令
 * @property {P} [args] - 执行命令的参数
 * @property {(number|null)} code - 执行结果退出代码
 * @property {(string|null)} signal - 执行结果退出信号
 * @property {(string|Buffer|null)} stdout - 执行结果
 * @property {(string|Buffer|null)} stderr - 执行异常
 */

/**
 * 是否为pipe
 * @param {string} stdio
 * @param {number} fd
 * @returns {boolean}
 */
function isPipe(stdio = "pipe", fd) {
  return stdio === "pipe" || stdio === null
    ? true
    : Array.isArray(stdio)
    ? isPipe(stdio[fd], fd)
    : false;
}

/**
 *
 * @param {Buffer[]} stdout
 * @param {Buffer[]} stderr
 * @param {StdioOpts} [opts]
 * @returns
 */
function stdioResult(stdout, stderr, opts) {
  const { stdioString, stdio } = opts || {};
  return stdioString
    ? {
        stdout: isPipe(stdio, 1) ? Buffer.concat(stdout).toString() : null,
        stderr: isPipe(stdio, 2) ? Buffer.concat(stderr).toString() : null,
      }
    : {
        stdout: isPipe(stdio, 1) ? Buffer.concat(stdout) : null,
        stderr: isPipe(stdio, 2) ? Buffer.concat(stderr) : null,
      };
}

/**
 * promise版的spawn
 * @template {string} T
 * @template {ReadonlyArray<string>} P
 * @param {T} cmd
 * @param {P} [args]
 * @param {import('child_process').SpawnOptions & StdioOpts} [opts]
 * @param {Record<string, any>} [extra]
 * @returns {Promise<SpawnResult<T, P>>}
 * @throws {Error & SpawnResult<T, P>}
 */
function promiseSpawn(cmd, /** @type {P} */ args, opts, extra = {}) {
  return new Promise((res, rej) => {
    /** @type {import('child_process').ChildProcess} */
    const proc = spawn(cmd, args || [], opts || {});
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];

    const reject = (
      /** @type {Error} */
      er
    ) =>
      rej(
        Object.assign(er, {
          cmd,
          args,
          ...stdioResult(stdout, stderr, opts),
          ...extra,
        })
      );
    proc.on("error", reject);
    if (proc.stdout) {
      proc.stdout
        .on(
          "data",
          (
            /** @type {Buffer} */
            c
          ) => {
            stdout.push(c);
          }
        )
        .on("error", reject);
      proc.stdout.on("error", (er) => reject(er));
    }
    if (proc.stderr) {
      proc.stderr.on("data", (c) => stderr.push(c)).on("error", reject);
      proc.stderr.on("error", (er) => reject(er));
    }
    proc.on("close", (code, signal) => {
      /** @type {SpawnResult<T, P>} */
      const result = {
        cmd,
        args,
        code,
        signal,
        ...stdioResult(stdout, stderr, opts),
        ...extra,
      };
      if (code || signal) {
        rej(Object.assign(new Error("command failed"), result));
      } else {
        res(result);
      }
    });
  });
}

function start() {
  return promiseSpawn("sudo", ["node", "app.js"], {
    stdio: "inherit",
  })
    .then((result) => {
      console.log(`stdout: %s`, result.stdout);
    })
    .catch(
      (
        /** @type {Error & SpawnResult<'sudo', {}>} */
        err
      ) => {
        console.error(err);
        console.log(`stderr: %s`, err.stderr);
      }
    );
}

(async function () {
  logger.info('>>> start app <<<');
  await start();
})();
