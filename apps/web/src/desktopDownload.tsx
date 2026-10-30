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

function versionParts(tag: string): number[] {
  return tag.replace(/^desktop-v/, '').split('.').map((part) => Number(part));
}

function compareReleaseVersions(left: PublicRelease, right: PublicRelease): number {
  const a = versionParts(left.tag_name);
  const b = versionParts(right.tag_name);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function DesktopDownloadPage() {
  const [installers, setInstallers] = useState<Installers | null>(null);
  const [releaseState, setReleaseState] = useState<'checking' | 'available' | 'unavailable'>('checking');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          'https://api.github.com/repos/Manav326/BajajDealership/releases?per_page=100',
          { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal },
        );
        if (!response.ok) throw new Error('Public release list is unavailable.');
        const releases = await response.json() as PublicRelease[];
        const release = releases
          .filter((candidate) =>
            !candidate.draft
            && !candidate.prerelease
            && /^desktop-v\d+\.\d+\.\d+$/.test(candidate.tag_name)
            && candidate.assets.some((asset) => asset.name === 'LuckyBajajDesktopSetup.exe')
            && candidate.assets.some((asset) => asset.name === 'LuckyBajajDesktop.msi')
            && candidate.assets.some((asset) => asset.name === 'SHA256SUMS.txt'))
          .sort(compareReleaseVersions)[0];
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
              ? 'The official Windows installers are ready. The recommended downloader verifies SHA-256 checksums before replacing older downloads.'
              : 'A reviewed public Windows installer is not currently available. Use the staff website until a release has passed the clean-Windows checks.'}</span>
        </div>

        {releaseState === 'available' && installers ? <>
          <section className="desktop-download-managed">
            <div>
              <p className="desktop-download-eyebrow">RECOMMENDED · AUTOMATIC VERSION MANAGEMENT</p>
              <h3>Download the latest version safely</h3>
              <p>
                Download and run the PowerShell helper. It fetches both the EXE and MSI from the
                latest stable release, verifies their SHA-256 checksums, then removes older
                version folders created by this helper. It never uninstalls the app or deletes
                unrelated files.
              </p>
            </div>
            <a className="desktop-download-managed-primary" href="/Download-LuckyBajajDesktop.ps1" download="Download-LuckyBajajDesktop.ps1">
              Download automatic downloader (.ps1)
            </a>
            <p className="desktop-download-managed-hint">
              After downloading, right-click the file and choose <strong>Run with PowerShell</strong>.
              The script opens the new version folder and displays the installation steps.
            </p>
          </section>
          <div className="desktop-download-manual">
            <strong>Manual download (does not remove older downloads)</strong>
            <div className="desktop-download-actions">
              <a href={installers.exeUrl}>Download Windows installer (.exe)</a>
              <a className="desktop-download-secondary" href={installers.msiUrl}>Download Windows MSI installer</a>
              <a className="desktop-download-secondary" href={installers.checksumsUrl}>View SHA-256 checksums</a>
              <a className="desktop-download-secondary" href={installers.releaseUrl} target="_blank" rel="noreferrer">View release notes</a>
            </div>
          </div>
        </> : <>
          <div className="desktop-download-actions">
            <button type="button" disabled>{releaseState === 'checking' ? 'Checking availability…' : 'Installer not yet available'}</button>
            <a className="desktop-download-secondary" href="https://github.com/Manav326/BajajDealership/releases" target="_blank" rel="noreferrer">View official release page</a>
          </div>
        </>}

        <section className="desktop-download-install-guide">
          <h3>What happens after the downloader runs?</h3>
          <ol>
            <li>It saves the current EXE and MSI in <strong>Downloads\LuckyBajajDesktop</strong>, inside a folder named for the release.</li>
            <li>It verifies both installers against the official SHA-256 manifest before touching older managed downloads.</li>
            <li>After verification, it removes older version folders created by this downloader and opens the new folder in File Explorer.</li>
            <li>Choose <strong>one</strong> installer: EXE for the guided setup, or MSI for Windows Installer. Do not run both.</li>
            <li>Follow the setup wizard, then open <strong>Lucky Bajaj Desktop</strong> from the Windows Start menu and sign in with your staff account.</li>
          </ol>
          <p className="desktop-download-security">
            The direct EXE/MSI packages are unsigned and may show Unknown Publisher or SmartScreen warnings.
            The helper checks their hashes, but never disable Windows security protections. A device policy
            may block unsigned installers; ask your administrator for an approved signed package in that case.
          </p>
        </section>
        <ul className="desktop-download-requirements">
          <li>Windows 10 or 11, 64-bit</li>
          <li>Internet connection required for live records and transactions</li>
          <li>The downloader requires Windows PowerShell and internet access to GitHub Releases</li>
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
