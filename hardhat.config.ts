import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import dotenv from "dotenv";

// Load environment variables.
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
        // Built-in Hardhat test network.
        hardhat: {
            type: "edr-simulated",
            chainType: "l1",
        },
        // Enable Sepolia only when an RPC URL is configured.
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
    ...(process.env.ETHERSCAN_API_KEY
        ? {
              verify: {
                  etherscan: {
                      apiKey: process.env.ETHERSCAN_API_KEY,
                  },
              },
          }
        : {}),
});
