import { useCallback, useEffect, useRef, useState } from "react";
import type { CareerStint, GameSquad, Puzzle, SquadPlayer } from "../../types";
import { getPlayer, getGameSquad, guessLink } from "../../api/client";
import { PlayerAvatar } from "../PlayerAvatar";
import { ClubBadge } from "../ClubBadge";
import type { ChainStep, GameStateOut } from "./GameGraph";

// Re-export so GameTab can import from one place.
export type { GameStateOut };

interface ChainEntry {
  playerId: string;
  playerName: string;
  imageUrl?: string | null;
  via?: {
    clubId: string;
    clubName: string;
    crestUrl: string | null;
    season: string;
  };
}

interface SelectedStint {
  clubId: string;
  clubName: string;
  crestUrl: string | null;
  season: string;
  competition: string | null;
}

interface Props {
  puzzle: Puzzle;
  disabled: boolean;
  onState: (s: GameStateOut) => void;
}

// Surname or last word — used for tight squad grid labels.
function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

// Compact year span for a club spell, e.g. "2013–2021". Single-season spells
// show the full season string ("2013-14"). Seasons arrive sorted ascending.
function spellYears(stint: CareerStint): string {
  if (stint.seasons.length <= 1) return stint.firstSeason || stint.lastSeason || "";
  const start = (stint.firstSeason || stint.seasons[0] || "").slice(0, 4);
  const end = (stint.lastSeason || stint.seasons[stint.seasons.length - 1] || "").slice(0, 4);
  return start && end ? `${start}–${end}` : start || end;
}

// ── Chain breadcrumb ──────────────────────────────────────────────────────────

interface ChainBreadcrumbProps {
  chain: ChainEntry[];
  goalPlayer: Puzzle["player2"];
  won: boolean;
}

