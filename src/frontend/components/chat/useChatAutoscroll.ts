import { useEffect, useRef } from "react";

/**
 * Pin a scroll container to its latest message. Returns a ref to attach to the scrolling element;
 * whenever any value in `deps` changes (new messages, panel opened, active channel switched) it
 * jumps the container to the bottom. Replaces the copy-pasted scroll effect that every chat surface
 * used to carry.
 */
export function useChatAutoscroll<T extends HTMLElement = HTMLDivElement>(
  deps: React.DependencyList,
): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;

    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
    // Caller owns the dependency list (the message list + open/active flags that should re-pin).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
