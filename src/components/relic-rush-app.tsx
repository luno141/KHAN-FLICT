"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { PhaserDungeon } from "@/src/components/phaser-dungeon";
import { ARCHETYPES, DEFAULT_MARKET_PRICE_WEI, DUNGEON_NAME, MOCK_PVP_OPPONENTS } from "@/src/game/content";
import {
  buildItemInstance,
  buildWalletLabel,
  consumeItem,
  createId,
  createLog,
  formatMon,
  getCombatPower,
  getDerivedStats,
  getDisplayName,
  rarityColor,
  rollLoot,
} from "@/src/game/helpers";
import type {
  Archetype,
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
} from "@/src/lib/relicRushRelicForge";
import {
  addMonadToWallet,
  connectWallet,
  expectedChainId,
  expectedChainName,
  getMonadExplorerTxUrl,
  hasInjectedWallet,
  hasMonadExplorerUrl,
  readWalletState,
  shortenAddress,
  switchToExpectedChain,
  type WalletState,
} from "@/src/lib/wallet";
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

const STORAGE_KEY = "relic-rush-player-id";
const SNAPSHOT_STORAGE_KEY = "relic-rush-player-snapshot";

const DEFAULT_WALLET: WalletState = {
  address: null,
  chainId: null,
  chainName: expectedChainName,
  correctNetwork: false,
};

