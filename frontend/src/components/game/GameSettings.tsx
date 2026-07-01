import { useEffect, useState } from "react";
import type { Difficulty, GameLeague } from "../../types";
import { getLeagues } from "../../api/client";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

interface Settings {
  difficulty: Difficulty;
  leagues: string[];
}

interface Props {
  initial: Settings;
  onApply: (s: Settings) => void;
  onClose: () => void;
}

const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: "easy", label: "Easy", blurb: "Famous players, ~2 links apart" },
  { id: "medium", label: "Medium", blurb: "Well-known names, 3–4 links" },
  { id: "hard", label: "Hard", blurb: "Trickier pairs, 5+ links" },
];

export function GameSettings({ initial, onApply, onClose }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty>(initial.difficulty);
  const [leagues, setLeagues] = useState<Set<string>>(new Set(initial.leagues));
  const [available, setAvailable] = useState<GameLeague[]>([]);

  useEffect(() => {
    const c = new AbortController();
    getLeagues(c.signal)
      .then((r) => !c.signal.aborted && setAvailable(r.leagues))
      .catch(() => {});
    return () => c.abort();
  }, []);

  function toggleLeague(id: string) {
    setLeagues((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <Modal title="Game settings" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-6">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-kit-dim font-semibold mb-3">Difficulty</h3>
          <div className="grid grid-cols-3 gap-2">
            {DIFFICULTIES.map((d) => {
              const on = d.id === difficulty;
              return (
                <button
                  key={d.id}
                  onClick={() => setDifficulty(d.id)}
                  className={`rounded-xl border px-3 py-3 text-left transition-all ${
                    on
                      ? "border-turf bg-turf/10 card-glow"
                      : "border-pitch-border bg-pitch-light/50 hover:border-turf/40"
                  }`}
                >
                  <div className={`font-display font-bold ${on ? "text-turf" : "text-kit-white"}`}>{d.label}</div>
                  <div className="text-[11px] text-kit-gray mt-1 leading-tight">{d.blurb}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs uppercase tracking-wider text-kit-dim font-semibold">
              Leagues {leagues.size > 0 && <span className="text-turf">· {leagues.size}</span>}
            </h3>
            {leagues.size > 0 && (
              <button onClick={() => setLeagues(new Set())} className="text-xs text-kit-dim hover:text-kit-white">
                Clear
              </button>
            )}
          </div>
          <p className="text-[11px] text-kit-gray mb-3">
            Leave empty for any league. Pick one or more to restrict both players to those competitions.
          </p>
          <div className="flex flex-wrap gap-2">
            {available.length === 0 && <span className="text-xs text-kit-dim">Loading leagues…</span>}
            {available.map((l) => {
              const on = leagues.has(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() => toggleLeague(l.id)}
                  title={l.country}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                    on
                      ? "border-turf bg-turf text-[#061009]"
                      : "border-pitch-border bg-pitch-light/50 text-kit-gray hover:text-kit-white hover:border-turf/40"
                  }`}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
        </div>

        <Button
          className="w-full"
          onClick={() => {
            onApply({ difficulty, leagues: [...leagues] });
            onClose();
          }}
        >
          Start new game
        </Button>
      </div>
    </Modal>
  );
}
