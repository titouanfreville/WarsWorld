import type { NextPage } from "next";
import type { ReactElement, ReactNode } from "react";

/**
 * A page that can opt out of (or replace) the global `Layout`. `_app` calls `getLayout` if present,
 * otherwise wraps the page in the default navbar+footer layout. The immersive match view sets
 * `getLayout = (page) => page` to render the board full-viewport with no site chrome.
 */
export type NextPageWithLayout<P = object> = NextPage<P> & {
  getLayout?: (page: ReactElement) => ReactNode;
};
