import { useState, useEffect, useRef } from "react";
import type { PlayerSuggestion } from "../types";
import { searchPlayers } from "../api/client";
import { useDebounce } from "./useDebounce";

export function usePlayerSearch(query: string) {
  const [suggestions, setSuggestions] = useState<PlayerSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebounce(query, 200);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    searchPlayers(debouncedQuery, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setSuggestions(res.players);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [debouncedQuery]);

  return { suggestions, isLoading };
}
