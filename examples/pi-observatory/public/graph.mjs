/** Order a graph by recorded parent dependencies, retaining input order between ready nodes.
 * External parents stay outside the traversal; this is not a total wall-clock runtime order.
 * @param {Array<object>} nodes Exact record IDs and explicit parent IDs.
 * @returns {Array<object>} Parent-before-child causal traversal.
 * @throws {TypeError} If IDs repeat or the visible graph contains a cycle.
 */
export function orderCausalNodes(nodes) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    if (byId.size !== nodes.length) throw new TypeError("Duplicate graph record identity");
    const indegree = new Map();
    const children = new Map();
    for (const node of nodes) {
        const parents = new Set(node.parents.filter((parent) => byId.has(parent)));
        indegree.set(node.id, parents.size);
        for (const parent of parents) {
            const list = children.get(parent) ?? [];
            list.push(node.id);
            children.set(parent, list);
        }
    }
    const ready = nodes.filter((node) => indegree.get(node.id) === 0);
    const ordered = [];
    for (let index = 0; index < ready.length; index++) {
        const node = ready[index];
        ordered.push(node);
        for (const child of children.get(node.id) ?? []) {
            const remaining = indegree.get(child) - 1;
            indegree.set(child, remaining);
            if (remaining === 0) ready.push(byId.get(child));
        }
    }
    if (ordered.length !== nodes.length) throw new TypeError("Cyclic graph evidence");
    return ordered;
}

/** Track new browser observations without relabeling restored history as live activity.
 * @param {number} windowMilliseconds Non-semantic highlight lifetime from configuration.
 * @returns {object} An observer whose observe call returns currently highlighted record IDs.
 */
export function createLiveFlowTracker(windowMilliseconds) {
    let seen;
    const deadlines = new Map();
    return {
        observe(nodes, now) {
            const ids = new Set(nodes.map((node) => node.id));
            if (seen)
                for (const id of ids)
                    if (!seen.has(id)) deadlines.set(id, now + windowMilliseconds);
            seen = ids;
            for (const [id, deadline] of deadlines)
                if (!ids.has(id) || now >= deadline) deadlines.delete(id);
            return new Set(deadlines.keys());
        },
    };
}
