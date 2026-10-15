# SPARQL

Import Wikidata statements and SPARQL SELECT results into Roam Research. SPARQL is a standalone extraction of [RoamJS Developer](https://github.com/RoamJS/developer), with native Roam query editing, a query workspace, previews and safer refresh.

This is an unreleased candidate. All inherited publishing workflows are disabled. Nothing in this repository publishes an extension, uploads a preview, creates a Depot release PR or deploys a backend.

## Open and import

- **Run SPARQL Query** opens the compact importer. Choose **Current Page**, **Current Block** or **Custom Query**. Empty blocks use their parent as the block destination. Pages without a first block work directly.
- **Run SPARQL Query: Custom** resolves a focused query first, then the most recently edited SPARQL source on the open page, then the existing `customQuery` block.
- **SPARQL: Open focused query** and the block/reference context menu resolve a SPARQL source, a containing parent's source, or a whole-block `((uid))` reference. Cycles and missing sources produce errors. Mixed prose references are not resolved.
- **SPARQL: Open workspace** opens `roam/js/sparql/workspace`, with a saved query library beside the shared editor and preview. Its ordinary fallback block remains readable while the extension is disabled.

The destination is shown separately from the source. Enter any existing page or block UID. **Import** fetches and validates before writing. **Preview** shows the exact output plan and proposed identity links; **Import previewed results** applies it without another endpoint request. Changing the query, source, settings or destination makes the preview stale. External destination changes also require a new preview.

For Wikidata, search **Item (Q)** or **Property details (P)**, or enter a Q/P identifier. Property details query statements about a P entity; this is separate from **Selected property IDs**, which filters the statements of the selected Q/P entity. **All properties** is the default. The limit counts result rows, including qualifier rows, rather than distinct properties.

Custom queries use the real native Roam block editor. Edits persist in the graph. Open **Query settings** for endpoint, format, label, name and saving. SELECT is supported; ASK, CONSTRUCT, DESCRIBE and SPARQL Update are rejected before requesting.

## Existing graph compatibility

No conversion runs on installation. The graph remains the source of truth:

````text
roam/js/sparql
  import
    default label
      SPARQL Import {date}
    default limit
      10
    qualifiers
  customQuery
    ```sparql … ```
  queries
    <output-root-uid>
      <query text>
      <endpoint URL prefix>
      Parent | Line | Table
  standalone/v1
    <output-root-uid> <versioned JSON metadata>
````

Ordered saved record children and their UIDs are retained. Unknown children are preserved. New names, source links, endpoint mode and ownership live in the separate `standalone/v1` subtree. Legacy endpoints concatenate the prefix with the encoded query; standard mode instead sets `query` and `format=json` URL parameters. Existing saved imports use the compatibility formatter, including legacy grouping by displayed text and broad date recognition. New imports group by entity identity and recognize dates by datatype. Both handle optional/unbound cells safely and format repeated URLs consistently.

Parent, Line and Table preserve variable order, paired `Label` variables, property attributes, images, links and table headers. `{date}` uses the device's locale. Identity links are added after validated output writes and awaited; existing identical links are not duplicated. Two different entity URIs with the same label can share a Roam page and therefore have multiple `same as::` links.

### Refresh and recovery

The library reads current graph records every time it runs. A refresh button appears beside each visible saved output, including multiple placements; the refresh command is also available. **Save definition** records current native source text and settings. External saved-record edits require reloading the definition or **Save a copy**. Copying creates a separate saved output on its next import.

For an unowned legacy import, exact equality between the entire existing output tree and the newly validated compatibility plan permits adoption in place. Adoption preserves every existing output UID. If equality cannot be established (changed endpoint results, notes or edits), the preview explains the uncertainty and **Import adjacent copy** creates a sibling output. This is an intentional compatibility exception: automatic destructive legacy refresh is not retained. The old root and descendants remain readable and referenced.

New owned imports update matching unchanged blocks in place. Edited, moved, missing and obsolete outputs are retained and counted visibly in the status and journal. User children are never deleted during refresh. Removed endpoint rows therefore require manual cleanup; they are not silently presented as a clean replacement. Import labels update only while their previous generated text is unchanged.

Roam writes are not atomic. **Stop**, closing the dialog or disabling the extension prevents subsequent writes; completed writes remain. A partial import reports recorded output changes. Its local graph-scoped journal survives navigation/reload. **Recover unchanged output writes** reverses unchanged updates and removes only unchanged, childless, unreferenced created output blocks. Changed or referenced blocks are retained. Identity-page links and saved metadata require manual review after partial failures; recovery does not promise universal undo. No journal or draft is sent to a server.

## Query block metadata

Optional direct children of a SPARQL source block, or siblings under its immediate containing block:

```text
sparql endpoint:: https://example.org/sparql
sparql endpoint mode:: standard
sparql format:: Table
```

`prefix` and `standard` are the accepted endpoint modes; `Parent`, `Line` and `Table` are the accepted formats. Without metadata, the Wikidata legacy prefix and Parent format apply. Source and destination remain independent. Endpoints must support browser HTTP(S) GET and SPARQL JSON results; CORS failures are visible and no hosted proxy or endpoint credentials are configured.

## Developer coexistence

This candidate detects the known `developer` / `@roamjs/developer` runtime IDs in `window.roamjs.loaded`. If Developer is present at startup, standalone SPARQL stays in standby and registers no legacy query commands, block menus or refresh controls. If Developer loads later, standalone cancels its operation, removes its handlers and enters standby. Its workspace remains available to explain the handoff. Standby remains latched until reload.

The legacy Developer module has no supported public handoff/teardown API, and its text `disable_sparql` setting cannot be reliably read across production extension boundaries. This candidate therefore requires **disable Developer, reload Roam, then enable SPARQL**. Disabling only its SPARQL setting is not a verified handoff. Other Developer features are unavailable while Developer is disabled. Automatic disabling of another extension is not attempted. Custom/older bundles with an unknown runtime ID or legacy code injected outside the known loader cannot be reliably detected. Reload after changing the installation prevents stale legacy handlers.

Rollback: disable standalone SPARQL, reload, then re-enable Developer. Legacy fields remain readable. New metadata stays separate. Standard endpoint mode and other new features require standalone SPARQL; select legacy prefix mode before rollback if needed.

## Build and verification

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build:roam
```

The actual bundle is `dist/extension.js`, mirrored to `extension.js`. The entry is `src/index.ts` because the inherited build tool does not select `index.tsx` when multiple TypeScript files sit in `src`. Build scripts have no install, release or deployment side effects. Only dry build/test CI is active, with `contents: read` and no artifact upload. Disabled publishing definitions and restoration policy are in `publishing-disabled/`.

Unit tests cover legacy storage, output trees, request validation/abort, safe writes, recovery and conservative detection. Runtime receipts, exact bundle hashes, screenshots, recordings, blockers and the local handoff are kept under ignored `local/`. Deterministic endpoint fixtures prove exact behavior separately from real endpoint connectivity. Automated proof is not Michael's acceptance.

The extracted baseline is Developer commit `c3d44d3ed027a5afcba8b0364f7e38f5751691d1`, SPARQL blob `ddd28d6cd83ee4a2610d1dabf95574a522e6c71d`. A local source build does not establish that the current Depot release has identical dependencies or behavior. MIT license and original RoamJS attribution are retained.
