import { useEffect, useRef, type ReactElement } from "react";
import { mountHelpCenter, type HelpCenterOptions } from "../help-center/mount.js";

export type HelpCenterProps = HelpCenterOptions;

/** React wrapper around the vanilla help-center mount. The component owns a
 *  host div and remounts the vanilla UI whenever any serializable option
 *  changes (`fetchImpl` excluded). Caveat: a remount discards the chat
 *  thread, so pass stable option values. */
export function HelpCenter(props: HelpCenterProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const { fetchImpl, ...serializable } = props;
  void fetchImpl;
  const key = JSON.stringify(serializable);
  useEffect(() => {
    if (!ref.current) return;
    return mountHelpCenter(ref.current, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div ref={ref} className="daymo-help-host" />;
}
