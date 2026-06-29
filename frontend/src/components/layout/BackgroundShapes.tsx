import { useEffect, useRef } from "react";

/**
 * A bold, World-Cup-broadcast colour field that sits behind all content.
 * Large flat panels of cyan / orange / green / magenta / yellow cluster around
 * the edges, leaving the centre lighter so content cards stay readable. Each
 * shape parallax-scrolls at its own rate for a sense of floating depth.
 */
export function BackgroundShapes() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const shapes = el.querySelectorAll<HTMLElement>("[data-speed]");

    function onScroll() {
      const y = window.scrollY;
      shapes.forEach((s) => {
        s.style.transform = `translateY(${y * +s.dataset.speed!}px)`;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden pointer-events-none"
      style={{ zIndex: -1 }}
      aria-hidden="true"
    >
      {/* TOP-LEFT cluster — lime + green arcs */}
      <div data-speed="-0.10" className="absolute" style={{ top: "-16%", left: "-12%", width: "52vw", height: "58vh" }}>
        <svg viewBox="0 0 520 580" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <path d="M60,-40 C340,-40 520,160 460,380 C400,580 140,560 -20,420 C-160,300 -120,-40 60,-40 Z" fill="#8bd600" />
          <path d="M120,40 C300,20 440,160 400,320 C360,480 160,480 60,360 C-20,260 -40,60 120,40 Z" fill="#00b85c" />
        </svg>
      </div>

      {/* TOP-RIGHT cluster — cyan panel + orange circle */}
      <div data-speed="-0.07" className="absolute" style={{ top: "-14%", right: "-14%", width: "48vw", height: "54vh" }}>
        <svg viewBox="0 0 480 540" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <path d="M120,-40 C360,-60 520,80 500,300 C480,500 260,520 140,420 C20,320 -80,-20 120,-40 Z" fill="#00c2d6" />
          <circle cx="360" cy="150" r="150" fill="#ff7a00" />
        </svg>
      </div>

      {/* RIGHT-MID — bold blue sweep */}
      <div data-speed="0.06" className="absolute" style={{ top: "34%", right: "-16%", width: "38vw", height: "46vh" }}>
        <svg viewBox="0 0 380 460" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <path d="M380,40 C200,20 60,160 80,280 C100,420 280,460 380,420 Z" fill="#1565ff" />
        </svg>
      </div>

      {/* BOTTOM-LEFT cluster — magenta wedge + yellow circle */}
      <div data-speed="0.12" className="absolute" style={{ bottom: "-16%", left: "-12%", width: "46vw", height: "56vh" }}>
        <svg viewBox="0 0 460 560" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <path d="M-40,560 L300,180 C420,300 440,520 360,560 Z" fill="#ff2d8e" />
          <circle cx="120" cy="440" r="140" fill="#ffc400" />
        </svg>
      </div>

      {/* BOTTOM-RIGHT cluster — green + blue */}
      <div data-speed="0.14" className="absolute" style={{ bottom: "-18%", right: "-12%", width: "50vw", height: "58vh" }}>
        <svg viewBox="0 0 500 580" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <path d="M520,160 C520,420 360,600 160,560 C-40,520 -20,260 160,180 C320,110 520,-100 520,160 Z" fill="#00b85c" />
          <circle cx="380" cy="420" r="130" fill="#1565ff" />
        </svg>
      </div>

      {/* Floating accent dots for extra energy */}
      <div data-speed="-0.05" className="absolute" style={{ top: "26%", left: "6%", width: "9vw", height: "9vw" }}>
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <circle cx="50" cy="50" r="50" fill="#ffc400" />
        </svg>
      </div>
      <div data-speed="0.09" className="absolute" style={{ top: "62%", right: "4%", width: "7vw", height: "7vw" }}>
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <circle cx="50" cy="50" r="50" fill="#ff2d8e" />
        </svg>
      </div>
    </div>
  );
}
