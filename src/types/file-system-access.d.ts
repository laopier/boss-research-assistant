/**
 * File System Access API — the minimal typings TypeScript 6.0's lib.dom does
 * not yet ship. Only the surface the artifact reader uses.
 */
export interface FileSystemFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
}

export interface FileSystemDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterableIterator<FileSystemHandle>;
}

export type FileSystemHandle = FileSystemFileHandle | FileSystemDirectoryHandle;

declare global {
  interface Window {
    showDirectoryPicker?(options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }): Promise<FileSystemDirectoryHandle>;
  }
}

export {};
