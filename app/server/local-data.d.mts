import type {Plugin} from 'vite';export function localDataPlugin():Plugin;
export function trustedRoot(directory:string):Promise<string>;
export function dataStore(input:{store:string;key?:string;action:'get'|'put';value?:unknown;migrate?:boolean;expectedRevision?:number}):Promise<{status:number;body:unknown}>;

export const dataDir: string;
export function registerProject(root: string, options?: {copy?: boolean}): Promise<{id: string; name: string; path: string}>;
