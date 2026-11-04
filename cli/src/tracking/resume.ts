// cli/src/tracking/resume.ts
import { shq } from './config.js';
import type { ResumeTemplates } from './config.js';
import type { WorkspaceView } from './types.js';

export function resumeDirectory(workspace: WorkspaceView): string {
  const cwd = workspace.resume_session?.cwd ?? null;
  if (cwd !== null && (cwd === workspace.path || cwd.startsWith(`${workspace.path}/`))) {
    return cwd;
  }
  return workspace.path;
}

export function isTranscriptGone(
  workspace: WorkspaceView,
  localAlias: string,
  exists: (file: string) => boolean
): boolean {
  const session = workspace.resume_session;
  return (
    workspace.machine === localAlias &&
    session !== null &&
    session.agent_kind === 'claude-code' &&
    session.transcript_path !== null &&
    !exists(session.transcript_path)
  );
}

export function renderResume(
  workspace: WorkspaceView,
  input: { localAlias: string; templates: ResumeTemplates; transcriptGone: boolean }
): string {
  const session = workspace.resume_session;
  const first = workspace.sessions[0];
  const kind = session?.agent_kind ?? first?.agent_kind ?? 'claude-code';
  const withId = session ? input.templates[session.agent_kind].with_id : null;
  const tpl =
    session !== null && withId !== null && !input.transcriptGone
      ? withId.replaceAll('{session_id}', shq(session.agent_session_id))
      : input.templates[kind].without_id;
  const local = `cd ${shq(resumeDirectory(workspace))}${tpl ? ` && ${tpl}` : ''}`;
  if (workspace.machine === input.localAlias) {
    return local;
  }
  return `ssh -t ${workspace.connect_target} ${shq(local)}`;
}

export function formatAge(fromIso: string, now: Date): string {
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(fromIso));
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.floor(elapsedMs / 86_400_000)}d`;
}
