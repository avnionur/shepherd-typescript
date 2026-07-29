# Align record identity with the pinned kernel ABI v0

Record envelopes mirror the pinned `shepherd.kernel.abi.v0` contract: `record_id` equals the
versioned canonical digest, while owner paths, ordinals, storage receipts, and protocol metadata
remain outside semantic identity. This replaces the earlier planning sketch that mixed semantic
and storage fields, preserving cross-language identity and allowing one record to appear at
multiple owner paths.
