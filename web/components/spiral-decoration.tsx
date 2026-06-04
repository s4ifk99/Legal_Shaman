"use client";

export function SpiralDecoration({
  className = "",
  size = 200,
  color = "currentColor",
}: {
  className?: string;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Main spiral */}
      <path
        d="M100 100 
           C100 85, 115 85, 115 100 
           C115 115, 85 115, 85 100 
           C85 75, 125 75, 125 100 
           C125 125, 75 125, 75 100 
           C75 65, 135 65, 135 100 
           C135 135, 65 135, 65 100 
           C65 55, 145 55, 145 100 
           C145 145, 55 145, 55 100 
           C55 45, 155 45, 155 100 
           C155 155, 45 155, 45 100 
           C45 35, 165 35, 165 100"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* Center dot */}
      <circle cx="100" cy="100" r="4" fill={color} opacity="0.8" />
    </svg>
  );
}

export function SpiralBackground({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {/* Large teal spiral - top left */}
      <div className="spiral-slow absolute -left-32 -top-32 opacity-20">
        <SpiralDecoration size={400} color="var(--teal)" />
      </div>
      
      {/* Medium coral spiral - top right */}
      <div className="spiral-medium absolute -right-24 -top-24 opacity-15">
        <SpiralDecoration size={300} color="var(--coral)" />
      </div>
      
      {/* Gold spiral - bottom left */}
      <div className="spiral-slow absolute -bottom-20 -left-20 opacity-25">
        <SpiralDecoration size={280} color="var(--gold)" />
      </div>
      
      {/* Small teal spiral - bottom right */}
      <div className="spiral-medium absolute -bottom-16 -right-16 opacity-20">
        <SpiralDecoration size={250} color="var(--teal)" />
      </div>
      
      {/* Center accent spiral */}
      <div className="spiral-slow absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-10">
        <SpiralDecoration size={500} color="var(--coral)" />
      </div>
    </div>
  );
}
