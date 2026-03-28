import { BrowserProvider, ethers } from "ethers";
import {
  getMonadExplorerBaseUrl,
  getMonadExplorerAddressUrl,
  getMonadExplorerTxUrl,
  hasConfiguredMonadExplorerUrl,
} from "@/src/lib/monad-explorer";

export type WalletState = {
  address: string | null;
  chainId: number | null;
  chainName: string;
  correctNetwork: boolean;
};

type EthereumProvider = ethers.Eip1193Provider & {
  on?: (eventName: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    eventName: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export const expectedChainId = Number.parseInt(
  process.env.NEXT_PUBLIC_MONAD_CHAIN_ID ?? "10143",
  10,
);

export const expectedChainName =
  process.env.NEXT_PUBLIC_MONAD_CHAIN_NAME ?? "Monad Testnet";

export function hasInjectedWallet() {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

function getInjectedEthereum() {
  if (!window.ethereum) {
    throw new Error("MetaMask-compatible wallet not detected.");
  }

  return window.ethereum;
}

export function getInjectedBrowserProvider() {
  return new BrowserProvider(getInjectedEthereum());
}

export function subscribeToWalletEvents(listener: () => void) {
  if (typeof window === "undefined" || !window.ethereum) {
    return () => {};
  }

  const { ethereum } = window;
  ethereum.on?.("accountsChanged", listener);
  ethereum.on?.("chainChanged", listener);

  return () => {
    ethereum.removeListener?.("accountsChanged", listener);
    ethereum.removeListener?.("chainChanged", listener);
  };
}

export async function connectWallet(): Promise<WalletState> {
  const ethereum = getInjectedEthereum();

  try {
    await ethereum.request?.({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // Fall back to the standard account request for wallets that do not support
    // the permissions flow.
  }

  const provider = getInjectedBrowserProvider();
  await provider.send("eth_requestAccounts", []);

  return readWalletState();
}

export async function readWalletState(): Promise<WalletState> {
  if (typeof window === "undefined" || !window.ethereum) {
    return {
      address: null,
      chainId: null,
      chainName: expectedChainName,
      correctNetwork: false,
    };
  }

  const provider = getInjectedBrowserProvider();
  const network = await provider.getNetwork();
  const accounts = (await provider.send("eth_accounts", [])) as string[];

  return {
    address: accounts[0] ?? null,
    chainId: Number(network.chainId),
    chainName: expectedChainName,
    correctNetwork: Number(network.chainId) === expectedChainId,
  };
}

export async function switchToExpectedChain() {
  await getInjectedEthereum().request?.({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${expectedChainId.toString(16)}` }],
  });
}

export function shortenAddress(address: string | null) {
  if (!address) {
    return "Not connected";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function hasMonadExplorerUrl() {
  return hasConfiguredMonadExplorerUrl();
}

export { getMonadExplorerTxUrl, getMonadExplorerAddressUrl };

const monadRpcUrl =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz/";

const monadCurrencySymbol =
  process.env.NEXT_PUBLIC_MONAD_CURRENCY_SYMBOL ?? "MON";

export async function addMonadToWallet() {
  await getInjectedEthereum().request?.({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: `0x${expectedChainId.toString(16)}`,
        chainName: expectedChainName,
        rpcUrls: [monadRpcUrl],
        nativeCurrency: {
          name: monadCurrencySymbol,
          symbol: monadCurrencySymbol,
          decimals: 18,
        },
        ...(hasConfiguredMonadExplorerUrl()
          ? { blockExplorerUrls: [getMonadExplorerBaseUrl()] }
          : {}),
      },
    ],
  });
}
