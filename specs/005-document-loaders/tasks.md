# Tasks: Document Loaders

Each task is implemented with red/green TDD, then reviewed, then committed.

- [x] **T1 Loader core.** Copy and adapt the loader contract, matching, registry, importer, sidecar client and registry builder. Also the configuration schema and loader, the text rendering and the attachment store. Unit tests only. No wiring into the server. See `plan.md` sections 1, 3 and 4.
- [x] **T2 Schema and configuration.** Migration `019`, the five environment variables in `src/config.ts`, Docker and `.env.example` updates, and a schema integration test. See `plan.md` sections 2, 3 and 9.
- [x] **T3 Ingest and attachment API.** The ingest service, the three REST routes, the new entity response fields, and contract tests. See `plan.md` sections 5 and 6.
- [x] **T4 Worker loading stage.** The loading stage in the enrichment worker, the wiring in `src/index.ts`, and integration tests with a fake loader. See `plan.md` section 7.
- [x] **T5 PDF loader.** The `packages/loader-pdf` workspace, the built-in default registration, the Dockerfile change, and the end-to-end test with a PDF fixture. See `plan.md` sections 8 and 9.
- [ ] **T6 CLI and operations.** `pgm ingest`, `pgm-admin attachments gc`, README and deployment documentation, and the full test suite.
- [ ] **T7 Final review.** Review of the whole branch, then the pull request that replaces #38.
