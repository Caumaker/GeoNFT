require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('@nomicfoundation/hardhat-verify');

// Networks for deploying: set the RPC URL and the deployer key in the environment (never in this file).
//   AMOY_RPC_URL / POLYGON_RPC_URL    e.g. https://rpc-amoy.polygon.technology
//   DEPLOYER_KEY                      private key of a wallet with POL for gas
const conta = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: '0.8.28',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  networks: {
    amoy: { url: process.env.AMOY_RPC_URL || 'https://rpc-amoy.polygon.technology', chainId: 80002, accounts: conta },
    polygon: { url: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com', chainId: 137, accounts: conta },
  },
  etherscan: { apiKey: process.env.POLYGONSCAN_API_KEY || '' },
};
