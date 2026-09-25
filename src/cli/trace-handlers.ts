import type { SemanticRecord } from "../canonical/canonical-record.ts";
import { readLedgerSelector } from "../ledger/bounds.ts";
import { ambiguousLedgerSelector, missingLedgerSelector } from "../ledger/selector-errors.ts";
import {
    cliProtocolConfig,
    projectionProtocolConfig,
    replayProtocolConfig,
    scopeProtocolConfig,
} from "../protocol/config.ts";
import { inspectReplaySession } from "../replay/inspection.ts";
import { diffReplaySessions, readReplayLineage } from "../replay/lineage.ts";
import type { ReplaySessionInspection } from "../replay/types.ts";
import { inspectScope } from "../scope/inspection.ts";
import type { ScopeInspection } from "../scope/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import {
    openStore,
    pagination,
    parseOptions,
    requireNoPositionals,
    requireOnePositional,
} from "./arguments.ts";
import { CliUnavailableError, CliUsageError } from "./errors.ts";
import type { CliHandler, CliHandlerIo } from "./types.ts";

const HANDLERS = cliProtocolConfig.handlerRoles;
const SESSION_SCHEMA = replayProtocolConfig.traceSchemas.session;
const SCOPE_SCHEMA = scopeProtocolConfig.traceSchemas.registration;

/**
 * @internal Creates the read-only `replay` and `scope` trace command handlers addressed by
 * configured handler IDs. Every handler opens the existing store read-only.
 */
export function createTraceCliHandlers(): readonly (readonly [string, CliHandler])[] {
    return [
        [HANDLERS.replayLog, replayLog],
        [HANDLERS.replayShow, replayShow],
        [HANDLERS.replayDiff, replayDiff],
        [HANDLERS.scopeList, scopeList],
        [HANDLERS.scopeShow, scopeShow],
    ];
}

async function replayLog(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.replayLog);
    const page = pagination(parsed);
    using store = openStore(parsed, io);
    if (parsed.positionals.length === 0) {
        const sessions = store
            .listOwnersBySchema(SESSION_SCHEMA, page.limit, page.offset)
            .map((sessionId) => summarizeSession(inspectReplaySession(store, { sessionId })));
        io.output(
            sessions.length === 0
                ? "No replay sessions.\n"
                : sessions
                      .map(
                          (session) =>
                              `${session.session_id}\t${session.mode}\t${session.classification}\n`,
                      )
                      .join(""),
            { replay_sessions: sessions } as unknown as SemanticRecord,
        );
        return;
    }
    const sessionId = resolveOwnerSelector(store, SESSION_SCHEMA, requireOnePositional(parsed));
    const inspection = inspectReplaySession(store, { sessionId });
    const lineage = readReplayLineage(store, sessionId);
    const steps = inspection.steps.slice(page.offset, page.offset + page.limit).map((step) => ({
        depends_on: step.depends_on,
        index: step.index,
        kind: step.kind,
        prefix_id: step.prefix_id,
        source: step.source,
        step_id: step.step_id,
    }));
    io.output(
        `Session: ${sessionId}\nLineage: ${lineage.join(" > ")}\n${steps.map((step) => `${step.index}\t${step.kind}\t${step.source}\t${step.step_id}\n`).join("")}`,
        {
            replay_log: {
                lineage,
                session_id: sessionId,
                step_count: inspection.steps.length,
                steps,
            },
        } as unknown as SemanticRecord,
    );
}

async function replayShow(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.replayShow);
    using store = openStore(parsed, io);
    const sessionId = resolveOwnerSelector(store, SESSION_SCHEMA, requireOnePositional(parsed));
    const inspection = inspectReplaySession(store, { sessionId });
    io.output(
        `Session: ${inspection.session_id}\nMode: ${inspection.mode}\nClassification: ${inspection.classification}\nSource: ${inspection.origin?.source_session_id ?? "none"}\nSteps: ${inspection.steps.length}\nCheckpoints: ${inspection.checkpoints.length}\n`,
        { replay_session: inspection } as unknown as SemanticRecord,
    );
}

