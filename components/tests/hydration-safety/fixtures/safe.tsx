// Fixture: this file uses the correct pattern — useEffect for localStorage.
import { useState, useEffect } from "react";
export function Good() {
  const [val, setVal] = useState("default");
  useEffect(() => {
    try { const v = window.localStorage.getItem("key"); if (v) setVal(v); } catch {}
  }, []);
  return <div>{val}</div>;
}
