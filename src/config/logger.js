const { createLogger, format, transports } = require("winston");

const logLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

const level = (process.env.NODE_ENV === "production")? 'info': 'trace'

const logger = createLogger({
  level,
  levels: logLevels,
  transports: [new transports.Console({level})],
});

module.exports = logger