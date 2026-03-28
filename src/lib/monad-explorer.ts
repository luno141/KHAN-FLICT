const configuredExplorerUrl =
  process.env.NEXT_PUBLIC_MONAD_EXPLORER_URL?.trim() ?? "";

// Keep a stable fallback so transaction links still render during local
// development even when the env var has not been filled yet.
const fallbackExplorerUrl = "https://testnet.monadexplorer.com";

export function getMonadExplorerBaseUrl() {
  return (configuredExplorerUrl || fallbackExplorerUrl).replace(/\/+$/, "");
}

export function getMonadExplorerTxUrl(txHash: string) {
  if (!txHash) {
    return "";
  }

  return `${getMonadExplorerBaseUrl()}/tx/${txHash}`;
}

export function getMonadExplorerAddressUrl(address: string) {
  if (!address) {
    return "";
  }

  return `${getMonadExplorerBaseUrl()}/address/${address}`;
}

export function hasConfiguredMonadExplorerUrl() {
  return configuredExplorerUrl.length > 0;
}

export function shortenTxHash(txHash: string | null | undefined) {
  if (!txHash) {
    return "";
  }

  if (txHash.length <= 14) {
    return txHash;
  }

  return `${txHash.slice(0, 10)}...${txHash.slice(-6)}`;
}
