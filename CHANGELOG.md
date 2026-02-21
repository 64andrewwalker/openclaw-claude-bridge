# Changelog

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
