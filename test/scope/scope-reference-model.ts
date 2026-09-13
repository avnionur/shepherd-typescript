/** Refusal classes shared by the reference model and the durable implementation. */
export type LawRefusal = "conflict" | "evidence" | "quiescence" | "terminal";

/** One logical scope in the pure reference model. */
export type ModelScope = {
    readonly children: string[];
    readonly key: string;
    /** World the child was forked from, for three-way merge planning. */
    readonly origin: ReadonlyMap<string, string> | null;
    readonly parent: string | null;
    readonly selected: string[];
    state: "discarded" | "merged" | "open";
    world: Map<string, string> | null;
};

/** One generated operation applied identically to the model and the implementation. */
export type LawOperation =
    | { readonly kind: "delete"; readonly path: string; readonly scope: string }
    | { readonly kind: "discard"; readonly scope: string }
    | { readonly kind: "emit"; readonly scope: string; readonly token: string }
    | {
          readonly kind: "fork";
          readonly key: string;
          readonly parent: string;
          readonly world: boolean;
      }
    | { readonly kind: "merge"; readonly scope: string }
    | {
          readonly content: string;
          readonly kind: "write";
          readonly path: string;
          readonly scope: string;
      };

/** Pure executable reference model of scope fork, emit, world write, merge, and discard. */
export class ScopeReferenceModel {
    readonly scopes = new Map<string, ModelScope>();
    readonly #binding: ReadonlyMap<string, string>;

    constructor(root: string, binding: ReadonlyMap<string, string>) {
        this.#binding = binding;
        this.scopes.set(root, {
            children: [],
            key: root,
            origin: null,
            parent: null,
            selected: [],
            state: "open",
            world: null,
        });
    }

    /** Applies one operation, returning the refusal class or null when it succeeds. */
    apply(operation: LawOperation): LawRefusal | null {
        switch (operation.kind) {
            case "fork":
                return this.#fork(operation.parent, operation.key, operation.world);
            case "emit":
                return this.#open(operation.scope, (scope) => {
                    scope.selected.push(operation.token);
                });
            case "write":
            case "delete": {
                const scope = this.#scope(operation.scope);
                if (operation.kind === "write") {
                    scope.world?.set(operation.path, operation.content);
                } else {
                    scope.world?.delete(operation.path);
                }
                return null;
            }
            case "merge":
                return this.#merge(operation.scope);
            case "discard":
                return this.#discard(operation.scope);
        }
    }

    #fork(parentKey: string, key: string, world: boolean): LawRefusal | null {
        return this.#open(parentKey, (parent) => {
            const source = world ? (parent.world ?? this.#binding) : null;
            parent.children.push(key);
            this.scopes.set(key, {
                children: [],
                key,
                origin: source === null ? null : new Map(source),
                parent: parentKey,
                selected: [],
                state: "open",
                world: source === null ? null : new Map(source),
            });
        });
    }

    #merge(key: string): LawRefusal | null {
        const child = this.#scope(key);
        const parent = this.#scope(child.parent as string);
        if (child.state !== "open" || parent.state !== "open") {
            return "terminal";
        }
        if (child.world !== null && parent.world === null) {
            return "evidence";
        }
        if (child.world !== null && parent.world !== null) {
            const origin = child.origin as ReadonlyMap<string, string>;
            const childChanged = changedPaths(origin, child.world);
            const parentChanged = changedPaths(origin, parent.world);
            if (childChanged.some((path) => parentChanged.includes(path))) {
                return "conflict";
            }
        }
        if (child.children.some((grandchild) => this.#scope(grandchild).state === "open")) {
            return "quiescence";
        }
        if (child.world !== null && parent.world !== null) {
            for (const path of changedPaths(
                child.origin as ReadonlyMap<string, string>,
                child.world,
            )) {
                const content = child.world.get(path);
                if (content === undefined) {
                    parent.world.delete(path);
                } else {
                    parent.world.set(path, content);
                }
            }
        }
        for (const token of child.selected) {
            if (!parent.selected.includes(token)) {
                parent.selected.push(token);
            }
        }
        child.state = "merged";
        return null;
    }

    #discard(key: string): LawRefusal | null {
        const target = this.#scope(key);
        const parent = this.#scope(target.parent as string);
        if (parent.state !== "open" || target.state !== "open") {
            return "terminal";
        }
        const seal = (scope: ModelScope) => {
            if (scope.state === "open") {
                scope.state = "discarded";
            }
            for (const child of scope.children) {
                seal(this.#scope(child));
            }
        };
        seal(target);
        return null;
    }

    #open(key: string, action: (scope: ModelScope) => void): LawRefusal | null {
        const scope = this.#scope(key);
        if (scope.state !== "open") {
            return "terminal";
        }
        action(scope);
        return null;
    }

    #scope(key: string): ModelScope {
        return this.scopes.get(key) as ModelScope;
    }
}

/** Returns the sorted paths whose content differs between two logical worlds. */
export function changedPaths(
    left: ReadonlyMap<string, string>,
    right: ReadonlyMap<string, string>,
): string[] {
    return [...new Set([...left.keys(), ...right.keys()])]
        .filter((path) => left.get(path) !== right.get(path))
        .sort();
}

/** Deterministic seeded pseudo-random generator (mulberry32). */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };
}
