"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { ethers } from "ethers";
import { PhaserDungeon } from "@/src/components/phaser-dungeon";
import {
  HeroBootstrapPanels,
  WalletGatePanel,
} from "@/src/components/relic-rush-entry-panels";
import {
  InventoryBadge,
  ItemVisual,
  Section,
  StatTile,
} from "@/src/components/relic-rush-ui";
import {
  ARCHETYPES,
  DEFAULT_MARKET_PRICE_WEI,
  DUNGEON_NAME,
  FLOOR_PREVIEW,
  GAME_TITLE,
  HERO_HOOK,
  MOCK_PVP_OPPONENTS,
  PLAYER_ARCHETYPE,
  PLAYER_HERO_NAME,
  SQUAD_SPOTLIGHTS,
} from "@/src/game/content";
import {
  buildItemInstance,
  buildWalletLabel,
  consumeItem,
  createId,
  createLog,
  formatMon,
  getCombatPower,
  getDerivedStats,
  rollLoot,
} from "@/src/game/helpers";
import { resolveItemIcon } from "@/src/game/items";
import type {
  CombatLogEntry,
  DungeonRunSummary,
  EquipmentSlot,
  InventoryItem,
  MarketplaceListing,
  PlayerProfile,
  PlayerSnapshot,
  TxAction,
} from "@/src/game/types";
import {
  bootstrapProfile,
  createListing,
  fetchListings,
  fetchProfile,
  purchaseListing,
  runMockPvp,
  syncProfile,
} from "@/src/lib/relic-rush-api";
import {
  clearStoredSession,
  clearStoredSnapshot,
  saveStoredPlayerId,
  saveStoredSnapshot,
} from "@/src/lib/relic-rush-storage";
import {
  createRelicRushArtifactMarket,
  hasRelicRushMarketAddress,
  relicRushMarketAddress,
} from "@/src/lib/relicRushArtifactMarket";
import {
  createRelicRushRunLedger,
  hasRelicRushLedgerAddress,
  relicRushLedgerAddress,
} from "@/src/lib/relicRushRunLedger";
import {
  createRelicRushRelicForge,
  hasRelicRushForgeAddress,
  relicRushForgeAddress,
} from "@/src/lib/relicRushRelicForge";
import {
  addMonadToWallet,
  connectWallet,
  expectedChainId,
  expectedChainName,
  getInjectedBrowserProvider,
  hasInjectedWallet,
  readWalletState,
  shortenAddress,
  subscribeToWalletEvents,
  switchToExpectedChain,
  type WalletState,
} from "@/src/lib/wallet";
import { getMonadExplorerTxUrl, shortenTxHash } from "@/src/lib/monad-explorer";
import { getUiErrorMessage } from "@/src/lib/ui-error";
import { 
  useMonadActivity, 
  pushChainAction, 
  explorerTxUrl,
  type ChainAction 
} from "@/src/lib/monad-activity";

type TabId = "dungeon" | "inventory" | "marketplace" | "pvp" | "forge";

type ToastType = "pending" | "success" | "error";
type Toast = {
  id: string;
  message: string;
  type: ToastType;
  txHash?: string;
  expiry: number;
};

const DEFAULT_WALLET: WalletState = {
  address: null,
  chainId: null,
  chainName: expectedChainName,
  correctNetwork: false,
};

