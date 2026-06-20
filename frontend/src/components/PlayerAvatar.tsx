import { useState } from "react";

interface Props {
  src?: string | null;
  name: string;
  size?: number;
}

/** Round player photo (Wikimedia Commons thumbnail) with an initials fallback
 *  when there's no photo or it fails to load. */
export function PlayerAvatar({ src, name, size = 36 }: Props) {
  const [failed, setFailed] = useState(false);
  const px = `${size}px`;
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: px, height: px }}
        className="rounded-full object-cover bg-pitch-lighter flex-shrink-0"
      />
    );
  }
  return (
    <div
      style={{ width: px, height: px, fontSize: `${Math.round(size * 0.32)}px` }}
      className="rounded-full bg-pitch-lighter flex items-center justify-center text-kit-dim flex-shrink-0"
    >
      {initials}
    </div>
  );
}
