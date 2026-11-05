import {
  formatDownloadBytes,
  getPublicDownloadPath,
  useFileDownload,
  usePublicRelease,
  type DownloadPlatform,
  type PublicReleaseState,
} from '../download-manager';

function WindowsDownloadAction({
  platform,
  fileName,
  label,
  available,
  releaseState,
  onRefresh,
}: {
  platform: Extract<DownloadPlatform, 'windows-exe' | 'windows-msi'>;
  fileName: string;
  label: string;
  available: boolean;
  releaseState: PublicReleaseState;
  onRefresh: () => Promise<void>;
}) {
  const { download, start, cancel } = useFileDownload(fileName);
  const percent = download.totalBytes && download.totalBytes > 0
    ? Math.min(100, Math.floor((download.bytesReceived / download.totalBytes) * 100))
    : null;
  const begin = () => void start(getPublicDownloadPath(platform));

  if (!available) {
    if (releaseState === 'error') {
      return <button className="lb-desktop-download-unavailable" type="button" onClick={() => void onRefresh()}>Retry availability check</button>;
    }
    return <span className="lb-desktop-download-unavailable" aria-disabled="true">
      {releaseState === 'loading' ? 'Checking release…' : 'Not published yet'}
    </span>;
  }

  if (download.status === 'downloading') {
    return (
      <div className="lb-desktop-download-progress" role="group" aria-label={`${label} progress`}>
        <div className="lb-desktop-download-progress-heading">
          <span><i /> Downloading</span>
          <strong>{percent === null ? 'In progress' : `${percent}%`}</strong>
        </div>
        <div className="lb-desktop-download-progress-track" role="progressbar" aria-label={`${fileName} download progress`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <span className={percent === null ? 'lb-desktop-download-progress-fill lb-desktop-download-progress-indeterminate' : 'lb-desktop-download-progress-fill'}
            style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
        <div className="lb-desktop-download-progress-details">
          <span>{formatDownloadBytes(download.bytesReceived)} downloaded</span>
          <span>{download.totalBytes ? `of ${formatDownloadBytes(download.totalBytes)}` : 'Total size unavailable'}</span>
        </div>
        <button className="lb-desktop-download-cancel" type="button" onClick={cancel}><span aria-hidden="true">×</span> Cancel download</button>
      </div>
    );
  }

  if (download.status === 'complete') {
    return (
      <div className="lb-desktop-download-result lb-desktop-download-result-success" role="status">
        <div><span aria-hidden="true">✓</span><span>Download complete</span><strong>{formatDownloadBytes(download.bytesReceived)}</strong></div>
        <button type="button" onClick={begin}><span aria-hidden="true">↓</span> Download again</button>
      </div>
    );
  }

  if (download.status === 'error' || download.status === 'cancelled') {
    return (
      <div className={download.status === 'error' ? 'lb-desktop-download-result lb-desktop-download-result-error' : 'lb-desktop-download-result'}>
        <p role="status">{download.status === 'cancelled' ? 'Download cancelled.' : download.errorMessage ?? 'The download could not be completed.'}</p>
        <button type="button" onClick={begin}><span aria-hidden="true">↻</span> {download.status === 'cancelled' ? 'Try again' : 'Retry download'}</button>
      </div>
    );
  }

  return (
    <button className="lb-desktop-download-button" type="button" onClick={begin}>
      <span aria-hidden="true">↓</span> {label}
    </button>
  );
}

export default function StaffDesktopDownloadCard() {
  const { release, state, refresh } = usePublicRelease();
  const exeAvailable = release?.windowsExeAvailable === true;
  const msiAvailable = release?.windowsMsiAvailable === true;

  return (
    <section className="lb-staff-download-card" aria-labelledby="lb-staff-download-title">
      <div className="lb-staff-download-card-heading">
        <div className="lb-staff-download-icon"><span aria-hidden="true">▣</span></div>
        <div className="lb-staff-download-card-copy">
          <div className="lb-staff-download-kicker-row">
            <span>STAFF DESKTOP · WINDOWS 10/11</span>
            <span className={exeAvailable && msiAvailable ? 'lb-staff-download-tag lb-staff-download-tag--available' : 'lb-staff-download-tag'}>
              {state === 'loading' ? 'Checking' : state === 'error' ? 'Check failed' : exeAvailable && msiAvailable ? 'Available' : 'Coming soon'}
            </span>
          </div>
          <h3 id="lb-staff-download-title">Lucky Bajaj for Windows</h3>
          <p>Install the staff desktop app for a focused dealership workspace. It connects securely to your hosted Lucky Bajaj service.</p>
        </div>
      </div>

      <div className="lb-staff-download-actions">
        <div className="lb-staff-download-action">
          <span>GUIDED SETUP · EXE</span>
          <WindowsDownloadAction platform="windows-exe" fileName="LuckyBajajDesktopSetup.exe" label="Download Windows setup"
            available={exeAvailable} releaseState={state} onRefresh={refresh} />
        </div>
        <div className="lb-staff-download-action">
          <span>WINDOWS INSTALLER · MSI</span>
          <WindowsDownloadAction platform="windows-msi" fileName="LuckyBajajDesktop.msi" label="Download MSI package"
            available={msiAvailable} releaseState={state} onRefresh={refresh} />
        </div>
      </div>

      <div className="lb-staff-download-footer">
        <span>{release?.version ? `Stable release ${release.version}` : 'The latest stable release will appear here automatically.'}</span>
        <a href="https://github.com/Manav326/BajajDealership/releases" target="_blank" rel="noreferrer">Release notes &amp; checksums ↗</a>
      </div>
      <p className="lb-staff-download-security">Windows installers are currently unsigned. Windows may show an Unknown Publisher or SmartScreen warning. Do not disable security protections; use the packages only for a controlled pilot until signing is configured.</p>
    </section>
  );
}
