// Generate a colorful initial-letter avatar via a CSS gradient.
const PALETTES = [
  ["#FF6B6B", "#FF9F43"],
  ["#0095F6", "#4F46E5"],
  ["#10B981", "#06B6D4"],
  ["#F472B6", "#7C3AED"],
  ["#F59E0B", "#EF4444"],
  ["#22D3EE", "#0EA5E9"],
  ["#A855F7", "#EC4899"],
  ["#84CC16", "#22C55E"],
];

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return Math.abs(h);
}

export default function Avatar({ username = "", size = 40, online = false, ring = false }) {
  const initial = (username[0] || "?").toUpperCase();
  const [a, b] = PALETTES[hashCode(username) % PALETTES.length];
  const px = `${size}px`;
  return (
    <div className="relative inline-block shrink-0" style={{ width: px, height: px }}>
      <div
        className={`flex items-center justify-center rounded-full text-white font-display font-semibold ${ring ? "ring-2 ring-offset-2 ring-offset-background ring-[#0095F6]" : ""}`}
        style={{
          width: px,
          height: px,
          background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
          fontSize: `${Math.max(12, size * 0.4)}px`,
        }}
      >
        {initial}
      </div>
      {online ? (
        <span
          className="absolute bottom-0 right-0 block rounded-full bg-[#10B981] ring-2 ring-background"
          style={{ width: Math.max(8, size * 0.28), height: Math.max(8, size * 0.28) }}
        />
      ) : null}
    </div>
  );
}