async function replayDiff(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.replayDiff);
    if (
        parsed.positionals.length < 2 ||
        parsed.positionals.length > replayProtocolConfig.divergence.maxSessions
    ) {
        throw new CliUsageError(cliProtocolConfig.messages.replayDiffUsage);
    }
    using store = openStore(parsed, io);
    const sessionIds = parsed.positionals.map((selector) =>
        resolveOwnerSelector(store, SESSION_SCHEMA, selector),
    );
    if (new Set(sessionIds).size !== sessionIds.length) {
        throw new CliUsageError(cliProtocolConfig.messages.replayDiffUsage);
    }
    const diff = diffReplaySessions(store, { sessionIds });
    const lines = [
        `Ancestor: ${diff.ancestor_session_id ?? "none"}`,
        `Base: ${diff.base_step_count} step(s)`,
        ...diff.branches.map(
            (branch) =>
                `Branch: ${branch.session_id}\tsteps ${branch.step_count}\tfirst divergence ${branch.first_divergence_index ?? "none"}`,
        ),
        ...diff.effects.map(
            (effect) =>
                `Effect: ${effect.effect_id}\t${effect.effect_kind}\t${effect.disposition}\t${effect.session_ids.length}/${diff.branches.length}${effect.in_ancestor ? "\tancestor" : ""}`,
        ),
    ];
    io.output(`${lines.join("\n")}\n`, { replay_diff: diff } as unknown as SemanticRecord);
}

async function scopeList(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.scopeList);
    requireNoPositionals(parsed);
    const page = pagination(parsed);
    using store = openStore(parsed, io);
    const scopes = store
        .listOwnersBySchema(SCOPE_SCHEMA, page.limit, page.offset)
        .map((scopeId) => {
            const scope = readScope(store, scopeId);
            return {
                children: scope.children.length,
                kind: scope.kind,
                parent_scope_id: scope.parent?.scope_id ?? null,
                scope_id: scope.scope_id,
                state: scope.state,
            };
        });
    io.output(
        scopes.length === 0
            ? "No scopes.\n"
            : scopes.map((scope) => `${scope.scope_id}\t${scope.kind}\t${scope.state}\n`).join(""),
        { scopes } as unknown as SemanticRecord,
    );
}

async function scopeShow(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.scopeShow);
    using store = openStore(parsed, io);
    const scope = readScope(
        store,
        resolveOwnerSelector(store, SCOPE_SCHEMA, requireOnePositional(parsed)),
    );
    const lineage = [scope.scope_id];
    // Scope identities are content-derived from their parent, so the parent chain is acyclic.
    for (let parent = scope.parent; parent !== null; ) {
        lineage.unshift(parent.scope_id);
        parent = readScope(store, parent.scope_id).parent;
    }
    io.output(
        `Scope: ${scope.scope_id}\nKind: ${scope.kind}\nState: ${scope.state}\nLineage: ${lineage.join(" > ")}\nChildren: ${scope.children.length}\nSelected history: ${scope.selected_history.length}\n`,
        { lineage, scope } as unknown as SemanticRecord,
    );
}

function readScope(store: SQLiteTraceStore, scopeId: string): ScopeInspection {
    const scope = inspectScope(store, scopeId);
    // Selectors resolve only to retained registrations, and a child cites a retained parent.
    /* node:coverage disable */
    if (scope === undefined) {
        throw new CliUnavailableError(cliProtocolConfig.messages.scopeUnavailable);
    }
    /* node:coverage enable */
    return scope;
}

function summarizeSession(inspection: ReplaySessionInspection) {
    return {
        classification: inspection.classification,
        mode: inspection.mode,
        program_id: inspection.program_id,
        session_id: inspection.session_id,
        source_session_id: inspection.origin?.source_session_id ?? null,
        step_count: inspection.steps.length,
        terminal: inspection.terminal,
    };
}

/**
 * Resolves an exact owner identity, the configured latest token, or a unique owner-identity
 * prefix among owners retaining a record of the schema.
 */
function resolveOwnerSelector(store: SQLiteTraceStore, schema: string, selector: string): string {
    const exact = readLedgerSelector(selector, "trace selector");
    if (store.readOwner(exact).some((record) => record.envelope.schema_ref === schema)) {
        return exact;
    }
    const ledgers = projectionProtocolConfig.taskRunLedgers;
    if (exact === ledgers.latestSelector) {
        const latest = store.listOwnersBySchema(schema, 1, 0, true)[0];
        if (latest === undefined) throw missingLedgerSelector(exact);
        return latest;
    }
    const matches = store.listOwnersBySchema(schema, 2, 0, false, exact);
    if (matches.length === 0) throw missingLedgerSelector(exact);
    if (matches.length > 1) throw ambiguousLedgerSelector(exact);
    return matches[0] as string;
}
