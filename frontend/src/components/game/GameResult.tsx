import { useEffect, useState } from "react";
import confetti from "canvas-confetti";
import type { Puzzle } from "../../types";
import { Button } from "../ui/Button";

interface Props {
  puzzle: Puzzle;
  linksUsed: number;
  par: number;
  hintsUsed: number;
  onNewGame: () => void;
}

function scoreLabel(diff: number): { text: string; tone: string } {
  if (diff <= 0) return { text: "Perfect — par!", tone: "text-turf" };
  if (diff === 1) return { text: "+1 over par", tone: "text-whistle" };
  return { text: `+${diff} over par`, tone: "text-whistle" };
}

function buildShare(puzzle: Puzzle, linksUsed: number, par: number, hintsUsed: number): string {
  const over = Math.max(0, linksUsed - par);
  const grid = "🟩".repeat(Math.min(linksUsed, par)) + "🟨".repeat(over);
  const hints = hintsUsed > 0 ? ` ${"💡".repeat(hintsUsed)}` : "";
  const head = puzzle.daily ? `Footy Connections — Daily #${puzzle.dailyNumber}` : "Footy Connections";
  return `${head}\n${puzzle.player1.name} → ${puzzle.player2.name}\n${linksUsed} links (par ${par})\n${grid}${hints}`;
}

export function GameResult({ puzzle, linksUsed, par, hintsUsed, onNewGame }: Props) {
  const [copied, setCopied] = useState(false);
  const diff = linksUsed - par;
  const score = scoreLabel(diff);

  useEffect(() => {
    const fire = (ratio: number, opts: confetti.Options) =>
      confetti({ origin: { y: 0.6 }, particleCount: Math.floor(180 * ratio), ...opts });
    fire(0.25, { spread: 26, startVelocity: 55, colors: ["#15e081", "#22d3ee"] });
    fire(0.35, { spread: 60, colors: ["#15e081", "#22d3ee", "#fbbf24"] });
    fire(0.2, { spread: 100, decay: 0.91, scalar: 0.9 });

    // Persist a completed daily so it can't be replayed for a fresh score.
    if (puzzle.daily) {
      try {
        localStorage.setItem(
          `fc.daily.${new Date().toISOString().slice(0, 10)}`,
          JSON.stringify({ dailyNumber: puzzle.dailyNumber, linksUsed, par, hintsUsed })
        );
      } catch {
        /* ignore */
      }
    }
  }, [puzzle, linksUsed, par, hintsUsed]);

  async function share() {
    const text = buildShare(puzzle, linksUsed, par, hintsUsed);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="mt-8 mx-auto max-w-md glass card-glow rounded-2xl p-6 text-center animate-pop">
      <div className="text-4xl mb-1">🎉</div>
      <h3 className="font-display text-2xl font-extrabold text-kit-white">Connected!</h3>
      <p className={`mt-1 font-semibold ${score.tone}`}>{score.text}</p>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          { k: "Links", v: linksUsed },
          { k: "Par", v: par },
          { k: "Hints", v: hintsUsed },
        ].map((s) => (
          <div key={s.k} className="rounded-xl bg-pitch-light/60 border border-pitch-border py-3">
            <div className="font-display text-2xl font-bold text-gradient">{s.v}</div>
            <div className="text-[11px] uppercase tracking-wider text-kit-dim mt-0.5">{s.k}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={share}>
          {copied ? "Copied!" : "Share result"}
        </Button>
        <Button className="flex-1" onClick={onNewGame}>
          New game
        </Button>
      </div>
    </div>
  );
}
