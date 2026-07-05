import * as React from "react";

// Generic UI icons for the website, drawn from Material Symbols (outlined
// family) to match the app's icon set — see docs/ui-icons.md. Glyph keys mirror
// packages/app/scripts/material-symbols-map.json so a name means the same thing
// in both surfaces. Brand and provider logos are NOT here; those keep their own
// marks. Icons inside UI mockups (hero-mockup, etc.) are image representations
// of the app and are handled separately.

interface MaterialIconProps {
  size?: number;
  className?: string;
}

function createMaterialIcon(path: string) {
  return function MaterialIcon({ size = 24, className }: MaterialIconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 -960 960 960"
        fill="currentColor"
        aria-hidden="true"
        className={className}
      >
        <path d={path} />
      </svg>
    );
  };
}

// Glyph keys mirror material-symbols-map.json (lucide name -> Material key)
export const ChevronRightIcon = createMaterialIcon(
  "M530-481 332-679l43-43 241 241-241 241-43-43 198-198Z",
);
export const ChevronDownIcon = createMaterialIcon(
  "M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z",
);
export const CheckIcon = createMaterialIcon(
  "M378-246 154-470l43-43 181 181 384-384 43 43-427 427Z",
);
export const CopyIcon = createMaterialIcon(
  "M300-200q-24 0-42-18t-18-42v-560q0-24 18-42t42-18h440q24 0 42 18t18 42v560q0 24-18 42t-42 18H300Zm0-60h440v-560H300v560ZM180-80q-24 0-42-18t-18-42v-620h60v620h500v60H180Zm120-180v-560 560Z",
);
export const FileTextIcon = createMaterialIcon(
  "M277-279h275v-60H277v60Zm0-171h406v-60H277v60Zm0-171h406v-60H277v60Zm-97 501q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Z",
);
export const MenuIcon = createMaterialIcon(
  "M120-240v-60h720v60H120Zm0-210v-60h720v60H120Zm0-210v-60h720v60H120Z",
);
export const CloseIcon = createMaterialIcon(
  "m249-207-42-42 231-231-231-231 42-42 231 231 231-231 42 42-231 231 231 231-42 42-231-231-231 231Z",
);
