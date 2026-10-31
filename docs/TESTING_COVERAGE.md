# Testing coverage and release-quality decision

**Audit date:** 31 October 2026  
**Repository:** Manav326/BajajDealership  
**Audited test-infrastructure baseline:** a5457abaa0e517fac2b53558a3d53e3fa02fda24  
**Decision:** Not approved for full production rollout. Backend and browser automation are useful and currently green. Android device execution remains unproven because the latest emulator attempt failed before Maestro could install the APK and start scenarios.

This document is the decision record for test volume, measured source coverage, actual execution evidence, limitations and quality by application. It deliberately does not convert test-file counts into a coverage percentage.

## 1. Executive decision

| Application / layer | Automated execution evidence | Measured source coverage | Quality assessment | Release decision |
|---|---|---:|---|---|
| Backend / API | 233/233 PostgreSQL-backed tests passed | **66.69% line / 42.82% branch** | **Good**, with two weak packages | Keep CI gate; improve Finance and Social |
| Staff web portal | Included in 97/97 full Chromium cases | **61.23% function execution** on 42 loaded source modules | **Good functional breadth; moderate coverage depth** | Suitable for continued staging; expand real-API browser acceptance |
| Customer web site | Included in 97/97 full Chromium cases | **64.34% function execution** on 8 loaded source modules | **Good showroom journey coverage; mock-heavy outside API integration tests** | Staging only until real-backend and deployed acceptance |
| Social Media Studio | 42/42 dedicated cases passed; also included in main web suite | Included in staff-web aggregate; no separate Social source percentage | **Good editor regression breadth; external providers not live-verified** | Keep Meta/WhatsApp disabled pending authorized E2E |
| Standard Android | 11 runnable flow definitions; latest emulator job failed before installing/running flows | Not measured | **Insufficient execution evidence** | No mobile pass claim; fix CI runner and complete device suite |
| Liquid Glass Android | 11 runnable flow definitions; latest emulator job failed before installing/running flows | Not measured | **Insufficient execution evidence** | Same gate as Standard |
| Windows desktop | EXE/MSI/MSIX packaging checks passed; 2 Tauri-related browser specs cover API-target selection and window layout; browser native dialogs are tested separately | Not measured for native shell | **Build evidence good; native app acceptance limited** | Require signed/clean-machine and native-shell acceptance |

**Do not add overlapping test suites together.** The dedicated 42-case Social Studio suite overlaps the 97-case full Chromium suite. The 6 cross-browser cases are an additional, narrow run covering two public showroom scenarios on three engines; they are not another full website suite.

## 2. Test inventory and actual pass evidence

### Web — full Chromium suite

<badge color="success">97 passed / 97 executed</badge>

