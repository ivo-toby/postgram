// Postgram pi extension.
//
// No dependency on pi packages: it declares the few members it uses and
// shells out to `pgm here` so there is one code path. `pgm hooks install --pi`
// copies this file into the pi extensions directory and replaces the
// PGM_NODE / PGM_SCRIPT placeholders with absolute paths.

type Ctx = {
  cwd: string;
  sessionManager: { getSessionId(): string };
};

type Pi = {
  on(event: string, handler: (event: unknown, ctx: Ctx) => unknown): void;
  exec(
    command: string,
    args: string[],
    options: { timeout: number }
  ): Promise<unknown>;
};

const PGM_NODE: string = '__PGM_NODE__';
const PGM_SCRIPT: string = '__PGM_SCRIPT__';

const ACTIVITY_THROTTLE_MS = 60_000;
let lastActivityAt = 0;

function hereArgs(event: string, ctx: Ctx): string[] {
  return [
    PGM_SCRIPT,
    'here',
    '--agent',
    'pi',
    '--session-id',
    ctx.sessionManager.getSessionId(),
    '--event',
    event,
    '--cwd',
    ctx.cwd,
    '--quiet'
  ];
}

function fire(pi: Pi, event: string, ctx: Ctx): void {
  void pi
    .exec(PGM_NODE, hereArgs(event, ctx), { timeout: 5000 })
    .catch(() => undefined);
}

export default function postgram(pi: Pi): void {
  pi.on('session_start', (_event, ctx) => {
    fire(pi, 'start', ctx);
  });

  pi.on('turn_end', (_event, ctx) => {
    const now = Date.now();
    if (now - lastActivityAt < ACTIVITY_THROTTLE_MS) {
      return;
    }
    lastActivityAt = now;
    fire(pi, 'activity', ctx);
  });

  pi.on('agent_settled', (_event, ctx) => {
    fire(pi, 'stop', ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    await pi
      .exec(PGM_NODE, hereArgs('end', ctx), { timeout: 5000 })
      .catch(() => undefined);
  });
}
