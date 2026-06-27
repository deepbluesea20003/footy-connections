import { useCallback, useEffect, useState } from "react";
import type { Difficulty, HintResult, PlayerSuggestion, Puzzle, SeparationResult } from "../../types";
import { newGame, guessLink, getHint, findSeparation } from "../../api/client";
import { ChainBuilder, type ChainLink } from "./ChainBuilder";
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
          Look for a player from{" "}
          <span className="font-semibold">
            {hint.club} ({hint.season})
          </span>
          {hint.isFinal ? (
            <> — that link reaches the target.</>
          ) : (
            hint.player && (
              <>
                {" "}
                — try someone whose name starts with{" "}
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

  const [chain, setChain] = useState<ChainLink[]>([]);
  const [hint, setHint] = useState<HintResult | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [guessError, setGuessError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [revealed, setRevealed] = useState<SeparationResult | null>(null);

  const tip = chain.length ? chain[chain.length - 1].player : puzzle?.player1;
  const won = !!puzzle && chain.length > 0 && chain[chain.length - 1].player.id === puzzle.player2.id;
  const gameOver = won || revealed !== null;

  const start = useCallback(async (opts: { difficulty?: Difficulty; leagues?: string[]; mode?: "daily" }) => {
    setLoading(true);
    setError(null);
    setChain([]);
    setHint(null);
    setHintsUsed(0);
    setGuessError(null);
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

  async function handleGuess(player: PlayerSuggestion) {
    if (!puzzle || busy || gameOver || !tip) return;
    if (player.id === tip.id || player.id === puzzle.player1.id || chain.some((l) => l.player.id === player.id)) {
      setGuessError(`${player.name} is already in your chain.`);
      setInputKey((k) => k + 1);
      return;
    }
    setBusy(true);
    setGuessError(null);
    const tipName = tip.name;
    try {
      const res = await guessLink(tip.id, player.id);
      if (res.connected) {
        setChain((c) => [
          ...c,
          {
            player: { id: player.id, name: player.name, imageUrl: player.imageUrl, nationality: player.nationality },
            via: res.links[0],
          },
        ]);
        setHint(null);
      } else {
        setGuessError(`${player.name} never shared a squad with ${tipName}.`);
      }
    } catch {
      setGuessError("Couldn't check that link — try again.");
    } finally {
      setBusy(false);
      setInputKey((k) => k + 1);
    }
  }

  async function handleHint() {
    if (!puzzle || gameOver || !tip) return;
    try {
      const h = await getHint(tip.id, puzzle.player2.id);
      setHint(h);
      setHintsUsed((n) => n + 1);
    } catch {
      /* ignore */
    }
  }

  async function handleReveal() {
    if (!puzzle) return;
    try {
      const sol = await findSeparation(puzzle.player1.id, puzzle.player2.id);
      setRevealed(sol);
    } catch {
      /* ignore */
    }
  }

  const diffLabel = puzzle?.daily ? `Daily #${puzzle.dailyNumber}` : (puzzle?.difficulty ?? settings.difficulty);

  return (
    <section className="animate-slide-up">
      {/* Scoreboard / controls */}
      <div className="mx-auto max-w-md mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-pitch-light border border-pitch-border px-3 py-1 text-xs font-semibold uppercase tracking-wider text-turf capitalize">
            {diffLabel}
          </span>
          {puzzle && (
            <span className="text-xs text-kit-gray">
              Links <span className="text-kit-white font-semibold">{chain.length}</span> · Par{" "}
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
          <Button size="sm" onClick={() => start({ difficulty: settings.difficulty, leagues: settings.leagues })}>
            New
          </Button>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="w-8 h-8 border-3 border-turf border-t-transparent rounded-full animate-spin" />
          <p className="text-kit-gray text-sm">Building a puzzle…</p>
        </div>
      )}

      {error && !loading && (
        <div className="max-w-md mx-auto p-6 rounded-xl bg-foul/10 border border-foul/30 text-center">
          <p className="text-foul font-medium">{error}</p>
          <Button
            className="mt-4"
            variant="ghost"
            onClick={() => start({ difficulty: settings.difficulty, leagues: settings.leagues })}
          >
            Try again
          </Button>
        </div>
      )}

      {puzzle && !loading && !error && (
        <>
          <ChainBuilder
            puzzle={puzzle}
            chain={chain}
            won={won}
            busy={busy}
            disabled={gameOver}
            guessError={guessError}
            inputKey={inputKey}
            tipName={tip?.name ?? puzzle.player1.name}
            onGuess={handleGuess}
          />

          {hint && !gameOver && <HintCard hint={hint} onClose={() => setHint(null)} />}

          {!gameOver && (
            <div className="mx-auto max-w-md mt-5 flex justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleHint}>
                💡 Hint{hintsUsed > 0 ? ` (${hintsUsed})` : ""}
              </Button>
              <Button variant="subtle" size="sm" onClick={handleReveal}>
                Give up
              </Button>
            </div>
          )}

          {won && (
            <GameResult
              puzzle={puzzle}
              linksUsed={chain.length}
              par={puzzle.par}
              hintsUsed={hintsUsed}
              onNewGame={() =>
                puzzle.daily
                  ? start({ mode: "daily" })
                  : start({ difficulty: settings.difficulty, leagues: settings.leagues })
              }
            />
          )}

          {revealed && (
            <div className="mt-8 mx-auto max-w-3xl glass rounded-2xl p-5 animate-slide-up">
              <p className="text-center text-sm text-kit-gray mb-4">
                One shortest connection ({revealed.separationNumber} links):
              </p>
              <ConnectionChain path={revealed.path} />
              <div className="text-center mt-4">
                <Button onClick={() => start({ difficulty: settings.difficulty, leagues: settings.leagues })}>
                  New game
                </Button>
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
