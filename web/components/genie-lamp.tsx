"use client";

export function GenieLamp() {
  return (
    <div className="relative mx-auto max-w-2xl px-4">
      {/* SVG Genie Lamp with smoke */}
      <svg
        viewBox="0 0 400 500"
        className="w-full h-auto max-w-md mx-auto mb-8"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="smokeShadow">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" />
          </filter>
          <linearGradient id="lampGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: "var(--gold)", stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: "var(--gold-dark)", stopOpacity: 1 }} />
          </linearGradient>
          <style>{`
            @keyframes smokeBillowLeft {
              0% { opacity: 0.3; transform: translate(0, 0) scale(0.8); }
              50% { opacity: 0.6; transform: translate(-60px, -80px) scale(1.2); }
              100% { opacity: 0; transform: translate(-120px, -160px) scale(0.5); }
            }
            @keyframes smokeBillowRight {
              0% { opacity: 0.3; transform: translate(0, 0) scale(0.8); }
              50% { opacity: 0.6; transform: translate(60px, -80px) scale(1.2); }
              100% { opacity: 0; transform: translate(120px, -160px) scale(0.5); }
            }
            @keyframes smokeBillowCenter {
              0% { opacity: 0.4; transform: translate(0, 0) scale(0.9); }
              50% { opacity: 0.7; transform: translate(0, -100px) scale(1.3); }
              100% { opacity: 0; transform: translate(0, -200px) scale(0.6); }
            }
            .smoke-left { animation: smokeBillowLeft 4s ease-out infinite; }
            .smoke-right { animation: smokeBillowRight 4s ease-out infinite 0.5s; }
            .smoke-center { animation: smokeBillowCenter 4s ease-out infinite 1s; }
          `}</style>
        </defs>

        {/* Smoke clouds */}
        <g className="smoke-left" filter="url(#smokeShadow)">
          <circle cx="120" cy="120" r="45" fill="var(--primary)" opacity="0.4" />
          <circle cx="100" cy="100" r="35" fill="var(--primary)" opacity="0.3" />
        </g>
        <g className="smoke-right" filter="url(#smokeShadow)">
          <circle cx="280" cy="120" r="45" fill="var(--secondary)" opacity="0.4" />
          <circle cx="300" cy="100" r="35" fill="var(--secondary)" opacity="0.3" />
        </g>
        <g className="smoke-center" filter="url(#smokeShadow)">
          <circle cx="200" cy="100" r="50" fill="var(--gold)" opacity="0.3" />
          <circle cx="200" cy="80" r="40" fill="var(--gold)" opacity="0.2" />
        </g>

        {/* Lamp spout */}
        <path
          d="M 180 200 Q 160 160 150 120 L 160 120 Q 170 160 190 200 Z"
          fill="url(#lampGradient)"
          stroke="var(--gold-dark)"
          strokeWidth="2"
        />

        {/* Lamp body - rounded bulbous shape */}
        <ellipse cx="200" cy="280" rx="95" ry="110" fill="url(#lampGradient)" stroke="var(--gold-dark)" strokeWidth="3" />

        {/* Lamp neck */}
        <rect x="170" y="200" width="60" height="80" fill="url(#lampGradient)" stroke="var(--gold-dark)" strokeWidth="2" />

        {/* Lamp base */}
        <ellipse cx="200" cy="400" rx="80" ry="30" fill="var(--gold-dark)" stroke="var(--gold-dark)" strokeWidth="2" />
        <path
          d="M 120 400 Q 120 420 200 430 Q 280 420 280 400"
          fill="none"
          stroke="var(--gold-dark)"
          strokeWidth="2"
        />

        {/* Decorative rings */}
        <circle cx="200" cy="240" r="70" fill="none" stroke="var(--gold-dark)" strokeWidth="1" opacity="0.5" />
        <circle cx="200" cy="310" r="85" fill="none" stroke="var(--gold-dark)" strokeWidth="1" opacity="0.5" />
      </svg>

      {/* Lamp glow effect */}
      <div className="absolute inset-0 -z-10 blur-3xl opacity-30">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-gradient-to-br from-primary/40 via-secondary/40 to-accent/40" />
      </div>
    </div>
  );
}
