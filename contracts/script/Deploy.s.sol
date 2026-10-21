// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {StoxhomesVault} from "../src/StoxhomesVault.sol";
import {StoxhomesPerps} from "../src/StoxhomesPerps.sol";
import {MockUSDG} from "../test/Base.t.sol";

/// @notice Deploys oracle, Vault and exchange and lists the six city markets.
///
/// Env:
///   USDG_ADDRESS     settlement token (leave empty on testnet to deploy a mock USDG)
///   OWNER            admin (use a multisig for anything real)
///   TREASURY         receives the treasury share of trading fees (for the $STOXH buyback)
///   PUBLISHER        oracle publisher (the price keeper)
///   INITIAL_PRICES   optional comma-separated 8-decimal prices for nyc,mia,lax,lon,dxb,los
///
///   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --account <keystore>
/// Mainnet only after an audit, with the owner role on a multisig.
contract Deploy is Script {
    bytes32[6] internal MARKETS = [bytes32("nyc"), "mia", "lax", "lon", "dxb", "los"];

    function params() internal pure returns (StoxhomesPerps.MarketParams memory) {
        // Placeholders: confirm before mainnet.
        return StoxhomesPerps.MarketParams({
            maxLeverage: 100,
            openFeeBps: 6,
            closeFeeBps: 6,
            maintenanceBps: 50,
            liquidationFeeBps: 10,
            borrowBpsPerDay: 1,
            maxOiBps: 1_000,
            reserveBps: 1_000
        });
    }

    function run() external {
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);
        address treasury = vm.envOr("TREASURY", owner);
        address publisher = vm.envOr("PUBLISHER", deployer);
        address usdgAddr = vm.envOr("USDG_ADDRESS", address(0));

        vm.startBroadcast();
        if (usdgAddr == address(0)) {
            require(block.chainid != 4663, "refusing to deploy a mock USDG on mainnet");
            MockUSDG mock = new MockUSDG();
            usdgAddr = address(mock);
            console2.log("Mock USDG (testnet only):", usdgAddr);
        }
        IERC20 usdg = IERC20(usdgAddr);

        // Deploy with the deployer as owner so markets can be configured, then hand ownership over.
        PriceOracle oracle = new PriceOracle(deployer);
        StoxhomesVault vault = new StoxhomesVault(usdg, deployer);
        StoxhomesPerps perps = new StoxhomesPerps(usdg, vault, oracle, treasury, deployer);

        vault.setPerps(address(perps));
        oracle.setPublisher(publisher, true);
        perps.setTreasury(treasury, 5_000);
        perps.setLimits(10e6, 60);
        for (uint256 i; i < MARKETS.length; ++i) {
            // Housing indices move slowly: at most 1% per post, and a price older than a day is refused.
            oracle.configureFeed(MARKETS[i], 100, 1 days, true);
            perps.listMarket(MARKETS[i], params());
        }

        if (owner != deployer) {
            oracle.transferOwnership(owner);
            vault.transferOwnership(owner);
            perps.transferOwnership(owner);
            console2.log("Ownership transfer started; the owner must call acceptOwnership() on each contract.");
        }
        vm.stopBroadcast();

        console2.log("PriceOracle:", address(oracle));
        console2.log("StoxhomesVault:", address(vault));
        console2.log("StoxhomesPerps:", address(perps));
        console2.log("USDG:", usdgAddr);
    }
}
