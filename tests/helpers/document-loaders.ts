import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FilesystemAttachmentStore } from '../../src/services/loaders/attachment-store.js';
import {
  LoaderRegistry,
  type RegisteredLoader
} from '../../src/services/loaders/registry.js';
import type { DocumentLoader } from '../../src/types/loader.js';
import type { InProcessLoaderConfig } from '../../src/types/loaders-config.js';

/** A real registry holding one in-memory loader that accepts PDF and text. */
export function createFakeRegistry(): LoaderRegistry {
  const accepts = {
    mimeTypes: ['application/pdf', 'text/plain'],
    extensions: ['.pdf', '.txt']
  };
  const loader: DocumentLoader = {
    name: 'fake',
    version: '0.0.1',
    accepts,
    load: () => Promise.resolve({ documentType: 'fake', blocks: [] })
  };
  const config = {
    kind: 'in-process' as const,
    name: 'fake',
    package: '@x/fake',
    accepts,
    priority: 0,
    options: {},
    enabled: true
  } as InProcessLoaderConfig;
  const entry: RegisteredLoader = {
    loader,
    config,
    enabled: true,
    status: 'ok'
  };
  return new LoaderRegistry([entry]);
}

export type TempStore = {
  root: string;
  store: FilesystemAttachmentStore;
  cleanup: () => Promise<void>;
};

export async function createTempStore(): Promise<TempStore> {
  const root = await mkdtemp(path.join(tmpdir(), 'pgm-attachments-'));
  return {
    root,
    store: new FilesystemAttachmentStore(root),
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}
