# Changelog

All notable changes to the MakiNuki web runtime are recorded here.

## [Unreleased]

- Adopted `@makinuki/spec` 1.3.0: `SettingSchema` support with a `get_settings` probe (`hasSettings`), per-source settings persistence, and payload type catch-up (`tags`, `locked`, `volume`, `covers`, transfer hints, optional `coverUrl`).
- Added oxlint and oxfmt with `lint`, `lint:fix`, `format`, and `format:check` scripts, and formatted the tree.
