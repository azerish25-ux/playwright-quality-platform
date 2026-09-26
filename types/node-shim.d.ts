declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd(): string;
  execPath: string;
  exitCode?: number;
  pid: number;
  platform: string;
  versions: Record<string, string>;
  stdout: { write(value: string): boolean };
  stderr: { write(value: string): boolean };
  on(event: string, listener: (...args: any[]) => void): void;
};
declare const Buffer: {
  from(value: string | Uint8Array, encoding?: string): any;
  byteLength(value: string, encoding?: string): number;
  concat(values: any[]): any;
};
declare namespace NodeJS { interface Timeout {} }
declare module "node:crypto" {
  export function createHash(algorithm: string): { update(value: any): any; digest(encoding?: string): any };
  export function randomUUID(): string;
  export function timingSafeEqual(a: any, b: any): boolean;
}
declare module "node:fs" {
  export const constants: Record<string, number>;
  export function createWriteStream(path: string, options?: any): any;
  export function existsSync(path: string): boolean;
  export function realpathSync(path: string): string;
}
declare module "node:fs/promises" {
  export function access(path: string, mode?: number): Promise<void>;
  export function appendFile(path: string, data: any, options?: any): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function copyFile(source: string, destination: string): Promise<void>;
  export function lstat(path: string): Promise<any>;
  export function mkdir(path: string, options?: any): Promise<any>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function open(path: string, flags: string, mode?: number): Promise<any>;
  export function readFile(path: string, options?: any): Promise<any>;
  export function readdir(path: string, options?: any): Promise<any[]>;
  export function realpath(path: string): Promise<string>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function rm(path: string, options?: any): Promise<void>;
  export function stat(path: string): Promise<any>;
  export function symlink(target: string, path: string, type?: string): Promise<void>;
  export function writeFile(path: string, data: any, options?: any): Promise<void>;
}
declare module "node:path" {
  export const sep: string;
  export const delimiter: string;
  export function basename(path: string, suffix?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
  export function normalize(path: string): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}
declare module "node:child_process" {
  export function spawn(command: string, args?: string[], options?: any): any;
  export function spawnSync(command: string, args?: string[], options?: any): any;
}
declare module "node:http" {
  export function createServer(listener?: (request: any, response: any) => void): any;
}
declare module "node:os" {
  export function tmpdir(): string;
  export function cpus(): any[];
  export function totalmem(): number;
}
