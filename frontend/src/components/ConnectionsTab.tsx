import { useState } from "react";
import type { SeparationState } from "../types";
import { findSeparation } from "../api/client";
import { SearchForm } from "./SearchForm";
import { Results } from "./Results";

/** The original "find the shortest connection" finder, now its own tab. */
export function ConnectionsTab() {
  const [state, setState] = useState<SeparationState>({ status: "idle", result: null, error: null });

  async function handleSearch(player1: string, player2: string) {
    setState({ status: "loading", result: null, error: null });
    try {
      const result = await findSeparation(player1, player2);
      setState({ status: "success", result, error: null });
    } catch (err) {
      setState({
        status: "error",
        result: null,
        error: err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  return (
    <section className="animate-slide-up">
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl sm:text-4xl font-extrabold">
          <span className="text-kit-white">Connection </span>
          <span className="text-gradient">Finder</span>
        </h2>
        <p className="mt-2 text-kit-gray max-w-lg mx-auto text-sm">
          Pick any two players and see the shortest chain of shared teammates between them.
        </p>
      </div>
      <SearchForm onSearch={handleSearch} isLoading={state.status === "loading"} />
      <Results state={state} />
    </section>
  );
}
