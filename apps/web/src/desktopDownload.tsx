import { createRoot } from 'react-dom/client';
import './desktopDownload.css';

function DesktopDownloadPage() {
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
        <div className="desktop-download-notice">
          <strong>Release availability</strong>
          <span>The installer links become active after a reviewed Windows release is published. Until then, use the staff website.</span>
        </div>
        <div className="desktop-download-actions">
          <a href="https://github.com/Manav326/BajajDealership/releases/latest/download/LuckyBajajDesktopSetup.exe">
            Download Windows installer (.exe)
          </a>
          <a className="desktop-download-secondary" href="https://github.com/Manav326/BajajDealership/releases/latest">
            View release details and MSI installer
          </a>
        </div>
        <ul className="desktop-download-requirements">
          <li>Windows 10 or 11, 64-bit</li>
          <li>Internet connection required for live records and transactions</li>
          <li>Use only the installer linked from this official page</li>
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
