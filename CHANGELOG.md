# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-03-06

### Added
- **Autonomous Coding Agent**: Initial implementation of the GLM autonomous agent.
- **SQLite Persistence**: Integrated `SessionRepository` for SQLite-backed session, message, and step storage.
- **Ambiguity Handling**: Added `occurrence` and context disambiguation to `edit_file` tool.
- **Configurable Timeouts**: Support for custom timeouts in `run_command` tool.
- **Multi-Modal Support**: Added `glm_vision` for image analysis using GLM-4V.
- **Embeddings**: Added `glm_embeddings` for text vectorization.
- **Chat Tool**: Added `glm_chat` for general LLM interactions.
- **Event Bus**: Implemented singleton EventBus with wildcard support for comprehensive event tracking.

### Changed
- **Rebranding**: Renamed project from MCP GLM to **GLM MCP Ultimate**.
- **API Default**: Pre-configured to use the GLM Coding Plan endpoint (`api.z.ai`) by default.
- **Reliability**: Improved `runCommand` to use `spawnSync` for reliable stderr capture.
- **Retry Logic**: Refined exponential backoff and retry counting for better stability under rate limits.

### Fixed
- Fixed `Auth Module` error messaging when no tokens are available.
- Fixed `PlanExecutor` skipping logic to correctly handle dependent vs independent steps.
- Fixed `PlanExecutor` retry count being incorrectly calculated in tests.
