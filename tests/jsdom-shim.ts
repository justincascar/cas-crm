declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    readonly window: Window & typeof globalThis;
  }
}

declare var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
