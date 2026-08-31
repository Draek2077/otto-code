process.on("message", (message) => {
  if (message?.type !== "otto_frame") return;
  process.send?.(message);
});
