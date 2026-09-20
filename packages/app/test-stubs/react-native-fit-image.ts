import type { ComponentType } from "react";
import type { ImageProps } from "react-native";

/**
 * `react-native-fit-image` ships a CJS build that `require`s `react-native`,
 * which Node resolves past Vite's alias and into Flow-typed source. It reaches
 * the tests only through `react-native-markdown-display`, which uses it to size
 * remote images - a measurement no test performs, so rendering nothing is
 * accurate rather than merely convenient.
 */
const FitImage: ComponentType<ImageProps> = () => null;

export default FitImage;
