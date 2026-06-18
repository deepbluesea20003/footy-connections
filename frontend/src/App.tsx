import { useState } from "react";
import type { SeparationState } from "./types";
import { findSeparation } from "./api/client";
import { SearchForm } from "./components/SearchForm";
import { Results } from "./components/Results";

export default function App() {
  const [state, setState] = useState<SeparationState>({
    status: "idle",
    result: null,
    error: null,
  });

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
    <div className="min-h-screen px-4 py-12 sm:py-20">
      <header className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
          <span className="text-kit-white">Football </span>
          <span className="text-turf">Separation</span>
          <span className="text-kit-white"> Number</span>
        </h1>
        <p className="mt-3 text-kit-gray max-w-lg mx-auto">
          Find the shortest connection between any two Premier League players through shared teammates.
        </p>
      </header>
      <SearchForm onSearch={handleSearch} isLoading={state.status === "loading"} />
      <Results state={state} />
    </div>
  );
}
