import { useEffect, useRef, type ReactElement } from "react";
import { mountHelpCenter, type HelpCenterOptions } from "../help-center/mount.js";

export type HelpCenterProps = HelpCenterOptions;

/** React wrapper around the vanilla help-center mount. The component owns a
 *  host div and mounts/unmounts the vanilla UI on mount. */
export function HelpCenter(props: HelpCenterProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const unmount = mountHelpCenter(ref.current, props);
    return unmount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.manifestUrl, props.chatEndpoint, props.title]);
  return <div ref={ref} className="daymo-help-host" />;
}
