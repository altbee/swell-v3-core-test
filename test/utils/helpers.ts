import hre, { ethers, network } from "hardhat";
import { bls12_381 } from "@noble/curves/bls12-381";
import { utils } from "ethers";

export const unlockAccount = async (address: string) => {
  await hre.network.provider.send("hardhat_impersonateAccount", [address]);
  return address;
};

export const increaseTime = async (sec: number) => {
  await hre.network.provider.send("evm_increaseTime", [sec]);
  await hre.network.provider.send("evm_mine");
};

export const mineBlocks = async (blockCount: number) => {
  for (let i = 0; i < blockCount; ++i) {
    await hre.network.provider.send("evm_mine");
  }
};

export const getBlockNumber = async () => {
  const blockNumber = await hre.network.provider.send("eth_blockNumber");
  return parseInt(blockNumber.slice(2), 16);
};

export const getTimeStamp = async () => {
  const blockNumber = await hre.network.provider.send("eth_blockNumber");
  const blockTimestamp = (await hre.network.provider.send("eth_getBlockByNumber", [blockNumber, false])).timestamp;
  return parseInt(blockTimestamp.slice(2), 16);
};

export const getSnapShot = async () => {
  return await hre.network.provider.send("evm_snapshot");
};

export const revertEvm = async (snapshotID: any) => {
  await hre.network.provider.send("evm_revert", [snapshotID]);
};

export const getLatestBlockTimestamp = async (): Promise<number> => {
  const latestBlock = await ethers.provider.getBlock("latest");
  return latestBlock.timestamp;
};

export const getLatestBlockNumber = async (): Promise<number> => {
  const latestBlock = await ethers.provider.getBlock("latest");
  return latestBlock.number;
};

export const advanceTime = async (time: number): Promise<void> =>
  new Promise((resolve, reject) => {
    network.provider.send("evm_increaseTime", [time]).then(resolve).catch(reject);
  });

export const advanceBlock = (): Promise<void> =>
  new Promise((resolve, reject) => {
    network.provider.send("evm_mine").then(resolve).catch(reject);
  });

export const advanceTimeAndBlock = async (time: number): Promise<void> => {
  await advanceTime(time);
  await advanceBlock();
};

const amount = "32000000000"; // 32ETH in gWei

export const generatePubKeyAndSignature = async (privateKey: string, withdrawalCredentials: string) => {
  const pubKeyBuffer = bls12_381.getPublicKey(privateKey);
  const pubKey = "0x" + Buffer.from(pubKeyBuffer).toString("hex");

  const message = utils.defaultAbiCoder.encode(["bytes", "bytes", "uint64"], [pubKey, withdrawalCredentials, amount]);
  const signature = await bls12_381.sign(utils.arrayify(message), privateKey);

  return { pubKey, signature };
};
