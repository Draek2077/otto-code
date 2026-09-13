import { createContext, useContext, type RefObject } from "react";
import type { ScrollView, View } from "react-native";

/** The actual scroll owner and its inner content, without another layout or scroll mechanism. */
export interface ScrollViewport {
  scroll: RefObject<ScrollView | null>;
  content: RefObject<View | null>;
}
export const ScrollViewportContext = createContext<ScrollViewport | null>(null);
export const useScrollViewport = () => useContext(ScrollViewportContext);
