# Changelog

All notable changes are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- **Standalone SPARQL** - Import and refresh SPARQL results without installing Developer.
- **Native query workspace** - Edit graph-backed queries, search saved imports, choose a destination, and preview proposed output before importing.
- **Focused queries and properties** - Open query blocks and references from commands or context menus; look up Wikidata properties and select the properties to import.

- **Sidebar importer** - Move the complete dialog or workspace into a native right sidebar window while keeping its query draft and preview; optionally open only the source block there.

### Changed

- **Safer refresh** - Preserve edited and referenced blocks, adopt matching legacy output in place, and offer an adjacent copy when legacy ownership is uncertain.

### Fixed

- **Awaited imports** - Validate endpoint results before graph writes and report partial failures with bounded recovery.
- **Optional result cells** - Handle missing labels, repeated URLs, malformed responses, cancellation and endpoint errors without pre-request graph debris.

- **Refresh consistency** - Insert new sorted output and table headers in place, stop between saved-record writes, and clear obsolete recovery after a successful retry.
- **Native source switching** - Reopen source editors correctly after changing query blocks or copying saved definitions.

- **Large imports** - Plan sibling insertions and grouped results without repeatedly copying large result trees.
- **Selected labels and dates** - Keep standalone `Label` columns and preserve the stated calendar day of date-only and midnight UTC values.

- **Persisted source changes** - Mark previews stale after native Roam finishes saving an edit, including edits from another placement of the source.

- **Preview refresh and empty table cells** - Rebuild explicit previews after destination edits and preserve empty or unbound columns in Table output.

- **Recovery concurrency** - Keep recovery and imports serialized, disable overlapping actions and stop between recovery writes.

- **Saved definitions** - Serialize saving and copying with imports and recovery. An interrupted save preserves the previous settings and asks you to reload and repair the definition before refreshing.
- **Output identities** - Keep distinct Parent, Line and Table results when a value contains key delimiters and reuse safely matched blocks when refreshing earlier saved imports.
