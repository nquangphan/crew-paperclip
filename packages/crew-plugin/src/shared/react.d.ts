declare module "react" {
  export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
}
declare module "react" {
  export function useState<T>(initial: T): [T, (value: T) => void];
}