export function RelicRushApp() {
  const [activeTab, setActiveTab] = useState<TabId>("dungeon");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [purchaseHistory, setPurchaseHistory] = useState<PlayerSnapshot["purchaseHistory"]>([]);
  const [wallet, setWallet] = useState<WalletState>(DEFAULT_WALLET);
  const [status, setStatus] = useState(
    `${PLAYER_HERO_NAME} is ready. Link your wallet and begin the vault run.`,
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [onChainBestScore, setOnChainBestScore] = useState<number | null>(null);
  const txActions = useMonadActivity();
  const [apiBusy, setApiBusy] = useState(false);
  const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([
    createLog("No vault run active.", "neutral"),
  ]);
  const [currentHealth, setCurrentHealth] = useState(0);
  const [runActive, setRunActive] = useState(false);
  const [runId, setRunId] = useState("");
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [txPending, setTxPending] = useState(false);

  const derivedStats = profile ? getDerivedStats(profile) : null;
  const playerBlueprint = ARCHETYPES[PLAYER_ARCHETYPE];
  const healthPercent = derivedStats
    ? Math.max(0, Math.min(100, Math.round((currentHealth / derivedStats.health) * 100)))
    : 0;

  useEffect(() => {
    void initFromWallet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWalletStateChange = useEffectEvent(() => {
    void initFromWallet();
  });

  useEffect(() => {
    if (!hasInjectedWallet()) {
      return;
    }

    return subscribeToWalletEvents(() => {
      handleWalletStateChange();
    });
  }, [handleWalletStateChange]);

  async function initFromWallet() {
    try {
      const currentWallet = hasInjectedWallet() ? await readWalletState() : DEFAULT_WALLET;
      setWallet(currentWallet);

      if (currentWallet.address) {
        const walletPlayerId = currentWallet.address.toLowerCase();
        setPlayerId(walletPlayerId);
        saveStoredPlayerId(walletPlayerId);

        // Try to reload existing profile for this wallet
        try {
          setApiBusy(true);
          const snapshot = await fetchProfile(walletPlayerId);
          applySnapshot(snapshot, `Welcome back, ${snapshot.profile.displayName}.`);
        } catch {
          clearProfileState(walletPlayerId);
          setStatus(`Wallet connected. Bootstrap ${PLAYER_HERO_NAME} to begin.`);
        } finally {
          setApiBusy(false);
        }
      } else {
        clearProfileState(null);
        setStatus(`${PLAYER_HERO_NAME} is ready. Connect your wallet to begin the vault run.`);
      }

      void loadListings();
    } catch {
      setWallet(DEFAULT_WALLET);
      clearProfileState(null);
    }
  }

  useEffect(() => {
    if (wallet.address && hasRelicRushLedgerAddress()) {
      void fetchOnChainBestScore();
    } else {
      setOnChainBestScore(null);
    }
  }, [wallet.address]);

  async function fetchOnChainBestScore() {
    if (!wallet.address || !hasInjectedWallet()) return;
    try {
      const provider = getInjectedBrowserProvider();
      const ledger = createRelicRushRunLedger(provider);
      const score = await ledger.bestScore(wallet.address);
      setOnChainBestScore(Number(score));
    } catch {
      // No score recorded yet (fresh contract returns BAD_DATA) — default to 0
      setOnChainBestScore(0);
    }
  }

  useEffect(() => {
    if (!profile) {
      clearStoredSnapshot();
      return;
    }

    const snapshot: PlayerSnapshot = {
      profile,
      listings,
      purchaseHistory,
    };

    saveStoredSnapshot(snapshot);
  }, [listings, profile, purchaseHistory]);

  useEffect(() => {
    if (profile && derivedStats) {
      setCurrentHealth((current) => (current > 0 ? Math.min(current, derivedStats.health) : derivedStats.health));
    }
  }, [profile, derivedStats?.health]);

  function applySnapshot(snapshot: PlayerSnapshot, nextStatus?: string) {
    const normalizedProfile: PlayerProfile = {
      ...snapshot.profile,
      archetype: PLAYER_ARCHETYPE,
      displayName: PLAYER_HERO_NAME,
      baseStats: ARCHETYPES[PLAYER_ARCHETYPE].baseStats,
    };

    setProfile(normalizedProfile);
    setListings(snapshot.listings);
    setPurchaseHistory(snapshot.purchaseHistory);
    setCurrentHealth(getDerivedStats(normalizedProfile).health);
    if (nextStatus) {
      setStatus(nextStatus);
    }
  }

  function addToast(message: string, type: ToastType = "success", txHash?: string) {
    const id = Math.random().toString(36).substring(2, 9);
    const expiry = Date.now() + 5000;
    setToasts((current) => [...current, { id, message, type, txHash, expiry }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 5500);
  }

  async function handleCopyTxHash(txHash: string) {
    try {
      await navigator.clipboard.writeText(txHash);
      addToast("Transaction hash copied.", "success", txHash);
    } catch {
      addToast("Could not copy the transaction hash from this browser.", "error", txHash);
    }
  }

  function resetRunUi(nextStatus?: string) {
    setCurrentHealth(0);
    setRunActive(false);
    setRunId("");
    setCombatLog([createLog("No vault run active.", "neutral")]);
    if (nextStatus) {
      setStatus(nextStatus);
    }
  }

  function clearProfileState(nextPlayerId: string | null = null) {
    setPlayerId(nextPlayerId);
    setProfile(null);
    setPurchaseHistory([]);
    setPriceInputs({});
    setOnChainBestScore(null);
    resetRunUi();
  }

  function clearSavedSession() {
    clearStoredSession();
    clearProfileState(null);
    setListings([]);
  }

  async function refreshWallet() {
    if (!hasInjectedWallet()) {
      setWallet(DEFAULT_WALLET);
      return;
    }

    try {
      setWallet(await readWalletState());
    } catch {
      setWallet(DEFAULT_WALLET);
    }
  }

  async function loadListings() {
    try {
      setListings(await fetchListings());
    } catch {
      setStatus("Marketplace feed is unavailable. Gameplay still works locally.");
    }
  }

  async function handleCreateProfile() {
    if (!wallet.address) {
      setStatus("Connect your wallet first. Offline play has been removed.");
      return;
    }

    try {
      setApiBusy(true);
      const walletPlayerId = wallet.address.toLowerCase();
      const displayName = PLAYER_HERO_NAME;
      const snapshot = await bootstrapProfile({
        playerId: walletPlayerId,
        archetype: PLAYER_ARCHETYPE,
        displayName,
        walletAddress: wallet.address,
      });

      saveStoredPlayerId(walletPlayerId);
      setPlayerId(walletPlayerId);
      applySnapshot(snapshot);
      setStatus(`${displayName} descends into ${DUNGEON_NAME}.`);
    } catch (error) {
      setStatus(getUiErrorMessage(error, "Failed to cast your hero."));
    } finally {
      setApiBusy(false);
    }
  }

  async function persistProfile(nextProfile: PlayerProfile, nextStatus: string) {
    setProfile(nextProfile);
    setStatus(nextStatus);

    try {
      const snapshot = await syncProfile({
        playerId: nextProfile.playerId,
        inventory: nextProfile.inventory,
        equipped: nextProfile.equipped,
        runs: nextProfile.runs,
        pvpHistory: nextProfile.pvpHistory,
        walletAddress: wallet.address,
      });
      setProfile(snapshot.profile);
      setListings(snapshot.listings);
      setPurchaseHistory(snapshot.purchaseHistory);
    } catch (error) {
      setStatus(
        `${nextStatus} Persistence warning: ${getUiErrorMessage(
          error,
          "Could not save the latest state.",
        )}`,
      );
    }
  }

  async function handleConnectWallet() {
    try {
      const connected = await connectWallet();
      setWallet(connected);

      if (connected.address) {
        const walletPlayerId = connected.address.toLowerCase();
        setPlayerId(walletPlayerId);
        saveStoredPlayerId(walletPlayerId);
        setStatus("Wallet connected. Loading profile…");

        // Try to load existing profile for this wallet
        try {
          setApiBusy(true);
          const snapshot = await fetchProfile(walletPlayerId);
          applySnapshot(snapshot, `Welcome back, ${snapshot.profile.displayName}.`);
        } catch {
          clearProfileState(walletPlayerId);
          setStatus(`Wallet connected. Bootstrap ${PLAYER_HERO_NAME} to begin.`);
        } finally {
          setApiBusy(false);
        }
      }
    } catch (error) {
      setStatus(getUiErrorMessage(error, "Wallet connection failed."));
    }
  }

  function handleRemoveWallet() {
    clearSavedSession();
    setWallet(DEFAULT_WALLET);
    setApiBusy(false);
    setTxPending(false);
    setCombatLog([createLog("Wallet removed. Connect another wallet to continue.", "neutral")]);
    setStatus("Wallet removed from this app session. Connect another wallet when ready.");
    void loadListings();
  }

  async function handleSwitchChain() {
    try {
      await switchToExpectedChain();
      await refreshWallet();
      setStatus(`Switched wallet to ${expectedChainName}.`);
    } catch {
      try {
        await addMonadToWallet();
        await refreshWallet();
        setStatus(`Added and switched to ${expectedChainName}.`);
      } catch (error) {
        setStatus(getUiErrorMessage(error, "Network switch failed."));
      }
    }
  }

  function requireWalletReady() {
    if (!wallet.address || !wallet.correctNetwork) {
      addToast("Connect your wallet to the correct network to continue.", "error");
      void refreshWallet();
      return false;
    }
    return true;
  }

  async function ensureContractDeployed(address: string, label: string) {
    const provider = getInjectedBrowserProvider();
    const code = await provider.getCode(address);

    if (!code || code === "0x") {
      throw new Error(
        `${label} is not deployed on the connected network. Update the contract address in .env or switch to the matching chain.`,
      );
    }
  }

  function handleStartExpedition() {
    if (!profile || !derivedStats) {
      return;
    }

    setRunId(createId("run"));
    setRunActive(true);
    setCurrentHealth(derivedStats.health);
    setActiveTab("dungeon");
    setCombatLog([
      createLog("Vault run live. Clear the room, secure the drops, and extract clean.", "neutral"),
    ]);
    setStatus("Run live. Move with WASD and attack with Space.");
  }

  function handleAbandonRun() {
    if (!derivedStats) {
      return;
    }

    setRunActive(false);
    setRunId("");
    setCurrentHealth(derivedStats.health);
    setCombatLog([createLog("Expedition cut. Regroup, retune the build, and try again.", "bad")]);
    setStatus("Run aborted. Your loadout is intact.");
  }

  function handleLootCollected(item: InventoryItem) {
    setProfile((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        inventory: [item, ...current.inventory],
      };
    });
    setStatus(`${item.name} added to inventory. Run data will sync on exit.`);
  }

  function handleRunComplete(summary: DungeonRunSummary) {
    if (!profile) {
      return;
    }

    const nextProfile: PlayerProfile = {
      ...profile,
      runs: [summary, ...profile.runs].slice(0, 8),
    };

    setRunActive(false);
    void persistProfile(
      nextProfile,
      summary.outcome === "victory"
        ? "Vault cleared. Review the haul and list any premium relics."
        : "Run failed. Refit your gear and push back in.",
    );

    // Record the run on-chain if wallet is ready and it was a victory
    if (summary.outcome === "victory") {
      void handleRecordRunOnChain(summary);
    }
  }

  function handleEquip(item: InventoryItem) {
    if (!profile || !item.slot) {
      return;
    }
    if (item.listed) {
      setStatus("Listed artifacts cannot be equipped. Cancel or sell them first.");
      return;
    }

    const slotKey = `${item.slot}Id` as keyof PlayerProfile["equipped"];
    const nextProfile: PlayerProfile = {
      ...profile,
      equipped: {
        ...profile.equipped,
        [slotKey]: item.instanceId,
      },
    };

    void persistProfile(nextProfile, `${item.name} equipped.`);
  }

  function handleUnequip(slot: EquipmentSlot) {
    if (!profile) {
      return;
    }

    const slotKey = `${slot}Id` as keyof PlayerProfile["equipped"];
    const nextProfile: PlayerProfile = {
      ...profile,
      equipped: {
        ...profile.equipped,
        [slotKey]: null,
      },
    };

    void persistProfile(nextProfile, `${slot} slot cleared.`);
  }

  function handleUseConsumable(item: InventoryItem) {
    if (!profile || !derivedStats) {
      return;
    }
    if (runActive) {
      setStatus("Pause the action first. Consumables are an out-of-combat MVP action.");
      return;
    }

    const outcome = consumeItem(
      profile.inventory,
      item.instanceId,
      currentHealth,
      derivedStats.health,
    );

    const nextProfile: PlayerProfile = {
      ...profile,
      inventory: outcome.inventory,
    };

    setCurrentHealth(outcome.nextHealth);
    void persistProfile(nextProfile, `${item.name} consumed.`);
  }

  async function handleCreateListing(
    item: InventoryItem,
    chainListingId?: string | null,
  ) {
    if (!profile) {
      return;
    }

    try {
      setApiBusy(true);
      const monInput = priceInputs[item.instanceId] || "0.0025";
      const priceWei = ethers.parseEther(monInput).toString();
      const nextListings = await createListing({
        playerId: profile.playerId,
        inventoryItemId: item.instanceId,
        priceWei,
        chainListingId,
      });
      setListings(nextListings);
      const snapshot = await fetchProfile(profile.playerId);
      setProfile(snapshot.profile);
      setPurchaseHistory(snapshot.purchaseHistory);
      setStatus(`${item.name} listed for ${monInput} MON.`);
    } catch (error) {
      setStatus(getUiErrorMessage(error, "Listing failed."));
    } finally {
      setApiBusy(false);
    }
  }

  async function handleBuyListing(listing: MarketplaceListing) {
    if (!profile) {
      return;
    }

    try {
      setApiBusy(true);
      const snapshot = await purchaseListing({
        buyerPlayerId: profile.playerId,
        listingId: listing.id,
      });
      setProfile(snapshot.profile);
      setListings(snapshot.listings);
      setPurchaseHistory(snapshot.purchaseHistory);
      setStatus(`Purchased ${listing.item.name} for ${formatMon(listing.priceWei)} MON.`);
    } catch (error) {
      setStatus(getUiErrorMessage(error, "Purchase failed."));
    } finally {
      setApiBusy(false);
    }
  }

  async function handleMockDuel(opponentId: string) {
    if (!profile || !derivedStats) {
      return;
    }

    try {
      setApiBusy(true);
      const snapshot = await runMockPvp({
        playerId: profile.playerId,
        opponentId,
        buildStats: derivedStats,
      });
      setProfile(snapshot.profile);
      setListings(snapshot.listings);
      setPurchaseHistory(snapshot.purchaseHistory);
      setStatus("Mock duel resolved. Live matchmaking is the next system to land.");
    } catch (error) {
      setStatus(getUiErrorMessage(error, "PvP simulation failed."));
    } finally {
      setApiBusy(false);
    }
  }

  async function handleMintOnChain(item: InventoryItem) {
    if (!requireWalletReady() || !profile) return;
    if (!hasRelicRushMarketAddress()) {
      addToast("Set NEXT_PUBLIC_RELIC_RUSH_MARKET_ADDRESS to enable minting.", "error");
      return;
    }

    try {
      setTxPending(true);
      const t0 = Date.now();
      addToast(`Minting ${item.name} on Monad…`, "pending");

      const provider = getInjectedBrowserProvider();
      await ensureContractDeployed(relicRushMarketAddress, "Relic Rush Market");
      const signer = await provider.getSigner();
      const market = createRelicRushArtifactMarket(signer, relicRushMarketAddress);

      const artifactId = `artifact-${item.templateId}-${item.instanceId}`;
      const tokenURI = JSON.stringify({
        name: item.name,
        description: item.description,
        icon: resolveItemIcon(item),
        rarity: item.rarity,
        bonuses: item.bonuses
      });

      const tx = await market.mintPremiumArtifact(wallet.address, artifactId, tokenURI);
      addToast(
        `${item.name} mint submitted to Monad. Waiting for confirmation…`,
        "pending",
        tx.hash,
      );
      const receipt = await tx.wait();
      const ms = Date.now() - t0;

      if (receipt) {
        let mintedTokenId: string | null = null;

        for (const log of receipt.logs) {
          try {
            const parsed = market.interface.parseLog(log);
            if (parsed?.name === "PremiumArtifactMinted") {
              mintedTokenId = parsed.args.tokenId.toString();
              break;
            }
          } catch {
            continue;
          }
        }

        addToast(`${item.name} minted successfully!`, "success", receipt.hash);
        pushChainAction({
          label: `Mint · ${item.name}`,
          txHash: receipt.hash,
          ms,
          at: new Date()
        });

        const nextProfile: PlayerProfile = {
          ...profile,
          inventory: profile.inventory.map((inv) =>
            inv.instanceId === item.instanceId
              ? { ...inv, chainTokenId: mintedTokenId ?? inv.chainTokenId ?? null }
              : inv,
          ),
        };

        await persistProfile(
          nextProfile,
          mintedTokenId
            ? `${item.name} minted on Monad as token #${mintedTokenId}.`
            : `${item.name} minted on Monad.`,
        );
      }
    } catch (error) {
      console.error("Mint failed:", error);
      addToast(getUiErrorMessage(error, "Minting failed. Check wallet."), "error");
    } finally {
      setTxPending(false);
    }
  }

  async function handleListOnChain(item: InventoryItem) {
    if (!requireWalletReady() || !profile) return;
    if (!hasRelicRushMarketAddress()) {
      addToast("Market address not configured.", "error");
      return;
    }
    if (!item.chainTokenId) {
      addToast("Mint this artifact on-chain first.", "error");
      return;
    }

    try {
      setTxPending(true);
      const monInput = priceInputs[item.instanceId] || "0.0025";
      const priceWei = ethers.parseEther(monInput);
      const t0 = Date.now();
      addToast(`Listing ${item.name} on Monad…`, "pending");

      const provider = getInjectedBrowserProvider();
      await ensureContractDeployed(relicRushMarketAddress, "Relic Rush Market");
      const signer = await provider.getSigner();
      const market = createRelicRushArtifactMarket(signer, relicRushMarketAddress);

      // Approve
      const approveTx = await market.approve(relicRushMarketAddress, item.chainTokenId);
      addToast(
        `${item.name} approval submitted to Monad.`,
        "pending",
        approveTx.hash,
      );
      await approveTx.wait();

      // List
      const tx = await market.createListing(item.chainTokenId, priceWei);
      addToast(
        `${item.name} listing submitted to Monad. Waiting for confirmation…`,
        "pending",
        tx.hash,
      );
      const receipt = await tx.wait();
      const ms = Date.now() - t0;

      if (receipt) {
        addToast(`${item.name} listed successfully!`, "success", receipt.hash);
        pushChainAction({
          label: `List · ${item.name}`,
          txHash: receipt.hash,
          ms,
          at: new Date()
        });
        
        await handleCreateListing(item, item.chainTokenId);
      }
    } catch (error) {
      console.error("List failed:", error);
      addToast(getUiErrorMessage(error, "Listing failed."), "error");
    } finally {
      setTxPending(false);
    }
  }

  async function handleBuyOnChain(listing: MarketplaceListing) {
    if (!requireWalletReady() || !profile) return;

    if (listing.chainListingId && hasRelicRushMarketAddress()) {
      try {
        setTxPending(true);
        const t0 = Date.now();
        addToast(`Buying ${listing.item.name} on Monad…`, "pending");
        
        const provider = getInjectedBrowserProvider();
        await ensureContractDeployed(relicRushMarketAddress, "Relic Rush Market");
        const signer = await provider.getSigner();
        const market = createRelicRushArtifactMarket(signer, relicRushMarketAddress);

        const tx = await market.buyListing(listing.chainListingId, { value: listing.priceWei });
        addToast(
          `${listing.item.name} purchase submitted to Monad. Waiting for confirmation…`,
          "pending",
          tx.hash,
        );
        const receipt = await tx.wait();
        const ms = Date.now() - t0;

        if (receipt) {
          addToast(`Purchased ${listing.item.name}!`, "success", receipt.hash);
          pushChainAction({
            label: `Buy · ${listing.item.name}`,
            txHash: receipt.hash,
            ms,
            at: new Date()
          });
          
          const snapshot = await purchaseListing({
            buyerPlayerId: profile.playerId,
            listingId: listing.id,
          });
          setProfile(snapshot.profile);
          setListings(snapshot.listings);
          setPurchaseHistory(snapshot.purchaseHistory);
          setStatus(`Purchased ${listing.item.name} for ${formatMon(listing.priceWei)} MON.`);
        }
      } catch (error) {
        console.error("Buy failed:", error);
        addToast(getUiErrorMessage(error, "Purchase failed."), "error");
      } finally {
        setTxPending(false);
      }
    } else {
      await handleBuyListing(listing);
    }
  }

  async function handleRecordRunOnChain(summary: DungeonRunSummary) {
    if (!wallet.address || !wallet.correctNetwork || !hasRelicRushLedgerAddress()) return;

    try {
      setTxPending(true);
      const t0 = Date.now();
      addToast("Recording run on Monad…", "pending");
      
      const provider = getInjectedBrowserProvider();
      await ensureContractDeployed(relicRushLedgerAddress, "Relic Rush Run Ledger");
      const signer = await provider.getSigner();
      const ledger = createRelicRushRunLedger(signer, relicRushLedgerAddress);

      const score = summary.enemiesDefeated * 50 + summary.lootCollected * 25;
      const tx = await ledger.recordRun(1, score);
      addToast("Run record submitted to Monad. Waiting for confirmation…", "pending", tx.hash);
      const receipt = await tx.wait();
      const ms = Date.now() - t0;

      if (receipt) {
        addToast("Run recorded on-chain!", "success", receipt.hash);
        pushChainAction({
          label: "Record Run",
          txHash: receipt.hash,
          ms,
          at: new Date()
        });
        void fetchOnChainBestScore();
      }
    } catch (error) {
      console.error("Ledger record failed:", error);
      addToast(getUiErrorMessage(error, "Failed to record run on-chain."), "error");
    } finally {
      setTxPending(false);
    }
  }

  async function handleForgeRelic() {
    if (!requireWalletReady() || !profile) return;
    if (!hasRelicRushForgeAddress()) {
      addToast("Set NEXT_PUBLIC_RELIC_RUSH_FORGE_ADDRESS to enable forging.", "error");
      return;
    }

    try {
      setTxPending(true);
      const t0 = Date.now();
      addToast("Igniting the Relic Forge…", "pending");
      
      const provider = getInjectedBrowserProvider();
      await ensureContractDeployed(relicRushForgeAddress, "Relic Rush Forge");
      const signer = await provider.getSigner();
      const forge = createRelicRushRelicForge(signer);

      const forgeFee = await forge.forgeFee();
      const artifactId = `forge-${createId("relic")}`;
      const forgedItem = buildItemInstance("starforged-idol", "loot", Math.random() < 0.3 ? "epic" : "rare");
      const tokenURI = JSON.stringify({ 
        name: forgedItem.name, 
        description: forgedItem.description, 
        icon: resolveItemIcon(forgedItem), 
        rarity: forgedItem.rarity 
      });

      const tx = await forge.forgeRandomRelic(artifactId, tokenURI, { value: forgeFee });
      addToast("Relic forge transaction submitted to Monad. Waiting for confirmation…", "pending", tx.hash);
      const receipt = await tx.wait();
      const ms = Date.now() - t0;

      if (receipt) {
        addToast(`${forgedItem.name} forged!`, "success", receipt.hash);
        pushChainAction({
          label: `Forge · ${forgedItem.name}`,
          txHash: receipt.hash,
          ms,
          at: new Date()
        });

        const nextProfile: PlayerProfile = {
          ...profile,
          inventory: [{ ...forgedItem, chainTokenId: receipt.hash }, ...profile.inventory],
        };
        void persistProfile(nextProfile, `Forged ${forgedItem.name} on Monad!`);
      }
    } catch (error) {
      console.error("Forge failed:", error);
      addToast(getUiErrorMessage(error, "Forge failed."), "error");
    } finally {
      setTxPending(false);
    }
  }

  function handleResetSave() {
    clearSavedSession();
    setApiBusy(false);
    setTxPending(false);
    setCombatLog([createLog("New expedition slate ready.", "neutral")]);
    setStatus(`Save reset. Bootstrap ${PLAYER_HERO_NAME} to begin again.`);
  }

  const ownedPremiumArtifacts = profile
    ? profile.inventory.filter((item) => item.premium)
    : [];
  const activeListings = listings.filter((listing) => listing.status === "active");

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(180,255,71,0.12),transparent_28%),linear-gradient(135deg,#050816,#0d1228_42%,#1a1034)] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_24px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
                  {GAME_TITLE}
                </span>
                <span className="inline-flex rounded-full border border-lime-400/20 bg-lime-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-lime-200">
                  Dungeon Run MVP
                </span>
                <span className="inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-amber-100">
                  Asset-Driven Build
                </span>
              </div>
              <div className="space-y-2">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
                  Breach the vault. Clear the slimes. Loot what glows.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                  {HERO_HOOK}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:min-w-[340px]">
              <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                  Wallet
                </p>
                <p className="mt-2 text-sm text-white">
                  {buildWalletLabel(wallet.address)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {wallet.chainId ? `Chain ${wallet.chainId}` : "No chain detected"}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void handleConnectWallet()}
                  className="rounded-full border border-cyan-400/35 bg-cyan-400/15 px-4 py-3 text-sm text-cyan-100 transition hover:bg-cyan-400/25"
                >
                  {wallet.address ? "Reconnect Wallet" : "Connect Wallet"}
                </button>
                {wallet.address ? (
                  <button
                    type="button"
                    onClick={handleRemoveWallet}
                    className="rounded-full border border-slate-400/25 bg-slate-400/10 px-4 py-3 text-sm text-slate-100 transition hover:bg-slate-400/20"
                  >
                    Remove Wallet
                  </button>
                ) : null}
                {!wallet.correctNetwork && wallet.address ? (
                  <button
                    type="button"
                    onClick={() => void handleSwitchChain()}
                    className="rounded-full border border-rose-400/35 bg-rose-400/15 px-4 py-3 text-sm text-rose-100 transition hover:bg-rose-400/25"
                  >
                    Switch To {expectedChainName}
                  </button>
                ) : null}
                {profile ? (
                  <button
                    type="button"
                    onClick={handleResetSave}
                    className="rounded-full border border-white/15 bg-white/8 px-4 py-3 text-sm text-white transition hover:bg-white/14"
                  >
                    New Save
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {profile ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatTile label="Hero" value={PLAYER_HERO_NAME} emphasis="text-cyan-100" />
              <StatTile label="Health" value={`${currentHealth} / ${derivedStats?.health ?? 0}`} emphasis="text-lime-200" />
              <StatTile label="Combat Power" value={derivedStats ? getCombatPower(derivedStats) : 0} />
              <StatTile label="Premium Relics" value={ownedPremiumArtifacts.length} emphasis="text-amber-200" />
              <StatTile label="Active Listings" value={activeListings.length} />
            </div>

            <div className="flex flex-wrap gap-2">
              {(["dungeon", "inventory", "marketplace", "pvp", "forge"] as TabId[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    activeTab === tab
                      ? "border-cyan-400/35 bg-cyan-400/15 text-cyan-100"
                      : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20"
                  }`}
                >
                  {tab === "dungeon"
                    ? "Vault Run"
                    : tab === "inventory"
                      ? "Loadout"
                      : tab === "marketplace"
                        ? "Market"
                        : tab === "pvp"
                          ? "Duel Stage"
                          : "⛒ Relic Forge"}
                </button>
              ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.22fr_0.78fr]">
              <div className="flex flex-col gap-5">
                {activeTab === "dungeon" ? (
                  <Section
                    eyebrow="Vault Run"
                    title={runActive ? DUNGEON_NAME : "Prepare the vault breach"}
                    actions={
                      runActive ? (
                        <div className="flex flex-wrap gap-2">
                          <span className="inline-flex items-center rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
                            Run Live
                          </span>
                          <button
                            type="button"
                            onClick={handleAbandonRun}
                            className="rounded-full border border-rose-400/35 bg-rose-400/15 px-4 py-2 text-sm text-rose-100 transition hover:bg-rose-400/25"
                          >
                            Abort Run
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStartExpedition}
                          disabled={apiBusy}
                          className="rounded-full border border-lime-400/35 bg-lime-400/15 px-4 py-2 text-sm text-lime-100 transition hover:bg-lime-400/25 disabled:opacity-50"
                        >
                          Start Run
                        </button>
                      )
                    }
                  >
                    {runActive && derivedStats ? (
                      <PhaserDungeon
                        active={runActive}
                        archetype={PLAYER_ARCHETYPE}
                        runId={runId}
                        stats={derivedStats}
                        onLog={(entry) =>
                          setCombatLog((current) => [entry, ...current].slice(0, 10))
                        }
                        onHealthChange={setCurrentHealth}
                        onLootCollected={handleLootCollected}
                        onRunComplete={handleRunComplete}
                        resolveLoot={rollLoot}
                      />
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
                        <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                          <h3 className="text-2xl font-semibold text-white">Encounter Set</h3>
                          <div className="mt-5 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                              Green Slime
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                              Blue Slime
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                              Red Slime
                            </div>
                          </div>
                          <div className="mt-5 grid gap-2">
                            {FLOOR_PREVIEW.map((beat) => (
                              <div
                                key={beat}
                                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300"
                              >
                                {beat}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                            Last Run
                          </p>
                          {profile.runs[0] ? (
                            <div className="mt-4 space-y-3 text-sm text-slate-300">
                              <div className="flex justify-between text-cyan-400">
                                <span>On-chain Best:</span>
                                <span>{onChainBestScore !== null ? onChainBestScore : "—"}</span>
                              </div>
                              <p>{profile.runs[0].notes}</p>
                              <p>Enemies defeated: {profile.runs[0].enemiesDefeated}</p>
                              <p>Loot collected: {profile.runs[0].lootCollected}</p>
                              <p>Outcome: {profile.runs[0].outcome}</p>
                            </div>
                          ) : (
                            <p className="mt-4 text-sm text-slate-400">
                              No runs recorded yet.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </Section>
                ) : null}

                {activeTab === "inventory" ? (
                  <Section eyebrow="Wardrobe" title="Loadout">
                    <div className="grid gap-4">
                      {profile.inventory.length === 0 ? (
                        <div className="rounded-3xl border border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                          No items yet.
                        </div>
                      ) : (
                        profile.inventory.map((item) => (
                          <div
                            key={item.instanceId}
                            className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4"
                          >
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex gap-4">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/70 p-2 text-2xl">
                                  <ItemVisual item={item} className="h-full w-full object-contain" />
                                </div>
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-lg font-semibold text-white">{item.name}</h3>
                                    <InventoryBadge item={item} />
                                    {item.premium ? (
                                      <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-amber-100">
                                        premium
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="mt-2 text-sm text-slate-300">{item.description}</p>
                                  <p className="mt-2 text-xs text-slate-500">Value {item.value} • {item.type}</p>
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                {item.slot ? (
                                  <button
                                    type="button"
                                    onClick={() => handleEquip(item)}
                                    className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100"
                                  >
                                    Equip
                                  </button>
                                ) : null}
                                {item.type === "consumable" ? (
                                  <button
                                    type="button"
                                    onClick={() => handleUseConsumable(item)}
                                    className="rounded-full border border-lime-400/30 bg-lime-400/10 px-3 py-2 text-xs text-lime-100"
                                  >
                                    Use
                                  </button>
                                ) : null}
                                {item.premium ? (
                                  <>
                                    {!item.chainTokenId ? (
                                      <button
                                        type="button"
                                        onClick={() => void handleMintOnChain(item)}
                                        disabled={txPending || apiBusy || !wallet.address}
                                        className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 disabled:opacity-40"
                                      >
                                        {txPending ? "Minting…" : "Mint on Monad"}
                                      </button>
                                    ) : (
                                      <span className="rounded-full border border-lime-400/20 bg-lime-400/10 px-2 py-1 text-[11px] text-lime-100">
                                        ✓ On-chain
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setActiveTab("marketplace")}
                                      className="rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-3 py-2 text-xs text-fuchsia-100"
                                    >
                                      Market
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                              {Object.entries(item.bonuses)
                                .filter((entry) => Number(entry[1] ?? 0) > 0)
                                .map(([key, value]) => (
                                  <span
                                    key={key}
                                    className="rounded-full border border-white/10 bg-slate-950/70 px-2 py-1"
                                  >
                                    +{value} {key}
                                  </span>
                                ))}
                              {item.healAmount ? (
                                <span className="rounded-full border border-white/10 bg-slate-950/70 px-2 py-1">
                                  heals {item.healAmount}
                                </span>
                              ) : null}
                              {item.listed ? (
                                <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-amber-100">
                                  listed on market
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Section>
                ) : null}

                {activeTab === "marketplace" ? (
                  <Section eyebrow="Market" title="Premium relics">
                    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
                      <div className="space-y-4">
                        <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                            Owned premium relics
                          </p>
                          <div className="mt-4 grid gap-3">
                            {ownedPremiumArtifacts.length === 0 ? (
                              <div className="rounded-3xl border border-white/10 bg-slate-950/65 p-4">
                                <p className="text-sm text-slate-300">
                                  No tradable relics yet.
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setActiveTab("dungeon")}
                                    className="rounded-full border border-lime-400/30 bg-lime-400/10 px-3 py-2 text-xs text-lime-100"
                                  >
                                    Go To Vault Run
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setActiveTab("forge")}
                                    className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100"
                                  >
                                    Open Forge
                                  </button>
                                </div>
                              </div>
                            ) : (
                              ownedPremiumArtifacts.map((item) => (
                                <div
                                  key={item.instanceId}
                                  className="rounded-3xl border border-white/10 bg-slate-950/65 p-4"
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <p className="text-lg font-semibold text-white">
                                      <span className="inline-flex items-center gap-2">
                                        <ItemVisual item={item} className="h-6 w-6 object-contain" />
                                        <span>{item.name}</span>
                                      </span>
                                      </p>
                                      <p className="mt-2 text-sm text-slate-300">
                                        {item.description}
                                      </p>
                                    </div>
                                    <InventoryBadge item={item} />
                                  </div>

                                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                                    <input
                                      value={priceInputs[item.instanceId] ?? "0.0025"}
                                      onChange={(event) =>
                                        setPriceInputs((current) => ({
                                          ...current,
                                          [item.instanceId]: event.target.value,
                                        }))
                                      }
                                      className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/35"
                                    />
                                    {hasRelicRushMarketAddress() && wallet.address ? (
                                      !item.chainTokenId ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleMintOnChain(item)}
                                          disabled={item.listed || apiBusy || txPending}
                                          className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100 disabled:opacity-40"
                                        >
                                          {txPending ? "Minting…" : "Mint on Monad"}
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => void handleListOnChain(item)}
                                          disabled={item.listed || apiBusy || txPending}
                                          className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100 disabled:opacity-40"
                                        >
                                          {item.listed ? "Listed" : txPending ? "Listing…" : "List on Monad"}
                                        </button>
                                      )
                                    ) : item.chainTokenId && wallet.address ? (
                                      <button
                                        type="button"
                                        onClick={() => void handleListOnChain(item)}
                                        disabled={item.listed || apiBusy || txPending}
                                        className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100 disabled:opacity-40"
                                      >
                                        {item.listed ? "Listed" : txPending ? "Listing…" : "List on Monad"}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => void handleCreateListing(item)}
                                        disabled={item.listed || apiBusy}
                                        className="rounded-2xl border border-lime-400/30 bg-lime-400/10 px-4 py-3 text-sm text-lime-100 disabled:opacity-40"
                                      >
                                        {item.listed ? "Already Listed" : "List Artifact"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="rounded-[1.5rem] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                          {hasRelicRushMarketAddress()
                            ? `On-chain market configured at ${shortenAddress(relicRushMarketAddress)}.`
                            : "UNKNOWN - MANUAL STEP REQUIRED: set NEXT_PUBLIC_RELIC_RUSH_MARKET_ADDRESS to enable live Monad bazaar settlement."}
                        </div>
                      </div>

                      <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                          Live bazaar listings
                        </p>
                        <div className="mt-4 grid gap-3">
                          {activeListings.length === 0 ? (
                            <div className="rounded-3xl border border-white/10 bg-slate-950/65 p-4">
                              <p className="text-sm text-slate-300">
                                No listings yet.
                              </p>
                              <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveTab("inventory")}
                                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100"
                                >
                                  Check Loadout
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setActiveTab("dungeon")}
                                  className="rounded-full border border-lime-400/30 bg-lime-400/10 px-3 py-2 text-xs text-lime-100"
                                >
                                  Hunt Premium Drops
                                </button>
                              </div>
                            </div>
                          ) : (
                            activeListings.map((listing) => (
                              <div
                                key={listing.id}
                                className="rounded-3xl border border-white/10 bg-slate-950/65 p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-lg font-semibold text-white">
                                      <span className="inline-flex items-center gap-2">
                                        <ItemVisual item={listing.item} className="h-6 w-6 object-contain" />
                                        <span>{listing.item.name}</span>
                                      </span>
                                    </p>
                                    <p className="mt-2 text-sm text-slate-300">
                                      Seller {listing.sellerName} • {formatMon(listing.priceWei)} MON
                                    </p>
                                  </div>
                                  <InventoryBadge item={listing.item} />
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleBuyOnChain(listing)}
                                    disabled={apiBusy || txPending || listing.sellerPlayerId === profile.playerId}
                                    className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40"
                                  >
                                    {listing.sellerPlayerId === profile.playerId
                                      ? "Your Listing"
                                      : listing.chainListingId
                                        ? "Buy on Monad"
                                        : "Buy Artifact"}
                                  </button>
                                  <span className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs text-slate-300">
                                    {listing.chainListingId
                                      ? `Chain listing ${shortenAddress(listing.chainListingId)}`
                                      : "Off-chain listing"}
                                  </span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </Section>
                ) : null}

                {activeTab === "pvp" ? (
                  <Section eyebrow="Duel Stage" title="Build check">
                    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                      <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                          Current build snapshot
                        </p>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
                          <div>Health {derivedStats?.health}</div>
                          <div>Attack {derivedStats?.attack}</div>
                          <div>Defense {derivedStats?.defense}</div>
                          <div>Speed {derivedStats?.speed}</div>
                          <div>Crit {Math.round((derivedStats?.critChance ?? 0) * 100)}%</div>
                          <div>Luck {derivedStats?.luck}</div>
                        </div>
                      </div>

                      <div className="grid gap-3">
                        {MOCK_PVP_OPPONENTS.map((opponent) => (
                          <div
                            key={opponent.id}
                            className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-lg font-semibold text-white">
                                  {opponent.name}
                                </p>
                                <p className="mt-2 text-sm text-slate-300">
                                  {opponent.archetype} • power {opponent.combatPower}
                                </p>
                                <p className="mt-2 text-sm text-slate-400">{opponent.note}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleMockDuel(opponent.id)}
                                disabled={apiBusy}
                                className="rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-3 py-2 text-xs text-fuchsia-100 disabled:opacity-40"
                              >
                                Simulate Duel
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Section>
                ) : null}

                {activeTab === "forge" ? (
                  <Section
                    eyebrow="Relic Forge"
                    title="Forge relics"
                    actions={
                      <button
                        type="button"
                        onClick={() => void handleForgeRelic()}
                        disabled={txPending || apiBusy || !wallet.address}
                        className="rounded-full border border-amber-300/35 bg-amber-300/15 px-4 py-2 text-sm text-amber-100 transition hover:bg-amber-300/25 disabled:opacity-50"
                      >
                        {txPending ? "Forging…" : "⛒ Forge Relic"}
                      </button>
                    }
                  >
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                        <h3 className="text-2xl font-semibold text-white">Relic Forge</h3>
                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Forge Fee</p>
                            <p className="mt-2 text-lg font-semibold text-amber-200">0.001 MON</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Output</p>
                            <p className="mt-2 text-lg font-semibold text-white">🜂 Lich Crown Relic</p>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-[1.5rem] border border-amber-300/15 bg-amber-300/5 p-5">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Steps</p>
                        <ol className="mt-4 space-y-3 text-sm text-slate-300">
                          <li>1. Connect wallet</li>
                          <li>2. Approve 0.001 MON</li>
                          <li>3. Receive a forged relic</li>
                        </ol>
                      </div>
                    </div>
                  </Section>
                ) : null}
              </div>

              <div className="flex flex-col gap-5">
                <Section eyebrow="Run Feed" title="Status and combat log">
                  <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                    <p className="text-sm text-slate-300">{status}</p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-lime-400 via-cyan-400 to-fuchsia-400 transition-[width] duration-300"
                        style={{ width: `${healthPercent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {combatLog.map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded-2xl border p-3 text-sm ${
                          entry.tone === "good"
                            ? "border-lime-400/20 bg-lime-400/10 text-lime-100"
                            : entry.tone === "bad"
                              ? "border-rose-400/20 bg-rose-400/10 text-rose-100"
                              : entry.tone === "loot"
                                ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                                : "border-white/10 bg-black/20 text-slate-300"
                        }`}
                      >
                        {entry.text}
                      </div>
                    ))}
                  </div>
                </Section>

                <Section eyebrow="Squad" title="Companions">
                  <div className="flex flex-wrap gap-2">
                    {SQUAD_SPOTLIGHTS.filter(
                      (spotlight) => spotlight.castName !== PLAYER_HERO_NAME,
                    ).map((spotlight) => (
                      <span
                        key={spotlight.castName}
                        className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300"
                      >
                        {spotlight.castName}
                      </span>
                    ))}
                  </div>
                </Section>

                <Section eyebrow="Chain Feed" title="Monad activity">
                  <div className="space-y-3">
                    {!wallet.address ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                        Wallet disconnected. Reconnect to resume live Monad actions.
                      </div>
                    ) : txActions.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                        No on-chain actions yet. Mint, forge, list, or buy to populate this feed.
                      </div>
                    ) : (
                      txActions.map((action) => (
                        (() => {
                          const txUrl = explorerTxUrl(action.txHash);

                          return (
                            <div
                              key={`${action.txHash}-${action.label}`}
                              className="rounded-2xl border border-white/10 bg-black/20 p-4"
                            >
                              <p className="text-sm font-medium text-white">{action.label}</p>
                              <p className="mt-1 text-xs text-slate-400">
                                {action.ms}ms confirmation
                              </p>
                              <p className="mt-2 font-mono text-[11px] tracking-wide text-slate-300">
                                {shortenTxHash(action.txHash)}
                              </p>
                              <p className="mt-2 break-all font-mono text-[11px] text-slate-500">
                                {action.txHash}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleCopyTxHash(action.txHash)}
                                  className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/14"
                                >
                                  Copy Hash
                                </button>
                                {txUrl ? (
                                  <a
                                    href={txUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-cyan-200 transition hover:bg-cyan-400/20"
                                  >
                                    View Tx
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          );
                        })()
                      ))
                    )}
                  </div>
                </Section>

                <Section eyebrow="Equipment" title="Current scene loadout">
                  <div className="grid gap-3">
                    {([
                      ["weapon", profile.equipped.weaponId],
                      ["armor", profile.equipped.armorId],
                      ["artifact", profile.equipped.artifactId],
                      ["charm", profile.equipped.charmId],
                    ] as Array<[EquipmentSlot, string | null]>).map(([slot, itemId]) => {
                      const item = profile.inventory.find((entry) => entry.instanceId === itemId) ?? null;
                      return (
                        <div
                          key={slot}
                          className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                                {slot}
                              </p>
                              <p className="mt-2 text-sm text-white">
                                {item ? item.name : "Empty slot"}
                              </p>
                            </div>
                            {item ? (
                              <button
                                type="button"
                                onClick={() => handleUnequip(slot)}
                                className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs text-slate-300"
                              >
                                Unequip
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>

                <Section eyebrow="Receipts" title="Recent purchases">
                  <div className="space-y-3">
                    {purchaseHistory.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                        No purchases yet. Hunt a premium relic or buy one from the bazaar.
                      </div>
                    ) : (
                      purchaseHistory.map((record) => (
                        <div
                          key={record.id}
                          className="rounded-2xl border border-white/10 bg-black/20 p-4"
                        >
                          <p className="text-sm font-medium text-white">{record.itemName}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {formatMon(record.priceWei)} MON • {new Date(record.purchasedAt).toLocaleString()}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </Section>
              </div>
            </div>
          </>
        ) : !wallet.address ? (
          <WalletGatePanel
            onConnectWallet={() => void handleConnectWallet()}
          />
        ) : (
          <HeroBootstrapPanels
            apiBusy={apiBusy}
            wallet={wallet}
            onCreateProfile={() => void handleCreateProfile()}
            playerBlueprint={playerBlueprint}
            squadSpotlights={SQUAD_SPOTLIGHTS.filter(
              (spotlight) => spotlight.castName !== PLAYER_HERO_NAME,
            )}
          />
        )}
      </div>
      {/* Toasts overlay */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-4 rounded-2xl border p-4 shadow-2xl backdrop-blur-md transition-all duration-300 ${
              toast.type === "pending"
                ? "border-cyan-400/30 bg-black/60 text-cyan-100"
                : toast.type === "success"
                  ? "border-lime-400/30 bg-black/60 text-lime-100"
                  : "border-rose-400/30 bg-black/60 text-rose-100"
            }`}
          >
            <div className="flex-1 text-sm font-medium">
              {toast.type === "pending" && "⏳ "}
              {toast.type === "success" && "✅ "}
              {toast.type === "error" && "❌ "}
              <div>{toast.message}</div>
              {toast.txHash ? (
                <>
                  <div className="mt-2 font-mono text-[11px] tracking-wide text-white/70">
                    {shortenTxHash(toast.txHash)}
                  </div>
                  <div className="mt-1 max-w-[22rem] break-all font-mono text-[10px] text-white/55">
                    {toast.txHash}
                  </div>
                </>
              ) : null}
            </div>
            {toast.txHash ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyTxHash(toast.txHash!)}
                  className="rounded-lg bg-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-white transition hover:bg-white/20"
                >
                  Copy Hash
                </button>
                <a
                  href={getMonadExplorerTxUrl(toast.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-white/10 px-2 py-1 text-center text-[10px] uppercase tracking-wider text-white transition hover:bg-white/20"
                >
                  View Tx
                </a>
              </div>
            ) : null}
            <button
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              className="ml-2 text-white/40 hover:text-white"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
