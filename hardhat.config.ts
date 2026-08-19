import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import dotenv from "dotenv";

// 加载 .env 文件中的环境变量
dotenv.config();

export default defineConfig({
    // 插件列表
    plugins: [hardhatToolboxMochaEthers],

    // Solidity 配置
    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },

    // 网络配置（如果需要连接外部网络）
    networks: {
        // Hardhat 内置网络（用于测试）
        hardhat: {
            type: "edr-simulated",
            chainType: "l1",
        },
        // Sepolia 测试网（需要设置环境变量）
        sepolia: {
            type: "http",
            chainType: "l1",
            url: process.env.SEPOLIA_RPC_URL || "",
            accounts: process.env.SEPOLIA_PRIVATE_KEY ? [process.env.SEPOLIA_PRIVATE_KEY] : [],
        },
    },
    test: {
        solidity: {
            timeout: 60000,

            fuzz: {
                runs: 256,
            },

            invariant: {
                runs: 256,
                depth: 500,
                failOnRevert: false,
            },
        },
    },
});
