# Testing coverage and release-quality decision

**Audit date:** 31 October 2026  
**Repository:** Manav326/BajajDealership  
**Implementation baseline reviewed:** `caff228c47358a8cc40178e0ce1f0eb5ad85bc02` (latest source commit observed before this documentation reconciliation)  
**Backend / web / finance measurement baseline:** `f94d46b56698e17c67f7ef61bc96383420a3cd62`  
**Android strict-emulator/JUnit validator baseline:** `51c937a204f2cdd31b5e791bd0272e66aa3e707d`  
**Decision:** Not approved for full production rollout. Backend, browser automation, Windows packaging and GHCR publication/pull evidence are green on their recorded baselines. The strict Android validator run #41178367640 completed successfully: Standard and Liquid Glass each passed both configured public flows with 2 JUnit tests, 0 failures, 0 errors and 0 skips. Full authenticated/notification flow acceptance and physical-device acceptance remain open.

**Evidence boundary:** The percentage measurements and backend/web/Windows results below are from the explicitly named earlier baselines, not an exact-head run on `caff228`. The Android strict-run evidence is from `51c937`; the later `caff228` commit updated the authenticated appointment-flow selectors but that flow is not in the two-flow public CI selection.

This document is the decision record for test volume, measured source coverage, actual execution evidence, limitations and quality by application. It deliberately does not convert test-file counts into a coverage percentage.

The overall JaCoCo line/branch percentages below use the report-level aggregate counters; the package rows use the corresponding package counters. Do not rebuild the bundle percentage by summing CSV class rows.

## 1. Executive decision

| Application / layer | Automated execution evidence | Measured source coverage | Quality assessment | Release decision |
|---|---|---:|---|---|
| Backend / API | 236/236 PostgreSQL-backed tests passed | **69.63% line / 44.76% branch** | **Good, improved**; Social remains very weak | Keep CI gate; prioritize Social and financial reconciliation edge cases |
| Staff web portal | Included in 97/97 full Chromium cases | **61.23% function execution** on 42 loaded source modules | **Good functional breadth; moderate coverage depth** | Suitable for continued staging; expand real-API browser acceptance |
| Customer web site | Included in 97/97 full Chromium cases | **64.34% function execution** on 8 loaded source modules | **Good showroom journey coverage; mock-heavy outside API integration tests** | Staging only until real-backend and deployed acceptance |
| Social Media Studio | 42/42 dedicated cases passed; also included in main web suite | Included in staff-web aggregate; no separate Social source percentage | **Good editor regression breadth; external providers not live-verified** | Keep Meta/WhatsApp disabled pending authorized E2E |
| Standard Android | 2/2 public Maestro flows passed on emulator; JUnit: 2 tests, 0 failures/errors/skips | Not measured | **Limited positive smoke evidence**; 9 other flow definitions and physical-device acceptance remain | Controlled staging only; complete authenticated/notification and physical-device tests |
| Liquid Glass Android | 2/2 public Maestro flows passed on emulator; JUnit: 2 tests, 0 failures/errors/skips | Not measured | **Limited positive smoke evidence**; 9 other flow definitions and physical-device acceptance remain | Same gate as Standard |
| Windows desktop | EXE/MSI/MSIX packaging checks passed; 2 Tauri-related browser specs cover API-target selection and window layout; browser native dialogs are tested separately | Not measured for native shell | **Build evidence good; native app acceptance limited** | Require signed/clean-machine and native-shell acceptance |

**Do not add overlapping test suites together.** The dedicated 42-case Social Studio suite overlaps the 97-case full Chromium suite. The 6 cross-browser cases are an additional, narrow run covering two public showroom scenarios on three engines; they are not another full website suite.

## 2. Test inventory and actual pass evidence

### Web — full Chromium suite

<badge color="success">97 passed / 97 executed</badge>

