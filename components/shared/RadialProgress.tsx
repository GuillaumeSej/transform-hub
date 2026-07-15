"use client";

/** Jauge circulaire de progression — utilisée pour mettre en avant la progression globale d'un
 * levier (plus visible qu'une simple barre) et la progression de chaque sous-levier en mini. */
export function RadialProgress({
  pct,
  size = 120,
  strokeWidth = 10,
  color = "#FF3C47",
  trackColor = "#F0F0F0",
  label,
  sublabel,
}: {
  pct: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sublabel?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center gap-1" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(90 ${size / 2} ${size / 2})`}
          className="fill-primary font-bold"
          style={{ fontSize: size * 0.22 }}
        >
          {Math.round(clamped)}%
        </text>
      </svg>
      {label && <div className="text-center text-[11px] font-bold text-primary">{label}</div>}
      {sublabel && (
        <div className="text-center text-[10px] uppercase tracking-wide text-tertiary">
          {sublabel}
        </div>
      )}
    </div>
  );
}
