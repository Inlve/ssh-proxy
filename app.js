// **BEFORE RUNNING THIS SCRIPT:**
//   1. The server portion is best run on non-Windows systems because they have
//      terminfo databases which are needed to properly work with different
//      terminal types of client connections
//   2. Install `blessed`: `npm install blessed`
//   3. Create a server host key in this same directory and name it `host.key`
"use strict";

const path = require("path");
const process = require("process");
const { readFileSync } = require("fs");

const blessed = require("blessed");
const isRoot = require("is-root");
const { Server } = require("ssh2");

const logger = require("./logger");

const RE_SPECIAL =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x1F\x7F]+|(?:\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[m|K])/g;
const MAX_MSG_LEN = 128;
const MAX_NAME_LEN = 10;
const PROMPT_NAME = `Enter a nickname to use (max ${MAX_NAME_LEN} chars): `;

const users = [];

function formatMessage(msg, output) {
  output.parseTags = true;
  msg = output._parseTags(msg);
  output.parseTags = false;
  return msg;
}

function userBroadcast(msg, source) {
  const sourceMsg = `> ${msg}`;
  const name = `{cyan-fg}{bold}${source.name}{/}`;
  msg = `: ${msg}`;
  for (const user of users) {
    const output = user.output;
    if (source === user) output.add(sourceMsg);
    else output.add(formatMessage(name, output) + msg);
  }
}

function localMessage(msg, source) {
  const output = source.output;
  output.add(formatMessage(msg, output));
}

function noop(v) {}

function checkAuth() {
  if (!isRoot()) {
    throw new Error("Please try root run app!");
  }
}

function loadHostKeys() {
  console.log(">>> load host keys");

  checkAuth();

  const dir = "/etc/ssh";
  const keys = [
    "ssh_host_dsa_key",
    "ssh_host_ecdsa_key",
    "ssh_host_ed25519_key",
    "ssh_host_rsa_key",
  ];

  return keys.map((key) => {
    return readFileSync(path.join(dir, key));
  });
}

