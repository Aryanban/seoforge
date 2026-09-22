/**
 * Ambient declarations for optional peer packages.
 * Playwright is only required when render mode is enabled; `open` is only
 * used for the optional auto-browser-open on `seoforge serve`.
 */
declare module "playwright" {
  const chromium: {
    launch(options?: any): Promise<any>;
  };
  export default chromium;
  export { chromium };
}

declare module "open" {
  const open: (target: string) => Promise<void>;
  export default open;
}
