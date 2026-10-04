# Pi connection settings preservation (#278)

Base main advanced to 0e4a232677f3814c5161c40430bc7a639a0b6fc4, version13.5.0; additive delivery13.6.0. New credential setup is a MINOR capability.

| Capability | Risk | Verification |
| --- | --- | --- |
| Native key save/catalog | High | Real pinned SDK dummy-key save/reopen, no raw key in output/argv, private modes, expression refusal and preservation of providers |
| HTTP settings | High | Exact IDs, host/origin/token admission, bounds, idle serialization, no trace/export writes, saved-key failure/status handling |
| Existing RPC chat | High | Existing18 tests preserved; additional connection-selection tests |
| Offline graph/playground | Medium | Existing UI/graph tests + browser smoke |
| Core/public/distribution | Medium | No core API/protocol changes; fullverify, sync and productionbuild; optional lockfile review |

Keys live only in a dedicated Pi-native private auth file. Single-user loopback app is not a production/multi-tenant/keychain service. No real key read or live model invocation is needed for conformance.

| Local model catalog | High | Native SDK custom-provider load; optional tags capabilities via show; embedding exclusion; stale catalog removal and private overlay modes |
| Trace rotation | High | HTTP token/idle admission, empty state, original export byte identity and fresh restart pointer |
| Keyboard/canvas reset | Medium | Repeatable browser arrow focus/typing behavior, clear resets transcript/graph/inspector/playback and retained settings |

Completed evidence: `pnpm verify` exit 0, 1,402 passed, two intentional skips and 100% configured coverage; version synchronization and production build passed. All 24 focused example tests passed. Browser checks verified 48px arrow panning, ordinary textarea navigation, clear to zero messages/nodes, inspector reset and local Ollama selection/connect. A real local qwen2.5-coder:0.5b turn returned OK with 567/1 tokens and 23 records in an isolated database. Installed SDK plus external RPC fixture retained fixture-a/model-one with Send enabled. Native credential tests used only dummy keys; no user credential was read. The optional lockfile's registry integrity entries and dependency scripts were reviewed; installation disables scripts and root allowBuilds is unchanged. Final standards/spec reviews found no remaining blockers.
