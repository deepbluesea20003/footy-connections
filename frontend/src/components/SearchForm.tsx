import { useState, useEffect } from "react";
import type { PlayerSuggestion, PlayerDetail } from "../types";
import { getPlayer } from "../api/client";
import { PlayerAutocomplete } from "./PlayerAutocomplete";
import { PlayerCard } from "./PlayerCard";

interface Props {
  onSearch: (player1: string, player2: string) => void;
  isLoading: boolean;
}

/** Fetches and renders the rich card for a player picked in the autocomplete. */
function SelectedPlayerCard({ id }: { id: string }) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);

  useEffect(() => {
    setDetail(null);
    const controller = new AbortController();
    getPlayer(id, controller.signal)
      .then((d) => !controller.signal.aborted && setDetail(d))
      .catch(() => {});
    return () => controller.abort();
  }, [id]);

  if (!detail) {
    return (
      <div className="w-full rounded-xl border border-pitch-border bg-pitch-light p-4 flex justify-center">
        <div className="w-6 h-6 border-2 border-turf border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return <PlayerCard detail={detail} highlight />;
}

export function SearchForm({ onSearch, isLoading }: Props) {
  const [player1, setPlayer1] = useState<PlayerSuggestion | null>(null);
  const [player2, setPlayer2] = useState<PlayerSuggestion | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (player1 && player2) {
      // Pass canonical ids (not names) so the exact player picked in the
      // autocomplete is used — same-name players resolve unambiguously.
      onSearch(player1.id, player2.id);
    }
  }

  const canSubmit = player1 !== null && player2 !== null && !isLoading;

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row gap-4 items-end">
        <PlayerAutocomplete
          label="Player 1"
          selected={player1}
          onSelect={setPlayer1}
          onClear={() => setPlayer1(null)}
        />
        <div className="hidden sm:flex items-center pb-3 text-kit-dim text-lg font-bold">&#8596;</div>
        <PlayerAutocomplete
          label="Player 2"
          selected={player2}
          onSelect={setPlayer2}
          onClear={() => setPlayer2(null)}
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-6 py-3 rounded-lg font-semibold transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed bg-turf text-pitch hover:bg-turf-light active:bg-turf-dark"
        >
          {isLoading ? "Finding..." : "Find Connection"}
        </button>
      </div>

      {(player1 || player2) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
          <div>{player1 && <SelectedPlayerCard id={player1.id} />}</div>
          <div>{player2 && <SelectedPlayerCard id={player2.id} />}</div>
        </div>
      )}
    </form>
  );
}
