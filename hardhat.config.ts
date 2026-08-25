import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import dotenv from "dotenv";

// 加载 .env
dotenv.config();

export default defineConfig({
    plugins: [hardhatToolboxMochaEthers, hardhatVerify],

    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },

    networks: {
        // Hardhat 内置测试网络
        hardhat: {
            type: "edr-simulated",
            chainType: "l1",
        },

        // 只有配置 RPC 时才启用 Sepolia
        ...(process.env.SEPOLIA_RPC_URL
            ? {
                  sepolia: {
                      type: "http",
                      chainType: "l1",
                      url: process.env.SEPOLIA_RPC_URL,
                      accounts: process.env.SEPOLIA_PRIVATE_KEY
                          ? [process.env.SEPOLIA_PRIVATE_KEY]
                          : [],
                  },
              }
            : {}),
    },
    verify: {
        etherscan: {
            apiKey: process.env.ETHERSCAN_API_KEY,
        },
    },
});
