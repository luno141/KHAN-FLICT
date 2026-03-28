import { expect } from "chai";
import { network } from "hardhat";

describe("RelicRushArtifactMarket", function () {
  it("mints a premium artifact, lists it, and transfers ownership on purchase", async function () {
    const { ethers } = await network.connect();
    const [deployer, seller, buyer] = await ethers.getSigners();
    const price = ethers.parseEther("0.25");

    const market = await ethers.deployContract("RelicRushArtifactMarket", [
      deployer.address,
    ]);
    await market.waitForDeployment();

    await expect(
      market
        .connect(seller)
        .mintPremiumArtifact(
          seller.address,
          "artifact-starforged-idol-1",
          "ipfs://starforged-idol-1",
        ),
    )
      .to.emit(market, "PremiumArtifactMinted")
      .withArgs(
        seller.address,
        1n,
        "artifact-starforged-idol-1",
        "ipfs://starforged-idol-1",
      );

    await market.connect(seller).approve(await market.getAddress(), 1n);

    await expect(market.connect(seller).createListing(1n, price))
      .to.emit(market, "ArtifactListed")
      .withArgs(1n, seller.address, price);

    await expect(
      market.connect(buyer).buyListing(1n, { value: price }),
    )
      .to.emit(market, "ArtifactSale")
      .withArgs(1n, seller.address, buyer.address, price);

    expect(await market.ownerOf(1n)).to.equal(buyer.address);
    const listing = await market.listings(1n);
    expect(listing.active).to.equal(false);
  });

  it("allows seller to cancel an active listing", async function () {
    const { ethers } = await network.connect();
    const [deployer, seller] = await ethers.getSigners();
    const price = ethers.parseEther("0.1");

    const market = await ethers.deployContract("RelicRushArtifactMarket", [
      deployer.address,
    ]);
    await market.waitForDeployment();

    await market
      .connect(seller)
      .mintPremiumArtifact(
        seller.address,
        "artifact-ember-crown-1",
        "ipfs://ember-crown-1",
      );
    await market.connect(seller).approve(await market.getAddress(), 1n);
    await market.connect(seller).createListing(1n, price);

    await expect(market.connect(seller).cancelListing(1n))
      .to.emit(market, "ArtifactListingCanceled")
      .withArgs(1n);

    const listing = await market.listings(1n);
    expect(listing.active).to.equal(false);
    expect(await market.ownerOf(1n)).to.equal(seller.address);
  });

  it("reverts if a wallet tries to mint to someone else", async function () {
    const { ethers } = await network.connect();
    const [deployer, seller, buyer] = await ethers.getSigners();

    const market = await ethers.deployContract("RelicRushArtifactMarket", [
      deployer.address,
    ]);
    await market.waitForDeployment();

    await expect(
      market
        .connect(seller)
        .mintPremiumArtifact(
          buyer.address,
          "artifact-illegal-redirect-1",
          "ipfs://illegal-redirect-1",
        ),
    ).to.be.revertedWithCustomError(market, "MintRecipientMismatch");
  });
});
