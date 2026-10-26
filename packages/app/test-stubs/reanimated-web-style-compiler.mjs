// OTTO(browser-tests): Reanimated's optional require() calls cannot load RN Web's
// style compiler in Vite's browser ESM runtime. Use the same real compiler with
// static imports; keep actual menu layout and animations under test.
export { default as createReactDOMStyle } from "react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle";
export {
  createTransformValue,
  createTextShadowValue,
} from "react-native-web/dist/exports/StyleSheet/preprocess";
