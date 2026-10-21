// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title Stoxhomes city price oracle
/// @notice Push oracle for the housing indices. Approved publishers post prices; every post is bounded by a
///         per-feed maximum move, and readers refuse prices older than the feed's maximum age.
/// @dev Prices use 8 decimals (USD per index point).
contract PriceOracle is Ownable2Step {
    struct Feed {
        uint128 price;
        uint64 updatedAt;
        /// Largest allowed change per post, in basis points of the previous price.
        uint16 maxDeviationBps;
        /// Oldest price `priceOf` will return, in seconds.
        uint32 maxAge;
        bool enabled;
    }

    uint8 public constant DECIMALS = 8;

    mapping(bytes32 market => Feed) public feeds;
    mapping(address publisher => bool) public isPublisher;

    event PublisherSet(address indexed publisher, bool allowed);
    event FeedConfigured(bytes32 indexed market, uint16 maxDeviationBps, uint32 maxAge, bool enabled);
    event PricePosted(bytes32 indexed market, uint256 price, uint256 timestamp, bool forced);

    error NotPublisher();
    error FeedDisabled(bytes32 market);
    error ZeroPrice();
    error DeviationTooLarge(bytes32 market, uint256 previous, uint256 next);
    error StalePrice(bytes32 market, uint256 updatedAt);
    error LengthMismatch();
    error BadConfig();

    constructor(address owner_) Ownable(owner_) {}

    function setPublisher(address publisher, bool allowed) external onlyOwner {
        isPublisher[publisher] = allowed;
        emit PublisherSet(publisher, allowed);
    }

    function configureFeed(bytes32 market, uint16 maxDeviationBps, uint32 maxAge, bool enabled) external onlyOwner {
        _configure(market, maxDeviationBps, maxAge, enabled);
    }

    /// @notice Configure many feeds with the same settings in one transaction.
    function configureFeeds(bytes32[] calldata markets, uint16 maxDeviationBps, uint32 maxAge, bool enabled) external onlyOwner {
        for (uint256 i; i < markets.length; ++i) _configure(markets[i], maxDeviationBps, maxAge, enabled);
    }

    function _configure(bytes32 market, uint16 maxDeviationBps, uint32 maxAge, bool enabled) private {
        if (maxDeviationBps == 0 || maxDeviationBps > 5_000 || maxAge == 0) revert BadConfig();
        Feed storage f = feeds[market];
        f.maxDeviationBps = maxDeviationBps;
        f.maxAge = maxAge;
        f.enabled = enabled;
        emit FeedConfigured(market, maxDeviationBps, maxAge, enabled);
    }

    /// @notice Post new prices. Each must be within the feed's maximum move from the last one.
    function post(bytes32[] calldata markets, uint128[] calldata prices) external {
        if (!isPublisher[msg.sender]) revert NotPublisher();
        if (markets.length != prices.length) revert LengthMismatch();
        for (uint256 i; i < markets.length; ++i) {
            Feed storage f = feeds[markets[i]];
            if (!f.enabled) revert FeedDisabled(markets[i]);
            uint128 next = prices[i];
            if (next == 0) revert ZeroPrice();
            uint256 prev = f.price;
            if (prev != 0) {
                uint256 diff = next > prev ? next - prev : prev - next;
                if (diff * 10_000 > prev * f.maxDeviationBps) revert DeviationTooLarge(markets[i], prev, next);
            }
            f.price = next;
            f.updatedAt = uint64(block.timestamp);
            emit PricePosted(markets[i], next, block.timestamp, false);
        }
    }

    /// @notice Owner override past the deviation limit, for index revisions. Emitted distinctly so it's visible.
    function forcePost(bytes32 market, uint128 price) external onlyOwner {
        Feed storage f = feeds[market];
        if (!f.enabled) revert FeedDisabled(market);
        if (price == 0) revert ZeroPrice();
        f.price = price;
        f.updatedAt = uint64(block.timestamp);
        emit PricePosted(market, price, block.timestamp, true);
    }

    /// @notice A fresh price, or revert. Used for every trade, close and liquidation.
    function priceOf(bytes32 market) external view returns (uint256) {
        Feed memory f = feeds[market];
        if (!f.enabled) revert FeedDisabled(market);
        if (f.price == 0) revert ZeroPrice();
        if (block.timestamp - f.updatedAt > f.maxAge) revert StalePrice(market, f.updatedAt);
        return f.price;
    }

    /// @notice The last price regardless of age. For accounting views only; never for execution.
    function lastPrice(bytes32 market) external view returns (uint256 price, uint256 updatedAt) {
        Feed memory f = feeds[market];
        return (f.price, f.updatedAt);
    }
}
