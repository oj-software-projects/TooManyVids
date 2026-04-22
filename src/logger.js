const fs = require('fs');
const path = require('path');

const MAX_FILES = 10;
const MAX_SIZE = 10 * 1024 * 1024;

class Logger {
  constructor(name) {
    this.name = name;
    const logDir = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.toomanyvids', 'logs');
    try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
    this.logDir = logDir;
    this.logFile = path.join(logDir, 'app.log');
    this._ensureFile();
  }

  _ensureFile() {
    try {
      if (!fs.existsSync(this.logFile)) {
        fs.writeFileSync(this.logFile, '');
      }
    } catch (_) {}
  }

  _rotate() {
    try {
      const stat = fs.statSync(this.logFile);
      if (stat.size < MAX_SIZE) return;

      for (let i = MAX_FILES - 1; i > 0; i--) {
        const oldFile = path.join(this.logDir, `app.${i}.log`);
        const newFile = path.join(this.logDir, `app.${i + 1}.log`);
        if (fs.existsSync(oldFile)) {
          if (i === MAX_FILES - 1) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }
      fs.renameSync(this.logFile, path.join(this.logDir, 'app.1.log'));
      fs.writeFileSync(this.logFile, '');
    } catch (_) {}
  }

  _write(level, msg, meta) {
    this._rotate();
    const ts = new Date().toISOString();
    let line = `[${ts}] [${level}] [${this.name}] ${msg}`;
    if (meta !== undefined) {
      try {
        line += ' ' + JSON.stringify(meta);
      } catch (_) {
        line += ' ' + String(meta);
      }
    }
    try {
      fs.appendFileSync(this.logFile, line + '\n');
    } catch (_) {}
    if (level === 'ERROR') {
      console.error(line);
    } else if (level === 'WARN') {
      console.warn(line);
    }
  }

  info(msg, meta) { this._write('INFO', msg, meta); }
  warn(msg, meta) { this._write('WARN', msg, meta); }
  error(msg, meta) { this._write('ERROR', msg, meta); }
  debug(msg, meta) { this._write('DEBUG', msg, meta); }
}

const loggers = {};
function getLogger(name) {
  if (!loggers[name]) {
    loggers[name] = new Logger(name);
  }
  return loggers[name];
}

module.exports = { Logger, getLogger };