function createServer() {
  return new Server(
    {
      hostKeys: loadHostKeys(),
    },
    (client) => {
      let stream;
      let name;

      client
        .on("authentication", (ctx) => {
          let nick = ctx.username;
          let prompt = PROMPT_NAME;
          let lowered;

          // Try to use username as nickname
          if (nick.length > 0 && nick.length <= MAX_NAME_LEN) {
            // 将名称 转小写
            lowered = nick.toLowerCase();
            let ok = true;
            // 遍历当前已经添加的用户
            for (const user of users) {
              // 如果存在用户跟当前登录的用户相同
              if (user.name.toLowerCase() === lowered) {
                ok = false;
                prompt = `That nickname is already in use.\n${PROMPT_NAME}`;
                break;
              }
            }

            // 如果登录的用户不在当前存在的用户中
            if (ok) {
              name = nick;
              // 同意登录
              return ctx.accept();
            }
          } else if (nick.length === 0) {
            // 如果登录的用户名为空， 提示必填
            prompt = "A nickname is required.\n" + PROMPT_NAME;
          } else {
            // 登录的用户名太长
            prompt = "That nickname is too long.\n" + PROMPT_NAME;
          }

          // 如果登录的方式不是键盘交互（keyboard-interactive）
          console.log(`method: %s`, ctx.method);
          if (ctx.method !== "keyboard-interactive")
            return ctx.reject(["keyboard-interactive"]);

          // 提示用户
          ctx.prompt(prompt, function retryPrompt(answers) {
            console.log(`answers: %o`, answers);
            if (answers.length === 0)
              return ctx.reject(["keyboard-interactive"]);
            nick = answers[0];
            // 如果用户名超出长度限制继续提示
            if (nick.length > MAX_NAME_LEN) {
              return ctx.prompt(
                `That nickname is too long.\n${PROMPT_NAME}`,
                retryPrompt
              );
            } else if (nick.length === 0) {
              // 如果用户名为空，继续提示
              return ctx.prompt(
                `A nickname is required.\n${PROMPT_NAME}`,
                retryPrompt
              );
            }
            lowered = nick.toLowerCase();
            // 如果登录用户已存在则继续提示
            for (const user of users) {
              if (user.name.toLowerCase() === lowered) {
                return ctx.prompt(
                  `That nickname is already in use.\n${PROMPT_NAME}`,
                  retryPrompt
                );
              }
            }
            name = nick;
            ctx.accept();
          });
        })
        .on("ready", () => {
          let rows;
          let cols;
          let term;
          client.once("session", (accept, reject) => {
            accept()
              .once("pty", (accept, reject, info) => {
                rows = info.rows;
                cols = info.cols;
                term = info.term;
                accept && accept();
              })
              .on("window-change", (accept, reject, info) => {
                rows = info.rows;
                cols = info.cols;
                if (stream) {
                  stream.rows = rows;
                  stream.columns = cols;
                  stream.emit("resize");
                }
                accept && accept();
              })
              .once("shell", (accept, reject) => {
                stream = accept();
                users.push(stream);

                stream.name = name;
                stream.rows = rows || 24;
                stream.columns = cols || 80;
                stream.isTTY = true;
                stream.setRawMode = noop;
                stream.on("error", noop);

                const screen = new blessed.screen({
                  autoPadding: true,
                  smartCSR: true,
                  program: new blessed.program({
                    input: stream,
                    output: stream,
                  }),
                  terminal: term || "ansi",
                });

                screen.title = "SSH Chatting as " + name;
                // Disable local echo
                screen.program.attr("invisible", true);

                const output = (stream.output = new blessed.log({
                  screen: screen,
                  top: 0,
                  left: 0,
                  width: "100%",
                  bottom: 2,
                  scrollOnInput: true,
                }));
                screen.append(output);

                screen.append(
                  new blessed.box({
                    screen: screen,
                    height: 1,
                    bottom: 1,
                    left: 0,
                    width: "100%",
                    type: "line",
                    ch: "=",
                  })
                );

                const input = new blessed.textbox({
                  screen: screen,
                  bottom: 0,
                  height: 1,
                  width: "100%",
                  inputOnFocus: true,
                });
                screen.append(input);

                input.focus();

                // Local greetings
                localMessage(
                  "{blue-bg}{white-fg}{bold}Welcome to SSH Chat!{/}\n" +
                    "There are {bold}" +
                    (users.length - 1) +
                    "{/} other user(s) connected.\n" +
                    "Type /quit or /exit to exit the chat.",
                  stream
                );

                // Let everyone else know that this user just joined
                for (const user of users) {
                  const output = user.output;
                  if (user === stream) continue;
                  output.add(
                    formatMessage("{green-fg}*** {bold}", output) +
                      name +
                      formatMessage("{/bold} has joined the chat{/}", output)
                  );
                }

                screen.render();
                // XXX This fake resize event is needed for some terminals in order to
                // have everything display correctly
                screen.program.emit("resize");

                // Read a line of input from the user
                input.on("submit", (line) => {
                  input.clearValue();
                  screen.render();
                  if (!input.focused) input.focus();
                  line = line.replace(RE_SPECIAL, "").trim();
                  if (line.length > MAX_MSG_LEN)
                    line = line.substring(0, MAX_MSG_LEN);
                  if (line.length > 0) {
                    if (line === "/quit" || line === "/exit") stream.end();
                    else userBroadcast(line, stream);
                  }
                });
              });
          });
        })
        .on("close", () => {
          if (stream !== undefined) {
            users.splice(users.indexOf(stream), 1);
            // Let everyone else know that this user just left
            for (const user of users) {
              const output = user.output;
              output.add(
                formatMessage("{magenta-fg}*** {bold}", output) +
                  name +
                  formatMessage("{/bold} has left the chat{/}", output)
              );
            }
          }
        })
        .on("error", (err) => {
          // Ignore errors
        });
    }
  ).listen(
    8888,
    /** @this {Server} */
    function () {
      if (process.send) process.send("ready");
      const address = this.address();
      if (address && typeof address !== "string") {
        logger.info("listening on port %s", address.port);
      }
    }
  );
}

createServer();
