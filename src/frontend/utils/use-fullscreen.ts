"use client";
import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Drive the browser Fullscreen API on a specific element (the game shell) — "full screen like a
 * video". Returns whether that element is currently fullscreen and a `toggle` to enter/exit. Tracks
 * `fullscreenchange` so the state stays right even when the user leaves fullscreen via Esc.
 */
export function useFullscreen(ref: RefObject<HTMLElement>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);

    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    const el = ref.current;

    if (el === null) {
      return;
    }

    if (document.fullscreenElement === null) {
      void el.requestFullscreen?.().catch(() => undefined);
    } else {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }, [ref]);

  return { isFullscreen, toggle };
}
