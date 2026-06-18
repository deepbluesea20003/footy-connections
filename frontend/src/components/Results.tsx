import type { SeparationState } from "../types";
import { ConnectionChain } from "./ConnectionChain";

interface Props {
  state: SeparationState;
}

export function Results({ state }: Props) {
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
    </div>
  );
}
