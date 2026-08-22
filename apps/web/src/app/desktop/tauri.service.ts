import { Service, signal } from '@angular/core';

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export interface NativeSaveTextInput {
  title: string;
  defaultFileName: string;
  contents: string;
  extension: string;
}

export interface NativeSaveBinaryInput {
  title: string;
  defaultFileName: string;
  contents: Uint8Array;
  extension: string;
}

export type NativeSaveTextResult =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' | 'unavailable'; path: null };

@Service()
export class TauriService {
  readonly available = signal(this.detectTauri());

  isAvailable(): boolean {
    return this.available();
  }

  magicLinkOptions(): { desktop?: boolean } {
    return this.isAvailable() ? { desktop: true } : {};
  }

  desktopAuthUrl(token: string): string {
    const url = new URL('monobungsya://auth');
    url.searchParams.set('token', token);

    return url.toString();
  }

  redirectToDesktopAuth(token: string): boolean {
    if (token.trim() === '') {
      return false;
    }

    window.location.assign(this.desktopAuthUrl(token));

    return true;
  }

  async saveTextFile(
    input: NativeSaveTextInput,
  ): Promise<NativeSaveTextResult> {
    if (!this.isAvailable()) {
      return { status: 'unavailable', path: null };
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const filePath = await invoke<string | null>('save_text_file', {
      ...input,
    });

    if (!filePath) {
      return { status: 'cancelled', path: null };
    }

    return { status: 'saved', path: filePath };
  }

  async saveBinaryFile(
    input: NativeSaveBinaryInput,
  ): Promise<NativeSaveTextResult> {
    if (!this.isAvailable()) {
      return { status: 'unavailable', path: null };
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const filePath = await invoke<string | null>('save_binary_file', {
      ...input,
      contents: Array.from(input.contents),
    });

    if (!filePath) {
      return { status: 'cancelled', path: null };
    }

    return { status: 'saved', path: filePath };
  }

  private detectTauri(): boolean {
    return (
      typeof window !== 'undefined' &&
      (typeof window.__TAURI_INTERNALS__ !== 'undefined' ||
        typeof window.__TAURI__ !== 'undefined')
    );
  }
}
