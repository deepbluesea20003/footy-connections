import { useCallback, useEffect, useState } from "react";
import type { Difficulty, HintResult, Puzzle, SeparationResult } from "../../types";
import { newGame, getHint, getGameSolution } from "../../api/client";
import { GamePane, type GameStateOut } from "./GamePane";
import { GameSettings } from "./GameSettings";
import { GameResult } from "./GameResult";
import { ConnectionChain } from "../ConnectionChain";
import { ClubBadge } from "../ClubBadge";
import { Button } from "../ui/Button";

interface Settings {
  difficulty: Difficulty;
  leagues: string[];
}

const SETTINGS_KEY = "fc.game.settings";

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "");
    if (s?.difficulty) return { difficulty: s.difficulty, leagues: Array.isArray(s.leagues) ? s.leagues : [] };
  } catch {
    /* ignore */
  }
  return { difficulty: "medium", leagues: [] };
}

function HintCard({ hint, onClose }: { hint: HintResult; onClose: () => void }) {
  if (!hint.found) {
    return (
      <div className="mx-auto max-w-md mt-4 rounded-xl border border-pitch-border bg-pitch-light/70 p-3 text-sm text-kit-gray">
        No hint available from here.
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md mt-4 rounded-xl border border-whistle/40 bg-whistle/10 p-3 animate-slide-up">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-wider text-whistle font-semibold">💡 Hint</span>
        <button onClick={onClose} className="text-kit-dim hover:text-kit-white text-sm">
          dismiss
        </button>
      </div>
      <div className="flex items-center gap-2">
        <ClubBadge name={hint.club ?? ""} crestUrl={hint.crestUrl} size={26} />
        <div className="text-sm text-kit-white">
          Open the dropdown and look for{" "}
          <span className="font-semibold">
            {hint.club} ({hint.season})
          </span>
          {hint.isFinal ? (
            <> — that squad reaches the target.</>
          ) : (
            hint.player && (
              <>
                {" "}
                — then pick someone whose name starts with{" "}
                <span className="font-semibold">{hint.player.initial}</span>
                {hint.player.nationality ? ` (${hint.player.nationality})` : ""}.
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function GameTab() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [game, setGame] = useState<GameStateOut | null>(null);
  const [hint, setHint] = useState<HintResult | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [revealed, setRevealed] = useState<SeparationResult | null>(null);

  const won = !!game?.won;
  const gameOver = won || revealed !== null;

  const start = useCallback(async (opts: { difficulty?: Difficulty; leagues?: string[]; mode?: "daily" }) => {
    setLoading(true);
    setError(null);
    setGame(null);
    setHint(null);
    setHintsUsed(0);
    setRevealed(null);
    try {
      const p = await newGame(
        opts.mode === "daily" ? { mode: "daily" } : { difficulty: opts.difficulty, leagues: opts.leagues }
      );
      setPuzzle(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a game.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Kick off an initial game on mount.
  useEffect(() => {
    void start({ difficulty: settings.difficulty, leagues: settings.leagues });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onGraphState = useCallback((s: GameStateOut) => {
    setGame(s);
    setHint(null); // a move/undo invalidates the previous hint
  }, []);

  async function handleHint() {
    if (!puzzle || gameOver || !game) return;
    try {
      const h = await getHint(game.tipId, puzzle.player2.id);
      setHint(h);
      setHintsUsed((n) => n + 1);
    } catch {
      /* ignore */
    }
  }

  async function handleReveal() {
    if (!puzzle) return;
    try {
      const sol = await getGameSolution(puzzle.player1.id, puzzle.player2.id);
      setRevealed(sol);
    } catch {
      /* ignore */
    }
  }

  const diffLabel = puzzle?.daily ? `Daily #${puzzle.dailyNumber}` : (puzzle?.difficulty ?? settings.difficulty);
  const replay = () =>
    puzzle?.daily ? start({ mode: "daily" }) : start({ difficulty: settings.difficulty, leagues: settings.leagues });

  return (
    <section className="animate-slide-up">
      {/* Scoreboard / controls */}
      <div className="mx-auto max-w-3xl mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-pitch-light border border-pitch-border px-3 py-1 text-xs font-semibold uppercase tracking-wider text-turf capitalize">
            {diffLabel}
          </span>
          {puzzle && (
            <span className="text-xs text-kit-gray">
              Links <span className="text-kit-white font-semibold">{game?.chainLength ?? 0}</span> · Par{" "}
              <span className="text-kit-white font-semibold">{puzzle.par}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)} title="Settings">
            ⚙
          </Button>
          <Button variant="ghost" size="sm" onClick={() => start({ mode: "daily" })} title="Daily challenge">
            📅
          </Button>
          <Button size="sm" onClick={replay}>
            New
          </Button>
        </div>
      </div>

      {puzzle && !loading && !error && (
        <p className="mx-auto max-w-3xl mb-3 text-center text-sm text-kit-gray">
          Connect <span className="text-turf font-semibold">{puzzle.player1.name}</span> to{" "}
          <span className="text-electric font-semibold">{puzzle.player2.name}</span> — click the glowing player, pick a
          season, then choose a teammate to hop along.
        </p>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="w-8 h-8 border-3 border-turf border-t-transparent rounded-full animate-spin" />
          <p className="text-kit-gray text-sm">Building a puzzle…</p>
        </div>
      )}

      {error && !loading && (
        <div className="max-w-md mx-auto p-6 rounded-xl bg-foul/10 border border-foul/30 text-center">
          <p className="text-foul font-medium">{error}</p>
          <Button className="mt-4" variant="ghost" onClick={replay}>
            Try again
          </Button>
        </div>
      )}

      {puzzle && !loading && !error && (
        <>
          <div className="rounded-2xl border border-pitch-border bg-pitch-light/40 overflow-hidden">
            <GamePane key={puzzle.puzzleId} puzzle={puzzle} disabled={gameOver} onState={onGraphState} />
          </div>

          {hint && !gameOver && <HintCard hint={hint} onClose={() => setHint(null)} />}

          {!gameOver && (
            <div className="mx-auto max-w-md mt-5 flex justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => game?.undo()} disabled={!game?.canUndo}>
                ↶ Undo
              </Button>
              <Button variant="ghost" size="sm" onClick={handleHint}>
                💡 Hint{hintsUsed > 0 ? ` (${hintsUsed})` : ""}
              </Button>
              <Button variant="subtle" size="sm" onClick={handleReveal}>
                Give up
              </Button>
            </div>
          )}

          {won && game && (
            <GameResult
              puzzle={puzzle}
              linksUsed={game.chainLength}
              par={puzzle.par}
              hintsUsed={hintsUsed}
              onNewGame={replay}
            />
          )}

          {revealed && (
            <div className="mt-8 mx-auto max-w-3xl glass rounded-2xl p-5 animate-slide-up">
              <p className="text-center text-sm text-kit-gray mb-4">
                One shortest connection ({revealed.separationNumber} links):
              </p>
              <ConnectionChain path={revealed.path} />
              <div className="text-center mt-4">
                <Button onClick={replay}>New game</Button>
              </div>
            </div>
          )}
        </>
      )}

      {showSettings && (
        <GameSettings
          initial={settings}
          onApply={(s) => {
            setSettings(s);
            try {
              localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
            } catch {
              /* ignore */
            }
            void start({ difficulty: s.difficulty, leagues: s.leagues });
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </section>
  );
}