[Full browser run #41173480435](https://github.com/Manav326/BajajDealership/actions/runs/41172140858) completed with zero failures, skips or flaky tests. Its test-results JSON records 97 expected and 97 passed.

| Spec file | Cases passed | Main scenarios |
|---|---:|---|
| customer-showroom.spec.ts | 25 | Public catalogue/search, model detail, comparison, promos, keyboard focus, test-ride/purchase handoff, delivery quotes, cancellation, parts and profile entry |
| social-media-studio-next.spec.ts | 42 | Canvas/editor, resources, elements/layers, project persistence, photo/video rendering, audio timeline/mixing, publishing and confirmations |
| notification-studio-responsive.spec.ts | 14 | Responsive breakpoints, audience review, preview/approval state, Send now, history and related media/profile views |
| social-media-studio.spec.ts | 8 | Legacy editor, asset pickers, saved drafts and channel tabs |
| customer-sales-requests.spec.ts | 2 | Staff request conversion UI and customer history |
| readability.spec.ts | 3 | Sign-in/dashboard/customer website readability and bundled fonts |
| desktop-api-target.spec.ts | 1 | Hosted API vs Local Docker API selection |
| desktop-viewport-layout.spec.ts | 1 | Tauri fixed frame and independent workspace scrolling |
| native-dialogs.spec.ts | 1 | Branded dialogs in staff/customer portal |
| **Total** | **97** | **9 Playwright spec files** |

Qualification: many browser scenarios intercept API calls with synthetic fixtures. They validate browser interactions, responsive behavior and client state; they do not prove every workflow against a live database.

### Web — cross-browser compatibility smoke

<badge color="success">6 passed / 6 executed</badge>

[Run #41171414198](https://github.com/Manav326/BajajDealership/actions/runs/41171414198) ran two public-showroom scenarios in Chromium, Firefox and WebKit:

- Named navigation, keyboard-operable model dialog, Escape close and focus restoration.
- Mobile navigation open/close and aria-expanded state.

This is a valuable compatibility smoke, not a complete 97-case Firefox/WebKit run and not a formal WCAG accessibility audit.

### Social Media Studio — dedicated regression

<badge color="success">42 passed / 42 executed</badge>

[Run #41172140838](https://github.com/Manav326/BajajDealership/actions/runs/41172140838) passed on the audited test-infrastructure baseline. It is separate evidence for the editor, but those cases overlap the full Chromium suite and must not be counted as 42 additional unique cases.

### Backend / API — PostgreSQL integration and security tests

<badge color="success">233 passed / 233 executed</badge>

[Main CI run #41172140918](https://github.com/Manav326/BajajDealership/actions/runs/41172140918) executed the backend suite against PostgreSQL. Maven reported:

- Tests run: **233**
- Failures: **0**
- Errors: **0**
- Skipped: **0**
- JaCoCo report and coverage check: **passed**

Important test domains include authentication and dealership isolation, customer portal identities/sessions/ownership, catalogue publication, inventory, customer sales requests, test rides, booking/concurrency, invoices and operational payments, workshop estimates/quality/handover, spare-parts stock/order/return, notification approval/preview/dispatch/retry, social provider security and webhook/media controls.

| Backend package | Test cases | Test classes (from the CI JUnit report) |
|---|---:|---:|
| Catalogue | 9 | 3 |
| Commerce / parts | 17 | 1 |
| Customers | 21 | 6 |
| Finance | 16 | 3 |
| Inventory | 26 | 5 |
| Notifications | 35 | 7 |
| Sales | 34 | 6 |
| Security | 17 | 6 |
| Social integrations | 25 | 6 |
| System | 12 | 2 |
| Workshop | 20 | 3 |
| Root / migrations | 1 | 1 |
| **Total** | **233** | **49** |

There is a backend integration journey for a synthetic customer request through test ride, booking, invoice, payment record, handover and customer ownership visibility. The parallel browser UI request-conversion test remains API-mocked; keep those two evidence types distinct.

## 3. Measured source-code coverage

### Backend — JaCoCo

<badge color="success">Coverage floors passed</badge>

[Coverage report artifact from CI #41172140918](https://github.com/Manav326/BajajDealership/actions/runs/41172140918/artifacts/13031915147)

| Package | Line coverage | Branch coverage | Assessment |
|---|---:|---:|---|
| Whole backend bundle | **66.69%** | **42.82%** | Good baseline; more branches needed |
| Catalogue | 86.08% | 58.82% | Strong |
| Commerce / parts | 80.16% | 57.39% | Strong |
| Customers | 73.65% | 47.36% | Good |
| Inventory | 78.49% | 52.67% | Good |
| Notifications | 69.70% | 48.87% | Good |
| Sales | 81.32% | 54.45% | Strong |
| Security | 80.06% | 50.38% | Strong |
| System | 79.08% | 62.80% | Strong |
| Workshop | 79.45% | 55.37% | Strong |
| Finance | **45.32%** | **26.73%** | **Weak; priority for more tests** |
| Social integrations | **15.85%** | **10.57%** | **Very weak; highest priority** |

The JaCoCo regression floors currently enforce at least 60% bundle line / 35% bundle branch, 65% / 40% for the established core packages, 42% / 24% for Finance and 14% / 9% for Social. Finance/Social thresholds are deliberately set close to the measured baseline to prevent regressions while their test suites are expanded. They are not quality targets or evidence those domains are adequately tested.

### Web — Chromium V8 function execution

The full browser run captured V8 function-execution data per test and unions functions by loaded source module:

| Application | Source modules loaded | Executed functions | Loaded-source function coverage |
|---|---:|---:|---:|
| Staff portal | 42 | 1,066 / 1,741 | **61.15%** |
| Customer web site | 8 | 249 / 387 | **64.34%** |
| Combined loaded source | 50 | 1,315 / 2,128 | **61.80%** |

The workflow enforces a 50% regression floor for the loaded-source function metric.

**Scope warning:** this is function execution for modules loaded during these Chromium journeys. It is not JavaScript line/branch coverage, does not include files no test loaded, and is not a percentage of the entire web repository. Do not compare this directly with JaCoCo line/branch coverage.

### Android and Windows coverage

No trustworthy source-code coverage percentage is currently produced for the React Native Android editions or native Tauri shell. Maestro flow counts are scenario inventory, not line/branch/function coverage. The Android app's 11 flow definitions in each edition are:

- 2 public flows: authentication/activation entry and public showroom.
- 5 authenticated flows: customer area navigation, portrait/landscape adaptation, notification inbox, parts cart persistence, and service appointment request/cancellation.
- 4 notification fixtures: pagination, read/unread/dismiss, rich content/image/CTA, and unsupported destination suppression.
- A shared customer login subflow supports the authenticated tests.

## 4. Android run: exact failure and correction

[Android emulator run #41172140850](https://github.com/Manav326/BajajDealership/actions/runs/41172140850) built both self-contained x86_64 Maestro APKs, started the API and PostgreSQL stack, seeded a synthetic CI dealership and verified 20 public catalogue models. Both editions then failed **before Maestro executed a scenario** because the emulator's ADB transport reported device offline during APK installation.

Therefore:

- APK generation: passed.
- Native project generation and TypeScript checks: passed.
- Synthetic API/database preflight: passed.
- APK installation: not passed.
- Maestro scenario execution: **0 flows executed**.
- Android app regression result: **unknown**, not pass and not a product assertion failure.

The ADB-hardened workflow now restarts the ADB server, waits for the emulator transport, Android boot and package-manager readiness, reconnects offline transports and retries APK installation. A fresh run [#41173351609](https://github.com/Manav326/BajajDealership/actions/runs/41173351609) has progressed into the Standard public Maestro step while Liquid Glass completes its APK build. Neither edition is counted as passed until its JUnit artifact is uploaded.

The emulator smoke workflow currently exercises the two public flows. Full authenticated/notification All flows still require a separate, isolated synthetic-account and notification-fixture setup. A physical phone run is also still required before mobile release acceptance.

## 5. Quality rating — decision data

| Dimension | Quality | Why |
|---|---|---|
| Backend correctness tests | **Good** | 233 real PostgreSQL-backed tests passed, including security, dealership scope, transaction and concurrency cases |
| Backend coverage depth | **Mixed** | Strong core packages; Finance is 45.32% line; Social is only 15.85% line |
| Staff web | **Good, not complete** | Main workflows have broad passing Chromium coverage; loaded-source function coverage 61.15%; many API routes are mocked |
| Customer website | **Good for tested journeys** | 25 showroom cases pass; loaded-source function coverage 64.34%; production-like end-to-end remains |
| Social Studio | **Good editor regression** | 42 dedicated cases pass; provider authentication, permissions and live publishing remain disabled/external |
| Notification Studio | **Good browser/backend baseline** | Responsive preview, approvals and Send now have UI and PostgreSQL tests; actual FCM delivery is not proven |
| Standard Android | **Insufficient evidence** | 11 flow definitions, but latest CI stopped before installing the APK |
| Liquid Glass Android | **Insufficient evidence** | Same; no successful latest device execution |
| Windows desktop | **Limited-to-good build evidence** | EXE/MSI/MSIX packaging passes; browser-based shell layout/API selection exists; full native-shell install/update acceptance remains |
| Accessibility | **Limited** | Keyboard focus and semantic navigation smoke exists; no comprehensive axe/WCAG or screen-reader audit |
| Performance and resilience | **Incomplete** | No comprehensive load/stress, long-running scheduler, service outage or backup-restore acceptance suite |

## 6. Remaining test work, ordered by release risk

### P0 — required before production approval

1. Make the ADB readiness/retry workflow green; capture JUnit results for both Standard and Liquid Glass.
2. Fix any actual assertions that fail after Maestro begins executing; do not mask failures as infrastructure retries.
3. Seed an isolated synthetic customer, linked test vehicle and deterministic notification fixture data so authenticated and notification Maestro flows can run as All on both editions.
4. Run the full All Maestro suite on at least one representative physical Android device for both editions and retain reports/screenshots.
5. Add real-backend Playwright acceptance for staff sales, inventory, finance and workshop, using only synthetic database fixtures; retain the existing service-level integration tests.
6. Add explicit authorization/privacy browser tests across OWNER, MANAGER and restricted staff roles.
7. Add backup/restore, deployment migration-upgrade rehearsal, scheduler outage/recovery and realistic transaction concurrency acceptance.

### P1 — improve quality depth

1. Raise Finance coverage from 45.32% line / 26.73% branch to at least 65% / 40%.
2. Raise Social coverage from 15.85% / 10.57% to at least 50% / 35%, including provider callback/error/permission/token lifecycle cases with synthetic provider stubs.
3. Raise whole-backend coverage progressively toward 75% line / 55% branch, without weakening current floors.
4. Add a stable per-application frontend line/branch metric (e.g. instrumented Vitest/V8 source maps); retain the current loaded-function metric only as a browser-journey signal.
5. Add full Firefox/WebKit coverage for high-risk customer showroom journeys, plus accessibility scans and manual screen-reader checks.
6. Add performance budgets and load tests for catalogue, customer portal, parts checkout, notification dispatch and reporting.

## 7. Release decision

**Current decision: staging / controlled acceptance only — not full production rollout.**

The backend and web test results are sufficiently credible to continue development and controlled staging. They are not a substitute for customer-data safety, production infrastructure, finance reconciliation, live integration setup or dealership sign-off. The mobile release gate remains open because the latest emulator attempt did not execute a single Maestro scenario, even though both APKs built successfully.

The release owner should approve full rollout only after P0 items are evidenced and the production operations gates in [PRODUCT_STATUS.md](PRODUCT_STATUS.md) are complete.
