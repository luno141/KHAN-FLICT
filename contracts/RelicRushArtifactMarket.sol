// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract RelicRushArtifactMarket is ERC721URIStorage, Ownable, ReentrancyGuard {
    error ArtifactAlreadyMinted();
    error InvalidPrice();
    error ListingInactive();
    error MintRecipientMismatch();
    error NotApprovedForMarket();
    error NotTokenOwner();
    error PayoutFailed();
    error TokenNotMinted();

    struct Listing {
        address seller;
        uint256 price;
        bool active;
        string artifactId;
    }

    uint256 public nextTokenId = 1;

    mapping(uint256 => Listing) public listings;
    mapping(string => uint256) public tokenIdByArtifactId;
    mapping(uint256 => string) public artifactIdByTokenId;

    event PremiumArtifactMinted(
        address indexed owner,
        uint256 indexed tokenId,
        string indexed artifactId,
        string tokenURI
    );
    event ArtifactListed(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price
    );
    event ArtifactSale(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price
    );
    event ArtifactListingCanceled(uint256 indexed tokenId);

    constructor(address initialOwner)
        ERC721("Relic Rush Premium Artifacts", "RRA")
        Ownable(initialOwner)
    {}

    function mintPremiumArtifact(
        address to,
        string calldata artifactId,
        string calldata tokenURI
    ) external returns (uint256 tokenId) {
        if (tokenIdByArtifactId[artifactId] != 0) revert ArtifactAlreadyMinted();
        if (to != msg.sender) revert MintRecipientMismatch();

        tokenId = nextTokenId;
        nextTokenId += 1;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);

        tokenIdByArtifactId[artifactId] = tokenId;
        artifactIdByTokenId[tokenId] = artifactId;

        emit PremiumArtifactMinted(to, tokenId, artifactId, tokenURI);
    }

    function createListing(uint256 tokenId, uint256 price) external {
        if (_ownerOf(tokenId) == address(0)) revert TokenNotMinted();
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (price == 0) revert InvalidPrice();

        bool approved = getApproved(tokenId) == address(this) ||
            isApprovedForAll(msg.sender, address(this));
        if (!approved) revert NotApprovedForMarket();

        listings[tokenId] = Listing({
            seller: msg.sender,
            price: price,
            active: true,
            artifactId: artifactIdByTokenId[tokenId]
        });

        emit ArtifactListed(tokenId, msg.sender, price);
    }

    function cancelListing(uint256 tokenId) external {
        Listing memory listing = listings[tokenId];
        if (!listing.active) revert ListingInactive();
        if (listing.seller != msg.sender) revert NotTokenOwner();

        delete listings[tokenId];

        emit ArtifactListingCanceled(tokenId);
    }

    function buyListing(uint256 tokenId) external payable nonReentrant {
        Listing memory listing = listings[tokenId];
        if (!listing.active) revert ListingInactive();
        if (msg.value < listing.price) revert InvalidPrice();

        delete listings[tokenId];

        _transfer(listing.seller, msg.sender, tokenId);

        (bool paid, ) = payable(listing.seller).call{value: listing.price}("");
        if (!paid) revert PayoutFailed();

        if (msg.value > listing.price) {
            (bool refunded, ) = payable(msg.sender).call{
                value: msg.value - listing.price
            }("");
            if (!refunded) revert PayoutFailed();
        }

        emit ArtifactSale(tokenId, listing.seller, msg.sender, listing.price);
    }
}
