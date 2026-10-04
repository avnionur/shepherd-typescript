import { createLiveFlowTracker, orderCausalNodes } from "./graph.mjs";

const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
let state;
let selected;
let scale = 0.8;
let offset = { x: 30, y: 45 };
let drag;
let timer;
let previousGraph = "";
let previousMessages = "";
let previousPlayground = "";
let flowTracker;
let activeIds = new Set();
let playbackId;
let playbackTimer;
let playbackQueue = [];
let playbackPosition = 0;
let chosenModel;
let settingsKey = "";
let cameraTarget;
let followTarget;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function element(name, attributes = {}, text) {
    const node = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
}
function transform() {
    $("world").setAttribute("transform", `translate(${offset.x},${offset.y}) scale(${scale})`);
}
function showError(message) {
    $("error").textContent = message;
    $("error").hidden = false;
}
async function post(url, body) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    return value;
}
function renderSettings() {
    const key = JSON.stringify(state.settings);
    if (key !== settingsKey) {
        settingsKey = key;
        let saved;
        try {
            saved = JSON.parse(localStorage.getItem(state.display.settingsStorageKey));
        } catch {
            /* Storage is optional. */
        }
        chosenModel =
            state.settings.models.find(
                (model) => model.provider === saved?.provider && model.id === saved?.id,
            ) ??
            state.settings.models.find(
                (model) =>
                    model.provider === state.settings.defaultModel.provider &&
                    model.id === state.settings.defaultModel.id,
            );
        $("provider-select").replaceChildren(
            ...[...new Set(state.settings.models.map((model) => model.provider))]
                .sort()
                .map((provider) => new Option(provider, provider)),
        );
    }
    $("provider-select").value = chosenModel.provider;
    const models = state.settings.models.filter((model) => model.provider === chosenModel.provider);
    const modelKey = JSON.stringify(models);
    if ($("model-select").dataset.models !== modelKey) {
        $("model-select").replaceChildren(
            ...models.map((model) => new Option(model.name, model.id)),
        );
        $("model-select").dataset.models = modelKey;
    }
    $("model-select").value = chosenModel.id;
    $("provider-select").disabled = Boolean(state.active) || state.settings.models.length < 2;
    $("model-select").disabled = Boolean(state.active) || models.length < 2;
    $("model-note").textContent =
        state.mode === "offline"
            ? "Synthetic offline fixture; no model calls."
            : "Pi catalog choices · next turn uses this model. Provider usage may incur cost.";
}
async function submitChat(body) {
    return post("/api/chat", {
        ...body,
        model: { provider: chosenModel.provider, id: chosenModel.id },
    });
}
function renderRunOverview() {
    const node = state.nodes.find((item) => item.id === selected);
    const run =
        state.runs.find((item) => item.runId === (node?.runId ?? $("run-filter").value)) ??
        state.runs.at(-1);
    const panel = $("run-overview");
    panel.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = run
        ? state.active?.runId === run.runId
            ? "Invocation in progress"
            : `Run ${run.status}`
        : "Ready to observe";
    const explanation = document.createElement("p");
    explanation.textContent = run
        ? (state.display.statusDescriptions[run.status] ?? state.display.overviewText)
        : state.display.overviewText;
    panel.append(heading, explanation);
    if (run) {
        const dl = document.createElement("dl");
        for (const [label, value] of Object.entries({
            Provider: run.provider?.model ?? run.provider?.id ?? "Unavailable",
            Task: run.taskRef ?? "Unavailable",
            "Turn budget": `${run.control?.consumed.turns ?? "Pending"} / ${run.budget?.maxTurns ?? "Unbounded"}`,
            "Duration budget": run.budget?.maxDurationMilliseconds
                ? `${run.budget.maxDurationMilliseconds / 1000} seconds`
                : "Unbounded",
            "Input / output": run.usage
                ? `${run.usage.input_tokens} / ${run.usage.output_tokens} tokens`
                : "Usage unavailable",
            [run.origin === "offline" ? "Cost (fixture)" : "Cost"]:
                run.usage?.cost_usd === null || !run.usage
                    ? "Unavailable"
                    : `$${run.usage.cost_usd.toFixed(4)}`,
            Cut: run.cut?.cut_id ?? "Not published",
        })) {
            const term = document.createElement("dt");
            term.textContent = label;
            const definition = document.createElement("dd");
            definition.textContent = value;
            dl.append(term, definition);
        }
        panel.append(dl);
    }
    const recordHelp = $("record-explanation");
    recordHelp.replaceChildren();
    if (node) {
        const description = state.display.recordDescriptions.find(
            (entry) => entry.schema === node.schema,
        );
        const title = document.createElement("h3");
        title.textContent = description?.title ?? "Retained record";
        const detail = document.createElement("p");
        detail.textContent =
            description?.description ??
            "Inspect the record's schema, payload and explicit parents below.";
        recordHelp.append(title, detail);
    }
}
function inspect() {
    const node = state.nodes.find((item) => item.id === selected);
    renderRunOverview();
    if (!node) return;
    $("selected-source").textContent = node.source.toUpperCase();
    const dl = document.createElement("dl");
    for (const [key, value] of Object.entries({
        Schema: node.schema,
        Identity: node.id,
        Owner: node.owner,
        Ordinal: node.ordinal,
        Mode: node.mode,
        Witness: node.witness,
        Parents: node.parents.join("\n") || "None",
    })) {
        const term = document.createElement("dt");
        term.textContent = key;
        const definition = document.createElement("dd");
        definition.textContent = value;
        dl.append(term, definition);
    }
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(node.body, null, 2);
    $("inspection").replaceChildren(dl, pre);
}
function visibleNodes() {
    const run = $("run-filter").value;
    const source = $("source-filter").value;
    const query = $("search").value.toLowerCase();
    return state.nodes.filter(
        (node) =>
            (!run || node.runId === run) &&
            (!source || node.source === source) &&
            (!query ||
                `${node.schema} ${node.id} ${node.body.event_type ?? ""}`
                    .toLowerCase()
                    .includes(query)),
    );
}
function renderGraph() {
    const visible = visibleNodes();
    const ids = new Set(visible.map((node) => node.id));
    const positions = new Map();
    const levels = new Map();
    const rows = new Map();
    // Records arrive parent-before-child. Only explicit parent identities determine depth.
    for (const node of orderCausalNodes(state.nodes))
        levels.set(
            node.id,
            Math.max(0, ...node.parents.map((parent) => (levels.get(parent) ?? -1) + 1)),
        );
    for (const node of visible) {
        const depth = levels.get(node.id);
        const row = rows.get(depth) ?? 0;
        rows.set(depth, row + 1);
        positions.set(node.id, { x: depth * 250, y: row * 105 });
    }
    const world = $("world");
    world.replaceChildren();
    let hiddenParents = 0;
    for (const node of visible) {
        const target = positions.get(node.id);
        for (const parent of node.parents) {
            if (!ids.has(parent)) {
                hiddenParents++;
                continue;
            }
            const origin = positions.get(parent);
            const startX = origin.x + 210;
            const flowing = playbackId ? node.id === playbackId : activeIds.has(node.id);
            const edge = element("path", {
                class: `edge${flowing ? " flowing" : ""}`,
                "data-source": parent,
                "data-target": node.id,
                d: `M${startX},${origin.y + 35} C${startX + 20},${origin.y + 35} ${target.x - 20},${target.y + 35} ${target.x},${target.y + 35}`,
            });
            if (flowing && !reducedMotion.matches)
                edge.append(
                    element("animate", {
                        attributeName: "stroke-dashoffset",
                        from: 0,
                        to: -24,
                        dur: `${state.display.edgeAnimationMilliseconds}ms`,
                        repeatCount: "indefinite",
                    }),
                );
            world.append(edge);
        }
    }
    for (const node of visible) {
        const position = positions.get(node.id);
        const group = element("g", {
            class: `node ${node.source} ${node.id === selected ? "selected" : ""} ${(playbackId ? node.id === playbackId : activeIds.has(node.id)) ? "current" : ""}`,
            "data-record-id": node.id,
            transform: `translate(${position.x},${position.y})`,
            tabindex: 0,
            role: "button",
            "aria-label": `${node.schema}, ordinal ${node.ordinal}`,
        });
        group.append(element("rect", { width: 210, height: 76, rx: 8 }));
        group.append(
            element(
                "text",
                { x: 13, y: 18, class: "node-source" },
                node.source === "shepherd"
                    ? `SHEPHERD / ${node.mode.toUpperCase()}`
                    : "RPC / OBSERVATION",
            ),
        );
        const label =
            node.body.event_type ??
            node.schema
                .split("/")
                .at(-1)
                .replace(".schema.json", "")
                .replace(state.display.schemaLabelPrefix, "");
        group.append(
            element("text", { x: 13, y: 40 }, label.length > 27 ? `${label.slice(0, 25)}…` : label),
        );
        group.append(
            element(
                "text",
                { x: 13, y: 60, class: "subtitle" },
                `#${node.ordinal} · ${node.id.slice(-12)}`,
            ),
        );
        const choose = () => {
            selected = node.id;
            renderGraph();
            inspect();
        };
        group.addEventListener("click", choose);
        group.addEventListener("keydown", (event) => {
            if (["Enter", " "].includes(event.key)) {
                event.preventDefault();
                choose();
            }
        });
        world.append(group);
    }
    $("graph-empty").hidden = visible.length > 0;
    const canonical = visible.filter((node) => node.source === "shepherd").length;
    $("metrics").replaceChildren();
    for (const [number, label] of [
        [canonical, "core records"],
        [visible.length - canonical, "RPC observations"],
        [hiddenParents, "parents outside view"],
    ]) {
        const item = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = number;
        item.append(strong, document.createTextNode(label));
        $("metrics").append(item);
    }
    const targetId = playbackId ?? followTarget;
    if (
        $("live-follow").checked &&
        targetId &&
        targetId !== cameraTarget &&
        positions.has(targetId)
    ) {
        cameraTarget = targetId;
        const target = positions.get(targetId);
        offset = {
            x: $("canvas").clientWidth / 2 - (target.x + 105) * scale,
            y: $("canvas").clientHeight / 2 - (target.y + 38) * scale,
        };
    }
    $("flow-status").textContent = playbackId
        ? `Causal playback · ${playbackPosition}/${playbackQueue.length}`
        : activeIds.size
          ? `Live · ${activeIds.size} newly observed records`
          : "Waiting for new records";
    $("play-trace").disabled = visible.length === 0;
    transform();
}
function render() {
    document.title = state.title;
    renderSettings();
    renderRunOverview();
    $("mode").textContent = state.mode === "offline" ? "Offline fixture" : "Pi RPC";
    $("record-count").textContent = `${state.nodes.length} RECORDS`;
    $("send").disabled = Boolean(state.active) || state.capacityReached || state.fatal;
    $("stop").hidden = !state.active;
    $("chat-status").textContent = state.fatal
        ? "Inspect / restart"
        : state.active
          ? "Running"
          : state.capacityReached
            ? "Store full"
            : "Ready";
    const playgroundKey = JSON.stringify([
        state.playground,
        state.active?.runId,
        state.capacityReached,
        state.fatal,
    ]);
    if (playgroundKey !== previousPlayground) {
        previousPlayground = playgroundKey;
        $("playground-items").replaceChildren();
        for (const item of state.playground) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "playground-item";
            const title = document.createElement("strong");
            title.textContent = item.title;
            const description = document.createElement("span");
            description.textContent = item.description;
            button.append(title, description);
            button.disabled =
                !item.enabled || Boolean(state.active) || state.capacityReached || state.fatal;
            button.addEventListener("click", async () => {
                button.disabled = true;
                try {
                    await submitChat({ itemId: item.id });
                    await refresh();
                } catch (error) {
                    showError(error.message);
                    button.disabled = false;
                }
            });
            $("playground-items").append(button);
        }
    }
    const messagesKey = JSON.stringify([state.messages, state.active]);
    if (messagesKey !== previousMessages) {
        previousMessages = messagesKey;
        const fragment = document.createDocumentFragment();
        const messages = [
            ...state.messages,
            ...(state.active?.partial ? [{ role: "assistant", text: state.active.partial }] : []),
        ];
        for (const message of messages) {
            const article = document.createElement("article");
            article.className = `message ${message.role}`;
            const role = document.createElement("span");
            role.className = "role";
            role.textContent = message.role.toUpperCase();
            article.append(role, document.createTextNode(message.text));
            fragment.append(article);
        }
        if (messages.length) {
            $("messages").replaceChildren(fragment);
            $("messages").scrollTop = $("messages").scrollHeight;
        }
    }
    const optionsKey = JSON.stringify(state.runs.map(({ runId, status }) => ({ runId, status })));
    if ($("run-filter").dataset.runs !== optionsKey) {
        const old = $("run-filter").value;
        $("run-filter").replaceChildren(
            new Option("All runs", ""),
            ...state.runs.map(
                (run, index) => new Option(`Turn ${index + 1} · ${run.status}`, run.runId),
            ),
        );
        $("run-filter").value = old;
        $("run-filter").dataset.runs = optionsKey;
    }
    flowTracker ??= createLiveFlowTracker(state.display.highlightMilliseconds);
    activeIds = flowTracker.observe(state.nodes, Date.now());
    if (activeIds.size) followTarget = [...activeIds].at(-1);
    const graphKey = JSON.stringify([
        state.nodes,
        state.runs.map((run) => run.status),
        [...activeIds],
        playbackId,
    ]);
    if (graphKey !== previousGraph) {
        previousGraph = graphKey;
        renderGraph();
        inspect();
    }
}
async function refresh() {
    clearTimeout(timer);
    try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not read trace evidence");
        state = await response.json();
        $("error").hidden = true;
        render();
    } catch (error) {
        showError(error.message);
        $("send").disabled = true;
    }
    timer = setTimeout(refresh, state?.pollMilliseconds ?? 1000);
}
$("chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("send").disabled = true;
    try {
        await submitChat({ text: $("prompt").value });
        $("prompt").value = "";
        await refresh();
    } catch (error) {
        showError(error.message);
        $("send").disabled = false;
    }
});
$("stop").addEventListener("click", async () => {
    try {
        await post("/api/cancel", { runId: state.active.runId });
        await refresh();
    } catch (error) {
        showError(error.message);
    }
});
function stopPlayback() {
    clearTimeout(playbackTimer);
    playbackId = undefined;
    playbackQueue = [];
    playbackPosition = 0;
    $("play-trace").textContent = "Play trace";
}
for (const id of ["run-filter", "source-filter", "search"])
    $(id).addEventListener("input", () => {
        stopPlayback();
        if (selected && !visibleNodes().some((node) => node.id === selected)) {
            selected = undefined;
            $("selected-source").textContent = "SELECT A NODE";
            $("inspection").replaceChildren();
        }
        renderGraph();
        inspect();
    });
