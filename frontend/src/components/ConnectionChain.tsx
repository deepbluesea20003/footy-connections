import type { PathStep } from "../types";

interface Props {
  path: PathStep[];
}

/** Wikidata entity URL for a QID (e.g. "Q50602"), or null for non-QID ids
 *  (seed slugs) which have no Wikidata page. */
function wikidataUrl(id: string | null | undefined): string | null {
  return id && /^Q\d+$/.test(id) ? `https://www.wikidata.org/wiki/${id}` : null;
}

export function ConnectionChain({ path }: Props) {
  return (
    <div className="w-full overflow-x-auto py-4">
      <div className="flex items-center justify-center gap-0 min-w-max px-8">
        {path.map((step, i) => {
          const playerHref = wikidataUrl(step.playerWikidataId);
          const clubHref = wikidataUrl(step.clubId);
          return (
            <div key={step.playerId} className="flex items-center">
              {/* Link arrow showing club/season — placed before each node except the first */}
              {i > 0 && (
                <div className="flex flex-col items-center mx-2 min-w-[120px]">
                  {clubHref ? (
                    <a
                      href={clubHref}
                      target="_blank"
                      rel="noreferrer"
                      title="View club on Wikidata"
                      className="text-xs font-medium text-whistle underline decoration-dotted underline-offset-2 hover:text-kit-white"
                    >
                      {step.club}
                    </a>
                  ) : (
                    <span className="text-xs font-medium text-whistle">{step.club}</span>
                  )}
                  <div className="flex items-center w-full my-1">
                    <div className="flex-1 h-px bg-pitch-border" />
                    <svg className="w-3 h-3 text-pitch-border mx-0.5" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M2 6l7-4v8z" />
                    </svg>
                  </div>
                  <span className="text-xs text-kit-dim">{step.season}</span>
                </div>
              )}

              {/* Player node */}
              <div
                className={`flex flex-col items-center justify-center px-5 py-3 rounded-xl border min-w-[100px] ${
                  i === 0 || i === path.length - 1
                    ? "bg-turf/10 border-turf/40 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                    : "bg-pitch-light border-pitch-border"
                }`}
              >
                {playerHref ? (
                  <a
                    href={playerHref}
                    target="_blank"
                    rel="noreferrer"
                    title="View player on Wikidata"
                    className="font-semibold text-sm text-kit-white whitespace-nowrap underline decoration-dotted underline-offset-2 hover:text-turf"
                  >
                    {step.player}
                  </a>
                ) : (
                  <span className="font-semibold text-sm text-kit-white whitespace-nowrap">
                    {step.player}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
