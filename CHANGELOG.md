# Changelog

All notable changes are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- **Standalone SPARQL** - Import and refresh SPARQL results without installing Developer.
- **Native query workspace** - Edit graph-backed queries, search saved imports, choose a destination, and preview proposed output before importing.
- **Focused queries and properties** - Open query blocks and references from commands or context menus; look up Wikidata properties and select the properties to import.

### Changed

- **Safer refresh** - Preserve edited and referenced blocks, adopt matching legacy output in place, and offer an adjacent copy when legacy ownership is uncertain.

### Fixed

- **Awaited imports** - Validate endpoint results before graph writes and report partial failures with bounded recovery.
- **Optional result cells** - Handle missing labels, repeated URLs, malformed responses, cancellation and endpoint errors without pre-request graph debris.

- **Refresh consistency** - Insert new sorted output and table headers in place, stop between saved-record writes, and clear obsolete recovery after a successful retry.
- **Native source switching** - Reopen source editors correctly after changing query blocks or copying saved definitions.
