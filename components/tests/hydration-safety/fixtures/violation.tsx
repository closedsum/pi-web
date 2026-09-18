// Fixture: this file intentionally contains the hydration-unsafe pattern.
// The test verifies that the scanner catches it.
import { useState } from "react";
export function Bad() {
  const [val] = useState(() => {
    try { return window.localStorage.getItem("key") ?? "default"; } catch { return "default"; }
  });
  return <div>{val}</div>;
}
