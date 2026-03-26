import pino from 'pino';

export function createLogger(level: pino.Level = 'info') {
  return pino({
    level,
    base: null
  });
}
