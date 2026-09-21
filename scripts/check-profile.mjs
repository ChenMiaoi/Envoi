export function checkProfile({ local, desktopConcurrency }) {
  return {
    desktopScript: local ? "test:desktop:quick" : "test:desktop",
    desktopConcurrency: desktopConcurrency || (local ? "2" : "1"),
  }
}
