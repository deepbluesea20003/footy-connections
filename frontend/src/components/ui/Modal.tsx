import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}

/** Centered modal over a dimmed backdrop. Closes on Escape or backdrop click. */
export function Modal({ title, onClose, children, maxWidth = "max-w-md" }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portal to <body> so the fixed overlay covers the full viewport regardless of
  // any animated ancestor that established a transform containing-block.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0d1220]/50 backdrop-blur-sm animate-slide-up"
      onClick={onClose}
    >
      <div
        className={`glass card-glow rounded-2xl w-full ${maxWidth} max-h-[88vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3 border-b border-pitch-border">
            <h2 className="font-display text-xl font-bold text-kit-white">{title}</h2>
            <button
              onClick={onClose}
              className="text-kit-dim hover:text-kit-white text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}