function Section({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_0_60px_rgba(86,229,255,0.04)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StatTile({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">
        {label}
      </p>
      <p className={`mt-3 text-2xl font-semibold ${emphasis ?? "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function InventoryBadge({ item }: { item: InventoryItem }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.2em]"
      style={{
        borderColor: `${rarityColor(item.rarity)}55`,
        color: rarityColor(item.rarity),
        background: `${rarityColor(item.rarity)}15`,
      }}
    >
      {item.rarity}
    </span>
  );
}

export function RelicRushApp() {
  const [activeTab, setActiveTab] = useState<TabId>("dungeon");
  const [selectedArchetype, setSelectedArchetype] = useState<Archetype>("Warrior");
  const [draftName, setDraftName] = useState("");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [purchaseHistory, setPurchaseHistory] = useState<PlayerSnapshot["purchaseHistory"]>([]);
  const [wallet, setWallet] = useState<WalletState>(DEFAULT_WALLET);
  const [status, setStatus] = useState("Forge a class and breach the catacomb.");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [onChainBestScore, setOnChainBestScore] = useState<number | null>(null);
  const txActions = useMonadActivity();
  const [apiBusy, setApiBusy] = useState(false);
  const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([
    createLog("No dungeon run active.", "neutral"),
  ]);
  const [currentHealth, setCurrentHealth] = useState(0);
  const [runActive, setRunActive] = useState(false);
  const [runId, setRunId] = useState("");
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [txPending, setTxPending] = useState(false);

  const derivedStats = profile ? getDerivedStats(profile) : null;
  const healthPercent = derivedStats
    ? Math.max(0, Math.min(100, Math.round((currentHealth / derivedStats.health) * 100)))
    : 0;

  useEffect(() => {
    void initFromWallet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function initFromWallet() {
    try {
      const currentWallet = hasInjectedWallet() ? await readWalletState() : DEFAULT_WALLET;
      setWallet(currentWallet);

      if (currentWallet.address) {
        const walletPlayerId = currentWallet.address.toLowerCase();
        setPlayerId(walletPlayerId);
        window.localStorage.setItem(STORAGE_KEY, walletPlayerId);

        // Try to reload existing profile for this wallet
        try {
          setApiBusy(true);
          const snapshot = await fetchProfile(walletPlayerId);
          applySnapshot(snapshot, `Welcome back, ${snapshot.profile.displayName}.`);
        } catch {
          // No profile yet — user will pick an archetype
          setStatus("Wallet connected. Choose a class to begin.");
        } finally {
          setApiBusy(false);
        }
      } else {
        // No wallet — fall back to cached session if available
        const storedId = window.localStorage.getItem(STORAGE_KEY);
        const cachedSnapshot = readCachedSnapshot();
        if (storedId && cachedSnapshot?.profile.playerId === storedId) {
          setPlayerId(storedId);
          applySnapshot(cachedSnapshot, `Welcome back, ${cachedSnapshot.profile.displayName}.`);
        }
      }

      void loadListings();
    } catch {
      setWallet(DEFAULT_WALLET);
    }
  }

  useEffect(() => {
    if (wallet.address && hasRelicRushLedgerAddress()) {
      void fetchOnChainBestScore();
    }
  }, [wallet.address]);

  async function fetchOnChainBestScore() {
    if (!wallet.address || !window.ethereum) return;
    try {
      const provider = new ethers.BrowserProvider(window.ethereum as any);
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
      window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
      return;
    }

    const snapshot: PlayerSnapshot = {
      profile,
      listings,
      purchaseHistory,
    };

    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  }, [listings, profile, purchaseHistory]);

  useEffect(() => {
    if (profile && derivedStats) {
      setCurrentHealth((current) => (current > 0 ? Math.min(current, derivedStats.health) : derivedStats.health));
    }
  }, [profile, derivedStats?.health]);

  async function hydrateProfile(storedPlayerId: string) {
    try {
      setApiBusy(true);
      const snapshot = await fetchProfile(storedPlayerId);
      applySnapshot(snapshot, `Welcome back, ${snapshot.profile.displayName}.`);
    } catch {
      const cachedSnapshot = readCachedSnapshot();

      if (cachedSnapshot?.profile.playerId === storedPlayerId) {
        applySnapshot(cachedSnapshot, `Recovered ${cachedSnapshot.profile.displayName} from local cache.`);
        await restoreProfileFromCache(cachedSnapshot);
        return;
      }

      clearSavedSession();
      setStatus("Previous profile could not be restored. Start a fresh run.");
    } finally {
      setApiBusy(false);
    }
  }

  function applySnapshot(snapshot: PlayerSnapshot, nextStatus?: string) {
    setProfile(snapshot.profile);
    setListings(snapshot.listings);
    setPurchaseHistory(snapshot.purchaseHistory);
    setSelectedArchetype(snapshot.profile.archetype);
    setCurrentHealth(getDerivedStats(snapshot.profile).health);
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

  function readCachedSnapshot() {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as PlayerSnapshot;
      if (!parsed?.profile?.playerId) {
        return null;
      }
      return parsed;
    } catch {
      window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
      return null;
    }
  }

  async function restoreProfileFromCache(snapshot: PlayerSnapshot) {
    try {
      setApiBusy(true);
      const bootstrapped = await bootstrapProfile({
        playerId: snapshot.profile.playerId,
        archetype: snapshot.profile.archetype,
        displayName: snapshot.profile.displayName,
        walletAddress: snapshot.profile.walletAddress,
      });

      const restored = await syncProfile({
        playerId: snapshot.profile.playerId,
        inventory: snapshot.profile.inventory,
        equipped: snapshot.profile.equipped,
        runs: snapshot.profile.runs,
        pvpHistory: snapshot.profile.pvpHistory,
        walletAddress: snapshot.profile.walletAddress,
      });

      applySnapshot(
        {
          profile: restored.profile,
          listings: restored.listings,
          purchaseHistory: restored.purchaseHistory,
        },
        `Recovered ${bootstrapped.profile.displayName} after local restart.`,
      );
    } catch {
      clearSavedSession();
      setStatus("Saved cache could not be restored. Start a fresh run.");
    } finally {
      setApiBusy(false);
    }
  }

  function clearSavedSession() {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
    setPlayerId(null);
    setProfile(null);
    setListings([]);
    setPurchaseHistory([]);
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
      setStatus("Connect your wallet first.");
      return;
    }

    try {
      setApiBusy(true);
      const walletPlayerId = wallet.address.toLowerCase();
      const displayName = draftName.trim() || getDisplayName(selectedArchetype);
      const snapshot = await bootstrapProfile({
        playerId: walletPlayerId,
        archetype: selectedArchetype,
        displayName,
        walletAddress: wallet.address,
      });

      window.localStorage.setItem(STORAGE_KEY, walletPlayerId);
      setPlayerId(walletPlayerId);
      setProfile(snapshot.profile);
      setListings(snapshot.listings);
      setPurchaseHistory(snapshot.purchaseHistory);
      setCurrentHealth(getDerivedStats(snapshot.profile).health);
      setStatus(`${displayName} descends into ${DUNGEON_NAME}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to forge profile.");
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
        error instanceof Error
          ? `${nextStatus} Persistence warning: ${error.message}`
          : `${nextStatus} Persistence warning.`,
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
        window.localStorage.setItem(STORAGE_KEY, walletPlayerId);
        setStatus("Wallet connected. Loading profile…");

        // Try to load existing profile for this wallet
        try {
          setApiBusy(true);
          const snapshot = await fetchProfile(walletPlayerId);
          applySnapshot(snapshot, `Welcome back, ${snapshot.profile.displayName}.`);
        } catch {
          // No profile yet — user will create one
          setProfile(null);
          setStatus("Wallet connected. Choose a class to begin.");
        } finally {
          setApiBusy(false);
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Wallet connection failed.");
    }
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
        setStatus(error instanceof Error ? error.message : "Network switch failed.");
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

  function handleStartExpedition() {
    if (!profile || !derivedStats) {
      return;
    }

    setRunId(createId("run"));
    setRunActive(true);
    setCurrentHealth(derivedStats.health);
    setActiveTab("dungeon");
    setCombatLog([
      createLog("The Ashen Catacomb stirs. Hunt the room and claim the vault.", "neutral"),
    ]);
    setStatus("Dungeon live. Move with WASD and attack with Space.");
  }

  function handleAbandonRun() {
    if (!derivedStats) {
      return;
    }

    setRunActive(false);
    setRunId("");
    setCurrentHealth(derivedStats.health);
    setCombatLog([createLog("Expedition aborted. Regroup and try a cleaner route.", "bad")]);
    setStatus("Expedition aborted. Your local loadout is intact.");
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
        ? "Vault breached. Review your haul and list premium relics."
        : "Run failed. Refit your gear and try again.",
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
      setStatus("Pause dungeon action first. Consumables are an out-of-combat MVP action.");
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

  async function handleCreateListing(item: InventoryItem) {
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
      });
      setListings(nextListings);
      const snapshot = await fetchProfile(profile.playerId);
      setProfile(snapshot.profile);
      setPurchaseHistory(snapshot.purchaseHistory);
      setStatus(`${item.name} listed for ${monInput} MON.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Listing failed.");
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
      setStatus(error instanceof Error ? error.message : "Purchase failed.");
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
      setStatus(error instanceof Error ? error.message : "PvP simulation failed.");
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

      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const signer = await provider.getSigner();
      const market = createRelicRushArtifactMarket(signer, relicRushMarketAddress);

      const artifactId = `artifact-${item.templateId}-${item.instanceId}`;
      const tokenURI = JSON.stringify({
        name: item.name,
        description: item.description,
        icon: item.icon,
        rarity: item.rarity,
        bonuses: item.bonuses
      });

      const tx = await market.mintPremiumArtifact(wallet.address, artifactId, tokenURI);
      const receipt = await tx.wait();
      const ms = Date.now() - t0;

      if (receipt) {
        addToast(`${item.name} minted successfully!`, "success", receipt.hash);
        pushChainAction({
          label: `Mint · ${item.name}`,
          txHash: receipt.hash,
          ms,
          at: new Date()
        });

        setProfile((current) => {
          if (!current) return current;
          return {
            ...current,
            inventory: current.inventory.map((inv) =>
              inv.instanceId === item.instanceId
                ? { ...inv, chainTokenId: receipt.hash }
                : inv,
            ),
          };
        });
      }
    } catch (error: any) {
      console.error("Mint failed:", error);
      addToast(error.reason || error.message || "Minting failed. Check wallet.", "error");
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

      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const signer = await provider.getSigner();
      const market = createRelicRushArtifactMarket(signer, relicRushMarketAddress);

      // Approve
      const approveTx = await market.approve(relicRushMarketAddress, item.chainTokenId);
      await approveTx.wait();

      // List
      const tx = await market.createListing(item.chainTokenId, priceWei);
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
        
        await handleCreateListing(item);
      }
    } catch (error: any) {
      console.error("List failed:", error);
      addToast(error.reason || error.message || "Listing failed.", "error");
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
        
        const provider = new ethers.BrowserProvider(window.ethereum as any);
        const signer = await provider.getSigner();
        const market = createRelicRushArtifactMarket(signer, relicRushMarketAddress);

        const tx = await market.buyListing(listing.chainListingId, { value: listing.priceWei });
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
          
          const snapshot = await fetchProfile(profile.playerId);
          setProfile(snapshot.profile);
          setListings(snapshot.listings);
          setPurchaseHistory(snapshot.purchaseHistory);
        }
      } catch (error: any) {
        console.error("Buy failed:", error);
        addToast(error.reason || error.message || "Purchase failed.", "error");
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
      
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const signer = await provider.getSigner();
      const ledger = createRelicRushRunLedger(signer, relicRushLedgerAddress);

      const score = summary.enemiesDefeated * 50 + summary.lootCollected * 25;
      const tx = await ledger.recordRun(1, score);
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
    } catch (error: any) {
      console.error("Ledger record failed:", error);
      addToast("Failed to record run on-chain.", "error");
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
      
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const signer = await provider.getSigner();
      const forge = createRelicRushRelicForge(signer);

      const forgeFee = await forge.forgeFee();
      const artifactId = `forge-${createId("relic")}`;
      const forgedItem = buildItemInstance("starforged-idol", "loot", Math.random() < 0.3 ? "epic" : "rare");
      const tokenURI = JSON.stringify({ 
        name: forgedItem.name, 
        description: forgedItem.description, 
        icon: forgedItem.icon, 
        rarity: forgedItem.rarity 
      });

      const tx = await forge.forgeRandomRelic(artifactId, tokenURI, { value: forgeFee });
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
    } catch (error: any) {
      console.error("Forge failed:", error);
      addToast(error.reason || error.message || "Forge failed.", "error");
    } finally {
      setTxPending(false);
    }
  }

  function handleResetSave() {
    clearSavedSession();
    setCurrentHealth(0);
    setRunActive(false);
    setRunId("");
    setCombatLog([createLog("New expedition slate ready.", "neutral")]);
    setStatus("Save reset. Pick a new class to begin again.");
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
                  Relic Rush
                </span>
                <span className="inline-flex rounded-full border border-lime-400/20 bg-lime-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-lime-200">
                  Dungeon RPG MVP
                </span>
                <span className="inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-amber-100">
                  PvP Ready
                </span>
              </div>
              <div className="space-y-2">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
                  Descend, loot, and flip premium relics.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                  Relic Rush is a fast 2D dungeon run built around instant action,
                  gear progression, premium artifact ownership, and a compact market loop
                  ready for Monad settlement.
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
                  {wallet.address ? "Refresh Wallet" : "Connect Wallet"}
                </button>
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

        {!wallet.address ? (
          /* ── Wallet Gate ── */
          <section className="mt-4">
            <Section eyebrow="Connect" title="Link your wallet to play">
              <div className="space-y-4 text-center">
                <div className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-6">
                  <p className="text-4xl">🔗</p>
                  <h3 className="mt-4 text-xl font-semibold text-white">
                    MetaMask Required
                  </h3>
                  <p className="mt-2 text-sm text-slate-400">
                    Your wallet address is your identity. Connect to play, collect NFT relics,
                    and trade on the marketplace using MON tokens.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleConnectWallet()}
                    className="mt-5 rounded-full border border-amber-400/40 bg-amber-400/15 px-6 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-400/25"
                  >
                    Connect Wallet
                  </button>
                </div>
              </div>
            </Section>
          </section>
        ) : !profile ? (
          <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <Section eyebrow="Start Here" title="Choose your delver">
              <div className="grid gap-4 lg:grid-cols-3">
                {Object.values(ARCHETYPES).map((entry) => (
                  <button
                    key={entry.archetype}
                    type="button"
                    onClick={() => setSelectedArchetype(entry.archetype)}
                    className={`rounded-[1.5rem] border p-5 text-left transition ${
                      selectedArchetype === entry.archetype
                        ? "border-lime-400/40 bg-lime-400/10"
                        : "border-white/10 bg-black/20 hover:border-cyan-400/30"
                    }`}
                  >
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                      {entry.archetype}
                    </p>
                    <h3 className="mt-3 text-2xl font-semibold text-white">
                      {entry.title}
                    </h3>
                    <p className="mt-3 text-sm text-slate-300">{entry.signature}</p>
                    <p className="mt-4 text-sm text-slate-400">{entry.lore}</p>
                    <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-slate-300">
                      <span>HP {entry.baseStats.health}</span>
                      <span>ATK {entry.baseStats.attack}</span>
                      <span>DEF {entry.baseStats.defense}</span>
                      <span>SPD {entry.baseStats.speed}</span>
                      <span>CRIT {Math.round(entry.baseStats.critChance * 100)}%</span>
                      <span>LUCK {entry.baseStats.luck}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Section>

            <Section
              eyebrow="Forge Profile"
              title="Bootstrap with your wallet"
              actions={
                <button
                  type="button"
                  onClick={() => void handleCreateProfile()}
                  disabled={apiBusy}
                  className="rounded-full border border-lime-400/35 bg-lime-400/15 px-4 py-2 text-sm text-lime-100 disabled:opacity-50"
                >
                  {apiBusy ? "Forging..." : "Create Character"}
                </button>
              }
            >
              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                    Callsign
                  </p>
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    placeholder={`${selectedArchetype} callsign`}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-cyan-400/35"
                  />
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                    Wallet Identity
                  </p>
                  <p className="mt-3 font-mono text-sm text-lime-200">
                    {wallet.address?.slice(0, 6)}…{wallet.address?.slice(-4)}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    Your wallet address is your player ID. Items and MON transactions are tied to this address.
                  </p>
                </div>

                <div className="rounded-3xl border border-cyan-400/15 bg-cyan-400/10 p-4 text-sm text-cyan-100">
                  Items are treated as NFTs. Buy, sell, and trade using MON on the Monad network.
                </div>
              </div>
            </Section>
          </section>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatTile label="Class" value={profile.archetype} emphasis="text-cyan-100" />
              <StatTile label="Health" value={`${currentHealth} / ${derivedStats?.health ?? 0}`} emphasis="text-lime-200" />
              <StatTile label="Power" value={derivedStats ? getCombatPower(derivedStats) : 0} />
              <StatTile label="Premium Relics" value={ownedPremiumArtifacts.length} emphasis="text-amber-200" />
              <StatTile label="Market Listings" value={activeListings.length} />
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
                    ? "Dungeon"
                    : tab === "inventory"
                      ? "Inventory"
                      : tab === "marketplace"
                        ? "Marketplace"
                        : tab === "pvp"
                          ? "PvP Arena"
                          : "⛒ Relic Forge"}
                </button>
              ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.22fr_0.78fr]">
              <div className="flex flex-col gap-5">
                {activeTab === "dungeon" ? (
                  <Section
                    eyebrow="Dungeon Run"
                    title={runActive ? DUNGEON_NAME : "Prepare the next expedition"}
                    actions={
                      runActive ? (
                        <div className="flex flex-wrap gap-2">
                          <span className="inline-flex items-center rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
                            Expedition Active
                          </span>
                          <button
                            type="button"
                            onClick={handleAbandonRun}
                            className="rounded-full border border-rose-400/35 bg-rose-400/15 px-4 py-2 text-sm text-rose-100 transition hover:bg-rose-400/25"
                          >
                            Abandon Run
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStartExpedition}
                          disabled={apiBusy}
                          className="rounded-full border border-lime-400/35 bg-lime-400/15 px-4 py-2 text-sm text-lime-100 transition hover:bg-lime-400/25 disabled:opacity-50"
                        >
                          Enter Dungeon
                        </button>
                      )
                    }
                  >
                    {runActive && derivedStats ? (
                      <PhaserDungeon
                        active={runActive}
                        archetype={profile.archetype}
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
                          <h3 className="text-2xl font-semibold text-white">
                            Ashen Catacomb Briefing
                          </h3>
                          <p className="mt-3 text-sm leading-7 text-slate-300">
                            One room. Three enemy types. Premium artifact drop chance on the
                            vault wisp. Clear the room, survive the counterattack, and route
                            valuable relics into your loadout or the market.
                          </p>
                          <div className="mt-5 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                              Bog Slime
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                              Dust Skeleton
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                              Vault Wisp
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                            Last Run
                          </p>
                          {profile.runs[0] ? (
                            <div className="mt-4 space-y-3 text-sm text-slate-300">
                              <div className="flex justify-between text-cyan-400">
                                <span>On-Chain Best:</span>
                                <span>{onChainBestScore !== null ? onChainBestScore : "—"}</span>
                              </div>
                              <p>{profile.runs[0].notes}</p>
                              <p>Enemies defeated: {profile.runs[0].enemiesDefeated}</p>
                              <p>Loot collected: {profile.runs[0].lootCollected}</p>
                              <p>Outcome: {profile.runs[0].outcome}</p>
                            </div>
                          ) : (
                            <p className="mt-4 text-sm text-slate-400">
                              No runs recorded yet. Enter the dungeon to generate your first summary.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </Section>
                ) : null}

                {activeTab === "inventory" ? (
                  <Section eyebrow="Inventory" title="Loadout and bag">
                    <div className="grid gap-4">
                      {profile.inventory.length === 0 ? (
                        <div className="rounded-3xl border border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                          Your bag is empty. Clear rooms and collect drops.
                        </div>
                      ) : (
                        profile.inventory.map((item) => (
                          <div
                            key={item.instanceId}
                            className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4"
                          >
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex gap-4">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/70 text-2xl">
                                  {item.icon}
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
                                  <p className="mt-2 text-xs text-slate-500">
                                    Value {item.value} gold equivalent • {item.type}
                                  </p>
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
                                        disabled={txPending || apiBusy}
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
                  <Section eyebrow="Marketplace" title="Premium artifact exchange">
                    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
                      <div className="space-y-4">
                        <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                            Owned premium artifacts
                          </p>
                          <div className="mt-4 grid gap-3">
                            {ownedPremiumArtifacts.length === 0 ? (
                              <p className="text-sm text-slate-400">
                                No tradable relics yet. Hunt the vault wisp for premium drops.
                              </p>
                            ) : (
                              ownedPremiumArtifacts.map((item) => (
                                <div
                                  key={item.instanceId}
                                  className="rounded-3xl border border-white/10 bg-slate-950/65 p-4"
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <p className="text-lg font-semibold text-white">
                                        {item.icon} {item.name}
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
                                    {item.chainTokenId && hasRelicRushMarketAddress() ? (
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
                            : "UNKNOWN - MANUAL STEP REQUIRED: set NEXT_PUBLIC_RELIC_RUSH_MARKET_ADDRESS to enable live Monad settlement."}
                        </div>
                      </div>

                      <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                          Live listings
                        </p>
                        <div className="mt-4 grid gap-3">
                          {activeListings.length === 0 ? (
                            <p className="text-sm text-slate-400">
                              No listings yet. List your first premium relic to seed the market.
                            </p>
                          ) : (
                            activeListings.map((listing) => (
                              <div
                                key={listing.id}
                                className="rounded-3xl border border-white/10 bg-slate-950/65 p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-lg font-semibold text-white">
                                      {listing.item.icon} {listing.item.name}
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
                  <Section eyebrow="PvP Arena" title="Build check before live matchmaking">
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
                        <p className="mt-4 text-sm text-slate-400">
                          Live multiplayer is deferred. This mock arena uses your equipped
                          build and persists duel history through the same profile layer.
                        </p>
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
                    title="On-chain artifact crafting"
                    actions={
                      <button
                        type="button"
                        onClick={() => void handleForgeRelic()}
                        disabled={txPending || apiBusy || !wallet.address}
                        className="rounded-full border border-amber-300/35 bg-amber-300/15 px-4 py-2 text-sm text-amber-100 transition hover:bg-amber-300/25 disabled:opacity-50"
                      >
                        {txPending ? "Forging…" : "⛒ Forge a Relic"}
                      </button>
                    }
                  >
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                        <h3 className="text-2xl font-semibold text-white">Relic Forge</h3>
                        <p className="mt-3 text-sm leading-7 text-slate-300">
                          Pay a small forge fee in MON to mint a new premium artifact directly
                          on Monad. The forge creates a Starforged Idol with random rarity
                          (rare or epic). Your new relic appears in your inventory and is
                          immediately chain-owned.
                        </p>
                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Forge Fee</p>
                            <p className="mt-2 text-lg font-semibold text-amber-200">0.001 MON</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Output</p>
                            <p className="mt-2 text-lg font-semibold text-white">🜂 Starforged Idol</p>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-[1.5rem] border border-amber-300/15 bg-amber-300/5 p-5">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">How it works</p>
                        <ol className="mt-4 space-y-3 text-sm text-slate-300">
                          <li>1. Connect your wallet to {expectedChainName}</li>
                          <li>2. Click “Forge a Relic” and approve the 0.001 MON transaction</li>
                          <li>3. Your new relic is minted as an ERC-721 on Monad</li>
                          <li>4. Equip it, list it on the marketplace, or trade it</li>
                        </ol>
                        <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-xs text-amber-100">
                          Demo-grade randomness. Not suitable for production value-bearing
                          decisions.
                        </div>
                      </div>
                    </div>
                  </Section>
                ) : null}
              </div>

              <div className="flex flex-col gap-5">
                <Section eyebrow="Monad Network" title="On-chain activity">
                  <div className="space-y-4">
                    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Network</p>
                          <p className="mt-2 text-sm text-white">{expectedChainName}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Chain ID</p>
                          <p className="mt-2 text-sm text-white">{expectedChainId}</p>
                        </div>
                      </div>
                      {txPending ? (
                        <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-xs text-cyan-100">
                          ⏳ Transaction pending…
                        </div>
                      ) : null}
                    </div>

                    {txActions.length > 0 ? (
                      <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                          Recent on-chain actions
                        </p>
                        <div className="mt-3 space-y-2">
                          {txActions.map((action) => (
                            <div
                              key={action.at.getTime()}
                              className="rounded-2xl border border-lime-400/15 bg-lime-400/5 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-white">{action.label}</p>
                                <span className="rounded-full border border-lime-400/25 bg-lime-400/10 px-2 py-0.5 text-[11px] text-lime-200">
                                  {action.ms}ms
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-400">
                                Tx: {shortenAddress(action.txHash)}
                                {hasMonadExplorerUrl() ? (
                                  <> · <a href={explorerTxUrl(action.txHash)} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">View on Explorer</a></>
                                ) : null}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                        No on-chain actions yet. Mint, list, buy, or forge to see Monad confirmation times.
                      </div>
                    )}
                  </div>
                </Section>

                <Section eyebrow="Profile" title={profile.displayName}>
                  <div className="space-y-4">
                    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                        Status feed
                      </p>
                      <p className="mt-3 text-sm leading-7 text-slate-200">{status}</p>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                          Vitality
                        </p>
                        <p className="text-sm text-white">
                          {currentHealth}/{derivedStats?.health}
                        </p>
                      </div>
                      <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-900">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#b4ff47,#56e5ff)]"
                          style={{ width: `${healthPercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <StatTile label="Attack" value={derivedStats?.attack ?? 0} />
                      <StatTile label="Defense" value={derivedStats?.defense ?? 0} />
                      <StatTile label="Speed" value={derivedStats?.speed ?? 0} />
                      <StatTile
                        label="Crit"
                        value={`${Math.round((derivedStats?.critChance ?? 0) * 100)}%`}
                      />
                    </div>
                  </div>
                </Section>

                <Section eyebrow="Equipment" title="Current loadout">
                  <div className="grid gap-3">
                    {(["weapon", "armor", "artifact", "charm"] as EquipmentSlot[]).map((slot) => {
                      const slotId = profile.equipped[`${slot}Id` as keyof typeof profile.equipped];
                      const item = profile.inventory.find((candidate) => candidate.instanceId === slotId);

                      return (
                        <div
                          key={slot}
                          className="rounded-3xl border border-white/10 bg-black/20 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                                {slot}
                              </p>
                              <p className="mt-2 text-sm text-white">
                                {item ? `${item.icon} ${item.name}` : "Empty slot"}
                              </p>
                            </div>
                            {item ? (
                              <button
                                type="button"
                                onClick={() => handleUnequip(slot)}
                                className="rounded-full border border-white/15 bg-white/8 px-3 py-2 text-xs text-white"
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

                <Section eyebrow="Combat Feed" title="Recent events">
                  <div className="grid gap-3">
                    {combatLog.map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded-3xl border p-4 text-sm ${
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

                <Section eyebrow="Recent Trades" title="Purchase history">
                  <div className="grid gap-3">
                    {purchaseHistory.length === 0 ? (
                      <div className="rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                        No purchases yet. Hunt a premium relic or buy one from the market.
                      </div>
                    ) : (
                      purchaseHistory.map((record) => (
                        <div
                          key={record.id}
                          className="rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300"
                        >
                          Bought {record.itemName} for {formatMon(record.priceWei)} MON
                        </div>
                      ))
                    )}
                  </div>
                </Section>
              </div>
            </div>
          </>
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
              {toast.message}
            </div>
            {toast.txHash && hasMonadExplorerUrl() && (
              <a
                href={getMonadExplorerTxUrl(toast.txHash)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-white transition hover:bg-white/20"
              >
                View Tx
              </a>
            )}
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
