import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("SimpleStakingPool", function () {
  it("owner = deployer", async function () {
    const [deployer] = await ethers.getSigners();

    const staking = await ethers.deployContract("StakingPool");
    await staking.waitForDeployment();

    expect(await staking.owner()).to.equal(deployer.address);
  });

  it("First dep: 1:1 ETH -> shares", async function () {
    const [, user] = await ethers.getSigners();

    const staking = await ethers.deployContract("StakingPool");
    await staking.waitForDeployment();

    const amount = ethers.parseEther("1");

    const tx = await staking.connect(user).deposit({ value: amount });
    await tx.wait();

    const userShares = await staking.shares(user.address);
    const totalShares = await staking.totalShares();
    const poolBalance = await ethers.provider.getBalance(
      await staking.getAddress(),
    );

    expect(userShares).to.equal(amount);
    expect(totalShares).to.equal(amount);
    expect(poolBalance).to.equal(amount);
  });
});
