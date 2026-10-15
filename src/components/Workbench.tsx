import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  Callout,
  Checkbox,
  Classes,
  Collapse,
  HTMLSelect,
  InputGroup,
  Label,
  NumericInput,
  Radio,
  RadioGroup,
  Spinner,
} from "@blueprintjs/core";
import {
  codeFromBlock,
  Entity,
  entityQuery,
  searchEntities,
  WIKIDATA_SOURCE,
} from "~/query";
import { host } from "~/roam";
import { Preview, QueryService } from "~/service";
import {
  ensureCustom,
  copyQuerySource,
  readDefaults,
  readMeta,
  readSaved,
  saveMeta,
  saveRecord,
  sourceQuery,
} from "~/storage";
import { Graph, Journal, Node, OutputFormat, Query, Saved } from "~/types";
import { recover } from "~/writer";

export type Launch = {
  destination: string;
  blockUid: string;
  pageTitle?: string;
  mode?: string;
  sourceUid?: string;
  savedRoot?: string;
  error?: string;
};
export type WorkbenchProps = {
  graph: Graph;
  service: QueryService;
  launch: Launch;
  wide?: boolean;
  onWorkspace: () => void;
  blocked?: string;
};
const TreePreview = ({ nodes }: { nodes: Node[] }): React.ReactElement => (
  <ul>
    {nodes.map((node) => (
      <li key={node.key}>
        <span>{node.text}</span>
        {!!node.children.length && <TreePreview nodes={node.children} />}
      </li>
    ))}
  </ul>
);
const NativeSource = ({
  uid,
  onEdit,
  disabled,
}: {
  uid: string;
  onEdit: () => void;
  disabled: boolean;
}): React.ReactElement => {
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    anchor.current?.toggleAttribute("inert", disabled);
  }, [disabled]);
  useEffect(() => {
    const el = anchor.current;
    if (!el || !uid) return;
    let disposed = false;
    void host()
      .ui.components.renderBlock({
        uid,
        el,
        "zoom-path?": false,
      })
      .then(() => {
        if (disposed) void host().ui.components.unmountNode({ el });
      });
    return (): void => {
      disposed = true;
      void host().ui.components.unmountNode({ el });
    };
  }, [uid]);
  return (
    <div
      className="sparql-native-source"
      ref={anchor}
      onInput={onEdit}
      aria-label="Native SPARQL source editor"
    />
  );
};

