"use client";

import { PLAYER_HERO_NAME } from "@/src/game/content";
import type { WalletState } from "@/src/lib/wallet";
import { Section } from "@/src/components/relic-rush-ui";

type Spotlight = {
  archetype: string;
  castName: string;
  role: string;
  vibe: string;
};

type PlayerBlueprint = {
  title: string;
  signature: string;
  lore: string;
  baseStats: {
    health: number;
    attack: number;
    defense: number;
    speed: number;
    critChance: number;
    luck: number;
  };
};

export function WalletGatePanel({
  onConnectWallet,
}: {
  onConnectWallet: () => void;
}) {
  return (
    <section className="mt-4">
      <Section eyebrow="Casting Call" title="Link your wallet to enter Filmygarh">
        <div className="space-y-4 text-center">
          <div className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-6">
            <p className="text-4xl">🔗</p>
            <h3 className="mt-4 text-xl font-semibold text-white">
              Wallet First, Slow Motion Later
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Your wallet is your hero identity. Connect to enter the dungeon, mint relics,
              and trade meme-tier artifacts on Monad when you are ready.
            </p>
            <button
              type="button"
              onClick={onConnectWallet}
              className="mt-5 rounded-full border border-amber-400/40 bg-amber-400/15 px-6 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-400/25"
            >
              Connect Wallet
            </button>
          </div>
        </div>
      </Section>
    </section>
  );
}

export function HeroBootstrapPanels({
  apiBusy,
  wallet,
  onCreateProfile,
  playerBlueprint,
  squadSpotlights,
}: {
  apiBusy: boolean;
  wallet: WalletState;
  onCreateProfile: () => void;
  playerBlueprint: PlayerBlueprint;
  squadSpotlights: Spotlight[];
}) {
  return (
    <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <Section eyebrow="Lead Cast" title="Locked hero: Shah Rukh Khan">
        <div className="rounded-[1.5rem] border border-lime-400/25 bg-lime-400/8 p-5">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
            Playable Hero
          </p>
          <h3 className="mt-3 text-3xl font-semibold text-white">{PLAYER_HERO_NAME}</h3>
          <p className="mt-3 text-sm text-slate-300">{playerBlueprint.title}</p>
          <p className="mt-3 text-sm leading-7 text-slate-300">{playerBlueprint.signature}</p>
          <p className="mt-4 text-sm text-slate-400">{playerBlueprint.lore}</p>
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-3">
            <span>HP {playerBlueprint.baseStats.health}</span>
            <span>ATK {playerBlueprint.baseStats.attack}</span>
            <span>DEF {playerBlueprint.baseStats.defense}</span>
            <span>SPD {playerBlueprint.baseStats.speed}</span>
            <span>CRIT {Math.round(playerBlueprint.baseStats.critChance * 100)}%</span>
            <span>LUCK {playerBlueprint.baseStats.luck}</span>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          {squadSpotlights.map((spotlight) => (
            <div
              key={spotlight.archetype}
              className="rounded-3xl border border-white/10 bg-black/20 p-4"
            >
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                Sidekick
              </p>
              <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-semibold text-white">{spotlight.castName}</h3>
                <span className="text-xs text-cyan-200">{spotlight.role}</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{spotlight.vibe}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="Hero Entry"
        title="Bootstrap Shah Rukh Khan"
        actions={
          <button
            type="button"
            onClick={onCreateProfile}
            disabled={apiBusy}
            className="rounded-full border border-lime-400/35 bg-lime-400/15 px-4 py-2 text-sm text-lime-100 disabled:opacity-50"
          >
            {apiBusy ? "Rolling Credits..." : "Start as SRK"}
          </button>
        }
      >
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
              Hero Slot
            </p>
            <p className="mt-3 text-lg font-semibold text-white">{PLAYER_HERO_NAME}</p>
            <p className="mt-2 text-xs text-slate-400">
              Class selection is removed. The story now always starts with Shah Rukh Khan as the playable lead.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
              Wallet Identity
            </p>
            <p className="mt-3 font-mono text-sm text-lime-200">
              {wallet.address?.slice(0, 6)}…{wallet.address?.slice(-4)}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Your wallet address is your player ID. Story progress, relics, and Monad transactions stay tied to this cast slot.
            </p>
          </div>

          <div className="rounded-3xl border border-cyan-400/15 bg-cyan-400/10 p-4 text-sm text-cyan-100">
            Current story arc: Salman rules the dungeon, Aishwarya is the relic core, and your squad is catastrophically under-qualified in the best way.
          </div>
        </div>
      </Section>
    </section>
  );
}
