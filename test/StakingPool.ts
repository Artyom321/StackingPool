import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("StakingPool", function () {
  const WITHDRAWAL_DELAY = 10;

  async function deployStaking() {
    const staking = await ethers.deployContract("StakingPool", [
      WITHDRAWAL_DELAY,
    ]);
    await staking.waitForDeployment();
    return staking;
  }


  it("Owner is deployer", async function () {
    const [deployer] = await ethers.getSigners();

    const staking = await deployStaking();
    expect(await staking.owner()).to.equal(deployer.address);
    expect(await staking.withdrawalDelay()).to.equal(WITHDRAWAL_DELAY);
  });


  it("First deposite", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();

    const amount = ethers.parseEther("1");

    await (await staking.connect(user).deposit({ value: amount })).wait();

    const userShares = await staking.shares(user.address);
    const totalShares = await staking.totalShares();
    const poolBalance = await ethers.provider.getBalance(
      await staking.getAddress(),
    );

    expect(userShares).to.equal(amount);
    expect(totalShares).to.equal(amount);
    expect(poolBalance).to.equal(amount);
  });


  it("Delayed claim", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const twoEth = ethers.parseEther("2");

    await (await staking.connect(user).deposit({ value: twoEth })).wait();

    const userSharesBefore = await staking.shares(user.address);
    const totalSharesBefore = await staking.totalShares();
    const poolBalanceBefore = await ethers.provider.getBalance(addr);

    expect(userSharesBefore).to.equal(twoEth);
    expect(totalSharesBefore).to.equal(twoEth);
    expect(poolBalanceBefore).to.equal(twoEth);

    const halfShares = userSharesBefore / 2n;

    await (
      await staking.connect(user).requestWithdraw(halfShares)
    ).wait();

    const req = await staking.withdrawalRequests(user.address);
    expect(req.shares).to.equal(halfShares);
    expect(req.readyAt).to.be.greaterThan(0);

    await expect(
      staking.connect(user).claimWithdraw(),
    ).to.be.revertedWith("Withdrawal not ready");

    await ethers.provider.send("evm_increaseTime", [WITHDRAWAL_DELAY + 1]);
    await ethers.provider.send("evm_mine", []);

    const tx = await staking.connect(user).claimWithdraw();
    await tx.wait();

    const userSharesAfter = await staking.shares(user.address);
    const totalSharesAfter = await staking.totalShares();
    const poolBalanceAfter = await ethers.provider.getBalance(addr);

    const expectedEth = (halfShares * poolBalanceBefore) / totalSharesBefore;

    expect(userSharesAfter).to.equal(userSharesBefore - halfShares);
    expect(totalSharesAfter).to.equal(totalSharesBefore - halfShares);
    expect(poolBalanceAfter).to.equal(poolBalanceBefore - expectedEth);

    const reqAfter = await staking.withdrawalRequests(user.address);
    expect(reqAfter.shares).to.equal(0n);
    expect(reqAfter.readyAt).to.equal(0n);
  });


  it("RequestWithdraw validates share amount", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();

    await (
      await staking.connect(user).deposit({
        value: ethers.parseEther("1"),
      })
    ).wait();

    await expect(
      staking.connect(user).requestWithdraw(0n),
    ).to.be.revertedWith("Zero shares");

    const userShares = await staking.shares(user.address);
    await expect(
      staking.connect(user).requestWithdraw(userShares + 1n),
    ).to.be.revertedWith("Not enough shares");
  });


  it("Revert second withdrawal request while first is pending", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();

    await (
      await staking.connect(user).deposit({
        value: ethers.parseEther("1"),
      })
    ).wait();

    const shares = await staking.shares(user.address);
    const half = shares / 2n;

    await (
      await staking.connect(user).requestWithdraw(half)
    ).wait();

    await expect(
      staking.connect(user).requestWithdraw(half),
    ).to.be.revertedWith("Pending withdrawal");
  });


  it("Revert claim without request", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();

    await expect(
      staking.connect(user).claimWithdraw(),
    ).to.be.revertedWith("No pending withdrawal");
  });


  it("Reward increases stake value via addRewards", async function () {
    const [deployer, user1, user2] = await ethers.getSigners();
    const staking = await deployStaking();

    const oneEth = ethers.parseEther("1");

    await (await staking.connect(user1).deposit({ value: oneEth })).wait();
    await (await staking.connect(user2).deposit({ value: oneEth })).wait();

    const value1Before = await staking.getUserStakeValue(user1.address);
    const value2Before = await staking.getUserStakeValue(user2.address);

    expect(value1Before).to.equal(oneEth);
    expect(value2Before).to.equal(oneEth);

    await (
      await staking.connect(deployer).addRewards({ value: oneEth })
    ).wait();

    const value1After = await staking.getUserStakeValue(user1.address);
    const value2After = await staking.getUserStakeValue(user2.address);
    const onePointFive = ethers.parseEther("1.5");

    expect(value1After).to.equal(onePointFive);
    expect(value2After).to.equal(onePointFive);
    expect(value1After).to.be.greaterThan(value1Before);
    expect(value2After).to.be.greaterThan(value2Before);
  });


  it("Reward increases stake value via plain transfer", async function () {
    const [deployer, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const oneEth = ethers.parseEther("1");

    await (await staking.connect(user).deposit({ value: oneEth })).wait();

    const valueBefore = await staking.getUserStakeValue(user.address);
    expect(valueBefore).to.equal(oneEth);

    await (
      await deployer.sendTransaction({ to: addr, value: oneEth })
    ).wait();

    const valueAfter = await staking.getUserStakeValue(user.address);
    const twoEth = ethers.parseEther("2");

    expect(valueAfter).to.equal(twoEth);
    expect(valueAfter).to.be.greaterThan(valueBefore);
  });


  it("ChangeOwner updates owner", async function () {
    const [deployer, , newOwner] = await ethers.getSigners();
    const staking = await deployStaking();

    expect(await staking.owner()).to.equal(deployer.address);

    const tx = await staking.connect(deployer).changeOwner(newOwner.address);
    await tx.wait();

    expect(await staking.owner()).to.equal(newOwner.address);
  });


  it("Revert changeOwner from non-owner", async function () {
    const [deployer, user, newOwner] = await ethers.getSigners();
    const staking = await deployStaking();

    expect(await staking.owner()).to.equal(deployer.address);

    await expect(
      staking.connect(user).changeOwner(newOwner.address),
    ).to.be.revertedWith("Not owner");
  });


  it("Revert changeOwner to zero address", async function () {
    const [deployer] = await ethers.getSigners();
    const staking = await deployStaking();

    await expect(
      staking
        .connect(deployer)
        .changeOwner("0x0000000000000000000000000000000000000000"),
    ).to.be.revertedWith("Zero address");
  });

});
