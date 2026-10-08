declare module "react" {
  export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  export function useEffect(effect: () => void | (() => void), deps: unknown[]): void;
}
declare module "react" {
  export function useState<T>(initial: T): [T, (value: T) => void];
}
