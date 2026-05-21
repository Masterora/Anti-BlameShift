import { useRef } from "react";

export function useHistory<T>(limit = 80) {
  const historyRef = useRef<T[]>([]);

  function pushHistory(entry: T) {
    historyRef.current.push(structuredClone(entry));
    if (historyRef.current.length > limit) historyRef.current.shift();
  }

  function popHistory() {
    return historyRef.current.pop() || null;
  }

  return {
    pushHistory,
    popHistory,
  };
}