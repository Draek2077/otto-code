import { useFonts } from "expo-font";
const sources = {
  OttoNerdSymbols: require("../../../assets/fonts/SymbolsNerdFontMono-Regular.ttf"),
};
/** One shared Expo font registration; never queries or installs host fonts. */
export function useTerminalFonts() {
  return useFonts(sources);
}
