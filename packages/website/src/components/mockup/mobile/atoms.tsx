// OTTO(identity): both site mockup sets use the same Otto face.
import { OttoBrandMark as PaseoMark } from "../../otto/brand-mark";
export { OttoBrandMark as PaseoMark } from "../../otto/brand-mark";

/** A hashed identity tile — one letter on a muted identity fill. */
export function LetterTile({
  letter,
  tone,
}: {
  letter: string;
  tone: "red" | "violet" | "amber" | "teal";
}) {
  return (
    <span
      className={`flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold text-white ${TILE_TONE[tone]}`}
    >
      {letter}
    </span>
  );
}

const TILE_TONE = {
  red: "bg-mock-tile-red",
  violet: "bg-mock-tile-violet",
  amber: "bg-mock-tile-amber",
  teal: "bg-mock-tile-teal",
} as const;

/** The product project tile: white Otto face on the black app plate. */
export function PaseoTile() {
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-black text-white">
      <PaseoMark size={14} />
    </span>
  );
}
