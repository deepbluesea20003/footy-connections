import { useState, useRef, useEffect } from "react";
import type { PlayerSuggestion } from "../types";
import { usePlayerSearch } from "../hooks/usePlayerSearch";

interface Props {
  label: string;
  selected: PlayerSuggestion | null;
  onSelect: (player: PlayerSuggestion) => void;
  onClear: () => void;
}

export function PlayerAutocomplete({ label, selected, onSelect, onClear }: Props) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const { suggestions } = usePlayerSearch(query);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (suggestions.length > 0 && query.length >= 2 && !selected) {
      setIsOpen(true);
    }
    setHighlightedIndex(-1);
  }, [suggestions, query.length, selected]);

  function handleSelect(player: PlayerSuggestion) {
    onSelect(player);
    setQuery(player.name);
    setIsOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[highlightedIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  function handleChange(value: string) {
    setQuery(value);
    if (selected) onClear();
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <label className="block text-sm font-medium text-kit-gray mb-1.5">{label}</label>
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0 && !selected) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search for a player..."
        className="w-full px-4 py-3 rounded-lg bg-pitch-light border border-pitch-border text-kit-white placeholder-kit-dim focus:outline-none focus:border-turf focus:ring-1 focus:ring-turf transition-colors"
        role="combobox"
        aria-expanded={isOpen}
      />
      {selected && (
        <div className="absolute right-3 top-[38px] text-turf text-sm">&#10003;</div>
      )}
      {isOpen && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-10 w-full mt-1 bg-pitch-light border border-pitch-border rounded-lg overflow-hidden shadow-lg max-h-60 overflow-y-auto"
        >
          {suggestions.map((player, i) => (
            <li
              key={player.id}
              role="option"
              aria-selected={i === highlightedIndex}
              className={`px-4 py-2.5 cursor-pointer transition-colors ${
                i === highlightedIndex
                  ? "bg-pitch-lighter text-kit-white"
                  : "text-kit-gray hover:bg-pitch-lighter hover:text-kit-white"
              }`}
              onMouseEnter={() => setHighlightedIndex(i)}
              onClick={() => handleSelect(player)}
            >
              <span className="font-medium text-kit-white">{player.name}</span>
              <span className="ml-2 text-xs text-kit-dim">{player.clubs.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
