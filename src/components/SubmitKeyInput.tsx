"use client";

import { useRef } from "react";

/** One key for this rendered form. A double-click posts the same key. A later page load gets a new one. */
export function SubmitKeyInput() {
  const key = useRef("");
  if (!key.current) key.current = crypto.randomUUID();
  return <input type="hidden" name="submitKey" value={key.current} />;
}
