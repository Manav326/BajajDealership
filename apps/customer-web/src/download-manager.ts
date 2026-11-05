import { useCallback, useEffect, useRef, useState } from 'react';

export type DownloadPlatform =
  | 'android-standard'
  | 'android-liquid-glass'
  | 'windows-exe'
  | 'windows-msi';

export type PublicRelease = {
  version: string | null;
  androidStandardAvailable: boolean;
  androidLiquidGlassAvailable: boolean;
  windowsExeAvailable: boolean;
  windowsMsiAvailable: boolean;
};

export type PublicReleaseState = 'loading' | 'ready' | 'error';

export function getPublicDownloadPath(platform: DownloadPlatform): string {
  return `/api/v1/public/downloads/${platform}`;
}

function isPublicRelease(value: unknown): value is PublicRelease {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PublicRelease>;
  return (candidate.version === null || typeof candidate.version === 'string')
    && typeof candidate.androidStandardAvailable === 'boolean'
    && typeof candidate.androidLiquidGlassAvailable === 'boolean'
    && typeof candidate.windowsExeAvailable === 'boolean'
    && typeof candidate.windowsMsiAvailable === 'boolean';
}

export function usePublicRelease(): {
  release: PublicRelease | null;
  state: PublicReleaseState;
  refresh: () => Promise<void>;
} {
  const [release, setRelease] = useState<PublicRelease | null>(null);
  const [state, setState] = useState<PublicReleaseState>('loading');

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setState('loading');
    try {
      const response = await fetch('/api/v1/public/downloads/status', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new Error(`Release status lookup failed with HTTP ${response.status}.`);
      const value: unknown = await response.json();
      if (!isPublicRelease(value)) throw new Error('The release status response was not in the expected format.');
      setRelease(value);
      setState('ready');
    } catch {
      if (!signal?.aborted) {
        setRelease(null);
        setState('error');
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  return { release, state, refresh: () => refresh() };
}

export type FileDownloadState = {
  status: 'idle' | 'downloading' | 'complete' | 'cancelled' | 'error';
  bytesReceived: number;
  totalBytes: number | null;
  errorMessage: string | null;
};

const initialState: FileDownloadState = {
  status: 'idle',
  bytesReceived: 0,
  totalBytes: null,
  errorMessage: null,
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getDownloadError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The download could not be completed. Please try again.';
}

function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function useFileDownload(fileName: string): {
  download: FileDownloadState;
  start: (url: string) => Promise<void>;
  cancel: () => void;
} {
  const [download, setDownload] = useState<FileDownloadState>(initialState);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(async (url: string) => {
    if (controllerRef.current) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setDownload({ status: 'downloading', bytesReceived: 0, totalBytes: null, errorMessage: null });

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/octet-stream' },
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404) throw new Error('This release file is not available. Refresh and try again.');
        throw new Error(`The download server returned HTTP ${response.status}. Please retry.`);
      }

      const parsedLength = Number(response.headers.get('content-length'));
      const totalBytes = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : null;
      let bytesReceived = 0;
      const chunks: BlobPart[] = [];
      const reader = response.body?.getReader();

      if (reader) {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          bytesReceived += result.value.byteLength;
          chunks.push(result.value.slice().buffer as ArrayBuffer);
          setDownload({ status: 'downloading', bytesReceived, totalBytes, errorMessage: null });
        }
      } else {
        const blob = await response.blob();
        bytesReceived = blob.size;
        chunks.push(blob);
        setDownload({ status: 'downloading', bytesReceived, totalBytes: totalBytes ?? bytesReceived, errorMessage: null });
      }

      if (bytesReceived <= 0) throw new Error('The download server returned an empty file. Please retry.');
      if (totalBytes !== null && bytesReceived !== totalBytes) {
        throw new Error(`The download was incomplete (${bytesReceived} of ${totalBytes} bytes received). Please retry.`);
      }

      const blob = new Blob(chunks, {
        type: response.headers.get('content-type') || 'application/octet-stream',
      });
      if (blob.size !== bytesReceived) throw new Error('The downloaded file could not be assembled correctly. Please retry.');

      saveBlob(blob, fileName);
      setDownload({ status: 'complete', bytesReceived, totalBytes: totalBytes ?? bytesReceived, errorMessage: null });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        setDownload(current => ({ ...current, status: 'cancelled', errorMessage: null }));
      } else {
        setDownload(current => ({ ...current, status: 'error', errorMessage: getDownloadError(error) }));
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [fileName]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { download, start, cancel };
}

export function formatDownloadBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1000) return `${Math.floor(value)} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1000;
  let index = 0;
  while (size >= 1000 && index < units.length - 1) {
    size /= 1000;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}