export const Workbench = ({
  graph,
  service,
  launch,
  wide,
  onWorkspace,
  blocked,
}: WorkbenchProps): React.ReactElement => {
  const defaults = readDefaults(graph);
  const block = graph.read(launch.blockUid);
  const blockDestination = block?.text.trim()
    ? launch.blockUid
    : graph.parent(launch.blockUid) || launch.blockUid;
  const [mode, setMode] = useState(launch.mode || "Current Page");
  const [sourceUid, setSourceUid] = useState(
    launch.sourceUid || defaults.customUid,
  );
  const [destination, setDestination] = useState(
    launch.mode === "Current Block" ? blockDestination : launch.destination,
  );
  const [endpoint, setEndpoint] = useState(WIKIDATA_SOURCE);
  const [endpointMode, setEndpointMode] =
    useState<Query["endpointMode"]>("prefix");
  const [format, setFormat] = useState<OutputFormat>("Parent");
  const [label, setLabel] = useState(defaults.label);
  const [name, setName] = useState("");
  const [limit, setLimit] = useState(defaults.limit);
  const [qualifiers, setQualifiers] = useState(defaults.qualifiers);
  const [properties, setProperties] = useState("");
  const [allProperties, setAllProperties] = useState(true);
  const [entityType, setEntityType] = useState<"item" | "property">("item");
  const [entityId, setEntityId] = useState("");
  const initialSearch =
    mode === "Current Block"
      ? block?.text ||
        graph.read(graph.parent(launch.blockUid) || "")?.text ||
        ""
      : launch.pageTitle || graph.read(launch.destination)?.text || "";
  const [search, setSearch] = useState(
    initialSearch.replace(/^\[\[|\]\]$/g, ""),
  );
  const [entities, setEntities] = useState<Entity[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [saved, setSaved] = useState<Saved>();
  const [library, setLibrary] = useState(() => readSaved(graph));
  const [librarySearch, setLibrarySearch] = useState("");
  const [showLibrary, setShowLibrary] = useState(!!wide);
  const [save, setSave] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [status, setStatus] = useState(
    launch.error ||
      "Choose a source, then import or preview. No graph changes yet.",
  );
  const [error, setError] = useState(!!launch.error);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const journalKey = `roamjs:sparql:v1:${host().graph.name}:journal`;
  const [journal, setJournal] = useState<Journal | undefined>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(journalKey) || "null") || undefined
      );
    } catch {
      return undefined;
    }
  });
  const [, setSourceRevision] = useState(0);
  const generation = useRef(0);
  const searchController = useRef<AbortController>();
  const mounted = useRef(true);
  const draftKey = `roamjs:sparql:v1:${host().graph.name}:draft`;
  const [draftAvailable, setDraftAvailable] = useState(
    () => !!localStorage.getItem(draftKey),
  );
  const initialDraft = useRef(true);
  useEffect(() => {
    if (initialDraft.current) {
      initialDraft.current = false;
      return;
    }
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        mode,
        sourceUid,
        destination,
        endpoint,
        endpointMode,
        format,
        label,
        name,
        limit,
        qualifiers,
        properties,
        allProperties,
        entityId,
        search,
      }),
    );
    setDraftAvailable(true);
  }, [
    mode,
    sourceUid,
    destination,
    endpoint,
    endpointMode,
    format,
    label,
    name,
    limit,
    qualifiers,
    properties,
    allProperties,
    entityId,
    search,
  ]);
  useEffect(() => {
    if (journal?.status === "partial")
      localStorage.setItem(journalKey, JSON.stringify(journal));
  }, [journal]);
  const savedRevision = useRef("");
  const fail = (caught: unknown): void => {
    setError(true);
    setStatus(caught instanceof Error ? caught.message : String(caught));
  };
  useEffect(
    () => (): void => {
      mounted.current = false;
      generation.current++;
      service.cancel();
      searchController.current?.abort();
    },
    [service],
  );
  useEffect(() => {
    if (
      mode === "Custom Query" &&
      !sourceUid &&
      !saved &&
      !launch.savedRoot &&
      !blocked
    )
      void ensureCustom(graph).then(setSourceUid).catch(fail);
  }, [mode, sourceUid, graph, blocked, saved]);
  useEffect(() => {
    if (blocked) {
      service.cancel();
      setPreview(undefined);
    }
  }, [blocked, service]);
  const refreshLibrary = (): void => setLibrary(readSaved(graph));
  const loadSaved = (record: Saved): void => {
    setSaved(record);
    setMode("Custom Query");
    setEndpoint(record.source);
    setEndpointMode(record.endpointMode);
    setFormat(record.outputFormat);
    setName(record.name);
    setDestination(record.rootUid);
    setLabel(
      readMeta(graph, record.rootUid)?.label ||
        graph
          .read(record.rootUid)
          ?.text.replace(/\s*\{\{\[\[table\]\]\}\}/, "") ||
        defaults.label,
    );
    setSourceUid(record.sourceUid || "");
    setPreview(undefined);
    setSave(true);
    savedRevision.current = JSON.stringify(graph.read(record.recordUid));
    setError(!!record.error);
    setStatus(
      record.error ||
        "Saved definition loaded. Refresh reads its latest graph record; save edited settings before refresh.",
    );
  };
  useEffect(() => {
    if (launch.savedRoot) {
      const record = readSaved(graph).find(
        (r) => r.rootUid === launch.savedRoot,
      );
      if (record) loadSaved(record);
      else
        fail(
          new Error(
            "Saved query was deleted. Reload the library or choose another source.",
          ),
        );
    }
  }, []);
  useEffect(() => {
    if (!launch.sourceUid) return;
    try {
      const query = sourceQuery({ graph, uid: launch.sourceUid });
      setSourceUid(query.sourceUid || "");
      setEndpoint(query.source);
      setEndpointMode(query.endpointMode);
      setFormat(query.outputFormat);
    } catch (caught) {
      fail(caught);
    }
  }, []);
  const querySpec = (): Query => {
    if (mode !== "Custom Query") {
      if (!allProperties && !properties.trim())
        throw new Error(
          "Select at least one property ID, or choose All properties.",
        );
      return {
        query: entityQuery({
          id: entityId,
          limit,
          qualifiers,
          properties: allProperties
            ? []
            : properties
                .split(/[\s,]+/)
                .filter(Boolean)
                .map((p) => p.toUpperCase()),
        }),
        source: WIKIDATA_SOURCE,
        endpointMode: "prefix",
        outputFormat: format,
        compatibility: false,
      };
    }
    const text = sourceUid
      ? codeFromBlock(graph.read(sourceUid)?.text || "")
      : saved?.query || "";
    if (!text)
      throw new Error(
        "Choose a SPARQL source block containing a fenced SELECT query.",
      );
    return {
      query: text,
      source: endpoint,
      endpointMode,
      outputFormat: format,
      sourceUid: sourceUid || undefined,
      compatibility: saved?.compatibility || false,
    };
  };
  const signature = (): string =>
    JSON.stringify({
      query: querySpec(),
      destination,
      label,
      name,
      save,
      record: saved ? graph.read(saved.recordUid) : null,
    });
  const latestSignature = useRef(signature);
  latestSignature.current = signature;
  const persistDraft = (): void => {
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        mode,
        sourceUid,
        destination,
        endpoint,
        endpointMode,
        format,
        label,
        name,
        limit,
        qualifiers,
        properties,
        allProperties,
        entityId,
        search,
      }),
    );
    setDraftAvailable(true);
  };
  const restoreDraft = (): void => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || "{}");
      setMode(draft.mode || "Custom Query");
      setSourceUid(draft.sourceUid || "");
      setDestination(draft.destination || launch.destination);
      setEndpoint(draft.endpoint || WIKIDATA_SOURCE);
      setEndpointMode(draft.endpointMode || "prefix");
      setFormat(draft.format || "Parent");
      setLabel(draft.label || defaults.label);
      setName(draft.name || "");
      setLimit(draft.limit || 10);
      setQualifiers(!!draft.qualifiers);
      setProperties(draft.properties || "");
      setAllProperties(draft.allProperties ?? true);
      setEntityId(draft.entityId || "");
      setSearch(draft.search || "");
      setSaved(undefined);
      setPreview(undefined);
      setStatus(
        "Local draft restored. Source content remains in its native graph block.",
      );
    } catch {
      fail(new Error("Local draft could not be read."));
    }
  };
  const run = async (importDirect = false): Promise<void> => {
    if (busy || blocked) return;
    const runId = ++generation.current;
    setBusy(true);
    setError(false);
    setJournal(undefined);
    setStatus("Querying endpoint… Existing results are retained.");
    persistDraft();
    try {
      const currentSignature = signature();
      const built =
        preview?.signature === currentSignature
          ? preview
          : await service.preview({
              query: querySpec(),
              destination,
              saved,
              signature: currentSignature,
              label,
              name,
              save,
            });
      if (!mounted.current || runId !== generation.current) return;
      if (latestSignature.current() !== currentSignature)
        throw new Error(
          "Query or destination changed during the request. Preview again.",
        );
      setPreview(built);
      if (mode !== "Custom Query")
        built.plan.destinationLinks = [
          `http://www.wikidata.org/entity/${entityId}`,
        ];
      if (
        importDirect &&
        built.legacyCopy &&
        preview?.signature !== currentSignature
      ) {
        setStatus(
          "Legacy import preserved. Review this preview, then choose Import adjacent copy.",
        );
        return;
      }
      if (!importDirect) {
        setStatus(
          `${built.plan.rows} result rows. Preview ready; no graph changes yet.`,
        );
        return;
      }
      setStatus(
        "Importing… Every graph write is awaited. Stop preserves completed writes.",
      );
      const outcome = await service.import({
        preview: built,
        currentSignature: latestSignature.current(),
        onProgress: (count) => {
          if (mounted.current)
            setStatus(`Importing… ${count} output writes completed.`);
        },
      });
      if (outcome.journal.status === "partial")
        localStorage.setItem(journalKey, JSON.stringify(outcome.journal));
      else if (outcome.journal.status === "complete")
        localStorage.removeItem(journalKey);
      if (!mounted.current) return;
      setJournal(outcome.journal);
      setPreview(undefined);
      refreshLibrary();
      if (outcome.journal.status !== "complete")
        throw new Error(
          `${outcome.journal.status === "partial" ? "Partial import" : "Import failed"}: ${outcome.journal.error}. ${outcome.journal.changes.length} recorded output changes. Identity or metadata writes may also have completed; inspect the graph.`,
        );
      setStatus(
        `Import complete. ${outcome.journal.changes.length} output writes. ${outcome.journal.retained.length ? `${outcome.journal.retained.length} edited, missing or obsolete output blocks retained; review manually.` : ""}`,
      );
      localStorage.removeItem(draftKey);
      setDraftAvailable(false);
    } catch (caught) {
      if (mounted.current) fail(caught);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const saveDefinition = async (copy: boolean): Promise<void> => {
    if (!saved || busy || blocked) return;
    if (
      !copy &&
      savedRevision.current !== JSON.stringify(graph.read(saved.recordUid))
    ) {
      fail(
        new Error(
          "Saved definition changed outside this surface. Reload library or save a copy.",
        ),
      );
      return;
    }
    try {
      const query = querySpec();
      if (copy) {
        const copyName = `${name || saved.name} (copy)`;
        const copiedSourceUid = await copyQuerySource({
          graph,
          query,
          name: copyName,
        });
        setSourceUid(copiedSourceUid);
        setSaved(undefined);
        setDestination(launch.destination);
        setSave(true);
        setPreview(undefined);
        setName(copyName);
        setStatus(
          "Copy draft ready. Import to create a separate saved output and definition.",
        );
        return;
      }
      await saveRecord({ graph, rootUid: saved.rootUid, query });
      const meta = readMeta(graph, saved.rootUid);
      await saveMeta({
        graph,
        meta: {
          ...(meta || {
            version: 1,
            rootUid: saved.rootUid,
            owned: [],
            compatibility: true,
          }),
          name: name || saved.name,
          label,
          endpointMode,
          sourceUid: sourceUid || undefined,
        },
      });
      savedRevision.current = JSON.stringify(graph.read(saved.recordUid));
      const updated = readSaved(graph).find(
        (record) => record.recordUid === saved.recordUid,
      );
      if (updated) setSaved(updated);
      refreshLibrary();
      setPreview(undefined);
      setStatus(
        "Definition saved. Preview or refresh reads the updated record.",
      );
    } catch (caught) {
      fail(caught);
    }
  };
  const searchNow = async (): Promise<void> => {
    const runId = ++generation.current;
    setSearchBusy(true);
    setError(false);
    const controller = new AbortController();
    searchController.current?.abort();
    searchController.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const found = await searchEntities({
        text: search,
        type: entityType,
        signal: controller.signal,
      });
      if (mounted.current && runId === generation.current) {
        setEntities(found);
        setStatus(
          found.length
            ? "Choose an entity. Property selection below filters its statements."
            : "No matching entities; correct the search or enter a Q/P identifier.",
        );
      }
    } catch (caught) {
      if (mounted.current && !controller.signal.aborted) fail(caught);
    } finally {
      clearTimeout(timer);
      if (mounted.current) setSearchBusy(false);
    }
  };
  let stale = false;
  try {
    stale = !!preview && preview.signature !== signature();
  } catch {
    stale = !!preview;
  }

  return (
    <div
      className={`sparql-workbench ${wide ? "sparql-wide" : ""}`}
      data-testid="sparql-workbench"
    >
      {blocked && (
        <Callout intent="warning" title="SPARQL is in standby">
          {blocked}
        </Callout>
      )}
      <div
        className={`sparql-layout ${showLibrary ? "sparql-with-library" : ""}`}
      >
        {showLibrary && (
          <aside className="sparql-library" aria-label="Saved query library">
            <h4>Saved queries</h4>
            <InputGroup
              aria-label="Search saved queries"
              placeholder="Search saved queries"
              value={librarySearch}
              onChange={(e) => setLibrarySearch(e.target.value)}
            />
            <Button
              minimal
              icon="refresh"
              text="Reload library"
              onClick={refreshLibrary}
              disabled={busy}
            />
            <div className="sparql-library-results">
              {library
                .filter((record) =>
                  `${record.name} ${record.query}`
                    .toLowerCase()
                    .includes(librarySearch.toLowerCase()),
                )
                .map((record) => (
                  <Button
                    key={record.recordUid}
                    minimal
                    fill
                    active={saved?.recordUid === record.recordUid}
                    icon={record.error ? "warning-sign" : "document"}
                    text={record.name}
                    onClick={() => loadSaved(record)}
                    disabled={busy}
                  />
                ))}
              {!library.length && <p>No saved imports yet.</p>}
            </div>
          </aside>
        )}
        <main className="sparql-main">
          <div className="sparql-scroll">
            <div className="sparql-toolbar">
              {!wide && (
                <Button
                  minimal
                  icon="folder-open"
                  text="Saved queries"
                  active={showLibrary}
                  onClick={() => setShowLibrary(!showLibrary)}
                  disabled={busy}
                />
              )}
              <Button
                minimal
                icon="document-open"
                text="Workspace"
                onClick={onWorkspace}
                disabled={busy}
              />
              <Button minimal text="Keep local draft" onClick={persistDraft} />
              {draftAvailable && (
                <Button
                  minimal
                  text="Restore draft"
                  onClick={restoreDraft}
                  disabled={busy}
                />
              )}
            </div>
            <fieldset disabled={busy || !!blocked}>
              <Label>
                Query type
                <HTMLSelect
                  aria-label="Query type"
                  value={mode}
                  onChange={(e) => {
                    const next = e.target.value;
                    setMode(next);
                    setSaved(undefined);
                    setPreview(undefined);
                    setDestination(
                      next === "Current Block"
                        ? blockDestination || launch.destination
                        : launch.destination,
                    );
                    setSearch(
                      next === "Current Block"
                        ? block?.text ||
                            graph.read(graph.parent(launch.blockUid) || "")
                              ?.text ||
                            ""
                        : launch.pageTitle ||
                            graph.read(launch.destination)?.text ||
                            "",
                    );
                  }}
                  options={["Current Page", "Current Block", "Custom Query"]}
                />
              </Label>
              {mode !== "Custom Query" ? (
                <>
                  <div className="sparql-inline">
                    <Label>
                      Look up
                      <HTMLSelect
                        aria-label="Entity kind"
                        value={entityType}
                        onChange={(e) => {
                          setEntityType(e.target.value as "item" | "property");
                          setEntityId("");
                          setEntities([]);
                          setAllProperties(true);
                          setProperties("");
                        }}
                        options={[
                          { label: "Item (Q)", value: "item" },
                          { label: "Property details (P)", value: "property" },
                        ]}
                      />
                    </Label>
                    <Label className="sparql-grow">
                      Name or Q/P identifier
                      <InputGroup
                        aria-label="Entity search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void searchNow();
                          }
                        }}
                      />
                    </Label>
                    <Button
                      text="Search"
                      icon="search"
                      onClick={() => void searchNow()}
                      disabled={searchBusy || !search.trim()}
                    />
                  </div>
                  <div className="sparql-entities">
                    {searchBusy ? (
                      <Spinner size={20} />
                    ) : (
                      <RadioGroup
                        selectedValue={entityId}
                        onChange={(e) => setEntityId(e.currentTarget.value)}
                      >
                        {entities.map((entity) => (
                          <Radio
                            key={entity.id}
                            value={entity.id}
                            labelElement={
                              <span>
                                <strong>{entity.label}</strong> ({entity.id}){" "}
                                <span className="sparql-muted">
                                  {entity.description}
                                </span>{" "}
                                <a
                                  href={`https://www.wikidata.org/wiki/${entity.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Inspect
                                </a>
                              </span>
                            }
                          />
                        ))}
                      </RadioGroup>
                    )}
                  </div>
                  <Checkbox
                    label="All properties"
                    checked={allProperties}
                    onChange={(e) => setAllProperties(e.currentTarget.checked)}
                  />
                  {!allProperties && (
                    <Label>
                      Selected property IDs
                      <InputGroup
                        aria-label="Selected properties"
                        placeholder="P31, P569"
                        value={properties}
                        onChange={(e) => setProperties(e.target.value)}
                      />
                      <span className="sparql-muted">
                        Filters statements for the chosen entity; property
                        lookup above imports details about a P entity.
                      </span>
                    </Label>
                  )}
                  <div className="sparql-inline">
                    <Label>
                      Result row limit
                      <NumericInput
                        aria-label="Result row limit"
                        min={1}
                        max={10000}
                        value={limit}
                        onValueChange={setLimit}
                      />
                    </Label>
                    <Checkbox
                      label="Import qualifiers"
                      checked={qualifiers}
                      onChange={(e) => setQualifiers(e.currentTarget.checked)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <Label>
                    Source block UID
                    <InputGroup
                      aria-label="Source block UID"
                      value={sourceUid}
                      placeholder="Native SPARQL block UID"
                      onChange={(e) =>
                        setSourceUid(e.target.value.replace(/^\(\(|\)\)$/g, ""))
                      }
                    />
                  </Label>
                  <div className="sparql-inline">
                    <Button
                      minimal
                      text="Resolve source/reference"
                      onClick={() => {
                        try {
                          const query = sourceQuery({ graph, uid: sourceUid });
                          setSourceUid(query.sourceUid || "");
                          setEndpoint(query.source);
                          setEndpointMode(query.endpointMode);
                          setFormat(query.outputFormat);
                          setStatus(
                            "Query source resolved. Source and destination are independent.",
                          );
                        } catch (caught) {
                          fail(caught);
                        }
                      }}
                    />
                    <Button
                      minimal
                      text="Open source"
                      icon="share"
                      disabled={!sourceUid}
                      onClick={() =>
                        void host().ui.mainWindow.openBlock({
                          block: { uid: sourceUid },
                        })
                      }
                    />
                    <Button
                      minimal
                      text="Use shared custom query"
                      onClick={() =>
                        void ensureCustom(graph).then(setSourceUid).catch(fail)
                      }
                    />
                  </div>
                  {sourceUid && graph.read(sourceUid) ? (
                    <NativeSource
                      key={sourceUid}
                      uid={sourceUid}
                      onEdit={() => setSourceRevision((v) => v + 1)}
                      disabled={busy || !!blocked}
                    />
                  ) : (
                    saved && (
                      <Callout>
                        The saved query text is preserved in its legacy record.
                        Set a source UID to edit a native query, or keep the
                        saved text for refresh.
                      </Callout>
                    )
                  )}
                </>
              )}
              <Label>
                Destination page or block UID
                <InputGroup
                  aria-label="Destination UID"
                  disabled={!!saved}
                  value={destination}
                  onChange={(e) =>
                    setDestination(e.target.value.replace(/^\(\(|\)\)$/g, ""))
                  }
                />
                <span className="sparql-muted">
                  {graph.read(destination)?.text || "Destination not found"}
                  {saved
                    ? " · saved output root"
                    : " · a new import root will be added here"}
                </span>
              </Label>
              <Button
                minimal
                icon={advanced ? "caret-up" : "caret-down"}
                text="Query settings"
                onClick={() => setAdvanced(!advanced)}
              />
              <Collapse isOpen={advanced}>
                <div className="sparql-options">
                  <Label>
                    Import label
                    <InputGroup
                      aria-label="Import label"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </Label>
                  <Label>
                    Library name
                    <InputGroup
                      aria-label="Library name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Optional; defaults to the import label"
                    />
                  </Label>
                  <Label>
                    Output format
                    <HTMLSelect
                      aria-label="Output format"
                      value={format}
                      options={["Parent", "Line", "Table"]}
                      onChange={(e) =>
                        setFormat(e.target.value as OutputFormat)
                      }
                    />
                  </Label>
                  {mode === "Custom Query" && (
                    <>
                      <Label>
                        SPARQL endpoint
                        <InputGroup
                          aria-label="SPARQL endpoint"
                          value={endpoint}
                          onChange={(e) => setEndpoint(e.target.value)}
                        />
                      </Label>
                      <Label>
                        Endpoint mode
                        <HTMLSelect
                          aria-label="Endpoint mode"
                          value={endpointMode}
                          onChange={(e) =>
                            setEndpointMode(
                              e.target.value as Query["endpointMode"],
                            )
                          }
                          options={[
                            {
                              value: "prefix",
                              label: "Legacy URL prefix + encoded query",
                            },
                            {
                              value: "standard",
                              label: "Standard endpoint (query parameter)",
                            },
                          ]}
                        />
                      </Label>
                    </>
                  )}
                  <Checkbox
                    label="Save query for refresh"
                    checked={save}
                    onChange={(e) => setSave(e.currentTarget.checked)}
                  />
                  {saved && (
                    <div className="sparql-inline">
                      <Button
                        text="Save definition"
                        onClick={() => void saveDefinition(false)}
                      />
                      <Button
                        text="Save a copy"
                        onClick={() => void saveDefinition(true)}
                      />
                      <Button
                        minimal
                        text="Reload saved definition"
                        onClick={() => {
                          const record = readSaved(graph).find(
                            (r) => r.recordUid === saved.recordUid,
                          );
                          if (record) loadSaved(record);
                          else fail(new Error("Saved record was deleted."));
                        }}
                      />
                    </div>
                  )}
                </div>
              </Collapse>
            </fieldset>
            <div
              className="sparql-preview"
              aria-label="SPARQL result preview"
              aria-busy={busy}
            >
              {preview ? (
                <>
                  <h4>
                    {stale
                      ? "Preview is stale"
                      : `${preview.plan.rows} result rows`}
                  </h4>
                  {preview.plan.warnings.map((warning) => (
                    <Callout key={warning} intent="warning">
                      {warning}
                    </Callout>
                  ))}
                  <TreePreview nodes={preview.plan.nodes} />
                  {!!preview.plan.identities.length && (
                    <details>
                      <summary>
                        {preview.plan.identities.length} proposed identity links
                      </summary>
                      <ul>
                        {preview.plan.identities.map((identity) => (
                          <li key={`${identity.title}:${identity.uri}`}>
                            [[{identity.title}]] → same as:: {identity.uri}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <p>
                  {busy
                    ? "Working… Existing results remain readable."
                    : "Preview appears here. Import also fetches and validates before writing."}
                </p>
              )}
            </div>
            <Callout
              intent={error ? "danger" : "none"}
              className="sparql-status"
            >
              <div role="status" aria-live="polite">
                {status}
              </div>
            </Callout>
            {journal?.status === "partial" && (
              <details>
                <summary>
                  Operation journal · {journal.status} ·{" "}
                  {journal.changes.length} output writes
                </summary>
                <pre>{JSON.stringify(journal, null, 2)}</pre>
                <Button
                  text="Recover unchanged output writes"
                  disabled={busy || !!blocked}
                  onClick={async () => {
                    try {
                      const recovered = await recover({ graph, journal });
                      setStatus(
                        `Recovered ${recovered.recovered.length} output writes; retained ${recovered.retained.length} changed or referenced blocks. Identity links and saved metadata require manual review.`,
                      );
                      setJournal(undefined);
                      localStorage.removeItem(journalKey);
                      refreshLibrary();
                    } catch (caught) {
                      fail(caught);
                    }
                  }}
                />
              </details>
            )}
          </div>
          <div className="sparql-actions">
            {busy ? (
              <Button
                intent="warning"
                text="Stop"
                icon="stop"
                onClick={() => service.cancel()}
              />
            ) : (
              <>
                <Button
                  text="Preview"
                  icon="eye-open"
                  onClick={() => void run()}
                  disabled={!!blocked}
                />
                <Button
                  intent="primary"
                  text={
                    preview?.legacyCopy
                      ? "Import adjacent copy"
                      : saved
                        ? "Refresh saved import"
                        : preview && !stale
                          ? "Import previewed results"
                          : "Import"
                  }
                  icon="bring-data"
                  onClick={() => void run(true)}
                  disabled={!!blocked}
                />
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