$("live-follow").addEventListener("change", () => {
    cameraTarget = undefined;
    renderGraph();
});
$("play-trace").addEventListener("click", () => {
    if (playbackId) {
        stopPlayback();
        renderGraph();
        return;
    }
    playbackQueue = orderCausalNodes(visibleNodes());
    playbackPosition = 0;
    $("play-trace").textContent = "Stop playback";
    const step = () => {
        const node = playbackQueue[playbackPosition++];
        if (!node) {
            stopPlayback();
            renderGraph();
            return;
        }
        playbackId = node.id;
        selected = node.id;
        renderGraph();
        inspect();
        playbackTimer = setTimeout(step, state.display.playbackStepMilliseconds);
    };
    step();
});
$("zoom-in").addEventListener("click", () => {
    scale = Math.min(2, scale * 1.2);
    transform();
});
$("zoom-out").addEventListener("click", () => {
    scale = Math.max(0.1, scale / 1.2);
    transform();
});
$("fit").addEventListener("click", () => {
    const box = $("world").getBBox();
    scale = Math.min(
        1,
        ($("canvas").clientWidth - 50) / Math.max(1, box.width),
        ($("canvas").clientHeight - 65) / Math.max(1, box.height),
    );
    offset = { x: 25 - box.x * scale, y: 25 - box.y * scale };
    transform();
});
$("canvas").addEventListener("pointerdown", (event) => {
    if (event.target.closest(".node")) return;
    drag = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    $("canvas").setPointerCapture(event.pointerId);
});
$("canvas").addEventListener("pointermove", (event) => {
    if (drag) {
        offset = { x: event.clientX - drag.x, y: event.clientY - drag.y };
        transform();
    }
});
$("canvas").addEventListener("pointerup", () => {
    drag = null;
});
$("canvas").addEventListener("pointercancel", () => {
    drag = null;
});
$("provider-select").addEventListener("change", () => {
    chosenModel = state.settings.models.find(
        (model) => model.provider === $("provider-select").value,
    );
    try {
        localStorage.setItem(
            state.display.settingsStorageKey,
            JSON.stringify({ provider: chosenModel.provider, id: chosenModel.id }),
        );
    } catch {
        /* Storage is optional. */
    }
    renderSettings();
});
$("model-select").addEventListener("change", () => {
    const provider = chosenModel.provider;
    chosenModel = state.settings.models.find(
        (model) => model.provider === provider && model.id === $("model-select").value,
    );
    try {
        localStorage.setItem(
            state.display.settingsStorageKey,
            JSON.stringify({ provider: chosenModel.provider, id: chosenModel.id }),
        );
    } catch {
        /* Storage is optional. */
    }
    renderSettings();
});
await refresh();
