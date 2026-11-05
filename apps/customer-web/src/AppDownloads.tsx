import { usePublicRelease, useFileDownload, getPublicDownloadPath, formatDownloadBytes, type DownloadPlatform, type PublicReleaseState } from './download-manager';

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
      <path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function SmartphoneGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <path d="M10 18h4" />
    </svg>
  );
}

function DownloadAction({
  platform,
  label,
  fileName,
  available,
  releaseState,
  onRefresh,
}: {
  platform: DownloadPlatform;
  label: string;
  fileName: string;
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
      return <button className="lb-download-unavailable lb-download-button" type="button" onClick={() => void onRefresh()}>Retry availability check</button>;
    }
    return <span className="lb-download-unavailable lb-download-button" aria-disabled="true">
      {releaseState === 'loading' ? 'Checking release…' : 'Not published yet'}
    </span>;
  }

  if (download.status === 'downloading') {
    return (
      <div className="lb-download-progress" role="group" aria-label={`${label} progress`}>
        <div className="lb-download-progress-heading">
          <span><span className="lb-download-live-dot" /> Downloading</span>
          <strong>{percent === null ? 'In progress' : `${percent}%`}</strong>
        </div>
        <div className="lb-download-progress-track" role="progressbar" aria-label={`${fileName} download progress`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <span className={percent === null ? 'lb-download-progress-fill lb-download-progress-indeterminate' : 'lb-download-progress-fill'}
            style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
        <div className="lb-download-progress-details">
          <span>{formatDownloadBytes(download.bytesReceived)} downloaded</span>
          <span>{download.totalBytes ? `of ${formatDownloadBytes(download.totalBytes)}` : 'Total size unavailable'}</span>
        </div>
        <button className="lb-download-cancel" type="button" onClick={cancel}>× Cancel download</button>
      </div>
    );
  }

  if (download.status === 'complete') {
    return (
      <div className="lb-download-result lb-download-result-success" role="status">
        <div><span aria-hidden="true">✓</span><span>Download complete</span><strong>{formatDownloadBytes(download.bytesReceived)}</strong></div>
        <button type="button" onClick={begin}><DownloadGlyph /> Download again</button>
      </div>
    );
  }

  if (download.status === 'error' || download.status === 'cancelled') {
    return (
      <div className={download.status === 'error' ? 'lb-download-result lb-download-result-error' : 'lb-download-result'}>
        <p role="status">{download.status === 'cancelled' ? 'Download cancelled.' : download.errorMessage ?? 'The download could not be completed.'}</p>
        <button type="button" onClick={begin}>{download.status === 'cancelled' ? 'Try again' : 'Retry download'}</button>
      </div>
    );
  }

  return (
    <button className="lb-download-link-button lb-download-button" type="button" onClick={begin}>
      <DownloadGlyph /> {label}
    </button>
  );
}

export default function CustomerAppDownloads() {
  const { release, state, refresh } = usePublicRelease();
  const standardAvailable = release?.androidStandardAvailable === true;
  const liquidGlassAvailable = release?.androidLiquidGlassAvailable === true;

  return (
    <section id="android-downloads" className="showroom-app-downloads" aria-labelledby="showroom-app-downloads-title">
      <div className="showroom-app-downloads-heading">
        <div>
          <div className="showroom-eyebrow">LUCKY BAJAJ · YOUR PHONE, YOUR DEALERSHIP</div>
          <h2 id="showroom-app-downloads-title">Take Lucky Bajaj<br /><em>with you.</em></h2>
          <p>Get the official customer app. Choose the Standard experience or the Liquid Glass edition. Both connect to the same Lucky Bajaj customer service.</p>
        </div>
        <span className="showroom-app-downloads-platform">ANDROID · ARM64</span>
      </div>

      <div className="showroom-app-download-grid">
        <article className="showroom-app-download-card">
          <div className="showroom-app-download-icon showroom-app-download-icon--standard"><SmartphoneGlyph /></div>
          <div className="showroom-app-download-label-row">
            <span className="showroom-app-download-platform">FOR CUSTOMERS · ANDROID</span>
            <span className={standardAvailable ? 'showroom-app-download-tag showroom-app-download-tag--available' : 'showroom-app-download-tag'}>
              {state === 'loading' ? 'Checking' : state === 'error' ? 'Check failed' : standardAvailable ? 'Available' : 'Coming soon'}
            </span>
          </div>
          <h3>Lucky Bajaj</h3>
          <p>Your everyday customer companion for motorcycle enquiries, test rides, purchase requests and service updates.</p>
          <DownloadAction platform="android-standard" label="Download Standard APK" fileName="LuckyBajaj-Android.apk"
            available={standardAvailable} releaseState={state} onRefresh={refresh} />
          <small className="showroom-app-download-note">Official stable release · Signed APK · Android arm64</small>
          <p className="showroom-app-download-release">{release?.version ? `Latest stable release: ${release.version}` : state === 'error' ? 'Release information could not be checked. Retry above.' : 'The download will activate when the first complete signed release is published.'}</p>
        </article>

        <article className="showroom-app-download-card showroom-app-download-card--glass">
          <div className="showroom-app-download-icon showroom-app-download-icon--glass"><SmartphoneGlyph /></div>
          <div className="showroom-app-download-label-row">
            <span className="showroom-app-download-platform">FOR CUSTOMERS · ANDROID</span>
            <span className={liquidGlassAvailable ? 'showroom-app-download-tag showroom-app-download-tag--available' : 'showroom-app-download-tag'}>
              {state === 'loading' ? 'Checking' : state === 'error' ? 'Check failed' : liquidGlassAvailable ? 'Available' : 'Coming soon'}
            </span>
          </div>
          <h3>Lucky Bajaj Liquid Glass</h3>
          <p>A more immersive, translucent visual experience, with the same account, dealership catalogue and customer journey.</p>
          <DownloadAction platform="android-liquid-glass" label="Download Liquid Glass APK" fileName="LuckyBajaj-LiquidGlass-Android.apk"
            available={liquidGlassAvailable} releaseState={state} onRefresh={refresh} />
          <small className="showroom-app-download-note">Official stable release · Signed APK · Android arm64</small>
          <p className="showroom-app-download-release">{release?.version ? `Latest stable release: ${release.version}` : state === 'error' ? 'Release information could not be checked. Retry above.' : 'The download will activate when the first complete signed release is published.'}</p>
        </article>
      </div>

      {state === 'ready' && release?.version && (
        <div className="showroom-app-download-meta">
          <span>Version {release.version}</span>
          <a href="https://github.com/Manav326/BajajDealership/releases" target="_blank" rel="noreferrer">Release notes &amp; SHA-256 checksums ↗</a>
        </div>
      )}
      <p className="showroom-app-download-footnote">Downloads are streamed securely through Lucky Bajaj. Verify the published release checksum before installing. Android may ask you to allow installation from your browser.</p>
    </section>
  );
}
