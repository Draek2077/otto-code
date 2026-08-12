import { StyleSheet } from "react-native-unistyles";

/**
 * The document is isolated from the Otto application: opening a workspace
 * HTML file must not let its scripts read or modify the app shell. It receives
 * no same-origin privilege, while ordinary page behavior remains available.
 */
export function HtmlFilePreview({ content, title }: { content: string; title: string }) {
  return (
    <iframe
      title={title}
      sandbox="allow-forms allow-modals allow-popups allow-scripts"
      srcDoc={content}
      style={styles.frame}
    />
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 0,
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
});