[Full browser run #41173480435](https://github.com/Manav326/BajajDealership/actions/runs/41173480435) completed with zero failures, skips or flaky tests. Its test-results JSON records 97 expected and 97 passed.

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

<badge color="success">236 passed / 236 executed</badge>

[Main CI run #41174598318](https://github.com/Manav326/BajajDealership/actions/runs/41174598318) executed the backend suite against PostgreSQL. The full main CI run completed successfully: backend/PostgreSQL tests, web build, Docker stack smoke, Windows installer packaging and GHCR publish/pull smoke all passed. Standard and Liquid Glass Android APK jobs were intentionally skipped on this non-Android change. Maven reported:

- Tests run: **236**
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
| Finance | 19 | 3 |
| Inventory | 26 | 5 |
| Notifications | 35 | 7 |
| Sales | 34 | 6 |
| Security | 17 | 6 |
| Social integrations | 25 | 6 |
| System | 12 | 2 |
| Workshop | 20 | 3 |
| Root / migrations | 1 | 1 |
| **Total** | **236** | **49** |

There is a backend integration journey for a synthetic customer request through test ride, booking, invoice, payment record, handover and customer ownership visibility. The parallel browser UI request-conversion test remains API-mocked; keep those two evidence types distinct.

## 3. Measured source-code coverage

### Backend — JaCoCo

<badge color="success">Coverage floors passed</badge>

[Coverage report artifact from CI #41174598318](https://github.com/Manav326/BajajDealership/actions/runs/41174598318/artifacts/13032471991)

| Package | Line coverage | Branch coverage | Assessment |
|---|---:|---:|---|
| Whole backend bundle | **69.63%** | **44.76%** | Good; continue raising branch depth |
| Catalogue | 86.08% | 58.82% | Strong |
| Commerce / parts | 80.16% | 57.39% | Strong |
| Customers | 73.65% | 47.36% | Good |
| Inventory | 78.49% | 52.67% | Good |
| Notifications | 69.70% | 48.87% | Good |
| Sales | 81.32% | 54.45% | Strong |
| Security | 80.06% | 50.38% | Strong |
| System | 79.08% | 62.80% | Strong |
| Workshop | 79.45% | 55.37% | Strong |
| Finance | **76.53%** | **50.60%** | **Good after new expense, day-close and tax-control integration tests** |
| Social integrations | **15.85%** | **10.57%** | **Very weak; highest priority** |

The JaCoCo regression floors currently enforce at least 60% bundle line / 35% bundle branch, 65% / 40% for the established core packages, 42% / 24% for Finance and 14% / 9% for Social. Finance has now materially exceeded its floor after three additional PostgreSQL integration scenarios, but the low Social floor is still deliberately close to its measured baseline to prevent regressions while provider tests are expanded. The floor is not a quality target.

#### Social integration class-level hotspots

The Social package total hides several large services with very little direct execution. The class figures below come from the same JaCoCo XML report and are the best next test targets:

| Service class | Line coverage | Branch coverage | Priority |
|---|---:|---:|---|
| SocialMetaPublishingService | 5.3% | 1.1% | Critical |
| SocialWhatsappScheduleService | 6.9% | 0.9% | Critical |
| SocialMediaWorkflowService | 8.0% | 1.0% | Critical |
| SocialMediaAssetController | 10.0% | n/a | High |
| SocialWhatsappService | 13.5% | 9.9% | High |
| SocialMetaService | 16.4% | 12.6% | High |
| SocialMediaAssetService | 21.6% | 8.5% | High |
| SocialMetaController | 23.1% | n/a | Medium |
| SocialMediaObjectStorage | 82.3% | 73.9% | Relatively strong |

Prioritize approval/reject/cancel and dispatch state transitions, schedule retries and consent revalidation, Meta token/OAuth failure paths, signed media expiry/tamper/integrity paths, and webhook event ordering. The current 25 Social tests mostly cover configuration, storage and endpoint security; they do not yet exercise the core provider workflows deeply.

### Web — Chromium V8 function execution

The full browser run captured V8 function-execution data per test and unions functions by loaded source module:

| Application | Source modules loaded | Executed functions | Loaded-source function coverage |
|---|---:|---:|---:|
| Staff portal | 42 | 1,066 / 1,741 | **61.23%** |
| Customer web site | 8 | 249 / 387 | **64.34%** |
| Combined loaded source | 50 | 1,315 / 2,128 | **61.80%** |

The workflow enforces a 50% regression floor for the loaded-source function metric.

**Scope warning:** this is function execution for modules loaded during these Chromium journeys. It is not JavaScript line/branch coverage, does not include files no test loaded, and is not a percentage of the entire web repository. Do not compare this directly with JaCoCo line/branch coverage.

### Android and Windows coverage

No trustworthy source-code coverage percentage is currently produced for the React Native Android editions or native Tauri shell. Maestro flow counts are scenario inventory, not line/branch/function coverage. Standard and Liquid Glass each define the same 11 flows, plus a shared customer-login subflow:

| Suite | Scenario / Maestro flow | Key assertions | Current execution status |
|---|---|---|---|
| Public | `authentication-entry.yaml` | Signed-out sign-in entry, credentials and activation fields, return to showroom | Passed in run #41178367640 on both editions (2/2 JUnit tests per edition) |
| Public | `showroom-smoke.yaml` | Public brand identity, showroom visibility and motorcycle search | Passed in run #41178367640 on both editions (2/2 JUnit tests per edition) |
| Authenticated | `customer-area-navigation.yaml` | My bikes, parts, updates, profile, saved addresses and service history navigation | Not run in CI; synthetic customer credentials required |
| Authenticated | `device-layout-adaptation.yaml` | Customer navigation and content remain visible in portrait and landscape | Not run in CI; synthetic customer credentials required |
| Authenticated | `notification-inbox-basics.yaml` | Inbox and unread-only filter | Not run in CI; synthetic customer credentials required |
| Authenticated | `parts-cart-persistence.yaml` | Parts filters, add-to-cart, subtotal and cart persistence after app restart | Not run in CI; synthetic customer credentials required |
| Authenticated | `service-appointment-cycle.yaml` | Create and cancel an appointment for a linked synthetic vehicle | Not run in CI; synthetic customer and vehicle required. Stable testIDs plus keyboard/scroll handling were added to both editions in commit `caff228`; this flow has not yet been executed |
| Notification fixtures | `notification-pagination.yaml` | Load-more action and page-two fixture | Not run in CI; deterministic notification fixture required |
| Notification fixtures | `notification-read-unread-dismiss.yaml` | Mark read, mark unread and dismiss | Not run in CI; deterministic notification fixture required |
| Notification fixtures | `notification-rich-content-cta-image.yaml` | Campaign title/image, CTA and expected destination | Not run in CI; deterministic campaign/media fixture required |
| Notification fixtures | `notification-unsafe-route-suppressed.yaml` | Unsafe internal destination appears without an actionable CTA | Not run in CI; deterministic notification fixture required |

The emulator CI workflow currently selects only the two public flows. The local helper's `All` selection can run all three suites, but authenticated and fixture flows need a synthetic customer, linked vehicle and deterministic notification fixture data. A public smoke pass must not be described as all 11 flows passing.

## 4. Android emulator public smoke: failure diagnosis and successful pass

### Historical runner failure

[Run #41175240508](https://github.com/Manav326/BajajDealership/actions/runs/41175240508) failed in both editions after APK generation, PostgreSQL/API startup, migrations, synthetic showroom seeding and emulator boot. The log showed:

`mkdir: cannot create directory '': No such file or directory`

The emulator action executed the multi-line script in separate shell processes, so workspace/result variables did not survive. APK installation and Maestro were not reached; no JUnit report was created. This was a test-harness execution failure, not an app assertion failure.

### Confirmed successful Android smoke

[Run #41177206073](https://github.com/Manav326/BajajDealership/actions/runs/41177206073) completed both matrix jobs successfully. Each edition built and installed its x86_64 test APK, booted the emulator, started the isolated PostgreSQL-backed API, applied migrations, seeded the synthetic public showroom, and executed Maestro.

The two uploaded JUnit reports were inspected:

| Android edition | Public test cases | Passed | Failed | Errors | Skipped |
|---|---:|---:|---:|---:|---:|
| Standard | 2 | **2** | 0 | 0 | 0 |
| Liquid Glass | 2 | **2** | 0 | 0 | 0 |

Both reports contain the two expected scenarios: customer sign-in/activation entry and public showroom smoke test. This is an actual emulator UI pass, not merely an APK build. The run proves only the two public flows; it does not prove all 11 flow definitions per edition.

### Current runner safeguards and stricter rerun

The persistent single-process helper `.github/scripts/run-android-maestro-public.sh` was corrected and then hardened in [commit 51c937a](https://github.com/Manav326/BajajDealership/commit/51c937a204f2cdd31b5e791bd0272e66aa3e707d). It verifies the flow directory and APK, waits for ADB/device/package-manager readiness, retries install, requires a non-empty parseable JUnit report, requires the JUnit test count to be at least the count of public YAML flow files, and rejects failures, errors or skipped tests.

The stricter rerun [#41178367640](https://github.com/Manav326/BajajDealership/actions/runs/41178367640) completed successfully for both editions. The Standard and Liquid Glass jobs each installed the self-contained x86_64 APK, started an isolated PostgreSQL-backed API, seeded the public showroom, ran both public Maestro flows, and uploaded JUnit evidence. Job logs confirm **2/2 flows passed; 2 tests, 0 failures, 0 errors and 0 skips** for each edition. The validator therefore proves the two configured public flows only; it does not execute authenticated or notification-fixture flows.

After that run, commit `caff228` added stable testIDs and improved scroll/keyboard handling in `service-appointment-cycle.yaml` and both Android customer screens. That changed flow remains unexecuted in CI.

The emulator workflow selects only the two public flows per edition. The remaining authenticated-customer and notification-fixture flows (five and four respectively) still require isolated synthetic customer/vehicle data and deterministic notification fixtures before running the complete 11-flow set. A physical phone run is also required before mobile release acceptance.

## 5. Quality rating — decision data

| Dimension | Quality | Why |
|---|---|---|
| Backend correctness tests | **Good** | 236 real PostgreSQL-backed tests passed, including security, dealership scope, transaction and concurrency cases |
| Backend coverage depth | **Good but uneven** | Whole backend 69.63% line / 44.76% branch; Finance improved to 76.53% / 50.60%; Social remains 15.85% / 10.57% |
| Staff web | **Good, not complete** | Main workflows have broad passing Chromium coverage; loaded-source function coverage 61.23%; many API routes are mocked |
| Customer website | **Good for tested journeys** | 25 showroom cases pass; loaded-source function coverage 64.34%; production-like end-to-end remains |
| Social Studio | **Good editor regression** | 42 dedicated cases pass; provider authentication, permissions and live publishing remain disabled/external |
| Notification Studio | **Good browser/backend baseline** | Responsive preview, approvals and Send now have UI and PostgreSQL tests; actual FCM delivery is not proven |
| Standard Android | **Limited positive smoke evidence** | 2/2 public emulator flows passed with JUnit; 9 additional flow definitions and physical-device acceptance remain |
| Liquid Glass Android | **Limited positive smoke evidence** | 2/2 public emulator flows passed with JUnit; 9 additional flow definitions and physical-device acceptance remain |
| Windows desktop | **Limited-to-good build evidence** | EXE/MSI/MSIX packaging passes; browser-based shell layout/API selection exists; full native-shell install/update acceptance remains |
| Accessibility | **Limited** | Keyboard focus and semantic navigation smoke exists; no comprehensive axe/WCAG or screen-reader audit |
| Performance and resilience | **Incomplete** | No comprehensive load/stress, long-running scheduler, service outage or backup-restore acceptance suite |

## 6. Remaining test work, ordered by release risk

### P0 — required before production approval

1. [x] Confirm the stricter JUnit-validation rerun #41178367640 completed successfully for both Standard and Liquid Glass; both job logs and JUnit summaries show 2/2 public flows and zero failures, errors or skips.
2. Fix any actual assertions that fail after Maestro begins executing; do not mask failures as infrastructure retries.
3. Seed an isolated synthetic customer, linked test vehicle and deterministic notification fixture data so authenticated and notification Maestro flows can run as All on both editions.
4. Run the full All Maestro suite on at least one representative physical Android device for both editions and retain reports/screenshots.
5. Add real-backend Playwright acceptance for staff sales, inventory, finance and workshop, using only synthetic database fixtures; retain the existing service-level integration tests.
6. Add explicit authorization/privacy browser tests across OWNER, MANAGER and restricted staff roles.
7. Add backup/restore, deployment migration-upgrade rehearsal, scheduler outage/recovery and realistic transaction concurrency acceptance.

### P1 — improve quality depth

1. Maintain Finance above its current 76.53% line / 50.60% branch baseline while adding reversal, reconciliation, permission and report-boundary cases.
2. Raise Social coverage from 15.85% / 10.57% to at least 50% / 35%, including provider callback/error/permission/token lifecycle cases with synthetic provider stubs.
3. Raise whole-backend coverage progressively toward 75% line / 55% branch, without weakening current floors.
4. Add a stable per-application frontend line/branch metric (e.g. instrumented Vitest/V8 source maps); retain the current loaded-function metric only as a browser-journey signal.
5. Add full Firefox/WebKit coverage for high-risk customer showroom journeys, plus accessibility scans and manual screen-reader checks.
6. Add performance budgets and load tests for catalogue, customer portal, parts checkout, notification dispatch and reporting.

## 7. Release decision

**Current decision: staging / controlled acceptance only — not full production rollout.**

The backend, web and Windows packaging evidence plus the two passing public Android emulator flows are sufficiently credible to continue controlled staging. They are not a substitute for complete authenticated/notification mobile journeys, physical-device acceptance, customer-data safety, production infrastructure, finance reconciliation, live integration setup or dealership sign-off. The mobile release gate therefore remains open.

The release owner should approve full rollout only after P0 items are evidenced and the production operations gates in [PRODUCT_STATUS.md](PRODUCT_STATUS.md) are complete.
