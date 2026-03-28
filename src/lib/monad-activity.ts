/**
 * Monad on-chain activity log.
 *
 * Tracks the last N Web3 actions (mint, list, buy, record run, forge) so the
 * UI can show confirmation times and tx links to demonstrate Monad's speed.
 */

export type ChainAction = {
    /** Human-readable label, e.g. "Mint · Epic Starforged Idol" */
    label: string;
    /** Raw tx hash */
    txHash: string;
    /** Milliseconds from tx send to receipt (confirmation time) */
    ms: number;
    /** Wall-clock time of the action */
    at: Date;
};

const MAX_ACTIONS = 3;

// Module-level store so any part of the app can push without prop drilling.
let _actions: ChainAction[] = [];
let _listeners: Array<(actions: ChainAction[]) => void> = [];

function notify() {
    _listeners.forEach((cb) => cb([..._actions]));
}

/** Push a completed chain action into the log. */
export function pushChainAction(action: ChainAction) {
    _actions = [action, ..._actions].slice(0, MAX_ACTIONS);
    notify();
}

/** Subscribe to activity updates. Returns an unsubscribe function. */
export function subscribeToActivity(
    cb: (actions: ChainAction[]) => void,
): () => void {
    _listeners.push(cb);
    // Immediately emit current state
    cb([..._actions]);
    return () => {
        _listeners = _listeners.filter((l) => l !== cb);
    };
}

/** Returns the current snapshot of recent actions (no subscription). */
export function getActivity(): ChainAction[] {
    return [..._actions];
}

/** Build the full Monad explorer URL for a tx hash. */
export function explorerTxUrl(txHash: string): string {
    const base =
        process.env.NEXT_PUBLIC_MONAD_EXPLORER_URL?.replace(/\/$/, "") ??
        "https://testnet.monadexplorer.com";
    return `${base}/tx/${txHash}`;
}

import { useEffect, useState } from "react";

/** React hook for the current activity log. */
export function useMonadActivity() {
    const [actions, setActions] = useState<ChainAction[]>(getActivity());

    useEffect(() => {
        return subscribeToActivity(setActions);
    }, []);

    return actions;
}
