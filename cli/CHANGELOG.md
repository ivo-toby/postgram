## [1.13.0](https://github.com/ivo-toby/postgram/compare/cli-v1.12.0...cli-v1.13.0) (2026-04-23)

### Features

* **extraction-service:** enhance LLM caller to accept an optional schema parameter for structured outputs ([0cdd604](https://github.com/ivo-toby/postgram/commit/0cdd604d3dcedb0c40be2797398e3fe9e973e573))
* **ui:** add favicon and wire postgram logo into the web UI ([7b87d84](https://github.com/ivo-toby/postgram/commit/7b87d84f99045665c2547c880865261a47faa4e2))

### Bug Fixes

* **extraction:** require target_type in structured-output schema ([45cfd16](https://github.com/ivo-toby/postgram/commit/45cfd1690ae5aedd85d279db27c0615d6d13d6f8))

## [1.12.0](https://github.com/ivo-toby/postgram/compare/cli-v1.11.0...cli-v1.12.0) (2026-04-23)

### Features

* **extraction:** EXTRACTION_DISABLE_THINKING env + ollama think:false ([70ac069](https://github.com/ivo-toby/postgram/commit/70ac0698971bcb6a46dd5a6b281992b6ffc53354))

## [1.11.0](https://github.com/ivo-toby/postgram/compare/cli-v1.10.0...cli-v1.11.0) (2026-04-23)

### Features

* **web-ui:** WYSIWYG editor, resizable sidebars, projector/graph UX fixes ([a7fed8c](https://github.com/ivo-toby/postgram/commit/a7fed8c2b154334f013eb30bbfdf0b86cf447e25))

## [1.10.0](https://github.com/ivo-toby/postgram/compare/cli-v1.9.0...cli-v1.10.0) (2026-04-23)

### Features

* **projector:** add 3D embedding projector page ([92f5a64](https://github.com/ivo-toby/postgram/commit/92f5a64e5d78ec17d8ee453b944d74a306c5839c))
* **ui:** shared entityTitle helper; projector shows embedding data ([08ded89](https://github.com/ivo-toby/postgram/commit/08ded898ab2d4e8a760f84ed13b94bed2aeeff10))
* **web-ui:** search-as-editor with WYSIWYG markdown, task metadata, advanced linking ([37a471e](https://github.com/ivo-toby/postgram/commit/37a471e4db1a56b02a5a3819793914f059a95658))

### Bug Fixes

* **projector:** clicks on points now select reliably ([5a217a6](https://github.com/ivo-toby/postgram/commit/5a217a667c7d41d7fb30e1f218475a8923cf988a))
* **projector:** detect taps at the DOM wrapper so OrbitControls can't eat them ([105db43](https://github.com/ivo-toby/postgram/commit/105db43c603639e41ba7382e54100e2d7e60b35c))
* **projector:** tap detection works on desktop + landscape ([e0954e6](https://github.com/ivo-toby/postgram/commit/e0954e65239693bd03bf3e2660f865f3ad1517e2))
* **projector:** usable hover + real titles + full entity viewer ([b6f4f1e](https://github.com/ivo-toby/postgram/commit/b6f4f1e52675a02392081284a135b15053d11a43))
* **web-ui:** hide archived entities from graph and recover sidebar load ([645d35d](https://github.com/ivo-toby/postgram/commit/645d35d405fd2d244f2afabb6a8c535f46151829))

## [1.9.0](https://github.com/ivo-toby/postgram/compare/cli-v1.8.0...cli-v1.9.0) (2026-04-22)

### Features

* **extraction:** graph maintenance + error visibility + auto-create ([32f5930](https://github.com/ivo-toby/postgram/commit/32f5930276fc61f39a2c55bc2aa16e28d4b5478c))

### Bug Fixes

* **extraction:** exclude auto-created entities from extraction queue ([c94e6b9](https://github.com/ivo-toby/postgram/commit/c94e6b9e0cbee5c1c0efb9c2b44c2af7e090e1f6))
* **review:** address P1 + P2 Codex feedback on dce88e3 ([a07765d](https://github.com/ivo-toby/postgram/commit/a07765d3597d50b59a563bdb52f3df097d548579))
* **review:** address P1 + P2 Codex feedback on PR [#17](https://github.com/ivo-toby/postgram/issues/17) ([89262b3](https://github.com/ivo-toby/postgram/commit/89262b35eda3c2d1ba95b1e24b083e005bb04dd8))
* **review:** address remaining Codex P1s on PR [#17](https://github.com/ivo-toby/postgram/issues/17) ([dce88e3](https://github.com/ivo-toby/postgram/commit/dce88e331bb2ad85cd20403ddac209cef46c692c))

## [1.8.0](https://github.com/ivo-toby/postgram/compare/cli-v1.7.0...cli-v1.8.0) (2026-04-21)

### Features

* **docs:** update README to reflect new sync API endpoints and usage ([d85593f](https://github.com/ivo-toby/postgram/commit/d85593f2e54c822d69d456b312f322b5fb0dd0d7))

## [1.7.0](https://github.com/ivo-toby/postgram/compare/cli-v1.6.0...cli-v1.7.0) (2026-04-21)

### Features

* **semantic-layout:** implement 2D semantic layout mode ([90b3fac](https://github.com/ivo-toby/postgram/commit/90b3fac51703a375091e5078de30f7eb22b9d591))

### Bug Fixes

* **embeddings:** switch endpoint from GET to POST to avoid 414 ([d43a95f](https://github.com/ivo-toby/postgram/commit/d43a95fe099327aacac5f2bf153a88c1829a2c40))

## [1.6.0](https://github.com/ivo-toby/postgram/compare/cli-v1.5.0...cli-v1.6.0) (2026-04-21)

### Features

* **web-ui:** add advanced search page as default view ([0b227ae](https://github.com/ivo-toby/postgram/commit/0b227ae65ec1ced1b9860189e14cdb6bf6084844))
* **web-ui:** drag neighbours along kinetically when pulling a node ([a42ec88](https://github.com/ivo-toby/postgram/commit/a42ec88dcc328861922dce96218062bddc21739d))
* **web-ui:** lazy-load search results with infinite scroll ([cfb7e5b](https://github.com/ivo-toby/postgram/commit/cfb7e5b0a638ce31fc010fdedb0e3074a0363927))

### Bug Fixes

* **web-ui:** navigate to fetched entities from search detail; zoom in more ([68f6f08](https://github.com/ivo-toby/postgram/commit/68f6f0804e795d8532f9bd87668d6a92fb4e7470))

## [1.5.0](https://github.com/ivo-toby/postgram/compare/cli-v1.4.0...cli-v1.5.0) (2026-04-20)

### Features

* **web-ui:** add auth gate with LoginScreen and localStorage key storage ([08dce3b](https://github.com/ivo-toby/postgram/commit/08dce3ba46a5c92c01655044ebf5c96d1e808299))
* **web-ui:** add Docker + nginx packaging, add postgram-ui service to compose ([7a43c40](https://github.com/ivo-toby/postgram/commit/7a43c4080b2e435163f95efa41ebc23c7a5d9041))
* **web-ui:** add entity actions — add note, link, delete ([002b16b](https://github.com/ivo-toby/postgram/commit/002b16b89811ad64f99489d498833e4ea68ebb9c))
* **web-ui:** add entity detail panel with markdown, inline edit, edge list ([5c1f3a8](https://github.com/ivo-toby/postgram/commit/5c1f3a81626ef0cca81143174cf282626c849b4e))
* **web-ui:** add graphology graph model and node style helpers ([2be8127](https://github.com/ivo-toby/postgram/commit/2be8127b74c21c919b689010fcc9f2ff4c288eb6))
* **web-ui:** add layout shell with TopBar, LeftPanel, RightPanel, MainLayout and useApi hook ([6ebad63](https://github.com/ivo-toby/postgram/commit/6ebad63df5d22fbf0cc4703c7e8c9d4c0778f491))
* **web-ui:** add layout switching — ForceAtlas2, radial, hierarchy ([c149515](https://github.com/ivo-toby/postgram/commit/c149515d17401791cf44e11e9e9bf44728ad4c4b))
* **web-ui:** add queue status polling and StatusWidget ([b0c3c5d](https://github.com/ivo-toby/postgram/commit/b0c3c5d502e2844cb6a3ccbdce7a23a7d4ed7e09))
* **web-ui:** add redraw button and zoom-to-node on search result click ([0430f90](https://github.com/ivo-toby/postgram/commit/0430f9069065373a70d7e3f887070bfdd1c0bd3f))
* **web-ui:** add search, entity filters, relation chips, depth slider ([2d9aa57](https://github.com/ivo-toby/postgram/commit/2d9aa57a2e9c6be5b8688b3ee659b7787b04f914))
* **web-ui:** add Sigma.js graph canvas with entity loading ([e1c43f6](https://github.com/ivo-toby/postgram/commit/e1c43f6f91bfdc3b5b159785e38177891b15f8bf))
* **web-ui:** add typed API client and shared types ([c9ab9d4](https://github.com/ivo-toby/postgram/commit/c9ab9d44527bb494717a8c55217e747e90a2b106))
* **web-ui:** disable hierarchy for large graphs, markdown previews, edge names, draggable nodes ([ebc2634](https://github.com/ivo-toby/postgram/commit/ebc2634de62d2781bc0d6d5d2ae4789af6f8619d))
* **web-ui:** scaffold Vite + React 19 + Tailwind project ([a068218](https://github.com/ivo-toby/postgram/commit/a06821874fea98fd1c8f46b6ca43c25237812079))

### Bug Fixes

* **docker:** change default host port to 3101 to avoid conflict with existing MCP container ([2d0ab6b](https://github.com/ivo-toby/postgram/commit/2d0ab6b4b1dd95060fded7a7daf0f0aea53536c0))
* **docker:** revert service rename back to mcp-server to avoid duplicate extraction containers ([45af4be](https://github.com/ivo-toby/postgram/commit/45af4be2718d11c350e743a8cbd1bacbffb44229))
* **web-ui:** add .dockerignore, fix port binding, improve nginx proxy headers ([8466a9b](https://github.com/ivo-toby/postgram/commit/8466a9bb8d5b8ffea0e0cfcf7f30380c51970826))
* **web-ui:** fix event listener leak, expand lock, loading state, draft reset, edge navigation ([344752a](https://github.com/ivo-toby/postgram/commit/344752a72c62a39bc5ca716f91f2d871c7c49da2))
* **web-ui:** fix vite config types, exclude ui from root tsconfig ([9ff6210](https://github.com/ivo-toby/postgram/commit/9ff621048afd6a97ef82be7e6d7df7772a85b2b3))
* **web-ui:** install @tailwindcss/typography so prose classes actually render markdown ([dc41e17](https://github.com/ivo-toby/postgram/commit/dc41e171e92e9f9def34c946766af9fd8164bd48))
* **web-ui:** remove unused EntityType, throw on non-JSON responses ([f26fbc2](https://github.com/ivo-toby/postgram/commit/f26fbc27650a307eb0e752b584dc076be16a8f88))
* **web-ui:** use entityType attribute instead of type to avoid Sigma renderer conflict ([7dd5d27](https://github.com/ivo-toby/postgram/commit/7dd5d27777b34cea9bffebdbfce4831ff389fd50))
* **web-ui:** use SyntheticEvent instead of deprecated FormEvent ([b774e5a](https://github.com/ivo-toby/postgram/commit/b774e5a9c138e48532a9bae6fd4f898fea25b0e5))

## [1.4.0](https://github.com/ivo-toby/postgram/compare/cli-v1.3.0...cli-v1.4.0) (2026-04-20)

### Features

* **cli:** add --expand-graph flag to pgm search for knowledge graph traversal ([685638f](https://github.com/ivo-toby/postgram/commit/685638fa24653646933e42672c46200023993e65))

### Bug Fixes

* **cli:** narrow related entity type to match actual wire shape ([1c9a723](https://github.com/ivo-toby/postgram/commit/1c9a72327958676cb45603a727d99b7be5c3dd7a))

## [1.3.0](https://github.com/ivo-toby/postgram/compare/cli-v1.2.0...cli-v1.3.0) (2026-04-20)

### Features

* **mcp:** add queue tool to MCP server ([e7172e9](https://github.com/ivo-toby/postgram/commit/e7172e9c298e3b55b812d2536f520bc990583619))
* **pgm:** add queue command to pgm CLI via REST API ([67647fc](https://github.com/ivo-toby/postgram/commit/67647fcc5f275873380af804f544930fc49ba722))

## [1.2.0](https://github.com/ivo-toby/postgram/compare/cli-v1.1.0...cli-v1.2.0) (2026-04-20)

### Features

* **admin:** add pgm-admin queue command for enrichment/extraction visibility ([e016786](https://github.com/ivo-toby/postgram/commit/e01678617c4aafa9aeba46f71a07820133fcc566))
* **db/pool.ts:** add connection pool configuration options for timeout and max connections to enhance database performance ([4006ddc](https://github.com/ivo-toby/postgram/commit/4006ddc19ec80279fb0e88ca1df132f285775d40))

### Bug Fixes

* replace setInterval with sequential worker loop to prevent pool exhaustion ([7bc1099](https://github.com/ivo-toby/postgram/commit/7bc10992e2f8b79b92e6d8d50e72f851e0bc45c4))
* **search:** cap DB result set to prevent OOM on large corpora ([6665693](https://github.com/ivo-toby/postgram/commit/66656933c2edb61df96fefb0f0dae2aafb3e90c1))

## [1.1.0](https://github.com/ivo-toby/postgram/compare/cli-v1.0.6...cli-v1.1.0) (2026-04-19)

### Features

* **mcp:** replace deprecated SSE transport with Streamable HTTP ([6156b72](https://github.com/ivo-toby/postgram/commit/6156b72d8f75e075bce61b640115861281876f11))

## [1.0.6](https://github.com/ivo-toby/postgram/compare/cli-v1.0.5...cli-v1.0.6) (2026-04-19)

### Bug Fixes

* package issues ([c842a85](https://github.com/ivo-toby/postgram/commit/c842a85924e1e561b971a5af5a7f08b242cad3e2))

## [1.0.5](https://github.com/ivo-toby/postgram/compare/cli-v1.0.4...cli-v1.0.5) (2026-04-19)

### Bug Fixes

* **cli:** use dedicated build tsconfig so tests are not compiled into dist ([182fd94](https://github.com/ivo-toby/postgram/commit/182fd949dd4bc4a254192109ebbb4711adfb6da1))

## [1.0.4](https://github.com/ivo-toby/postgram/compare/cli-v1.0.3...cli-v1.0.4) (2026-04-19)

### Bug Fixes

* **cli:** exclude test output from published package ([33fb722](https://github.com/ivo-toby/postgram/commit/33fb722421dd5364acd5c07ce18b42f64d8d54ce))

## [1.0.3](https://github.com/ivo-toby/postgram/compare/cli-v1.0.2...cli-v1.0.3) (2026-04-19)

### Bug Fixes

* **ci:** switch to NPM_TOKEN for reliable publishing ([7133a30](https://github.com/ivo-toby/postgram/commit/7133a302ba5f70c96e2eba69c5c3fb9748966627))

## [1.0.2](https://github.com/ivo-toby/postgram/compare/cli-v1.0.1...cli-v1.0.2) (2026-04-19)

### Bug Fixes

* **ci:** remove registry-url from setup-node to unblock OIDC npm publish ([036b27e](https://github.com/ivo-toby/postgram/commit/036b27e147be3023c4b0bacb9b333f810748d36f))

## [1.0.1](https://github.com/ivo-toby/postgram/compare/cli-v1.0.0...cli-v1.0.1) (2026-04-19)

### Bug Fixes

* **cli:** simplify release rules so conventional commits actually fire ([60a309e](https://github.com/ivo-toby/postgram/commit/60a309e16b363a3d85572aa5dec6043e880f33b5))
* **cli:** trigger first CI-driven release ([e379823](https://github.com/ivo-toby/postgram/commit/e37982358befe42854414916d1933511b60cf13e))

## 1.0.0 (2026-04-19)

### Features

* add async enrichment and semantic search ([f674bec](https://github.com/ivo-toby/postgram/commit/f674bec64e8e864150d8a5fd84a6169620902e44))
* add audit logging and stabilize test fixtures ([0e06285](https://github.com/ivo-toby/postgram/commit/0e062852cf97bbcc88198666aa3ed7579537c842))
* add database migrations and API key auth foundation ([47c41b0](https://github.com/ivo-toby/postgram/commit/47c41b0e3b9997d46e712e0e46ae989f3a455967))
* add document_sources table for sync tracking ([0f59353](https://github.com/ivo-toby/postgram/commit/0f59353b0de8fe4f6a99c7d3ada1c49108a5b169))
* add edge REST endpoints, MCP tools, and CLI commands ([06b849b](https://github.com/ivo-toby/postgram/commit/06b849b0b1cd8da04a139ba58c5bd49f7507b0c8))
* add edges table, extraction_status, and extraction config ([a8390cf](https://github.com/ivo-toby/postgram/commit/a8390cfdd68620a96da6d3e6465cda69977bd570))
* add entity service and REST CRUD routes ([c125b45](https://github.com/ivo-toby/postgram/commit/c125b45bdb7bf263c531486db3a46db6d7f841ea))
* add error primitives and structured health responses ([53533eb](https://github.com/ivo-toby/postgram/commit/53533eb7997e41d9f90a7613d0d71f3c297b1431))
* add expand_graph option to search for 1-hop graph neighbors ([cbc55cf](https://github.com/ivo-toby/postgram/commit/cbc55cf477ef3779be1035c6b3c8db0c9f0cea8a))
* add HTTP error handling and auth middleware ([4961f82](https://github.com/ivo-toby/postgram/commit/4961f829aa9f038d9e11ff9796d656f6ce677c13))
* add LLM provider abstraction (OpenAI, Anthropic, Ollama) and update README ([3d6c69b](https://github.com/ivo-toby/postgram/commit/3d6c69b2d8c9b2d71df752bde2e2f8bb20087ed0))
* add MCP transport and runtime validation support ([bc03855](https://github.com/ivo-toby/postgram/commit/bc03855153d19bca5e044acdbb5235ba1334d803))
* add migration for tsvector column and enrichment_attempts ([e17c250](https://github.com/ivo-toby/postgram/commit/e17c250171022179a5b8709e5e3fcb34da736495))
* add Ollama Cloud API key support ([135e508](https://github.com/ivo-toby/postgram/commit/135e5088d7e4b61decf42524230d2598dd4b6918))
* add pgm list command for listing entities ([0886cdb](https://github.com/ivo-toby/postgram/commit/0886cdbeb28874dcd636330f433d3241c308a615))
* add pgm sync command for local directory sync ([36a17aa](https://github.com/ivo-toby/postgram/commit/36a17aa3e984116dc65c5df68664b3888a308892))
* add pgm-admin reembed command ([f52a869](https://github.com/ivo-toby/postgram/commit/f52a8694683b42b8700c85ebe56fd9c3ee11abb0))
* add REST endpoints and MCP tools for document sync ([af8a097](https://github.com/ivo-toby/postgram/commit/af8a09769fb968975dd6d004fd3022901ba93ae1))
* add talon migration slice ([c3f7e5e](https://github.com/ivo-toby/postgram/commit/c3f7e5e2bfe186fbc815a5c28105bd08816e3ba2))
* add task service and REST endpoints ([a24dcc5](https://github.com/ivo-toby/postgram/commit/a24dcc5d98f21a6c813abd50b1845c64efc3c72d))
* **client.ts:** add owner property to StoredEntityResponse type for better entity management ([455fe6e](https://github.com/ivo-toby/postgram/commit/455fe6ea6cfe8d600107c79f81bc3ac3a3aaf508))
* **embeddings:** add Ollama provider with independent host + dimension migration ([4ba3c39](https://github.com/ivo-toby/postgram/commit/4ba3c39c853305a3b67d6556523c6c85b0850c0d))
* **embeddings:** add Ollama provider with independent host + dimension migration ([87164aa](https://github.com/ivo-toby/postgram/commit/87164aa99cd3128a0967ea2a466e9565bb6fab16))
* enrichment worker retries failed entities with backoff ([2e340ba](https://github.com/ivo-toby/postgram/commit/2e340ba0ef276c79f5acfdfd57044d2d1d248043))
* extract pgm CLI as standalone @postgram/cli npm package ([1eb2921](https://github.com/ivo-toby/postgram/commit/1eb29219763a8f50581bf4d60867546462dfd062))
* **findings.md:** add review findings document to capture issues and recommendations from the audit ([3423ddf](https://github.com/ivo-toby/postgram/commit/3423ddfe3cada86ba378ade2d90501e9f2ff36d6))
* hybrid BM25+vector search with scoring functions ([8989505](https://github.com/ivo-toby/postgram/commit/89895056130c5630655463b8f0cfb0f0f2410dcb))
* implement edge service with CRUD and graph traversal ([714f121](https://github.com/ivo-toby/postgram/commit/714f12116e8c542f1cbc1c6b37bc26e769f540e9))
* implement LLM extraction service with entity matching ([622c4eb](https://github.com/ivo-toby/postgram/commit/622c4ebe27e71f69a26dbca65129113afe951178))
* implement sync service with manifest comparison ([eb1fc79](https://github.com/ivo-toby/postgram/commit/eb1fc7935922f7869e84c727b2ff11270014c57c))
* **package:** add bin entry for pgm CLI tool to enable command line usage ([3ef5a25](https://github.com/ivo-toby/postgram/commit/3ef5a256804e8a28f8f2ca107cadbbeb25dd20b6))
* update packagelock and trigger release ([e8e13f9](https://github.com/ivo-toby/postgram/commit/e8e13f954c3b83451e9c2f8b1a15610546ac25d9))
* validate embedding service on startup ([31096b2](https://github.com/ivo-toby/postgram/commit/31096b21f8a507f8ec07d94d3faa3ead6b665b9f))
* wire LLM extraction into enrichment worker ([870cd18](https://github.com/ivo-toby/postgram/commit/870cd1803096206baf16fbf036338c79a9de24ad))

### Bug Fixes

* add undefined to optional property types for exactOptionalPropertyTypes ([aa9a358](https://github.com/ivo-toby/postgram/commit/aa9a358571c125252358226bd3c371a00156f87f))
* address PR review findings ([f4bd49e](https://github.com/ivo-toby/postgram/commit/f4bd49eb22261dd6acd491a4b6a60334524146eb))
* address round-2 review — confidence validation, batched graph expansion, auth types, entity matching order ([c48a085](https://github.com/ivo-toby/postgram/commit/c48a085b7812ad13e1a244791e9e512eac77b94a))
* **compose:** forward EMBEDDING_* and EXTRACTION_* env vars to mcp-server ([5789709](https://github.com/ivo-toby/postgram/commit/57897099ddfeb9617dca05b9da53c7ba20eeca17))
* enforce auth on edge operations, snake_case responses, input validation ([eb62b58](https://github.com/ivo-toby/postgram/commit/eb62b589334586aeeb7e93067e0e8f5847d5ab46))
* **enrichment-worker:** use advisory locks for extraction to avoid FK deadlock ([b34b49a](https://github.com/ivo-toby/postgram/commit/b34b49a40a387794abea3980bebf4f2d73551ea0))
* ExtractionOptions callLlm type for exactOptionalPropertyTypes ([a0d8e47](https://github.com/ivo-toby/postgram/commit/a0d8e47d69595224db66da1274dcf92ef886412c))
* filter edges by visible endpoints, handle OpenAI JSON object wrapper ([8cea79c](https://github.com/ivo-toby/postgram/commit/8cea79c815133d070db97b61bfeaac18e93924a9))
* fix package.json ([4512e68](https://github.com/ivo-toby/postgram/commit/4512e68cf278ff6fd4681945d09c6d6cb07faab7))
* **llm-provider:** accept OpenAI-shape responses from llama.cpp's /api/chat ([1d7004c](https://github.com/ivo-toby/postgram/commit/1d7004cbd58a42bac6a3955d8dcb2e01faa27e33))
* **llm-provider:** add request timeout + disable Qwen3 thinking for Ollama ([6be37ec](https://github.com/ivo-toby/postgram/commit/6be37ec1f6c26d089c65d4ed13a630fc9de859c3))
* per-provider model defaults and JSON mode enforcement ([62e3054](https://github.com/ivo-toby/postgram/commit/62e30543078878ba98a75172e3b204b3a06e4497))
* recursive CTE graph traversal, type safety, ILIKE escaping, client types ([616f80a](https://github.com/ivo-toby/postgram/commit/616f80a328cf711698a2f2c15606368bba407479))
* resolve lint errors in sync tests ([1ef4397](https://github.com/ivo-toby/postgram/commit/1ef439784118aaa662d8d03ee4c950beecfd04d2))
* update contract tests for BM25 fallback behavior ([045d7c6](https://github.com/ivo-toby/postgram/commit/045d7c692d8f1a72e211d0e1ae59065e74780ea7))
* use Promise.resolve instead of async for mockLlm lint ([0fea02c](https://github.com/ivo-toby/postgram/commit/0fea02c6f42e717bde37917218f429f5dd17abac))
* wrap parseJsonObject SyntaxError and warn on insecure ~/.pgmrc permissions ([096e68c](https://github.com/ivo-toby/postgram/commit/096e68c56f1489f4f05757f7a9d2f9a86a9fa768))
