// Fixture: Date.now() in useState initializer causes hydration mismatch.
import { useState } from "react";
export function Bad() {
  const [ts] = useState(() => Date.now());
  return <div>{ts}</div>;
}
