// Otto face from branding/otto-icon.svg, shared by desktop and mobile site mockups.
export function OttoBrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <g stroke="currentColor" strokeWidth={28}>
        <circle cx={114.72778} cy={280} r={70} />
        <circle cx={397.27271} cy={280} r={70} />
        <path d="M155.08434 162h96M216 162v202M260.91559 162h96M296 162v202" />
      </g>
      <circle cx={114.72778} cy={280} r={22} fill="currentColor" />
      <circle cx={397.27271} cy={280} r={22} fill="currentColor" />
    </svg>
  );
}
