export const developerPresent = (loaded: Iterable<string>): boolean =>
  [...loaded].some((name) => /^(?:@roamjs\/)?developer$/i.test(name));
export const COEXISTENCE_WARNING =
  "Developer is loaded. This version cannot verify whether its legacy SPARQL module is disabled or whether old handlers remain. Disable Developer, reload Roam, then enable SPARQL. Developer's text disable_sparql setting alone is not a verified handoff. Other Developer features are unavailable while Developer is disabled. No graph migration is required.";
