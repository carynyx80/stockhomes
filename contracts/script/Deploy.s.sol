// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {StoxhomesVault} from "../src/StoxhomesVault.sol";
import {StoxhomesPerps} from "../src/StoxhomesPerps.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";

/// @notice Deploys oracle, Vault and exchange and lists the city markets.
///
/// Env:
///   MARKETS          comma-separated market ids (config/markets.generated.ts); default nyc,mia,lax,lon
///   USDG_ADDRESS     settlement token (leave empty on testnet to deploy TestUSDG with a public faucet)
///   USDG_MINTABLE    testnet: true if USDG_ADDRESS is a TestUSDG the deployer owns (so the Vault can be seeded)
///   OWNER            admin (use a multisig for anything real)
///   TREASURY         receives the treasury share of trading fees (for the $STOXH buyback)
///   PUBLISHER        oracle publisher (the price keeper)
///   INITIAL_PRICES   comma-separated 8-decimal opening prices, one per market (from the oracle keeper)
///   SEED_VAULT_USDG  testnet only: tUSDG (whole units) to mint and deposit into the Vault
///
///   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --account <keystore>
/// Mainnet only after an audit, with the owner role on a multisig.
contract Deploy is Script {
    function markets() internal view returns (bytes32[] memory ids) {
        string[] memory def = new string[](4);
        def[0] = "nyc";
        def[1] = "mia";
        def[2] = "lax";
        def[3] = "lon";
        string[] memory names = vm.envOr("MARKETS", ",", def);
        ids = new bytes32[](names.length);
        for (uint256 i; i < names.length; ++i) {
            require(bytes(names[i]).length > 0 && bytes(names[i]).length <= 31, "market id must be 1-31 bytes");
            ids[i] = bytes32(bytes(names[i]));
        }
    }

    function params() internal pure returns (StoxhomesPerps.MarketParams memory) {
        // Placeholders: confirm before mainnet.
        return StoxhomesPerps.MarketParams({
            maxLeverage: 100,
            openFeeBps: 6,
            closeFeeBps: 6,
            maintenanceBps: 50,
            liquidationFeeBps: 10,
            borrowBpsPerDay: 1,
            maxOiBps: 2_000,
            reserveBps: 1_000
        });
    }

    function run() external {
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);
        address treasury = vm.envOr("TREASURY", owner);
        address publisher = vm.envOr("PUBLISHER", deployer);
        address usdgAddr = vm.envOr("USDG_ADDRESS", address(0));

        bytes32[] memory ids = markets();
        vm.startBroadcast();
        TestUSDG testUsdg;
        if (usdgAddr != address(0) && vm.envOr("USDG_MINTABLE", false)) {
            require(block.chainid != 4663, "test USDG is testnet only");
            testUsdg = TestUSDG(usdgAddr);
        }
        if (usdgAddr == address(0)) {
            require(block.chainid != 4663, "refusing to deploy a test USDG on mainnet");
            testUsdg = new TestUSDG(owner);
            usdgAddr = address(testUsdg);
            console2.log("TestUSDG (testnet only):", usdgAddr);
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
        // Housing indices move slowly: at most 1% per post, and a price older than two days is refused
        // (the keeper runs daily).
        oracle.configureFeeds(ids, 100, 2 days, true);
        perps.listMarkets(ids, params());

        uint256[] memory prices = vm.envOr("INITIAL_PRICES", ",", new uint256[](0));
        if (prices.length == ids.length && publisher == deployer) {
            uint128[] memory ps = new uint128[](ids.length);
            for (uint256 i; i < ids.length; ++i) ps[i] = uint128(prices[i]);
            oracle.post(ids, ps);
        }

        uint256 seed = vm.envOr("SEED_VAULT_USDG", uint256(0));
        if (seed != 0 && address(testUsdg) != address(0) && owner == deployer) {
            testUsdg.mint(deployer, seed * 2 * 1e6);
            testUsdg.approve(address(vault), seed * 1e6);
            vault.deposit(seed * 1e6, deployer);
            console2.log("Seeded the Vault with tUSDG:", seed);
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
