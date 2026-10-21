// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Test USDG (testnet only)
/// @notice A 6-decimal stand-in for USDG with a public faucet, so anyone can try the exchange on testnet.
///         Refuses to exist on Robinhood Chain mainnet.
contract TestUSDG is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    mapping(address => uint256) public lastFaucet;

    error MainnetNotAllowed();
    error FaucetCooldown(uint256 availableAt);

    constructor(address owner_) ERC20("Test USDG (Stoxhomes testnet)", "tUSDG") Ownable(owner_) {
        if (block.chainid == 4663) revert MainnetNotAllowed();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice 10,000 tUSDG, once a day per address.
    function faucet() external {
        uint256 next = lastFaucet[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucet[msg.sender] != 0 && block.timestamp < next) revert FaucetCooldown(next);
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
