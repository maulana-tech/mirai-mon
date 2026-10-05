// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Mirai, IYieldSource} from "../src/Mirai.sol";
import {MiraiVault} from "../src/MiraiVault.sol";
import {YieldStreamer} from "../src/YieldStreamer.sol";
import {MarketVault, IPriceFeed} from "../src/MarketVault.sol";

/// @dev Deploys one vault + yield streamer per yield strategy (conservative / balanced / growth), the
///      smart-money MarketVault (BTC / ETH priced by Chainlink) and Mirai. Testnet APRs mirror live
///      Monad AUSD markets; on mainnet you would pass those markets' ERC-4626 vaults with no streamers.
interface IPreviousMirai {
    function strategies() external view returns (IERC4626[3] memory, IYieldSource[3] memory);
}

contract DeployMirai is Script {
    // AUSD on Monad testnet (https://docs.agora.finance/developer/contract-deployments)
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    // Chainlink push feeds on Monad testnet (reference-data-directory.vercel.app/feeds-monad-testnet.json)
    address constant BTC_USD_TESTNET = 0x12C0F44368a02081ce58a936d1C1F606BB301715;
    address constant ETH_USD_TESTNET = 0x5c8c8482f064049248F86D9F4aFa4B1f2F5b6d31;

    function run() external {
        address ausd = vm.envOr("AUSD_ADDRESS", AUSD_TESTNET);
        // AUSD base units sent to each streamer as its yield reserve (0 = fund later).
        uint256 reserve = vm.envOr("STREAMER_RESERVE", uint256(0));
        // AUSD that backs market gains above deposits (0 = fund later).
        uint256 marketReserve = vm.envOr("MARKET_RESERVE", uint256(0));
        // Sets basket weights from Nansen: the web server's DRIP wallet.
        address curator = vm.envAddress("CURATOR_ADDRESS");
        IPriceFeed[] memory feeds = new IPriceFeed[](2);
        (feeds[0], feeds[1]) = (IPriceFeed(BTC_USD_TESTNET), IPriceFeed(ETH_USD_TESTNET));
        uint16[] memory weights = new uint16[](2);
        (weights[0], weights[1]) = (5000, 5000);
        uint16[3] memory apr = [uint16(400), 800, 1200];

        vm.startBroadcast();
        IERC4626[4] memory vaults;
        IYieldSource[4] memory sources;
        // Reuse the yield vaults + streamers of an earlier 3-strategy deployment (they are permissionless).
        address previous = vm.envOr("REUSE_YIELD_FROM", address(0));
        if (previous != address(0)) {
            (IERC4626[3] memory pv, IYieldSource[3] memory ps) = IPreviousMirai(previous).strategies();
            for (uint256 i; i < 3; ++i) {
                (vaults[i], sources[i]) = (pv[i], ps[i]);
            }
        }
        for (uint256 i; previous == address(0) && i < 3; ++i) {
            MiraiVault vault = new MiraiVault(IERC20(ausd));
            YieldStreamer streamer = new YieldStreamer(vault, apr[i]);
            if (reserve != 0) IERC20(ausd).transfer(address(streamer), reserve);
            vaults[i] = vault;
            sources[i] = IYieldSource(address(streamer));
            console.log("vault", i, address(vault));
            console.log("streamer", i, address(streamer));
        }
        // Reuse an already deployed MarketVault (it is permissionless apart from its curator).
        MarketVault market = MarketVault(vm.envOr("REUSE_MARKET_VAULT", address(0)));
        if (address(market) == address(0)) {
            market = new MarketVault(IERC20(ausd), curator, feeds, weights);
            if (marketReserve != 0) IERC20(ausd).transfer(address(market), marketReserve);
        }
        vaults[3] = market;
        console.log("market", address(market));
        Mirai mirai = new Mirai(vaults, sources);
        vm.stopBroadcast();

        console.log("Mirai:", address(mirai));
    }
}
