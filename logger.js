const winston = require("winston");
const { format } = require("winston");

const normalizeMessage = format.printf(function (info) {
  const { level, timestamp, message } = info;
  return `${timestamp} [${level.toUpperCase()}] ${message}`;
});

const filterLevel = format(function (info, opts) {
  const { allow } = opts;

  if (allow && !allow.includes(info.level)) {
    return false;
  }

  return info;
});

const logger = winston.createLogger({
  level: "info",
  // format: format.json(),
  format: format.combine(
    format.splat(),
    format.simple(),
    format.timestamp(),
    normalizeMessage
  ),
  transports: [
    //
    // - Write all logs with importance level of `error` or less to `error.log`
    // - Write all logs with importance level of `info` or less to `combined.log`
    //
    new winston.transports.File({
      filename: "error.log",
      level: "error",
      dirname: "logs",
    }),
    new winston.transports.File({
      filename: "out.log",
      level: "info",
      dirname: "logs",
      format: filterLevel({
        allow: ["info", "warn"],
      }),
    }),
  ],
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      level: "info",
    })
  );
}

console.log(process.env.NODE_ENV);

module.exports = logger;
