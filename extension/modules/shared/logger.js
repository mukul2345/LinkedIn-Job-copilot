// logger.js - Structured logging with defensive sensitive-data redaction.

// eslint-disable-next-line no-var
var ExtensionLogger = (function () {
  const SENSITIVE_KEY = /token|password|secret|authorization|email|phone|resume|profile|candidate|answer/i;

  function redact(value, depth = 0) {
    if (depth > 4) return '[REDACTED]';
    if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    const copy = {};
    Object.keys(value).forEach(key => {
      copy[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(value[key], depth + 1);
    });
    return copy;
  }

  function write(level, message, metadata) {
    const safeMessage = typeof message === 'string' ? message.slice(0, 300) : 'Extension event.';
    const safeMetadata = redact(metadata || {});
    const sink = console[level] || console.log;
    sink.call(console, `[JobPilot] ${safeMessage}`, safeMetadata);
  }

  return Object.freeze({
    redact,
    debug(message, metadata) { write('debug', message, metadata); },
    info(message, metadata) { write('info', message, metadata); },
    warn(message, metadata) { write('warn', message, metadata); },
    error(message, metadata) { write('error', message, metadata); },
  });
})();
