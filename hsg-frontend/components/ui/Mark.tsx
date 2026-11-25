/** HSG asterisk mark. `inverse` = lime tile with console-teal asterisk (operator rail). */
export function Mark({ size = 36, inverse = false }: { size?: number; inverse?: boolean }) {
  const tile = inverse ? "#E4FF1A" : "#0D3542";
  const star = inverse ? "#08252E" : "#E4FF1A";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="14" fill={tile} />
      <g fill={star}>
        {[0, 45, 90, 135].map((r) => <rect key={r} x="21" y="9" width="6" height="30" rx="3" transform={`rotate(${r} 24 24)`} />)}
      </g>
    </svg>
  );
}
