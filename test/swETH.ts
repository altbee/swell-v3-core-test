import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import hre, { upgrades, ethers } from "hardhat";
import { AccessControlManager, SwETH, NodeOperatorRegistry, DepositManager, IDepositContract } from "../typechain";

import { ether, generatePubKeyAndSignature, wei } from "./utils";
import { utils } from "ethers";

const { expect } = chai;

chai.use(solidity);

const privateKey = "18f020b98eb798752a50ed0563b079c125b0db5dd0b1060d1c1b47d4a193e1e4";
const operatorName = "Operator";

describe("swETH", function () {
  let owner: SignerWithAddress;
  let tester1: SignerWithAddress;
  let tester2: SignerWithAddress;
  let tester3: SignerWithAddress;
  let tester4: SignerWithAddress;
  let admin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let operator: SignerWithAddress;
  let operatorReward: SignerWithAddress;
  let bot: SignerWithAddress;
  let accessControlManager: AccessControlManager;
  let depositManager: DepositManager;
  let nodeOperatorRegistry: NodeOperatorRegistry;
  let swETH: SwETH;
  let depositContract: IDepositContract;
  let depositRootHash: string = "";

  beforeEach(async function () {
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    [owner, tester1, tester2, tester3, tester4, admin, treasury, operator, operatorReward, bot] = signers;

    const AccessControlManagerArtifact = await ethers.getContractFactory("AccessControlManager");
    accessControlManager = <AccessControlManager>await upgrades.deployProxy(
      AccessControlManagerArtifact,
      [[admin.address, treasury.address]],
      {
        initializer: "initialize",
      },
    );

    const DepositManagerArtifact = await ethers.getContractFactory("DepositManager");
    depositManager = <DepositManager>await upgrades.deployProxy(
      DepositManagerArtifact,
      [accessControlManager.address],
      {
        initializer: "initialize",
      },
    );

    const NodeOperatorRegistryArtifact = await ethers.getContractFactory("NodeOperatorRegistry");
    nodeOperatorRegistry = <NodeOperatorRegistry>await upgrades.deployProxy(
      NodeOperatorRegistryArtifact,
      [accessControlManager.address],
      {
        initializer: "initialize",
      },
    );

    const SwETHArtifact = await ethers.getContractFactory("swETH");
    swETH = <SwETH>await upgrades.deployProxy(SwETHArtifact, [accessControlManager.address], {
      initializer: "initialize",
      unsafeAllow: ["delegatecall"],
    });

    const IDepositContractArtifcation = await hre.artifacts.readArtifact("IDepositContract");
    const depositContractAddress = await depositManager.DepositContract();
    depositContract = <IDepositContract>(
      await ethers.getContractAt(IDepositContractArtifcation.abi, depositContractAddress)
    );

    // config
    await accessControlManager.setSwETH(swETH.address);
    await accessControlManager.setDepositManager(depositManager.address);
    await accessControlManager.setNodeOperatorRegistry(nodeOperatorRegistry.address);

    await accessControlManager.unpauseBotMethods();
    await accessControlManager.unpauseCoreMethods();
    await accessControlManager.unpauseOperatorMethods();
    await accessControlManager.unpauseWithdrawals();
    await swETH.disableWhitelist();

    await accessControlManager.grantRole(utils.solidityKeccak256(["string"], ["BOT"]), bot.address);
  });

  describe("basic check", () => {
    it("initial rate should be 0", async () => {
      expect(await swETH.getRate()).to.equal(ether(1));
      expect(await swETH.swETHToETHRate()).to.equal(ether(1));
      expect(await swETH.ethToSwETHRate()).to.equal(ether(1));
    });

    it("deposit 20 ether from tester1", async () => {
      await swETH.connect(tester1).deposit({ value: ether(20) });

      expect(await swETH.balanceOf(tester1.address)).to.equal(ether(20));
      expect(await ethers.provider.getBalance(depositManager.address)).to.equal(ether(20));
    });
  });

  describe("check validators", () => {
    beforeEach(async () => {
      await swETH.connect(tester1).deposit({ value: ether(20) });
      await swETH.connect(tester2).deposit({ value: ether(20) });
    });

    it("check getNextValidatorDetails", async () => {
      await nodeOperatorRegistry.addOperator(operatorName, operator.address, operatorReward.address);
      const withdrawalCredentials = await depositManager.getWithdrawalCredentials();
      const { pubKey, signature } = await generatePubKeyAndSignature(privateKey, withdrawalCredentials);
      await nodeOperatorRegistry.connect(operator).addNewValidatorDetails([{ pubKey, signature }]);

      const nextValidatorInfo = await nodeOperatorRegistry.getNextValidatorDetails(1);
      expect(nextValidatorInfo.foundValidators).to.equal(wei(1));
    });
  });

  describe("create validator", () => {
    beforeEach(async () => {
      await swETH.connect(tester1).deposit({ value: ether(20) });
      await swETH.connect(tester2).deposit({ value: ether(20) });
      await nodeOperatorRegistry.addOperator(operatorName, operator.address, operatorReward.address);
      const withdrawalCredentials = await depositManager.getWithdrawalCredentials();
      const { pubKey, signature } = await generatePubKeyAndSignature(privateKey, withdrawalCredentials);
      await nodeOperatorRegistry.connect(operator).addNewValidatorDetails([{ pubKey, signature }]);
      depositRootHash = await depositContract.get_deposit_root();
    });

    it("create validator", async () => {
      const nextValidatorInfo = await nodeOperatorRegistry.getNextValidatorDetails(1);
      const pubKeys = nextValidatorInfo.validatorDetails.map(e => e.pubKey);
      await depositManager.connect(bot).setupValidators(pubKeys, depositRootHash);
    });
  });

  describe("create validator and manage rewards", () => {
    beforeEach(async () => {
      await swETH.connect(tester1).deposit({ value: ether(20) });
      await swETH.connect(tester2).deposit({ value: ether(20) });
      await nodeOperatorRegistry.addOperator(operatorName, operator.address, operatorReward.address);
      const withdrawalCredentials = await depositManager.getWithdrawalCredentials();
      const { pubKey, signature } = await generatePubKeyAndSignature(privateKey, withdrawalCredentials);
      await nodeOperatorRegistry.connect(operator).addNewValidatorDetails([{ pubKey, signature }]);
      depositRootHash = await depositContract.get_deposit_root();
      const nextValidatorInfo = await nodeOperatorRegistry.getNextValidatorDetails(1);
      const pubKeys = nextValidatorInfo.validatorDetails.map(e => e.pubKey);
      await depositManager.connect(bot).setupValidators(pubKeys, depositRootHash);

      // set percents
      await swETH.setNodeOperatorRewardPercentage(ether(0.1)); // 10%
      await swETH.setSwellTreasuryRewardPercentage(ether(0.1)); // 10%
    });

    it("check reprice", async () => {
      await swETH.connect(bot).reprice(ether(40), ether(1), ether(40));
      const rewardAmount = ether(0.2)
        .mul(ether(40))
        .div(ether(40 - 0.2 + 1));

      expect(await swETH.balanceOf(operatorReward.address)).to.equal(rewardAmount.div(2));
      expect(await swETH.balanceOf(treasury.address)).to.equal(rewardAmount.sub(rewardAmount.div(2)));

      const newRate = ether(40 + 1)
        .mul(ether(1))
        .div(ether(40).add(rewardAmount));
      expect(await swETH.swETHToETHRate()).to.equal(newRate);
    });
  });
});
