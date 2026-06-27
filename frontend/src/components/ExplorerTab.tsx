import { lazy, Suspense, useState } from "react";
import type { PlayerSuggestion } from "../types";
import { PlayerAutocomplete } from "./PlayerAutocomplete";
import { Button } from "./ui/Button";

const BfsGraphPanel = lazy(() => import("./BfsGraph"));

/** The interactive BFS connection-web, promoted to its own tab. */
export function ExplorerTab() {
  const [player1, setPlayer1] = useState<PlayerSuggestion | null>(null);
  const [player2, setPlayer2] = useState<PlayerSuggestion | null>(null);
  const [pair, setPair] = useState<{ a: string; b: string } | null>(null);

  return (
    <section className="animate-slide-up">
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl sm:text-4xl font-extrabold">
          <span className="text-kit-white">Connection </span>
          <span className="text-gradient">Web</span>
        </h2>
        <p className="mt-2 text-kit-gray max-w-lg mx-auto text-sm">
          Visualise every teammate the search fans through. Drag, zoom, and click a node to expand it.
        </p>
      </div>

      <div className="w-full max-w-3xl mx-auto flex flex-col sm:flex-row gap-4 items-end">
        <PlayerAutocomplete label="Player 1" selected={player1} onSelect={setPlayer1} onClear={() => setPlayer1(null)} />
        <div className="hidden sm:flex items-center pb-3 text-kit-dim text-lg font-bold">↔</div>
        <PlayerAutocomplete label="Player 2" selected={player2} onSelect={setPlayer2} onClear={() => setPlayer2(null)} />
        <Button
          disabled={!player1 || !player2}
          onClick={() => player1 && player2 && setPair({ a: player1.id, b: player2.id })}
        >
          Build web
        </Button>
      </div>

      {pair && (
        <div className="mt-8">
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-3 py-16 text-kit-gray text-sm">
                <div className="w-5 h-5 border-2 border-turf border-t-transparent rounded-full animate-spin" />
                Loading graph…
              </div>
            }
          >
            <BfsGraphPanel key={`${pair.a}|${pair.b}`} player1Id={pair.a} player2Id={pair.b} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