function ChainBreadcrumb({ chain, goalPlayer, won }: ChainBreadcrumbProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" });
  }, [chain.length]);

  if (chain.length <= 1 && !won) return null;

  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex items-center gap-1.5 min-w-max px-1">
        {chain.map((entry, i) => {
          const isTip = i === chain.length - 1 && !won;
          return (
            <div key={`${entry.playerId}-${i}`} className="contents">
              <div className="flex flex-col items-center gap-0.5">
                <div
                  className={`rounded-full ${isTip ? "ring-2 ring-turf ring-offset-1 ring-offset-pitch" : ""}`}
                >
                  <PlayerAvatar src={entry.imageUrl} name={entry.playerName} size={36} />
                </div>
                <span className="text-[10px] text-kit-dim max-w-[52px] truncate text-center leading-tight">
                  {surname(entry.playerName)}
                </span>
              </div>
              {entry.via && (
                <div className="flex flex-col items-center gap-0.5 px-1">
                  <svg className="w-3 h-3 text-pitch-border" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <ClubBadge name={entry.via.clubName} crestUrl={entry.via.crestUrl} size={20} />
                  <span className="text-[9px] text-kit-dim max-w-[44px] truncate text-center leading-tight">
                    {entry.via.season}
                  </span>
                  <svg className="w-3 h-3 text-pitch-border" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
        {won && (
          <div className="flex flex-col items-center gap-0.5">
            <div className="rounded-full ring-2 ring-electric ring-offset-1 ring-offset-pitch">
              <PlayerAvatar src={goalPlayer.imageUrl} name={goalPlayer.name} size={36} />
            </div>
            <span className="text-[10px] text-electric max-w-[52px] truncate text-center leading-tight font-semibold">
              {surname(goalPlayer.name)}
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ── Player card in the squad grid ─────────────────────────────────────────────

interface PlayerCardProps {
  player: SquadPlayer;
  isGoal: boolean;
  isTip: boolean;
  disabled: boolean;
  onClick: () => void;
}

function PlayerCard({ player, isGoal, isTip, disabled, onClick }: PlayerCardProps) {
  const baseClass =
    "flex flex-col items-center gap-1 p-2 rounded-xl border transition-colors cursor-pointer select-none";
  const stateClass = isTip
    ? "opacity-30 cursor-not-allowed border-pitch-border bg-pitch-light/30"
    : isGoal
    ? "border-electric/60 bg-electric/10 hover:bg-electric/20 shadow-[0_0_12px_rgba(21,101,255,0.18)]"
    : disabled
    ? "opacity-40 cursor-not-allowed border-pitch-border bg-pitch-light/20"
    : "border-pitch-border bg-pitch-light/40 hover:border-turf/40 hover:bg-turf/5";

  return (
    <button
      className={`${baseClass} ${stateClass}`}
      onClick={!isTip && !disabled ? onClick : undefined}
      disabled={isTip || disabled}
      title={player.name}
    >
      <PlayerAvatar src={player.imageUrl} name={player.name} size={48} />
      <span className={`text-[11px] font-medium max-w-[68px] truncate text-center leading-tight ${isGoal ? "text-electric" : "text-kit-white"}`}>
        {surname(player.name)}
      </span>
      {isGoal && <span className="text-[9px] text-electric/70 font-semibold uppercase tracking-wider">Goal!</span>}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GamePane({ puzzle, disabled, onState }: Props) {
  const [chain, setChain] = useState<ChainEntry[]>([
    { playerId: puzzle.player1.id, playerName: puzzle.player1.name, imageUrl: puzzle.player1.imageUrl },
  ]);
  const [career, setCareer] = useState<CareerStint[] | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  const [selectedStint, setSelectedStint] = useState<SelectedStint | null>(null);
  const [squad, setSquad] = useState<GameSquad | null>(null);
  const [squadLoading, setSquadLoading] = useState(false);
  const [squadNote, setSquadNote] = useState<string | null>(null);
  const [won, setWon] = useState(false);
  // Which club spell has its season sub-picker open (clubId), if any.
  const [expandedClubId, setExpandedClubId] = useState<string | null>(null);

  const tip = chain[chain.length - 1];
  const tipId = tip.playerId;

  // Emit game state to parent whenever something changes.
  const emitState = useCallback(
    (newChain: ChainEntry[], newWon: boolean, undoFn: () => void) => {
      const steps: ChainStep[] = newChain.map((e) => ({
        player: { id: e.playerId, name: e.playerName, imageUrl: e.imageUrl },
        via: null,
      }));
      onState({
        tipId: newChain[newChain.length - 1].playerId,
        tipName: newChain[newChain.length - 1].playerName,
        chainLength: Math.max(0, newChain.length - 1),
        won: newWon,
        steps,
        canUndo: newChain.length > 1,
        undo: undoFn,
      });
    },
    [onState]
  );

  const undo = useCallback(() => {
    setChain((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      setSelectedStint(null);
      setSquad(null);
      setSquadNote(null);
      setExpandedClubId(null);
      setWon(false);
      return next;
    });
  }, []);

  // Emit state whenever chain or won changes.
  useEffect(() => {
    emitState(chain, won, undo);
  }, [chain, won, undo, emitState]);

  // Load career when tip changes.
  useEffect(() => {
    if (won) return;
    setCareer(null);
    setCareerLoading(true);
    setSelectedStint(null);
    setSquad(null);
    setSquadNote(null);
    setExpandedClubId(null);
    const ctrl = new AbortController();
    getPlayer(tipId, ctrl.signal)
      .then((detail) => setCareer(detail.career.filter((s) => !!s.clubId)))
      .catch(() => {
        if (!ctrl.signal.aborted) setCareer([]);
      })
      .finally(() => setCareerLoading(false));
    return () => ctrl.abort();
  }, [tipId, won]);

  async function pickStint(stint: CareerStint, season: string) {
    if (!stint.clubId || disabled) return;
    const s: SelectedStint = {
      clubId: stint.clubId,
      clubName: stint.club,
      crestUrl: stint.crestUrl,
      season,
      competition: null,
    };
    setSelectedStint(s);
    setSquad(null);
    setSquadNote(null);
    setSquadLoading(true);
    try {
      const sq = await getGameSquad(stint.clubId, season);
      if (sq.players.length === 0) {
        setSquadNote("No squad data for this season — try another.");
      } else {
        // Update competition from the squad response.
        s.competition = sq.competition;
        setSelectedStint({ ...s });
        setSquad(sq);
      }
    } catch {
      setSquadNote("Couldn't load squad — try another season.");
    } finally {
      setSquadLoading(false);
    }
  }

  // Clicking a club chip: single-season spells load straight away; multi-season
  // spells open a season sub-picker so the player chooses which year to use.
  function handleClubClick(stint: CareerStint) {
    if (!stint.clubId || disabled) return;
    if (stint.seasons.length <= 1) {
      setExpandedClubId(stint.clubId);
      void pickStint(stint, stint.seasons[0] ?? stint.lastSeason);
      return;
    }
    setExpandedClubId((prev) => (prev === stint.clubId ? null : stint.clubId));
    setSelectedStint(null);
    setSquad(null);
    setSquadNote(null);
  }

  async function pickPlayer(player: SquadPlayer) {
    if (!selectedStint || disabled || player.id === tipId) return;
    try {
      await guessLink(tipId, player.id, {
        clubId: selectedStint.clubId,
        season: selectedStint.season,
      });
    } catch {
      // guessLink may fail if they're not actually connected; still let the UI
      // proceed — the game is client-trust; server logs the attempt.
    }
    const via = {
      clubId: selectedStint.clubId,
      clubName: selectedStint.clubName,
      crestUrl: selectedStint.crestUrl,
      season: selectedStint.season,
    };
    const isWin = player.id === puzzle.player2.id;
    setChain((prev) => {
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], via };
      next.push({ playerId: player.id, playerName: player.name, imageUrl: player.imageUrl });
      return next;
    });
    setSelectedStint(null);
    setSquad(null);
    setSquadNote(null);
    if (isWin) setWon(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Oldest spell first → newest last, so the career reads as a clear timeline.
  const careerToShow = (career ?? [])
    .slice()
    .sort(
      (a, b) =>
        (a.firstSeason || "").localeCompare(b.firstSeason || "") ||
        (a.lastSeason || "").localeCompare(b.lastSeason || "")
    );

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      {/* Endpoint header */}
      <div className="flex items-center justify-between gap-4">
        <EndpointCard player={puzzle.player1} accent="turf" label="Start" />
        <div className="flex flex-col items-center gap-1 text-kit-dim">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] uppercase tracking-wider">Connect</span>
        </div>
        <EndpointCard player={puzzle.player2} accent="electric" label="Goal" />
      </div>

      {/* Live chain breadcrumb */}
      {(chain.length > 1 || won) && (
        <div className="rounded-xl border border-pitch-border bg-pitch-light/30 p-3">
          <p className="text-[10px] uppercase tracking-wider text-kit-dim mb-2">Your chain</p>
          <ChainBreadcrumb chain={chain} goalPlayer={puzzle.player2} won={won} />
        </div>
      )}

      {/* Picker area — hidden once won */}
      {!won && !disabled && (
        <div className="rounded-xl border border-pitch-border bg-pitch-light/30 p-4 flex flex-col gap-4">
          {/* Current tip player */}
          <div className="flex items-center gap-3">
            <div className="rounded-full ring-2 ring-turf ring-offset-2 ring-offset-pitch">
              <PlayerAvatar src={tip.imageUrl} name={tip.playerName} size={52} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-kit-dim">Playing as</p>
              <p className="text-base font-semibold text-kit-white">{tip.playerName}</p>
            </div>
          </div>

          {/* Career stints / season chips */}
          {careerLoading && (
            <div className="flex items-center gap-2 text-kit-dim text-sm py-2">
              <div className="w-4 h-4 border-2 border-turf border-t-transparent rounded-full animate-spin" />
              Loading career…
            </div>
          )}

          {!careerLoading && careerToShow.length === 0 && (
            <p className="text-sm text-kit-dim">No career data available for this player.</p>
          )}

          {!careerLoading && careerToShow.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-kit-dim mb-2">
                {selectedStint ? "Season selected" : "Pick a club"}
              </p>
              <div className="flex flex-wrap gap-2">
                {careerToShow.map((stint) => {
                  const isActive = selectedStint?.clubId === stint.clubId;
                  const isExpanded = expandedClubId === stint.clubId;
                  const multi = stint.seasons.length > 1;
                  return (
                    <button
                      key={stint.clubId ?? stint.club}
                      onClick={() => handleClubClick(stint)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        isActive || isExpanded
                          ? "border-turf/60 bg-turf/10 text-turf"
                          : "border-pitch-border bg-pitch-light/40 text-kit-white hover:border-turf/30 hover:bg-turf/5"
                      }`}
                    >
                      <ClubBadge name={stint.club} crestUrl={stint.crestUrl} size={16} />
                      <span>{stint.club}</span>
                      <span className="text-kit-dim shrink-0">{spellYears(stint)}</span>
                      {multi && (
                        <span className="text-kit-dim shrink-0 text-[10px]">
                          {isExpanded ? "▾" : `· ${stint.seasons.length} seasons`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Season sub-picker for the expanded multi-season club */}
              {(() => {
                const ex = expandedClubId
                  ? careerToShow.find((s) => s.clubId === expandedClubId)
                  : null;
                if (!ex || ex.seasons.length <= 1) return null;
                return (
                  <div className="mt-3 rounded-lg border border-pitch-border bg-pitch-lighter/50 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-kit-dim mb-2">
                      Which season at {ex.club}?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[...ex.seasons]
                        .sort((a, b) => a.localeCompare(b))
                        .map((season) => {
                        const on = selectedStint?.clubId === ex.clubId && selectedStint?.season === season;
                        return (
                          <button
                            key={season}
                            onClick={() => pickStint(ex, season)}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                              on
                                ? "border-turf bg-turf text-white"
                                : "border-pitch-border bg-pitch-light text-kit-white hover:border-turf/40 hover:bg-turf/5"
                            }`}
                          >
                            {season}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Squad grid */}
          {squadLoading && (
            <div className="flex items-center gap-2 text-kit-dim text-sm py-2">
              <div className="w-4 h-4 border-2 border-turf border-t-transparent rounded-full animate-spin" />
              Loading squad…
            </div>
          )}

          {squadNote && !squadLoading && (
            <p className="text-sm text-kit-dim">{squadNote}</p>
          )}

          {squad && !squadLoading && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ClubBadge name={squad.club.name} crestUrl={squad.club.crestUrl} size={22} />
                <div>
                  <p className="text-sm font-semibold text-kit-white">{squad.club.name}</p>
                  <p className="text-[11px] text-kit-dim">
                    {selectedStint?.season}
                    {squad.competition ? ` · ${squad.competition}` : ""}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
                {squad.players.map((player) => (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    isGoal={player.id === puzzle.player2.id}
                    isTip={player.id === tipId}
                    disabled={disabled}
                    onClick={() => void pickPlayer(player)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Endpoint card (start / goal) ─────────────────────────────────────────────

interface EndpointCardProps {
  player: Puzzle["player1"];
  accent: "turf" | "electric";
  label: string;
}

function EndpointCard({ player, accent, label }: EndpointCardProps) {
  const ring = accent === "turf" ? "ring-turf" : "ring-electric";
  const text = accent === "turf" ? "text-turf" : "text-electric";
  const bg = accent === "turf" ? "bg-turf/5 border-turf/20" : "bg-electric/5 border-electric/20";
  return (
    <div className={`flex flex-col items-center gap-2 p-3 rounded-xl border ${bg} flex-1 min-w-0`}>
      <span className={`text-[10px] uppercase tracking-wider font-semibold ${text}`}>{label}</span>
      <div className={`rounded-full ring-2 ${ring} ring-offset-2 ring-offset-pitch`}>
        <PlayerAvatar src={player.imageUrl} name={player.name} size={56} />
      </div>
      <p className="text-sm font-semibold text-kit-white text-center leading-tight truncate w-full text-center">
        {player.name}
      </p>
      {player.nationality && (
        <p className="text-[10px] text-kit-dim">{player.nationality}</p>
      )}
    </div>
  );
}
