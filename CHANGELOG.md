# Changelog

## [0.1.4](https://github.com/64andrewwalker/codebridge/compare/codebridge-v0.1.3...codebridge-v0.1.4) (2026-02-21)


### Bug Fixes

* clear stale pid and session_id on resetForResume ([#23](https://github.com/64andrewwalker/codebridge/issues/23)) ([#28](https://github.com/64andrewwalker/codebridge/issues/28)) ([aadb172](https://github.com/64andrewwalker/codebridge/commit/aadb1723bf4f47c69a02f15c48104c47973fd8b4))
* engine parser edge cases for tokens and sessionId ([#26](https://github.com/64andrewwalker/codebridge/issues/26)) ([#32](https://github.com/64andrewwalker/codebridge/issues/32)) ([a67751e](https://github.com/64andrewwalker/codebridge/commit/a67751e47fc0bb45ef647bc6b99b2cc36d5622f3))
* filter KimiCode output to assistant role only ([#21](https://github.com/64andrewwalker/codebridge/issues/21)) ([#31](https://github.com/64andrewwalker/codebridge/issues/31)) ([a31fbd4](https://github.com/64andrewwalker/codebridge/commit/a31fbd44a6e63c1ad6faf9a21031059ef3e6dc56))
* reconciler handles stopping state and corrupt session.json ([#22](https://github.com/64andrewwalker/codebridge/issues/22)) ([#29](https://github.com/64andrewwalker/codebridge/issues/29)) ([4484cbc](https://github.com/64andrewwalker/codebridge/commit/4484cbcafe305a7b9b47e64fc880b70dbad757b8))
* security — path traversal and workspace validation ([#20](https://github.com/64andrewwalker/codebridge/issues/20)) ([#34](https://github.com/64andrewwalker/codebridge/issues/34)) ([81a6f30](https://github.com/64andrewwalker/codebridge/commit/81a6f30c67c7b2a0050c66f119d6b4d3631b0435))
* tighten Zod schema validation constraints ([#24](https://github.com/64andrewwalker/codebridge/issues/24)) ([#30](https://github.com/64andrewwalker/codebridge/issues/30)) ([d9772b4](https://github.com/64andrewwalker/codebridge/commit/d9772b414df80d845e7716d3b2ce341cc6dea07f))
* validate CLI inputs before writing to disk ([#25](https://github.com/64andrewwalker/codebridge/issues/25)) ([#33](https://github.com/64andrewwalker/codebridge/issues/33)) ([32a7227](https://github.com/64andrewwalker/codebridge/commit/32a7227fcaecb19533805579f2838c2b6fb326c1))
* wrap processRun in top-level try/catch to guarantee result.json ([#27](https://github.com/64andrewwalker/codebridge/issues/27)) ([6cef36c](https://github.com/64andrewwalker/codebridge/commit/6cef36c20ad65328143dd6e40f042680c998ba65))

## [0.1.3](https://github.com/64andrewwalker/codebridge/compare/codebridge-v0.1.2...codebridge-v0.1.3) (2026-02-21)


### Features

* store full engine output in output.txt ([#15](https://github.com/64andrewwalker/codebridge/issues/15)) ([#16](https://github.com/64andrewwalker/codebridge/issues/16)) ([f404379](https://github.com/64andrewwalker/codebridge/commit/f4043796943e6867193b27ab1720e068539ec045))


### Bug Fixes

* guard writeOutputFile and add explicit failure path fields ([#15](https://github.com/64andrewwalker/codebridge/issues/15)) ([#18](https://github.com/64andrewwalker/codebridge/issues/18)) ([d45a258](https://github.com/64andrewwalker/codebridge/commit/d45a258955530cc26ac6f17c61e1933870dfbd2c))

## [0.1.2](https://github.com/64andrewwalker/codebridge/compare/codebridge-v0.1.1...codebridge-v0.1.2) (2026-02-21)


### Features

* extract session ID from ~/.kimi/kimi.json for kimi-code engine ([#13](https://github.com/64andrewwalker/codebridge/issues/13)) ([2cc8243](https://github.com/64andrewwalker/codebridge/commit/2cc82437b2187478e54feb52b7f582af828ced6d))

## [0.1.1](https://github.com/64andrewwalker/codebridge/compare/codebridge-v0.1.0...codebridge-v0.1.1) (2026-02-21)


### Features

* add CLI commands (submit, status, resume, stop, logs, doctor) ([442e2d2](https://github.com/64andrewwalker/codebridge/commit/442e2d2461096e5231bc3778f8919f2a9ef58635))
* add daemon runner with file watcher and reconciliation on startup ([71ceae8](https://github.com/64andrewwalker/codebridge/commit/71ceae82a49a13ea2afc333315b870392d2ff397))
* add Engine interface and Claude Code adapter ([6a61a07](https://github.com/64andrewwalker/codebridge/commit/6a61a07a463020db45b577a1ea1b0fa0593d3093))
* add Kimi Code engine support with multi-engine architecture ([#9](https://github.com/64andrewwalker/codebridge/issues/9)) ([3bb3b46](https://github.com/64andrewwalker/codebridge/commit/3bb3b46ebc77108adf969f96efa3e0905891c85f))
* add model pass-through to claude-code and kimi-code engines ([06a38b2](https://github.com/64andrewwalker/codebridge/commit/06a38b2527fed423923e81a56af7dfcd9a71cd5e))
* add model pass-through to claude-code and kimi-code engines ([#12](https://github.com/64andrewwalker/codebridge/issues/12)) ([1a24bb3](https://github.com/64andrewwalker/codebridge/commit/1a24bb35fb24c9b54142de54b32e3f8e701a811b))
* add OpenClaw codebridge skill definition ([0bd2234](https://github.com/64andrewwalker/codebridge/commit/0bd22347d100b554cd125fe6abacd646beaab3a5))
* add OpenCode + Codex engines, install command, and model pass-through ([#11](https://github.com/64andrewwalker/codebridge/issues/11)) ([a5d597d](https://github.com/64andrewwalker/codebridge/commit/a5d597d39b983127b9766435c52982daac16f6bb))
* add Reconciler for crash recovery on startup ([97a7b87](https://github.com/64andrewwalker/codebridge/commit/97a7b87ae684e117f1f34d5c177def6570ff4a3a))
* add request/result/session schemas with zod validation ([87668d9](https://github.com/64andrewwalker/codebridge/commit/87668d91e77707a53d859f1471058209a69bfc95))
* add RunManager with atomic file protocol ([b70c2ad](https://github.com/64andrewwalker/codebridge/commit/b70c2adddcf1d0babd30a4b86fd90c11b007c518))
* add SessionManager with state machine validation ([d9957e8](https://github.com/64andrewwalker/codebridge/commit/d9957e8b0732d4ac6dd105a3cfbc05c3a0d1fa86))
* add TaskRunner with workspace validation and error handling ([d5a7ec2](https://github.com/64andrewwalker/codebridge/commit/d5a7ec2acaa3764464687793bf458a1c4c8a1ada))
* agent experience optimization — files_changed, error suggestions, skill rewrite ([#10](https://github.com/64andrewwalker/codebridge/issues/10)) ([80a9d8e](https://github.com/64andrewwalker/codebridge/commit/80a9d8e1e50f053834992fa4b8f0f6f99f28ffdd))
* allow configurable claude permission mode via env ([bb3e0da](https://github.com/64andrewwalker/codebridge/commit/bb3e0daf5ca8d32a00ae5ede2df536787c1d0182))


### Bug Fixes

* close stop lifecycle (stopping → completed with result.json) ([0a384a8](https://github.com/64andrewwalker/codebridge/commit/0a384a82f71435d04cb80be0be658c8b3fb2676e))
* detect claude in common bin paths for non-interactive envs ([2aff853](https://github.com/64andrewwalker/codebridge/commit/2aff853fcac13777a5e8d9803df52ea8aa193e00))
* enforce schema validation and allowed_roots security at runtime ([cd1b43f](https://github.com/64andrewwalker/codebridge/commit/cd1b43f145c7cd4977105f81e9f2d3cbe249700b))
* make codebridge bin executable after build ([824bfb3](https://github.com/64andrewwalker/codebridge/commit/824bfb3866980ca7f92f99a811c0876dc4dcfbfb))
* make result session_id nullable, add missing schema tests ([cfdf40e](https://github.com/64andrewwalker/codebridge/commit/cfdf40e08ced91860a6456298d335e22f6c14b16))
* pass timeout to constraints, fix resume workspace, add resume --wait ([69d8a95](https://github.com/64andrewwalker/codebridge/commit/69d8a955ba6f01b8d5b8deec584a5fec29c6bf02))
* prevent claude stdin hang and parse json session metadata ([2bd1146](https://github.com/64andrewwalker/codebridge/commit/2bd11465c31952c28dca06c3625e097aeebb92d9))
* prevent sibling-prefix escape and reject root in allowed_roots ([#6](https://github.com/64andrewwalker/codebridge/issues/6)) ([1bfcec5](https://github.com/64andrewwalker/codebridge/commit/1bfcec5e34d74f886a3581a0a09350843fa66817))
* resolve paths before DANGEROUS_ROOTS check (CI fix) ([6ef20a8](https://github.com/64andrewwalker/codebridge/commit/6ef20a8052a88626060c7fea4f8a8d205632a362))
* resolve paths before DANGEROUS_ROOTS check to prevent platform-dependent bypass ([1bada9c](https://github.com/64andrewwalker/codebridge/commit/1bada9cb893bc96e1fbdff83fd70d9a3e8ba675e))
* write reconciliation actions to log files ([2743396](https://github.com/64andrewwalker/codebridge/commit/27433962bf4b9f4aa189aa83617e0ef499333f8c))
