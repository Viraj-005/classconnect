import { useEffect, useState } from "react";

/*
  Delay a rapidly changing value.

  Search inputs drive server side queries here, so without this every
  keystroke is a request. 250ms is short enough to feel immediate and
  long enough that typing a word is one call rather than seven.
*/
export function useDebounced(value, delay = 250) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
