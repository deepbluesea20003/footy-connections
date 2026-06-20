import { useState } from "react";
import type { PathStep } from "../types";
import { PlayerAvatar } from "./PlayerAvatar";
import { ClubBadge } from "./ClubBadge";
import { SquadModal } from "./SquadModal";
import { wikipediaUrl } from "../utils/links";

interface Props {
  path: PathStep[];
}

const isQid = (id?: string | null): id is string => !!id && /^Q\d+$/.test(id);

function PlayerNode({ step, endpoint }: { step: PathStep; endpoint: boolean }) {
  const href = wikipediaUrl(step.playerWikidataId);
  return (
    <div
      className={`flex md:flex-col items-center gap-3 md:gap-1.5 px-3 py-2.5 rounded-xl border md:w-36 ${
        endpoint
          ? "bg-turf/10 border-turf/40 shadow-[0_0_15px_rgba(16,185,129,0.12)]"
          : "bg-pitch-light border-pitch-border"
      }`}
    >
      <PlayerAvatar src={step.playerImageUrl} name={step.player} size={48} />
      <div className="min-w-0 md:text-center">
        <div className="text-sm font-semibold text-kit-white truncate md:max-w-[120px]">{step.player}</div>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-whistle hover:text-kit-white"
          >
            Wikipedia ↗
          </a>
        )}
      </div>
    </div>
  );
}

function LinkConnector({ step, onViewSquad }: { step: PathStep; onViewSquad: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-1 px-2 md:w-32">
      {/* Flow arrow: points down on mobile (column), right on desktop (row). */}
      <svg className="w-5 h-5 text-pitch-border rotate-90 md:rotate-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <ClubBadge name={step.club} crestUrl={step.clubCrestUrl} size={34} />
      <span className="text-xs font-medium text-whistle leading-tight md:max-w-[120px]">{step.club}</span>
      <span className="text-xs text-kit-dim">{step.season}</span>
      {isQid(step.clubId) && (
        <button
          onClick={onViewSquad}
          className="text-xs text-turf hover:text-turf-light hover:underline mt-0.5"
        >
          View squad
        </button>
      )}
    </div>
  );
}

export function ConnectionChain({ path }: Props) {
  const [squad, setSquad] = useState<{ clubId: string; clubName: string; crestUrl?: string | null; season: string } | null>(null);

  return (
    <div className="w-full flex flex-col md:flex-row md:flex-wrap items-center md:justify-center gap-3 md:gap-2 py-2">
      {path.map((step, i) => (
        <div key={step.playerId} className="contents">
          {i > 0 && (
            <LinkConnector
              step={step}
              onViewSquad={() =>
                isQid(step.clubId) &&
                setSquad({ clubId: step.clubId, clubName: step.club, crestUrl: step.clubCrestUrl, season: step.season })
              }
            />
          )}
          <PlayerNode step={step} endpoint={i === 0 || i === path.length - 1} />
        </div>
      ))}

      {squad && (
        <SquadModal
          clubId={squad.clubId}
          clubName={squad.clubName}
          crestUrl={squad.crestUrl}
          season={squad.season}
          onClose={() => setSquad(null)}
        />
      )}
    </div>
  );
}
