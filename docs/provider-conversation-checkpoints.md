# Retained provider conversation checkpoints

Normative from 13.7.0, issue [#242](https://github.com/avnionur/shepherd-typescript/issues/242).
Public entry: root and [`./providers`](../src/facades/providers.ts). Implementation:
[`conversation.ts`](../src/provider/conversation.ts), [`checkpoints.ts`](../src/provider/checkpoints.ts).
The provider protocol v4 configuration adds a versioned
[payload schema](../spec/schemas/provider-conversation-checkpoint-v1.schema.json) inside the existing
supervision-context record envelope. Existing replay record schemas and memory-only receipts stay valid.

## Opt into retention

```ts
import { createProviderConversation } from "@avnionur/shepherd-typescript/providers";

const conversation = createProviderConversation({
    adapterId: "worker-conversation",
    provider,
    system: "Your stable system prompt.",
    checkpointStore: store,
});
// Pass conversation.provider and conversation.session to runReplaySession.
// In a new process, reopen the store and construct the same definition before rewind/replay.
```

`checkpointStore` opts into persisting messages and the complete system prompt. A checkpoint contains
ordered messages, system text, tool definitions, the chained replay context identity, adapter ID,
provider descriptor and a non-secret configuration identity. Equal captures deduplicate. Nothing
is truncated. The complete canonical payload must fit `supervision.limits.maxDataCanonicalBytes`
(65,536 UTF-8 bytes); the configured message, tool and identity limits also apply. An oversized
capture reports the provider constituent unavailable through the replay adapter failure path.

The live factory binds its descriptor, endpoint, dialect, static headers, output settings and tool
configuration without retaining credentials, credential environment variables or transport handles.
Credential rotation is compatible. Caller `configurationId`, when supplied, adds a binding; it does
not override the factory binding. Custom/program providers must supply a stable, non-secret
`configurationId` identifying their code and settings. Its truthfulness remains the host's responsibility.
Changing provider/model, configuration, adapter or system refuses restoration.

Without `checkpointStore`, receipts remain process-local. After restart, `rebuild(retainedSteps)`
plus a step-boundary replay remains a reconstructive fallback. A retained checkpoint restores verified
captured state; it does not silently fall back to reconstruction when verification fails.

## Native tool prefixes and custom adapters

The built-in conversation renders structured requests/outputs into messages and retains no native
tool definitions. Native tool-loop adapters can retain the exact state they actually consume:

```ts
import {
    readProviderConversationCheckpoint,
    retainProviderConversationCheckpoint,
} from "@avnionur/shepherd-typescript/providers";

const receipt = retainProviderConversationCheckpoint(store, { ...binding, state });
// Adapter checkpoint evidence:
const evidence = {
    status: "verified" as const,
    contextPrefixId: state.contextPrefixId,
    receiptId: receipt.receiptId,
    snapshotRecordId: receipt.recordId,
};
// Use this read in validateReceipt; restore reads again before replacing local state.
const restored = readProviderConversationCheckpoint(store, {
    ...binding,
    receiptId: receipt.receiptId,
    contextPrefixId: state.contextPrefixId,
});
```

`binding` contains `adapterId`, `configurationId` and `provider` (the descriptor). `state` contains
`contextPrefixId`, `messages`, `system` and `tools`. Native `tool_use` and `tool_result` blocks,
ordered tool definitions and exact text survive canonical storage. Reads return immutable snapshots
and work on read-only stores. The complete executable adapter example is
[`provider-native-checkpoint-process.ts`](../test/fixtures/provider-native-checkpoint-process.ts),
which uses the live-provider transport, tool-turn provider and replay tool-loop bindings.

## Verification and recovery

Capture validates the snapshot in the replay store before accepting verified evidence. The checkpoint
cites its `snapshot_record_id` as a causal parent. Inspection verifies the receipt, envelope, content
identity, owner, payload version, descriptor and context. A native import retains these checks; an
imported descriptor is data and does not authorize a provider or supply credentials.

Branches require the same adapter identity and a read-only `validateReceipt(receiptId, context)` for
stored snapshots. Preflight runs before branch publication, external compensation and world restore;
completed exact commands return their retained result without calling the adapter again. The selected
replay provider must match the snapshot. Restore revalidates before changing held state. Missing,
malformed, misowned, incompatible or corrupt data refuses explicitly. An active conversation turn
refuses validation/restore. Failed turns advance context without appending messages; cancelled turns
change neither. There is no recovery of an unacknowledged remote provider request or remote KV cache.

Snapshot publication and replay checkpoint publication are separate durable operations. A crash may
leave an unreferenced snapshot, but it cannot turn missing snapshot data into verified checkpoint
evidence. Retrying the same snapshot deduplicates. Canonical data is immutable; no purge is provided.

## Retention and compatibility limits

Snapshots use the existing `context` data class. Append/import secret scanning applies when enabled;
scanning is pattern-based and defaults off. Redacted exports omit snapshot content, while native
archives and database backups include it. Redacted archives cannot restore a conversation. See
[secrets and retention](./secrets-and-retention.md) for rotation and handling policy.

13.5.0 readers refuse new retained checkpoint evidence before compensation, and redact its context
body even after native import. Repeat the N−1 drill by building commit `0e4a232` in a separate checkout:

```sh
node test/fixtures/provider-checkpoint-legacy-reader.ts /absolute/path/to/13.5.0/dist
```

This feature proves local prefix restoration, not a live cache hit, remote provider state capture,
cross-store ownership, provider-side exactly-once execution, or trust in imported claims. Wire-byte
proofs use fixture transports; live cache behavior remains the separate opt-in provider test.

## Evidence

- [Fresh process and native import](../test/provider/provider-checkpoint-restart.test.ts): exact next request bytes and context, with a failing memory-receipt control.
- [Native prefix](../test/provider/provider-native-checkpoint.test.ts): actual tool-use/result, system and definition bytes after restart/import.
- [Binding](../test/provider/provider-checkpoint-binding.test.ts): incompatible settings refuse before real compensation; credential rotation and completed-command replay.
- [Storage](../test/provider/provider-checkpoint-storage.test.ts): immutable/deduplicated reads, bounds, schema, secret refusal and redaction.
- [Corruption](../test/provider/provider-checkpoint-corruption.test.ts): malformed versions, owner/envelope mismatch and no local mutation.
- [Interrupted turns](../test/provider/provider-checkpoint-turns.test.ts): failure context, cancellation and pending-turn refusal.
