import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './desktopDownload.css';

type PublicRelease = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; }[];
};
type Installers = { exeUrl: string; msiUrl: string; checksumsUrl: string; releaseUrl: string; tag: string; };

function DesktopDownloadPage() {
  const [installers, setInstallers] = useState<Installers | null>(null);
  const [releaseState, setReleaseState] = useState<'checking' | 'available' | 'unavailable'>('checking');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          'https://api.github.com/repos/Manav326/BajajDealership/releases?per_page=20',
          { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal },
        );
        if (!response.ok) throw new Error('Public release list is unavailable.');
        const releases = await response.json() as PublicRelease[];
        const release = releases.find((candidate) =>
          !candidate.draft
          && !candidate.prerelease
          && /^desktop-v\d+\.\d+\.\d+$/.test(candidate.tag_name)
          && candidate.assets.some((asset) => asset.name === 'LuckyBajajDesktopSetup.exe')
          && candidate.assets.some((asset) => asset.name === 'LuckyBajajDesktop.msi')
          && candidate.assets.some((asset) => asset.name === 'SHA256SUMS.txt'));
        if (!release) { setReleaseState('unavailable'); return; }
        const exe = release.assets.find((asset) => asset.name === 'LuckyBajajDesktopSetup.exe');
        const msi = release.assets.find((asset) => asset.name === 'LuckyBajajDesktop.msi');
        const checksums = release.assets.find((asset) => asset.name === 'SHA256SUMS.txt');
        if (!exe || !msi || !checksums) { setReleaseState('unavailable'); return; }
        setInstallers({
          exeUrl: exe.browser_download_url,
          msiUrl: msi.browser_download_url,
          checksumsUrl: checksums.browser_download_url,
          releaseUrl: release.html_url,
          tag: release.tag_name,
        });
        setReleaseState('available');
      } catch {
        if (!controller.signal.aborted) setReleaseState('unavailable');
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <main className="desktop-download-shell">
      <header className="desktop-download-header">
        <div className="desktop-download-mark">Q</div>
        <div>
          <p className="desktop-download-eyebrow">QUANTAEDGE • LUCKY BAJAJ</p>
          <h1>Lucky Bajaj Desktop</h1>
          <p>Install the dealership workspace as a Windows application.</p>
        </div>
      </header>
      <section className="desktop-download-panel">
        <div className="desktop-download-icon">Q</div>
        <p className="desktop-download-eyebrow">WINDOWS DESKTOP CLIENT</p>
        <h2>One workspace for your dealership</h2>
        <p className="desktop-download-description">
          Open the staff portal from your Windows Start menu. Your existing staff login,
          roles and central dealership records remain in use.
        </p>
        <div className="desktop-download-notice" role="status">
          <strong>{releaseState === 'available' ? 'Available now · ' + installers?.tag : 'Release availability'}</strong>
          <span>{releaseState === 'checking'
            ? 'Checking for a reviewed Windows release…'
            : releaseState === 'available'
              ? 'The direct-download EXE and MSI are intentionally unsigned. Windows may show an Unknown Publisher or SmartScreen warning. Verify the SHA-256 checksum before installing. Do not disable Windows Defender or SmartScreen.'
              : 'A reviewed public Windows installer is not currently available. Use the staff website until a release has passed the clean-Windows checks.'}</span>
        </div>
        <div className="desktop-download-actions">
          {releaseState === 'available' && installers ? <>
            <a href={installers.exeUrl}>Download Windows installer (.exe)</a>
            <a className="desktop-download-secondary" href={installers.msiUrl}>Download Windows MSI installer</a>
            <a className="desktop-download-secondary" href={installers.checksumsUrl}>View SHA-256 checksums</a>
            <a className="desktop-download-secondary" href={installers.releaseUrl} target="_blank" rel="noreferrer">View release notes and verification details</a>
          </> : <>
            <button type="button" disabled>{releaseState === 'checking' ? 'Checking availability…' : 'Installer not yet available'}</button>
            <a className="desktop-download-secondary" href="https://github.com/Manav326/BajajDealership/releases" target="_blank" rel="noreferrer">View official release page</a>
          </>}
        </div>
        <ul className="desktop-download-requirements">
          <li>Windows 10 or 11, 64-bit</li>
          <li>Internet connection required for live records and transactions</li>
          <li>Unsigned direct downloads can trigger Windows security warnings; verify the SHA-256 checksum and official source</li>
          <li>Do not disable Windows Defender or SmartScreen to install the app</li>
          <li>Expired licenses retain read-only access and owner data export</li>
        </ul>
      </section>
      <footer className="desktop-download-footer">
        <a href="/">Return to staff sign in</a>
        <span>Powered by QuantaEdge</span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<DesktopDownloadPage />);
