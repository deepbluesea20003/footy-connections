import { useEffect, useState } from "react";
import type { SquadResponse } from "../types";
import { getSquad } from "../api/client";
import { PlayerAvatar } from "./PlayerAvatar";
import { ClubBadge } from "./ClubBadge";

interface Props {
  clubId: string;
  clubName: string;
  crestUrl?: string | null;
  season: string;
  onClose: () => void;
}

export function SquadModal({ clubId, clubName, crestUrl, season, onClose }: Props) {
  const [data, setData] = useState<SquadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getSquad(clubId, season, controller.signal)
      .then((res) => !controller.signal.aborted && setData(res))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Could not load this squad.");
      });
    return () => controller.abort();
  }, [clubId, season]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl bg-pitch-light border border-pitch-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-pitch-border">
          <ClubBadge name={clubName} crestUrl={crestUrl} size={40} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-kit-white truncate">{clubName}</div>
            <div className="text-xs text-kit-gray">{season} squad</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-kit-gray hover:text-kit-white text-xl leading-none px-2"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-2">
          {error && <p className="text-foul text-sm text-center py-8">{error}</p>}
          {!error && !data && (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-turf border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {data && (
            <ul className="flex flex-col">
              {data.players.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-pitch-lighter"
                >
                  <PlayerAvatar src={p.imageUrl} name={p.name} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-kit-white truncate">{p.name}</div>
                    {p.nationality && <div className="text-xs text-kit-dim">{p.nationality}</div>}
                  </div>
                  {p.wikipediaUrl && (
                    <a
                      href={p.wikipediaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-whistle hover:text-kit-white flex-shrink-0"
                    >
                      Wikipedia ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
