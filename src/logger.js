/**
 * logger.js — simple leveled, colorized logger for the AI gateway.
 *
 * Levels (lowest → highest severity):
 *   debug  — verbose tracing, disabled by default
 *   info   — normal operational messages       [default]
 *   warn   — recoverable issues worth noting
 *   error  — failures that need attention
 *
 * Set LOG_LEVEL=debug|info|warn|error in env to control verbosity.
 * info → stderr for error, stdout for everything else.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const COLORS = {
  debug: '\x1b[90m',  // grey
  info:  '\x1b[36m',  // cyan
  warn:  '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
};
const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';

// Resolve configured level; fall back to 'info'
const configuredLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function log(level, ...args) {
  if (LEVELS[level] < configuredLevel) return;

  const ts    = new Date().toISOString();
  const color = COLORS[level] || '';
  const label = `${BOLD}${color}${level.toUpperCase().padEnd(5)}${RESET}`;

  const message = args
    .map((a) => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');

  const line = `${color}[${ts}]${RESET} ${label} ${message}`;
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(line + '\n');
}

module.exports = {
  debug: (...a) => log('debug', ...a),
  info:  (...a) => log('info',  ...a),
  warn:  (...a) => log('warn',  ...a),
  error: (...a) => log('error', ...a),

  /** Morgan-compatible write stream — strips trailing newline Morgan adds. */
  stream: {
    write: (msg) => log('info', msg.trimEnd()),
  },
};
