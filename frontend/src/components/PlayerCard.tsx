import type { PlayerDetail } from "../types";
import { PlayerAvatar } from "./PlayerAvatar";
import { ClubBadge } from "./ClubBadge";

interface Props {
  detail: PlayerDetail;
  highlight?: boolean;
}

/** "2014-15" + "2017-18" -> "2014–18"; single season stays "2017-18". */
function seasonRange(first: string, last: string): string {
  if (!first) return "";
  if (first === last) return first;
  return `${first.slice(0, 4)}–${last.slice(2, 4) || last.slice(0, 4)}`;
}

export function PlayerCard({ detail, highlight }: Props) {
  const birthYear = detail.dateOfBirth?.slice(0, 4);
  return (
    <div
      className={`w-full rounded-xl border p-4 ${
        highlight
          ? "bg-turf/10 border-turf/40"
          : "bg-pitch-light border-pitch-border"
      }`}
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar src={detail.imageUrl} name={detail.name} size={52} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-kit-white truncate">{detail.name}</div>
          <div className="text-xs text-kit-gray mt-0.5">
            {[detail.nationality, birthYear && `b. ${birthYear}`].filter(Boolean).join(" · ")}
          </div>
          {detail.wikipediaUrl && (
            <a
              href={detail.wikipediaUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-whistle hover:text-kit-white mt-1"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M14.97 4.5v.4c.67.05.93.27.93.62 0 .18-.06.4-.17.66l-2.6 6.05-.06.01-2.2-5.32 1-.02V4.5H6.02v.4c.8.06 1.07.3 1.46 1.2l3.3 7.84h.4l2.5-5.86 2.42 5.86h.4l3.1-7.4c.45-1.08.7-1.55 1.5-1.64v-.4h-3.4v.4c.8.07 1 .35.84.96l-.04.13-2.02 4.86-.05.01-1.6-3.97.96-1.99c.27-.55.5-.86 1.27-1zM4.3 4.9c-.74.1-.97.5-1.5 1.66l-3.1 7.4h.4l-.04-.02.04.02 3.1-7.4c.5-1.1.7-1.5 1.46-1.62v-.04z"/>
              </svg>
              Wikipedia
            </a>
          )}
        </div>
      </div>

      {detail.career.length > 0 && (
        <ul className="mt-3 pt-3 border-t border-pitch-border/60 flex flex-col gap-1.5 max-h-44 overflow-y-auto">
          {detail.career.map((c) => (
            <li key={`${c.clubId ?? c.club}`} className="flex items-center gap-2 text-sm">
              <ClubBadge name={c.club} crestUrl={c.crestUrl} size={20} />
              <span className="text-kit-gray truncate flex-1">{c.club}</span>
              <span className="text-xs text-kit-dim flex-shrink-0">
                {seasonRange(c.firstSeason, c.lastSeason)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
