import { useState } from "react";

interface Props {
  name: string;
  crestUrl?: string | null;
  size?: number;
}

/** A few letters from the club name for the generated-badge fallback. */
function monogram(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 3).toUpperCase();
}

/** Deterministic, readable-on-dark colour from the club name. */
function badgeColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 42%, 32%)`;
}

/** Club crest, with a graceful fallback to a coloured monogram badge when the
 *  club has no free crest (the ~95% case) or the image fails to load. */
export function ClubBadge({ name, crestUrl, size = 32 }: Props) {
  const [failed, setFailed] = useState(false);
  const px = `${size}px`;

  if (crestUrl && !failed) {
    return (
      <img
        src={crestUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: px, height: px }}
        className="object-contain flex-shrink-0"
      />
    );
  }
  return (
    <div
      style={{ width: px, height: px, background: badgeColor(name) }}
      className="rounded-md flex items-center justify-center flex-shrink-0 text-kit-white font-semibold"
      title={name}
    >
      <span style={{ fontSize: `${Math.round(size * 0.34)}px` }}>{monogram(name)}</span>
    </div>
  );
}
