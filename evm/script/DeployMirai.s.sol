// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Mirai, IYieldSource, IBasket} from "../src/Mirai.sol";
import {MiraiVault} from "../src/MiraiVault.sol";
import {YieldStreamer} from "../src/YieldStreamer.sol";
import {BasketVault, IPriceFeed} from "../src/BasketVault.sol";

interface IPreviousMirai {
    function strategies() external view returns (IERC4626[3] memory, IYieldSource[3] memory);
}

/// @dev Deploys one vault + yield streamer per yield strategy (conservative / balanced / growth), the
///      invest strategy's BasketVault and Mirai. Testnet APRs mirror live Monad AUSD markets; on mainnet
///      you would pass those markets' ERC-4626 vaults with no streamers.
contract DeployMirai is Script {
    // AUSD on Monad testnet (https://docs.agora.finance/developer/contract-deployments)
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    // Chainlink push feeds on Monad testnet (reference-data-directory.vercel.app/feeds-monad-testnet.json)
    address constant USDC_USD = 0x39820e7965e29DC86b94F20eD04e9c5cCf9aFf95;
    address constant BTC_USD = 0x12C0F44368a02081ce58a936d1C1F606BB301715;
    address constant ETH_USD = 0x5c8c8482f064049248F86D9F4aFa4B1f2F5b6d31;
    address constant LINK_USD = 0x2A9FBFbf392594c4Dd7593C8a91cdEbc02e5b884;

    function run() external {
        address ausd = vm.envOr("AUSD_ADDRESS", AUSD_TESTNET);
        // AUSD base units sent to each streamer / the basket as reserves (0 = fund later).
        uint256 reserve = vm.envOr("STREAMER_RESERVE", uint256(0));
        uint256 basketReserve = vm.envOr("BASKET_RESERVE", uint256(0));
        uint16[3] memory apr = [uint16(400), 800, 1200];

        vm.startBroadcast();
        IERC4626[3] memory vaults;
        IYieldSource[3] memory sources;
        // Reuse the yield vaults + streamers of an earlier 3-strategy deployment (they are permissionless).
        address previous = vm.envOr("REUSE_YIELD_FROM", address(0));
        if (previous != address(0)) {
            (vaults, sources) = IPreviousMirai(previous).strategies();
        } else {
            for (uint256 i; i < 3; ++i) {
                MiraiVault vault = new MiraiVault(IERC20(ausd));
                YieldStreamer streamer = new YieldStreamer(vault, apr[i]);
                if (reserve != 0) IERC20(ausd).transfer(address(streamer), reserve);
                (vaults[i], sources[i]) = (vault, IYieldSource(address(streamer)));
                console.log("vault", i, address(vault));
                console.log("streamer", i, address(streamer));
            }
        }

        // Basket assets, in the order the web app expects (web/src/lib/basket.ts, web/api/market.ts).
        // The deployer is the curator (prices MON + memecoins, sets Smart Money weights), so deploy with
        // the key the web server uses as DRIP_PRIVATE_KEY.
        BasketVault basket = new BasketVault(IERC20(ausd), msg.sender);
        basket.addAsset("USDC", IPriceFeed(USDC_USD), false);
        basket.addAsset("BTC", IPriceFeed(BTC_USD), false);
        basket.addAsset("ETH", IPriceFeed(ETH_USD), false);
        basket.addAsset("LINK", IPriceFeed(LINK_USD), false);
        basket.addAsset("MON", IPriceFeed(address(0)), false);
        basket.addAsset("CHOG", IPriceFeed(address(0)), true);
        basket.addAsset("NADS", IPriceFeed(address(0)), true);
        basket.addAsset("MONCAT", IPriceFeed(address(0)), true);
        basket.addAsset("EMO", IPriceFeed(address(0)), true);
        // Chainlink-only start; the curator adds MON and memecoins once their prices are pushed.
        uint16[] memory w = new uint16[](9);
        (w[0], w[1], w[2]) = (1000, 4000, 5000);
        basket.setSmartWeights(w);
        if (basketReserve != 0) IERC20(ausd).transfer(address(basket), basketReserve);

        Mirai mirai = new Mirai(vaults, sources, IBasket(address(basket)));
        basket.initMirai(address(mirai));
        vm.stopBroadcast();

        console.log("basket", address(basket));
        console.log("Mirai:", address(mirai));
    }
}
