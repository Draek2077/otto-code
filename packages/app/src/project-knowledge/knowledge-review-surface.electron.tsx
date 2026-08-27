// Electron's Metro overlay resolves this explicit desktop entrypoint before
// the ordinary web fallback. The interaction is DOM-based in both renderers,
// so desktop deliberately shares the Otto context menu and source anchors.
export { KnowledgeReviewSurface } from "./knowledge-review-surface.web";
