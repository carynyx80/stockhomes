// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {PriceOracle} from "./PriceOracle.sol";
import {IPerpsAccounting, StoxhomesVault} from "./StoxhomesVault.sol";

/// @title Stoxhomes housing-price perpetuals
/// @notice Isolated-margin long/short positions on city home-price indices, settled in the collateral token
///         (USDG). The Vault takes the other side of every trade.
/// @dev Units: amounts in collateral base units; prices in oracle units (8 decimals); `units` = size * 1e18 / entry,
///      so a position's value at price P is units * P / 1e18 and aggregate PnL per market is exact.
///      Rounding always favours the House. Paused = no new positions; closing, adding margin and liquidating
///      always work, so traders can exit.
contract StoxhomesPerps is IPerpsAccounting, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using SafeCast for int256;

    uint256 private constant BPS = 10_000;
    uint256 private constant UNIT = 1e18;

    struct MarketParams {
        uint16 maxLeverage;
        uint16 openFeeBps;
        uint16 closeFeeBps;
        /// Maintenance margin, bps of size.
        uint16 maintenanceBps;
        /// Liquidator reward, bps of size (paid from the position's collateral).
        uint16 liquidationFeeBps;
        /// Borrow fee charged to positions, bps of size per day; paid to the Vault.
        uint16 borrowBpsPerDay;
        /// Max open interest per side, bps of Vault assets.
        uint16 maxOiBps;
        /// Liquidity the Vault must keep per unit of open interest, bps of size.
        uint16 reserveBps;
    }

    struct Market {
        bool listed;
        bool enabled;
        MarketParams p;
        uint256 longSize;
        uint256 shortSize;
        uint256 longUnits;
        uint256 shortUnits;
        /// Cumulative borrow rate, 1e18 = 100% of size.
        uint256 borrowIndex;
        uint64 lastAccrual;
    }

    struct Position {
        address owner;
        bytes32 market;
        bool isLong;
        uint128 collateral;
        uint128 size;
        uint128 entryPrice;
        uint256 units;
        uint256 borrowIndexAtOpen;
        uint64 openedAt;
    }

    IERC20 public immutable collateralToken;
    StoxhomesVault public immutable vault;
    PriceOracle public immutable oracle;

    address public treasury;
    /// Share of open/close fees sent to the treasury (for the $STOXH buyback); the rest stays with the Vault.
    uint16 public treasuryFeeShareBps;
    uint256 public minCollateral;
    /// Minimum seconds between opening and closing, to blunt oracle-update front-running.
    uint32 public minHoldSeconds;

    mapping(bytes32 => Market) internal _markets;
    bytes32[] public marketIds;
    mapping(uint256 => Position) internal _positions;
    uint256 public nextPositionId = 1;

    event MarketListed(bytes32 indexed market, MarketParams params);
    event MarketUpdated(bytes32 indexed market, MarketParams params, bool enabled);
    event TreasurySet(address treasury, uint16 shareBps);
    event LimitsSet(uint256 minCollateral, uint32 minHoldSeconds);
    event PositionOpened(
        uint256 indexed id, address indexed owner, bytes32 indexed market, bool isLong, uint256 collateral, uint256 size, uint256 price, uint256 fee
    );
    event PositionClosed(uint256 indexed id, address indexed owner, uint256 price, int256 pnl, uint256 borrowFee, uint256 closeFee, uint256 paidOut);
    event PositionLiquidated(uint256 indexed id, address indexed owner, address indexed liquidator, uint256 price, uint256 reward);
    event CollateralAdded(uint256 indexed id, uint256 amount);

    error MarketNotTradable(bytes32 market);
    error BadParams();
    error BadLeverage();
    error CollateralTooSmall();
    error SlippageExceeded(uint256 price, uint256 acceptable);
    error OpenInterestCap();
    error NotOwner();
    error NoPosition();
    error HoldTimeNotMet();
    error NotLiquidatable();
    error InsufficientVaultLiquidity();

    constructor(IERC20 collateral_, StoxhomesVault vault_, PriceOracle oracle_, address treasury_, address owner_) Ownable(owner_) {
        if (address(vault_.asset()) != address(collateral_)) revert BadParams();
        collateralToken = collateral_;
        vault = vault_;
        oracle = oracle_;
        treasury = treasury_;
    }

    // ------------------------------------------------------------------ admin

    function listMarket(bytes32 market, MarketParams calldata p) external onlyOwner {
        if (_markets[market].listed) revert BadParams();
        _checkParams(p);
        Market storage m = _markets[market];
        m.listed = true;
        m.enabled = true;
        m.p = p;
        m.lastAccrual = uint64(block.timestamp);
        marketIds.push(market);
        emit MarketListed(market, p);
    }

    function updateMarket(bytes32 market, MarketParams calldata p, bool enabled) external onlyOwner {
        Market storage m = _markets[market];
        if (!m.listed) revert BadParams();
        _checkParams(p);
        _accrue(m);
        m.p = p;
        m.enabled = enabled;
        emit MarketUpdated(market, p, enabled);
    }

    function setTreasury(address treasury_, uint16 shareBps) external onlyOwner {
        if (shareBps > BPS || treasury_ == address(0)) revert BadParams();
        treasury = treasury_;
        treasuryFeeShareBps = shareBps;
        emit TreasurySet(treasury_, shareBps);
    }

    function setLimits(uint256 minCollateral_, uint32 minHoldSeconds_) external onlyOwner {
        if (minHoldSeconds_ > 1 hours) revert BadParams();
        minCollateral = minCollateral_;
        minHoldSeconds = minHoldSeconds_;
        emit LimitsSet(minCollateral_, minHoldSeconds_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _checkParams(MarketParams calldata p) private pure {
        if (
            p.maxLeverage == 0 || p.maxLeverage > 100 || p.maintenanceBps == 0 || p.maintenanceBps >= BPS / p.maxLeverage
                || p.openFeeBps > 100 || p.closeFeeBps > 100 || p.liquidationFeeBps > p.maintenanceBps || p.maxOiBps > BPS
                || p.reserveBps > BPS || p.borrowBpsPerDay > 100
        ) revert BadParams();
    }

    // ------------------------------------------------------------------ trading

    /// @notice Open a position. Pulls `collateral` plus the open fee from the caller.
    /// @param acceptablePrice Longs revert above it, shorts below it.
    function open(bytes32 market, bool isLong, uint256 collateral, uint256 leverage, uint256 acceptablePrice)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        Market storage m = _markets[market];
        if (!m.listed || !m.enabled) revert MarketNotTradable(market);
        if (leverage == 0 || leverage > m.p.maxLeverage) revert BadLeverage();
        if (collateral < minCollateral || collateral == 0) revert CollateralTooSmall();
        _accrue(m);

        uint256 price = oracle.priceOf(market);
        if (isLong ? price > acceptablePrice : price < acceptablePrice) revert SlippageExceeded(price, acceptablePrice);

        uint256 size = collateral * leverage;
        uint256 fee = _feeUp(size, m.p.openFeeBps);
        uint256 cap = (vault.totalAssets() * m.p.maxOiBps) / BPS;
        if ((isLong ? m.longSize : m.shortSize) + size > cap) revert OpenInterestCap();

        // Longs round units down, shorts round up: either way the trader's PnL rounds against them.
        uint256 units = isLong ? (size * UNIT) / price : _divUp(size * UNIT, price);

        collateralToken.safeTransferFrom(msg.sender, address(this), collateral + fee);
        _distributeFee(fee);

        id = nextPositionId++;
        _positions[id] = Position({
            owner: msg.sender,
            market: market,
            isLong: isLong,
            collateral: collateral.toUint128(),
            size: size.toUint128(),
            entryPrice: price.toUint128(),
            units: units,
            borrowIndexAtOpen: m.borrowIndex,
            openedAt: uint64(block.timestamp)
        });
        if (isLong) {
            m.longSize += size;
            m.longUnits += units;
        } else {
            m.shortSize += size;
            m.shortUnits += units;
        }
        emit PositionOpened(id, msg.sender, market, isLong, collateral, size, price, fee);
    }

    /// @notice Add margin to an open position (always allowed, even when paused).
    function addCollateral(uint256 id, uint256 amount) external nonReentrant {
        Position storage pos = _positions[id];
        if (pos.owner == address(0)) revert NoPosition();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        pos.collateral = (uint256(pos.collateral) + amount).toUint128();
        emit CollateralAdded(id, amount);
    }

    /// @notice Close your position at the oracle price.
    /// @param acceptablePrice Longs revert below it, shorts above it.
    function close(uint256 id, uint256 acceptablePrice) external nonReentrant returns (uint256 paidOut) {
        Position memory pos = _positions[id];
        if (pos.owner == address(0)) revert NoPosition();
        if (pos.owner != msg.sender) revert NotOwner();
        if (block.timestamp < pos.openedAt + minHoldSeconds) revert HoldTimeNotMet();
        Market storage m = _markets[pos.market];
        _accrue(m);

        uint256 price = oracle.priceOf(pos.market);
        if (pos.isLong ? price < acceptablePrice : price > acceptablePrice) revert SlippageExceeded(price, acceptablePrice);

        int256 pnl = _pnl(pos, price);
        uint256 borrowFee = _borrowFee(pos, m);
        uint256 closeFee = _feeUp(pos.size, m.p.closeFeeBps);
        _remove(id, pos, m);

        int256 equity = int256(uint256(pos.collateral)) + pnl - int256(borrowFee) - int256(closeFee);
        paidOut = equity > 0 ? uint256(equity) : 0;

        // This contract holds the collateral. Treasury gets its share of the close fee if the position covered it;
        // the Vault gets (or pays) the rest.
        uint256 toTreasury = equity >= 0 ? (closeFee * treasuryFeeShareBps) / BPS : 0;
        uint256 needed = paidOut + toTreasury;
        if (needed > pos.collateral) {
            uint256 shortfall = needed - pos.collateral;
            if (collateralToken.balanceOf(address(vault)) < shortfall) revert InsufficientVaultLiquidity();
            vault.payout(address(this), shortfall);
        } else if (pos.collateral > needed) {
            collateralToken.safeTransfer(address(vault), pos.collateral - needed);
        }
        if (toTreasury != 0) collateralToken.safeTransfer(treasury, toTreasury);
        if (paidOut != 0) collateralToken.safeTransfer(pos.owner, paidOut);

        emit PositionClosed(id, pos.owner, price, pnl, borrowFee, closeFee, paidOut);
    }

    /// @notice Liquidate a position whose equity is at or below maintenance margin. Anyone may call.
    function liquidate(uint256 id) external nonReentrant returns (uint256 reward) {
        Position memory pos = _positions[id];
        if (pos.owner == address(0)) revert NoPosition();
        Market storage m = _markets[pos.market];
        _accrue(m);

        uint256 price = oracle.priceOf(pos.market);
        int256 equity = int256(uint256(pos.collateral)) + _pnl(pos, price) - int256(_borrowFee(pos, m));
        if (equity > int256((uint256(pos.size) * m.p.maintenanceBps) / BPS)) revert NotLiquidatable();
        _remove(id, pos, m);

        reward = (uint256(pos.size) * m.p.liquidationFeeBps) / BPS;
        if (reward > pos.collateral) reward = pos.collateral;
        if (pos.collateral > reward) collateralToken.safeTransfer(address(vault), pos.collateral - reward);
        if (reward != 0) collateralToken.safeTransfer(msg.sender, reward);
        emit PositionLiquidated(id, pos.owner, msg.sender, price, reward);
    }

    // ------------------------------------------------------------------ views

    function market(bytes32 id) external view returns (Market memory) {
        return _markets[id];
    }

    function position(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }

    /// @notice Unrealised PnL and accrued borrow fee at the current oracle price.
    function positionPnl(uint256 id) external view returns (int256 pnl, uint256 borrowFee) {
        Position memory pos = _positions[id];
        if (pos.owner == address(0)) revert NoPosition();
        Market memory m = _markets[pos.market];
        (uint256 price,) = oracle.lastPrice(pos.market);
        pnl = _pnl(pos, price);
        uint256 index = m.borrowIndex + _pendingBorrow(m);
        borrowFee = (uint256(pos.size) * (index - pos.borrowIndexAtOpen)) / UNIT;
    }

    /// @notice Price at which the position hits maintenance margin, ignoring future borrow fees.
    function liquidationPrice(uint256 id) external view returns (uint256) {
        Position memory pos = _positions[id];
        if (pos.owner == address(0)) revert NoPosition();
        Market memory m = _markets[pos.market];
        uint256 mm = (uint256(pos.size) * m.p.maintenanceBps) / BPS;
        if (pos.collateral <= mm) return pos.entryPrice;
        uint256 cushion = pos.collateral - mm;
        uint256 distance = (uint256(pos.entryPrice) * cushion) / pos.size;
        return pos.isLong ? (pos.entryPrice > distance ? pos.entryPrice - distance : 0) : pos.entryPrice + distance;
    }

    /// @inheritdoc IPerpsAccounting
    function netTraderPnl() public view returns (int256 total) {
        for (uint256 i; i < marketIds.length; ++i) {
            Market storage m = _markets[marketIds[i]];
            (uint256 price,) = oracle.lastPrice(marketIds[i]);
            if (price == 0) continue;
            total += int256((m.longUnits * price) / UNIT) - int256(m.longSize);
            total += int256(m.shortSize) - int256((m.shortUnits * price) / UNIT);
        }
    }

    /// @inheritdoc IPerpsAccounting
    function reservedLiquidity() external view returns (uint256 reserved) {
        for (uint256 i; i < marketIds.length; ++i) {
            Market storage m = _markets[marketIds[i]];
            reserved += ((m.longSize + m.shortSize) * m.p.reserveBps) / BPS;
        }
    }

    // ------------------------------------------------------------------ internals

    function _pnl(Position memory pos, uint256 price) private pure returns (int256) {
        uint256 value = (pos.units * price) / UNIT;
        return pos.isLong ? int256(value) - int256(uint256(pos.size)) : int256(uint256(pos.size)) - int256(value);
    }

    function _borrowFee(Position memory pos, Market storage m) private view returns (uint256) {
        return _divUp(uint256(pos.size) * (m.borrowIndex - pos.borrowIndexAtOpen), UNIT);
    }

    function _pendingBorrow(Market memory m) private view returns (uint256) {
        return (uint256(m.p.borrowBpsPerDay) * UNIT * (block.timestamp - m.lastAccrual)) / (BPS * 1 days);
    }

    function _accrue(Market storage m) private {
        if (block.timestamp == m.lastAccrual) return;
        m.borrowIndex += _pendingBorrow(m);
        m.lastAccrual = uint64(block.timestamp);
    }

    function _remove(uint256 id, Position memory pos, Market storage m) private {
        if (pos.isLong) {
            m.longSize -= pos.size;
            m.longUnits -= pos.units;
        } else {
            m.shortSize -= pos.size;
            m.shortUnits -= pos.units;
        }
        delete _positions[id];
    }

    function _distributeFee(uint256 fee) private {
        uint256 toTreasury = (fee * treasuryFeeShareBps) / BPS;
        if (toTreasury != 0) collateralToken.safeTransfer(treasury, toTreasury);
        if (fee > toTreasury) collateralToken.safeTransfer(address(vault), fee - toTreasury);
    }

    function _feeUp(uint256 size, uint256 bps) private pure returns (uint256) {
        return _divUp(size * bps, BPS);
    }

    function _divUp(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
