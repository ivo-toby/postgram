import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AttachmentDraft } from '../../types/loader.js';

/**
 * Stores attachment bytes on local disk under `attachmentsDir`. The
 * `storage_uri` returned is opaque to the database; today it's a `file://`
 * path, tomorrow it could be an `s3://` URI.
 *
 * Files are content-addressed by sha256 with a two-character fan-out so a
 * single directory doesn't accumulate millions of files:
 *   attachmentsDir/ab/abcdef...01.bin
 */
export interface AttachmentStore {
  put(draft: AttachmentDraft): Promise<PersistedAttachment>;
}

export type PersistedAttachment = {
  ref: string;
  kind: AttachmentDraft['kind'];
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageUri: string;
  metadata: Record<string, unknown>;
};

export class FilesystemAttachmentStore implements AttachmentStore {
  constructor(private readonly attachmentsDir: string) {}

  async put(draft: AttachmentDraft): Promise<PersistedAttachment> {
    const bytes = await materialiseBytes(draft);
    const sha = sha256Hex(bytes);
    const target = path.join(
      this.attachmentsDir,
      sha.slice(0, 2),
      `${sha}.bin`,
    );
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'w' });

    return {
      ref: draft.ref,
      kind: draft.kind,
      mimeType: draft.mimeType,
      byteSize: bytes.byteLength,
      sha256: sha,
      storageUri: `file://${target}`,
      metadata: draft.metadata ?? {},
    };
  }
}

async function materialiseBytes(draft: AttachmentDraft): Promise<Uint8Array> {
  if (draft.source.kind === 'bytes') return draft.source.bytes;
  return new Uint8Array(await readFile(draft.source.path));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
