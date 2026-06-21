import { lazy, Suspense, useState } from "react";
import type { SeparationState } from "../types";
import { ConnectionChain } from "./ConnectionChain";

// Code-split: the force-graph library + canvas viz load only when opened.
const BfsGraphPanel = lazy(() => import("./BfsGraph"));

interface Props {
  state: SeparationState;
}

export function Results({ state }: Props) {
  const [showGraph, setShowGraph] = useState(false);

  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <div className="w-8 h-8 border-3 border-turf border-t-transparent rounded-full animate-spin" />
        <p className="text-kit-gray text-sm">Finding the shortest connection...</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="max-w-md mx-auto mt-12 p-6 rounded-xl bg-foul/10 border border-foul/30 text-center">
        <p className="text-foul font-medium">{state.error}</p>
      </div>
    );
  }

  if (!state.result || !state.result.found) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6 rounded-xl bg-pitch-light border border-pitch-border text-center">
        <p className="text-kit-gray text-lg">No connection found between these players.</p>
        <p className="text-kit-dim text-sm mt-2">They may not share any teammate chains in our dataset.</p>
      </div>
    );
  }

  return (
    <div className="mt-12 flex flex-col items-center gap-8">
      <div className="text-center">
        <div className="text-6xl font-extrabold text-turf">{state.result.separationNumber}</div>
        <div className="text-kit-gray text-sm mt-1 uppercase tracking-wider font-medium">
          Separation Number
        </div>
      </div>
      <ConnectionChain path={state.result.path} />

      {state.result.path.length >= 2 && (
        <div className="w-full max-w-4xl">
          <button
            onClick={() => setShowGraph((v) => !v)}
            className="mx-auto flex items-center gap-2 px-4 py-2 rounded-lg border border-pitch-border bg-pitch-light text-sm text-kit-gray hover:text-kit-white hover:border-turf/50 transition-colors"
            aria-expanded={showGraph}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" />
              <path d="M7 6h10M6.5 8l4.5 8M17.5 8L13 16" strokeLinecap="round" />
            </svg>
            {showGraph ? "Hide search graph" : "Explore the search graph"}
          </button>

          {showGraph && (
            <div className="mt-4">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center gap-3 py-16 text-kit-gray text-sm">
                    <div className="w-5 h-5 border-2 border-turf border-t-transparent rounded-full animate-spin" />
                    Loading graph…
                  </div>
                }
              >
                <BfsGraphPanel
                  player1Id={state.result.path[0].playerId}
                  player2Id={state.result.path[state.result.path.length - 1].playerId}
                />
              </Suspense>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
