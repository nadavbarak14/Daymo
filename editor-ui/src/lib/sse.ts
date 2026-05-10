import { useEffect, useRef } from "react";

export function useSse(onEvent: (evt: any) => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      try {
        ref.current(JSON.parse(m.data));
      } catch {}
    };
    return () => es.close();
  }, []);
}
