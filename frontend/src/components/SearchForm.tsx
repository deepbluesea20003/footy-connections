import { useState } from "react";
import type { PlayerSuggestion } from "../types";
import { PlayerAutocomplete } from "./PlayerAutocomplete";

interface Props {
  onSearch: (player1: string, player2: string) => void;
  isLoading: boolean;
}

export function SearchForm({ onSearch, isLoading }: Props) {
  const [player1, setPlayer1] = useState<PlayerSuggestion | null>(null);
  const [player2, setPlayer2] = useState<PlayerSuggestion | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (player1 && player2) {
      onSearch(player1.name, player2.name);
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
    </form>
  );
}
