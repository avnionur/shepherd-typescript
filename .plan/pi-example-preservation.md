# Pi example capability preservation

Base: main `be35ca976a866a063a75fee8fe3900a81beebfba`. Issue #275.

| Capability | Existing evidence | Risk | Required verification |
| --- | --- | --- | --- |
| Chat + RPC subprocess | Pinned Pi RPC docs; new example | High | HTTP/process fixtures: settle, fail, cancel, cleanup, framing, bounds |
| Canonical durable runs | test/run/durable-execution*.test.ts | High | Example real-store reopen + exact archive comparison across reads |
| Evidence graph | Public trace envelopes + direct parent IDs | High | HTTP graph identity/parent assertions; browser interaction smoke |
| Existing packaged examples | examples/manifest.json + package gate | Medium | pnpm verify; no manifest or existing example edits |
| Public runtime/contracts | src + docs; prior changelog | Medium | No runtime/protocol edits; pnpm verify/typecheck/test/package gates |
| Distribution/version | release-config.yaml + package.json | Medium | MINOR sync + pnpm build:desktop; evidence inventory check |

No core streaming, governed Pi tools, native jail, provider restart checkpoint, or platform expansion is claimed. Pi is an external optional executable. Credentialed live calls require independent evidence. Final verification results are recorded below.

Main advanced during work. The final example is based on `e794508639902d64f350e4621fb5cf2cc0b8e701`, preserving both #239 repository declarations and #240 compensation ownership. No core, protocol, dependency, lockfile or existing test assertion is changed by this example. Final MINOR version is 13.4.0. Nested Node test context was reproduced red at the repository test seam and corrected by clearing only NODE_TEST_CONTEXT and requiring a nonempty TAP report; the example tests now actually execute in the complete suite.

## Completed evidence

- `CI=true pnpm verify`: exit 0 on Node 24.17.0 / macOS arm64, 1,378 passed, two intentional skips, zero failures; configured core/tooling coverage 100% line/branch/function. Protocol, evaluation, SBOM, API reference, capability inventory, compatibility (zero changes), lint, typecheck and freshly installed package gates passed.
- `pnpm sync:version`, versioned API/SBOM/compatibility generation and `pnpm build:desktop`: exit 0 at 13.4.0.
- Source and freshly installed `node --test .../http.test.mjs .../graph.test.mjs`: 18 passed, zero failures/skips. Actual HTTP and child-process seams verify durable lifecycle, archive-read byte identity, restart/refusal, UTF-8/LF/CRLF/Unicode separators, retry/settlement, malformed/bounded output, exact selected model, catalog credential redaction, cancellation, timeout cleanup and partial-request shutdown. Pure graph seam verifies dependency traversal and observation expiry.
- Browser smoke on the actual rendered app: playground success/failure/cancel/literal/context, ready-after-stop, inspector schema/identity/witness/parents, filtered inspector clearing and correct run details, zoom/Fit, causal playback/live-follow, full-window and 390px responsive layout. A separately labeled RPC fixture verifies provider switching, provider-dependent choices, selected model persistence during the turn, disabled controls during execution, and retained `fixture-a/model-two` after completion. No credentialed Pi/model call occurred.
- Existing core/protocol/lockfile/workspace configuration and assertions are unchanged relative to the final base; API and protocol baselines change version metadata only. No platform/jail/replay/streaming or live-provider claim is added.
- Initial verification exposed an inherited nested Node test marker and the wrapper failed on an empty report rather than silently accepting unexecuted tests. The production-seam fix clears only NODE_TEST_CONTEXT, selects TAP, and requires a nonempty successful report. Final source and full-suite checks pass. Earlier pre-main-sync verification also missed coverage under the loaded host; it is not reported as passing.
- Internal standards and spec review findings were fixed: coordinated HTTP shutdown (F-033), explicit unavailable-model refusal, filtered inspector context, guide claims and shared graph filtering. No unresolved review blocker remains.
