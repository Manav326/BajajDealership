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
          <p>Windows desktop installer downloads and local testing.</p>
        </div>
      </header>
      <section className="desktop-download-panel">
        <div className="desktop-download-icon">Q</div>
        <p className="desktop-download-eyebrow">WINDOWS DESKTOP CLIENT</p>
        <h2>Download the local-Docker test build</h2>
        <p className="desktop-download-description">
          This download is compiled to connect to the Docker API on this same computer at
          <strong> 127.0.0.1:8080</strong>. It is intended for local testing, not customer distribution.
        </p>
        <div className="desktop-download-notice" role="status">
          <strong>Current source commit only</strong>
          <span>
            While PR #37 is open, the downloader follows its feature branch. After the PR merges, it automatically follows main.
            It proceeds only after the Windows build for that exact source commit succeeds; it never substitutes an older installer.
          </span>
        </div>

        <section className="desktop-download-managed">
          <div>
            <p className="desktop-download-eyebrow">AUTOMATIC DOWNLOAD · VERSION CLEANUP</p>
            <h3>Get the latest EXE and MSI</h3>
            <p>
              The PowerShell helper downloads the local-Docker Actions artifact for the current
              PR commit, validates the archive and confirms it contains exactly one EXE and one MSI.
              After validation it removes older local-test download folders created by this helper.
              It does not uninstall the app, change Docker data or delete unrelated files.
            </p>
          </div>
          <a className="desktop-download-managed-primary" href="/Download-LuckyBajajDesktop.ps1" download="Download-LuckyBajajDesktop.ps1">
            Download local-test downloader (.ps1)
          </a>
          <p className="desktop-download-managed-hint">
            Right-click the file and choose <strong>Run with PowerShell</strong>. If Windows says scripts are disabled, use the process-only command below; it does not change your saved Windows policy.
            It opens the new installer folder and writes a full <strong>INSTALL.txt</strong> guide.
            If artifact access asks for authentication, use GitHub CLI sign-in or set GH_TOKEN locally with Actions: read access.
          </p>
        </section>

          <p className="desktop-download-managed-hint">
            When Windows blocks the script under your local execution policy, open PowerShell and run:
            <br />
            <code>Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; &amp; "$env:USERPROFILE\Downloads\Download-LuckyBajajDesktop.ps1"</code>
            <br />
            This affects only the current PowerShell process. If an administrator-enforced policy blocks scripts, do not override it; ask your administrator.
          </p>
        <section className="desktop-download-install-guide">
          <h3>Before installing the desktop app</h3>
          <ol>
            <li>Open PowerShell in your local BajajDealership repository folder and switch to the branch named in the generated <strong>INSTALL.txt</strong> guide.</li>
            <li>Build the API from that branch: <code>docker compose build api</code>.</li>
            <li>Start the API and dependencies: <code>docker compose up -d --no-build api</code>.</li>
            <li>Check the API: <code>Invoke-RestMethod http://127.0.0.1:8080/actuator/health</code>. Continue only when it reports <strong>UP</strong>.</li>
            <li>Choose one downloaded installer: EXE for guided setup or MSI for Windows Installer. Do not run both. Keep using the same installer type for later upgrades, then launch Lucky Bajaj Desktop from the Start menu.</li>
          </ol>
          <p className="desktop-download-security">
            Follow the backend branch and health-check instructions generated for the exact installer commit. Do not delete your existing PostgreSQL Docker volume. This installer targets this computer's loopback address and will not connect to the right 
          </p>
        </section>

        <section className="desktop-download-hosted">
          <h3>Hosted customer installer</h3>
          {releaseState === 'checking'
            ? <p>Checking whether a reviewed public customer release is available…</p>
            : releaseState === 'available' && installers
              ? <>
                  <p>These packages connect to the hosted Lucky Bajaj API and are separate from the local-Docker test build.</p>
                  <div className="desktop-download-actions">
                    <a href={installers.exeUrl}>Download customer EXE</a>
                    <a className="desktop-download-secondary" href={installers.msiUrl}>Download customer MSI</a>
                    <a className="desktop-download-secondary" href={installers.checksumsUrl}>SHA-256 checksums</a>
                    <a className="desktop-download-secondary" href={installers.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>
                  </div>
                </>
              : <p>No reviewed public customer release is published yet. The local-Docker test download above is a separate development artifact.</p>}
        </section>

        <ul className="desktop-download-requirements">
          <li>Windows 10 or 11, 64-bit</li>
          <li>Docker Desktop and the local BajajDealership API must run on this same computer</li>
          <li>The downloader requires internet access to GitHub Actions artifacts</li>
          <li>Local-Docker installers are test builds and must not be distributed to customers</li>
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
