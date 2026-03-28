import { NextRequest, NextResponse } from "next/server";
import { getPlayerSnapshot } from "@/src/server/repository";

export async function GET(request: NextRequest) {
  const playerId = request.nextUrl.searchParams.get("playerId");

  if (!playerId) {
    return NextResponse.json(
      { error: "playerId is required." },
      { status: 400 },
    );
  }

  try {
    const snapshot = await getPlayerSnapshot(playerId);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile.";
    const status = message === "Player profile not found." ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
