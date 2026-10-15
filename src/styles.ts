export const CSS = `
.sparql-dialog.bp3-dialog{width:min(760px,calc(100vw - 28px));border-radius:8px;padding:0;overflow:hidden;box-shadow:0 8px 28px #0003}
.sparql-dialog .bp3-dialog-header{box-shadow:none;border-bottom:1px solid #d3d8dc}
.sparql-workbench{color:inherit;font-size:14px}.sparql-dialog .sparql-workbench{background:#fff}.sparql-layout{display:grid;grid-template-columns:minmax(0,1fr)}.sparql-with-library{grid-template-columns:170px minmax(0,1fr)}
.sparql-main{padding:0;min-width:0;max-height:78vh;overflow:hidden;display:flex;flex-direction:column}.sparql-scroll{padding:16px;min-height:0;overflow:auto}.sparql-library{padding:12px;border-right:1px solid #d3d8dc;min-width:0}
.sparql-library .bp3-button-text{text-align:left;overflow-wrap:anywhere}.sparql-library-results{min-height:160px;max-height:480px;overflow:auto}
.sparql-workbench fieldset{border:0;padding:0;margin:0;min-width:0}.sparql-workbench label{font-weight:500}.sparql-workbench .bp3-label>.bp3-input-group{margin-top:5px}
.sparql-inline,.sparql-toolbar,.sparql-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sparql-grow{flex:1;min-width:140px}
.sparql-toolbar{margin-bottom:12px}.sparql-muted{font-weight:400;font-size:12px;opacity:.72;display:block;margin:5px 0}.sparql-entities{height:130px;overflow:auto;margin:10px 0;padding:8px;border:1px solid #d3d8dc;border-radius:3px}
.sparql-native-source{padding:10px;border:1px solid #d3d8dc;border-radius:4px;min-height:100px;margin:12px 0}.sparql-native-source .rm-code-block{margin:0}
.sparql-options{padding:12px 0}.sparql-preview{height:180px;overflow:auto;padding:12px;border:1px solid #d3d8dc;border-radius:4px;margin:12px 0;overflow-wrap:anywhere}.sparql-preview ul{padding-left:18px}
.sparql-preview .bp3-callout{margin-bottom:8px}.sparql-status{margin:8px 0}.sparql-actions{justify-content:flex-end;padding:8px 16px;border-top:1px solid #d3d8dc;flex-shrink:0}.sparql-workbench pre{max-height:200px;overflow:auto;font-size:11px;white-space:pre-wrap}
.sparql-footer{height:30px;box-sizing:border-box;background:#ebeceb;border-top:1px solid #d3d4d4;padding:3px 8px;display:flex;align-items:center;justify-content:flex-end;font-size:12px;color:#394b59}
.sparql-footer kbd{background:#0001;border-radius:2px;padding:1px 4px;font-size:10px;margin-left:6px}.sparql-wide .sparql-main{max-height:none}.sparql-workspace-mount{margin:20px 0}
.bp3-dark .sparql-footer{background:#293742;color:#f5f8fa}.bp3-dark .sparql-dialog .sparql-workbench{background:#30404d}.bp3-dark .sparql-library,.bp3-dark .sparql-preview,.bp3-dark .sparql-native-source,.bp3-dark .sparql-entities{border-color:#5c7080}
@media(max-width:680px){.sparql-layout{grid-template-columns:1fr}.sparql-library{border-right:0;border-bottom:1px solid #d3d8dc}.sparql-library-results{min-height:40px;max-height:110px}.sparql-main{max-height:65vh}.sparql-library h4{margin:0 0 8px}}
`;
