/**
 * Resolves after a delay or as soon as any supplied signal aborts.
 *
 * Timers and listeners are always released, so an abandoned wait never keeps the process alive
 * beyond its delay.
 *
 * @param milliseconds - Maximum wait.
 * @param signals - Signals that end the wait early; undefined entries are ignored.
 * @returns A promise that resolves with whether the wait ended by abort.
 * @internal
 */
export function waitFor(
    milliseconds: number,
    signals: readonly (AbortSignal | undefined)[],
): Promise<boolean> {
    const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
    if (active.some((signal) => signal.aborted)) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        const finish = (aborted: boolean) => {
            clearTimeout(timer);
            for (const signal of active) {
                signal.removeEventListener("abort", onAbort);
            }
            resolve(aborted);
        };
        const onAbort = () => finish(true);
        const timer = setTimeout(() => finish(false), milliseconds);
        for (const signal of active) {
            signal.addEventListener("abort", onAbort, { once: true });
        }
    });
}
