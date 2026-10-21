// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
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
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

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
        /// Close automatically at or beyond these prices (0 = none). Executed by anyone, usually the keeper.
        uint128 takeProfit;
        uint128 stopLoss;
    }

    /// A resting limit or stop order. Collateral and the open fee are escrowed here until it fills or is cancelled.
    struct Order {
        address owner;
        bytes32 market;
        bool isLong;
        /// Fill when the price is at or above `triggerPrice` (true) or at or below it (false).
        /// Long limit = below, long stop = above; short limit = above, short stop = below.
        bool triggerAbove;
        uint16 leverage;
        uint128 collateral;
        uint128 fee;
        uint128 triggerPrice;
        uint128 takeProfit;
        uint128 stopLoss;
        uint64 createdAt;
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
    EnumerableSet.UintSet internal _open;
    mapping(address => EnumerableSet.UintSet) internal _byOwner;
    /// Markets with open interest, so Vault accounting only walks those.
    EnumerableSet.Bytes32Set internal _activeMarkets;

    uint256 public constant MAX_ORDERS_PER_OWNER = 25;
    mapping(uint256 => Order) internal _orders;
    uint256 public nextOrderId = 1;
    EnumerableSet.UintSet internal _openOrders;
    mapping(address => EnumerableSet.UintSet) internal _ordersByOwner;

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
    event CollateralRemoved(uint256 indexed id, uint256 amount);
    event PositionDecreased(
        uint256 indexed id, address indexed owner, uint256 sizeDelta, uint256 price, int256 pnl, uint256 borrowFee, uint256 closeFee, uint256 paidOut
    );
    event TriggersSet(uint256 indexed id, uint256 takeProfit, uint256 stopLoss);
    event TriggerExecuted(uint256 indexed id, address indexed executor, uint256 price, bool takeProfit);
    event OrderPlaced(
        uint256 indexed orderId, address indexed owner, bytes32 indexed market, bool isLong, bool triggerAbove, uint256 triggerPrice, uint256 collateral, uint256 leverage
    );
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
    event OrderExecuted(uint256 indexed orderId, uint256 indexed positionId, address indexed executor, uint256 price);

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
    error NoOrder();
    error TooManyOrders();
    error TriggerNotMet();
    error BadTriggers();
    error WouldBreachMargin();

    constructor(IERC20 collateral_, StoxhomesVault vault_, PriceOracle oracle_, address treasury_, address owner_) Ownable(owner_) {
        if (address(vault_.asset()) != address(collateral_)) revert BadParams();
        collateralToken = collateral_;
        vault = vault_;
        oracle = oracle_;
        treasury = treasury_;
    }

    // ------------------------------------------------------------------ admin

    function listMarket(bytes32 market, MarketParams calldata p) external onlyOwner {
        _list(market, p);
    }

    /// @notice List many markets with the same parameters in one transaction.
    function listMarkets(bytes32[] calldata ids, MarketParams calldata p) external onlyOwner {
        for (uint256 i; i < ids.length; ++i) _list(ids[i], p);
    }

    function _list(bytes32 market, MarketParams calldata p) private {
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

    /// @notice Open a position at the oracle price. Pulls `collateral` plus the open fee from the caller.
    /// @param acceptablePrice Longs revert above it, shorts below it.
    function open(bytes32 market, bool isLong, uint256 collateral, uint256 leverage, uint256 acceptablePrice)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        return _openMarket(market, isLong, collateral, leverage, acceptablePrice, 0, 0);
    }

    /// @notice Open with a take-profit and/or stop-loss attached (0 = none).
    function openWithTriggers(
        bytes32 market,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 acceptablePrice,
        uint256 takeProfit,
        uint256 stopLoss
    ) external nonReentrant whenNotPaused returns (uint256 id) {
        return _openMarket(market, isLong, collateral, leverage, acceptablePrice, takeProfit, stopLoss);
    }

    function _openMarket(bytes32 market, bool isLong, uint256 collateral, uint256 leverage, uint256 acceptablePrice, uint256 tp, uint256 sl)
        private
        returns (uint256)
    {
        Market storage m = _tradable(market, collateral, leverage);
        uint256 price = oracle.priceOf(market);
        if (isLong ? price > acceptablePrice : price < acceptablePrice) revert SlippageExceeded(price, acceptablePrice);
        uint256 fee = _feeUp(collateral * leverage, m.p.openFeeBps);
        collateralToken.safeTransferFrom(msg.sender, address(this), collateral + fee);
        return _openAt(m, msg.sender, market, isLong, collateral, leverage, price, fee, tp, sl);
    }

    function _tradable(bytes32 market, uint256 collateral, uint256 leverage) private returns (Market storage m) {
        m = _markets[market];
        if (!m.listed || !m.enabled) revert MarketNotTradable(market);
        if (leverage == 0 || leverage > m.p.maxLeverage) revert BadLeverage();
        if (collateral < minCollateral || collateral == 0) revert CollateralTooSmall();
        _accrue(m);
    }

    /// Books a position whose collateral and fee are already held by this contract.
    function _openAt(
        Market storage m,
        address owner_,
        bytes32 market,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 price,
        uint256 fee,
        uint256 tp,
        uint256 sl
    ) private returns (uint256 id) {
        _checkTriggers(isLong, price, tp, sl);
        uint256 size = collateral * leverage;
        uint256 cap = (vault.totalAssets() * m.p.maxOiBps) / BPS;
        if ((isLong ? m.longSize : m.shortSize) + size > cap) revert OpenInterestCap();

        // Longs round units down, shorts round up: either way the trader's PnL rounds against them.
        uint256 units = isLong ? (size * UNIT) / price : _divUp(size * UNIT, price);
        _distributeFee(fee);

        id = nextPositionId++;
        _positions[id] = Position({
            owner: owner_,
            market: market,
            isLong: isLong,
            collateral: collateral.toUint128(),
            size: size.toUint128(),
            entryPrice: price.toUint128(),
            units: units,
            borrowIndexAtOpen: m.borrowIndex,
            openedAt: uint64(block.timestamp),
            takeProfit: tp.toUint128(),
            stopLoss: sl.toUint128()
        });
        if (isLong) {
            m.longSize += size;
            m.longUnits += units;
        } else {
            m.shortSize += size;
            m.shortUnits += units;
        }
        _activeMarkets.add(market);
        _open.add(id);
        _byOwner[owner_].add(id);
        emit PositionOpened(id, owner_, market, isLong, collateral, size, price, fee);
        if (tp != 0 || sl != 0) emit TriggersSet(id, tp, sl);
    }

    /// A take-profit must sit on the profitable side of `ref` and a stop-loss on the losing side.
    function _checkTriggers(bool isLong, uint256 ref, uint256 tp, uint256 sl) private pure {
        if (isLong ? (tp != 0 && tp <= ref) || (sl != 0 && sl >= ref) : (tp != 0 && tp >= ref) || (sl != 0 && sl <= ref)) {
            revert BadTriggers();
        }
    }

    /// @notice Add margin to an open position (always allowed, even when paused).
    function addCollateral(uint256 id, uint256 amount) external nonReentrant {
        Position storage pos = _positions[id];
        if (pos.owner == address(0)) revert NoPosition();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        pos.collateral = (uint256(pos.collateral) + amount).toUint128();
        emit CollateralAdded(id, amount);
    }

    /// @notice Withdraw margin. The position must stay within max leverage on both its collateral and its equity.
    function removeCollateral(uint256 id, uint256 amount) external nonReentrant {
        Position storage s = _positions[id];
        Position memory pos = s;
        if (pos.owner == address(0)) revert NoPosition();
        if (pos.owner != msg.sender) revert NotOwner();
        Market storage m = _markets[pos.market];
        _accrue(m);
        if (amount == 0 || amount > pos.collateral) revert WouldBreachMargin();
        uint256 left = pos.collateral - amount;
        if (left < minCollateral) revert CollateralTooSmall();
        uint256 initialMargin = _divUp(pos.size, m.p.maxLeverage);
        int256 equity = int256(left) + _pnl(pos, oracle.priceOf(pos.market)) - int256(_borrowFee(pos, m));
        if (left < initialMargin || equity < int256(initialMargin)) revert WouldBreachMargin();
        s.collateral = left.toUint128();
        collateralToken.safeTransfer(msg.sender, amount);
        emit CollateralRemoved(id, amount);
    }

    /// @notice Set or clear take-profit and stop-loss prices (0 = none), checked against the current price.
    function setTriggers(uint256 id, uint256 takeProfit, uint256 stopLoss) external {
        Position storage s = _positions[id];
        if (s.owner == address(0)) revert NoPosition();
        if (s.owner != msg.sender) revert NotOwner();
        (uint256 price,) = oracle.lastPrice(s.market);
        _checkTriggers(s.isLong, price, takeProfit, stopLoss);
        s.takeProfit = takeProfit.toUint128();
        s.stopLoss = stopLoss.toUint128();
        emit TriggersSet(id, takeProfit, stopLoss);
    }

    /// @notice Close your position at the oracle price.
    /// @param acceptablePrice Longs revert below it, shorts above it.
    function close(uint256 id, uint256 acceptablePrice) external nonReentrant returns (uint256 paidOut) {
        (, uint256 size) = _ownedAndHeld(id);
        return _closeAtOracle(id, size, acceptablePrice);
    }

    /// @notice Close part of a position. The rest keeps its entry price, leverage and triggers.
    /// @param sizeDelta Position size to close, in collateral units; at or above the size closes it all.
    function decrease(uint256 id, uint256 sizeDelta, uint256 acceptablePrice) external nonReentrant returns (uint256 paidOut) {
        _ownedAndHeld(id);
        if (sizeDelta == 0) revert BadParams();
        return _closeAtOracle(id, sizeDelta, acceptablePrice);
    }

    function _ownedAndHeld(uint256 id) private view returns (address owner_, uint256 size) {
        Position storage s = _positions[id];
        owner_ = s.owner;
        if (owner_ == address(0)) revert NoPosition();
        if (owner_ != msg.sender) revert NotOwner();
        if (block.timestamp < s.openedAt + minHoldSeconds) revert HoldTimeNotMet();
        size = s.size;
    }

    function _closeAtOracle(uint256 id, uint256 sizeDelta, uint256 acceptablePrice) private returns (uint256) {
        Position storage s = _positions[id];
        uint256 price = oracle.priceOf(s.market);
        if (s.isLong ? price < acceptablePrice : price > acceptablePrice) revert SlippageExceeded(price, acceptablePrice);
        return _settle(id, price, sizeDelta);
    }

    /// @notice Close a position whose take-profit or stop-loss has been reached. Anyone may call.
    function executeTriggers(uint256 id) external nonReentrant returns (uint256 paidOut) {
        Position storage s = _positions[id];
        if (s.owner == address(0)) revert NoPosition();
        if (block.timestamp < s.openedAt + minHoldSeconds) revert HoldTimeNotMet();
        uint256 price = oracle.priceOf(s.market);
        bool tpHit = s.takeProfit != 0 && (s.isLong ? price >= s.takeProfit : price <= s.takeProfit);
        bool slHit = s.stopLoss != 0 && (s.isLong ? price <= s.stopLoss : price >= s.stopLoss);
        if (!tpHit && !slHit) revert TriggerNotMet();
        emit TriggerExecuted(id, msg.sender, price, tpHit);
        return _settle(id, price, type(uint256).max);
    }

    /// Realises `sizeDelta` of a position (all of it if sizeDelta >= size) at `price` and pays the owner.
    function _settle(uint256 id, uint256 price, uint256 sizeDelta) private returns (uint256 paidOut) {
        Position storage s = _positions[id];
        Position memory pos = s;
        Market storage m = _markets[pos.market];
        _accrue(m);

        bool full = sizeDelta >= pos.size;
        uint256 units;
        uint256 collateral;
        if (full) {
            sizeDelta = pos.size;
            units = pos.units;
            collateral = pos.collateral;
        } else {
            // The closed slice rounds against the trader; the remainder keeps the dust.
            units = pos.isLong ? (pos.units * sizeDelta) / pos.size : _divUp(pos.units * sizeDelta, pos.size);
            collateral = (uint256(pos.collateral) * sizeDelta) / pos.size;
        }

        uint256 value = (units * price) / UNIT;
        int256 pnl = pos.isLong ? int256(value) - int256(sizeDelta) : int256(sizeDelta) - int256(value);
        uint256 borrowFee = _divUp(sizeDelta * (m.borrowIndex - pos.borrowIndexAtOpen), UNIT);
        uint256 closeFee = _feeUp(sizeDelta, m.p.closeFeeBps);

        if (pos.isLong) {
            m.longSize -= sizeDelta;
            m.longUnits -= units;
        } else {
            m.shortSize -= sizeDelta;
            m.shortUnits -= units;
        }
        if (full) {
            _forget(id, pos.owner, pos.market, m);
        } else {
            s.size = (pos.size - sizeDelta).toUint128();
            s.units = pos.units - units;
            s.collateral = (pos.collateral - collateral).toUint128();
            if (s.collateral < minCollateral) revert CollateralTooSmall();
        }

        int256 equity = int256(collateral) + pnl - int256(borrowFee) - int256(closeFee);
        paidOut = equity > 0 ? uint256(equity) : 0;

        // This contract holds the collateral. Treasury gets its share of the close fee if the position covered it;
        // the Vault gets (or pays) the rest.
        uint256 toTreasury = equity >= 0 ? (closeFee * treasuryFeeShareBps) / BPS : 0;
        uint256 needed = paidOut + toTreasury;
        if (needed > collateral) {
            uint256 shortfall = needed - collateral;
            if (collateralToken.balanceOf(address(vault)) < shortfall) revert InsufficientVaultLiquidity();
            vault.payout(address(this), shortfall);
        } else if (collateral > needed) {
            collateralToken.safeTransfer(address(vault), collateral - needed);
        }
        if (toTreasury != 0) collateralToken.safeTransfer(treasury, toTreasury);
        if (paidOut != 0) collateralToken.safeTransfer(pos.owner, paidOut);

        if (full) emit PositionClosed(id, pos.owner, price, pnl, borrowFee, closeFee, paidOut);
        else emit PositionDecreased(id, pos.owner, sizeDelta, price, pnl, borrowFee, closeFee, paidOut);
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
        if (pos.isLong) {
            m.longSize -= pos.size;
            m.longUnits -= pos.units;
        } else {
            m.shortSize -= pos.size;
            m.shortUnits -= pos.units;
        }
        _forget(id, pos.owner, pos.market, m);

        reward = (uint256(pos.size) * m.p.liquidationFeeBps) / BPS;
        if (reward > pos.collateral) reward = pos.collateral;
        if (pos.collateral > reward) collateralToken.safeTransfer(address(vault), pos.collateral - reward);
        if (reward != 0) collateralToken.safeTransfer(msg.sender, reward);
        emit PositionLiquidated(id, pos.owner, msg.sender, price, reward);
    }

    // ------------------------------------------------------------------ orders

    /// @notice Place a limit or stop order. Escrows collateral plus the open fee until it fills or is cancelled.
    /// @param triggerAbove Fill when the price is at or above `triggerPrice` (true) or at or below it (false).
    function placeOrder(
        bytes32 market,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 triggerPrice,
        bool triggerAbove,
        uint256 takeProfit,
        uint256 stopLoss
    ) external nonReentrant whenNotPaused returns (uint256 orderId) {
        Market storage m = _tradable(market, collateral, leverage);
        if (triggerPrice == 0) revert BadParams();
        _checkTriggers(isLong, triggerPrice, takeProfit, stopLoss);
        if (_ordersByOwner[msg.sender].length() >= MAX_ORDERS_PER_OWNER) revert TooManyOrders();
        uint256 fee = _feeUp(collateral * leverage, m.p.openFeeBps);
        collateralToken.safeTransferFrom(msg.sender, address(this), collateral + fee);

        orderId = nextOrderId++;
        _orders[orderId] = Order({
            owner: msg.sender,
            market: market,
            isLong: isLong,
            triggerAbove: triggerAbove,
            leverage: uint16(leverage),
            collateral: collateral.toUint128(),
            fee: fee.toUint128(),
            triggerPrice: triggerPrice.toUint128(),
            takeProfit: takeProfit.toUint128(),
            stopLoss: stopLoss.toUint128(),
            createdAt: uint64(block.timestamp)
        });
        _openOrders.add(orderId);
        _ordersByOwner[msg.sender].add(orderId);
        emit OrderPlaced(orderId, msg.sender, market, isLong, triggerAbove, triggerPrice, collateral, leverage);
    }

    /// @notice Cancel your order and get the escrow back (always allowed, even when paused).
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order memory o = _orders[orderId];
        if (o.owner == address(0)) revert NoOrder();
        if (o.owner != msg.sender) revert NotOwner();
        _dropOrder(orderId, o.owner);
        collateralToken.safeTransfer(o.owner, uint256(o.collateral) + o.fee);
        emit OrderCancelled(orderId, o.owner);
    }

    /// @notice Fill an order whose trigger has been reached, at the oracle price. Anyone may call.
    function executeOrder(uint256 orderId) external nonReentrant whenNotPaused returns (uint256 positionId) {
        Order memory o = _orders[orderId];
        if (o.owner == address(0)) revert NoOrder();
        Market storage m = _tradable(o.market, o.collateral, o.leverage);
        uint256 price = oracle.priceOf(o.market);
        if (o.triggerAbove ? price < o.triggerPrice : price > o.triggerPrice) revert TriggerNotMet();
        _dropOrder(orderId, o.owner);
        // Triggers that the fill price has already passed are dropped rather than blocking the fill.
        uint256 tp = o.takeProfit;
        uint256 sl = o.stopLoss;
        if (tp != 0 && (o.isLong ? tp <= price : tp >= price)) tp = 0;
        if (sl != 0 && (o.isLong ? sl >= price : sl <= price)) sl = 0;
        positionId = _openAt(m, o.owner, o.market, o.isLong, o.collateral, o.leverage, price, o.fee, tp, sl);
        emit OrderExecuted(orderId, positionId, msg.sender, price);
    }

    function _dropOrder(uint256 orderId, address owner_) private {
        _openOrders.remove(orderId);
        _ordersByOwner[owner_].remove(orderId);
        delete _orders[orderId];
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

    /// @notice Open position ids for a trader.
    function positionsOf(address owner_) external view returns (uint256[] memory) {
        return _byOwner[owner_].values();
    }

    function order(uint256 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    /// @notice Resting order ids for a trader.
    function ordersOf(address owner_) external view returns (uint256[] memory) {
        return _ordersByOwner[owner_].values();
    }

    function openOrderCount() external view returns (uint256) {
        return _openOrders.length();
    }

    /// @notice A page of resting order ids, for keepers.
    function openOrderIds(uint256 offset, uint256 limit) external view returns (uint256[] memory ids) {
        uint256 n = _openOrders.length();
        if (offset >= n) return new uint256[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; ++i) ids[i - offset] = _openOrders.at(i);
    }

    function openPositionCount() external view returns (uint256) {
        return _open.length();
    }

    /// @notice A page of open position ids, for keepers scanning for liquidations.
    function openPositionIds(uint256 offset, uint256 limit) external view returns (uint256[] memory ids) {
        uint256 n = _open.length();
        if (offset >= n) return new uint256[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; ++i) ids[i - offset] = _open.at(i);
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
        uint256 n = _activeMarkets.length();
        for (uint256 i; i < n; ++i) {
            bytes32 id = _activeMarkets.at(i);
            Market storage m = _markets[id];
            (uint256 price,) = oracle.lastPrice(id);
            if (price == 0) continue;
            total += int256((m.longUnits * price) / UNIT) - int256(m.longSize);
            total += int256(m.shortSize) - int256((m.shortUnits * price) / UNIT);
        }
    }

    /// @inheritdoc IPerpsAccounting
    function reservedLiquidity() external view returns (uint256 reserved) {
        uint256 n = _activeMarkets.length();
        for (uint256 i; i < n; ++i) {
            Market storage m = _markets[_activeMarkets.at(i)];
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

    /// Drops a fully closed position; sizes and units are already updated.
    function _forget(uint256 id, address owner_, bytes32 market, Market storage m) private {
        if (m.longSize == 0 && m.shortSize == 0 && m.longUnits == 0 && m.shortUnits == 0) _activeMarkets.remove(market);
        _open.remove(id);
        _byOwner[owner_].remove(id);
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
