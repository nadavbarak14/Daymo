import { useEffect } from "react";

export function useSse(onEvent: (evt: any) => void): void {
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {}
    };
    return () => es.close();
  }, [onEvent]);
}
