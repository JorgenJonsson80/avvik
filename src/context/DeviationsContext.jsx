import { createContext, useContext } from "react";
import { useDeviations } from "../hooks/useDeviations.js";

const DeviationsContext = createContext(null);

// HistorikTab, VeckaTab, AnalysTab, AtgarderTab, and ImportTab each called
// useDeviations() independently with identical (unbounded) args. Since tabs
// unmount on switch, every visit re-fetched the whole (unboundedly growing)
// deviations table from scratch — visiting all five tabs in one session
// cost five full fetches instead of one. Sharing a single instance here
// fixes that without changing what any tab sees: the query and its args
// are unchanged, mutations (updateOrsak, refetch after import) now update
// state every consumer shares instead of just the tab that called them.
// StatistikTab keeps its own separate windowed useDeviations() call —
// different query (fromDate/toDate-bound), deliberately not merged in.
export function DeviationsProvider({ children }) {
  const value = useDeviations();
  return <DeviationsContext.Provider value={value}>{children}</DeviationsContext.Provider>;
}

export function useDeviationsContext() {
  const ctx = useContext(DeviationsContext);
  if (!ctx) throw new Error("useDeviationsContext must be used within a DeviationsProvider");
  return ctx;
}
