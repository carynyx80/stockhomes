// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice What the vault needs to know from the exchange.
interface IPerpsAccounting {
    /// @return Sum of traders' unrealised PnL across all markets (positive = the House owes traders).
    function netTraderPnl() external view returns (int256);
    /// @return Liquidity that must stay in the vault to back open positions.
    function reservedLiquidity() external view returns (uint256);
}

/// @title The Vault: the House liquidity pool
/// @notice ERC-4626 vault in USDG. Depositors are the counterparty to every Stoxhomes trade: they earn trading
///         and borrow fees and traders' losses, and pay traders' profits.
/// @dev Share price is conservative: traders' unrealised profits are subtracted, their unrealised losses are not
///      counted until realised. Withdrawals can't dip into liquidity reserved for open positions.
contract StoxhomesVault is ERC4626, Ownable2Step {
    using SafeERC20 for IERC20;

    IPerpsAccounting public perps;
    bool public depositsPaused;

    event PerpsSet(address perps);
    event DepositsPaused(bool paused);
    event Payout(address indexed to, uint256 amount);

    error OnlyPerps();
    error PerpsAlreadySet();
    error DepositsArePaused();

    constructor(IERC20 usdg, address owner_)
        ERC20("Stoxhomes House Share", "sHOUSE")
        ERC4626(usdg)
        Ownable(owner_)
    {}

    /// @notice One-time link to the exchange.
    function setPerps(address perps_) external onlyOwner {
        if (address(perps) != address(0)) revert PerpsAlreadySet();
        perps = IPerpsAccounting(perps_);
        emit PerpsSet(perps_);
    }

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    /// @notice Pays a trader's profit (or tops up the exchange to settle one). Exchange only.
    function payout(address to, uint256 amount) external {
        if (msg.sender != address(perps)) revert OnlyPerps();
        IERC20(asset()).safeTransfer(to, amount);
        emit Payout(to, amount);
    }

    function totalAssets() public view override returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        if (address(perps) == address(0)) return bal;
        int256 owed = perps.netTraderPnl();
        if (owed <= 0) return bal; // unrealised trader losses aren't counted until realised
        return bal > uint256(owed) ? bal - uint256(owed) : 0;
    }

    /// @notice Assets that can leave now: balance minus reserves for open positions minus what traders are owed.
    function freeLiquidity() public view returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        if (address(perps) == address(0)) return bal;
        int256 owed = perps.netTraderPnl();
        uint256 locked = perps.reservedLiquidity() + (owed > 0 ? uint256(owed) : 0);
        return bal > locked ? bal - locked : 0;
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 own = super.maxWithdraw(owner_);
        uint256 free = freeLiquidity();
        return own < free ? own : free;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 own = super.maxRedeem(owner_);
        uint256 freeShares = _convertToShares(freeLiquidity(), Math.Rounding.Floor);
        return own < freeShares ? own : freeShares;
    }

    function maxDeposit(address) public view override returns (uint256) {
        return depositsPaused ? 0 : type(uint256).max;
    }

    function maxMint(address) public view override returns (uint256) {
        return depositsPaused ? 0 : type(uint256).max;
    }

    /// @dev Virtual-share offset against the first-depositor inflation attack.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}

