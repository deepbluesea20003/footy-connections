import type { PlayerSuggestion, Puzzle, SharedLink } from "../../types";
import { PlayerAutocomplete } from "../PlayerAutocomplete";
import { PlayerAvatar } from "../PlayerAvatar";
import { ClubBadge } from "../ClubBadge";

export interface ChainLink {
  player: { id: string; name: string; imageUrl?: string | null; nationality?: string | null };
  via: SharedLink;
}

interface Props {
  puzzle: Puzzle;
  chain: ChainLink[];
  won: boolean;
  busy: boolean;
  disabled: boolean;
  guessError: string | null;
  inputKey: number;
  tipName: string;
  onGuess: (player: PlayerSuggestion) => void;
}

function PlayerRow({
  name,
  imageUrl,
  subtitle,
  variant,
}: {
  name: string;
  imageUrl?: string | null;
  subtitle?: string | null;
  variant: "endpoint" | "goal" | "mid";
}) {
  const styles =
    variant === "endpoint"
      ? "border-turf/50 bg-turf/10 card-glow"
      : variant === "goal"
        ? "border-dashed border-electric/50 bg-electric/5"
        : "border-pitch-border bg-pitch-light/70";
  return (
    <div className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3 ${styles}`}>
      <PlayerAvatar src={imageUrl} name={name} size={44} />
      <div className="min-w-0">
        <div className="font-display font-bold text-kit-white truncate">{name}</div>
        {subtitle && <div className="text-xs text-kit-gray truncate">{subtitle}</div>}
      </div>
    </div>
  );
}

/** The "fun fact" link between two players: the club-season they shared. */
function Connector({ via }: { via: SharedLink }) {
  const games = `${via.gamesTogether} game${via.gamesTogether === 1 ? "" : "s"} together`;
  const meta = [via.competition, games].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3 pl-4 py-1.5 animate-slide-up">
      <div className="flex flex-col items-center">
        <span className="w-px h-3 bg-pitch-border" />
        <ClubBadge name={via.club} crestUrl={via.crestUrl} size={30} />
        <span className="w-px h-3 bg-pitch-border" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-whistle truncate">
          {via.club} <span className="text-kit-dim font-normal">· {via.season}</span>
        </div>
        <div className="text-[11px] text-kit-gray truncate">{meta}</div>
      </div>
    </div>
  );
}

export function ChainBuilder({
  puzzle,
  chain,
  won,
  busy,
  disabled,
  guessError,
  inputKey,
  tipName,
  onGuess,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-md flex flex-col">
      {/* Start endpoint */}
      <PlayerRow
        name={puzzle.player1.name}
        imageUrl={puzzle.player1.imageUrl}
        subtitle={puzzle.player1.nationality}
        variant="endpoint"
      />

      {/* Confirmed links */}
      {chain.map((link) => (
        <div key={link.player.id} className="animate-pop">
          <Connector via={link.via} />
          <PlayerRow
            name={link.player.name}
            imageUrl={link.player.imageUrl}
            subtitle={link.player.nationality}
            variant={link.player.id === puzzle.player2.id ? "endpoint" : "mid"}
          />
        </div>
      ))}

      {/* Input + goal (while playing) */}
      {!won && (
        <>
          <div className="flex items-center gap-2 pl-4 py-2 text-kit-dim">
            <span className="w-px h-4 bg-pitch-border" />
            <span className="text-xs">who played with {tipName}?</span>
          </div>
          <div className={`rounded-2xl border border-pitch-border bg-pitch-light/70 p-3 ${guessError ? "animate-shake border-foul/60" : ""}`}>
            <PlayerAutocomplete
              key={inputKey}
              label=""
              selected={null}
              onSelect={(p) => !disabled && !busy && onGuess(p)}
              onClear={() => {}}
            />
            {guessError && <p className="text-xs text-foul mt-2 px-1">{guessError}</p>}
            {busy && <p className="text-xs text-kit-dim mt-2 px-1">Checking the link…</p>}
          </div>

          <div className="flex items-center gap-2 pl-4 py-2 text-kit-dim">
            <span className="w-px h-4 bg-pitch-border" />
            <span className="text-xs">reach…</span>
          </div>
          <PlayerRow
            name={puzzle.player2.name}
            imageUrl={puzzle.player2.imageUrl}
            subtitle={puzzle.player2.nationality}
            variant="goal"
          />
        </>
      )}
    </div>
  );
}
