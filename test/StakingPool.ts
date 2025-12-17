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

  async function getBalance(addr: string) {
    return await ethers.provider.getBalance(addr);
  }


  it("Owner is deployer", async function () {
    const [deployer] = await ethers.getSigners();

    const staking = await deployStaking();
    const addr = await staking.getAddress();

    expect(await staking.owner()).to.equal(deployer.address);
    expect(await staking.withdrawalDelay()).to.equal(WITHDRAWAL_DELAY);

    const contractBalance = await getBalance(addr);
    const deployerBalance = await getBalance(deployer.address);

    expect(contractBalance).to.equal(0n);
    expect(deployerBalance).to.be.greaterThan(0n);
  });


  it("First deposite", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const amount = ethers.parseEther("1");

    const userBalanceBefore = await getBalance(user.address);
    const contractBalanceBefore = await getBalance(addr);

    const tx = await staking.connect(user).deposit({ value: amount });
    const receipt = await tx.wait();
    const gasPrice = tx.gasPrice ?? 0n;
    const gasCost = receipt!.gasUsed * gasPrice;

    const userBalanceAfter = await getBalance(user.address);
    const contractBalanceAfter = await getBalance(addr);

    const userShares = await staking.shares(user.address);
    const totalShares = await staking.totalShares();

    expect(userShares).to.equal(amount);
    expect(totalShares).to.equal(amount);
    expect(contractBalanceAfter - contractBalanceBefore).to.equal(amount);
    expect(userBalanceBefore - gasCost - userBalanceAfter).to.equal(amount);
  });


  it("Delayed claim (no profit → no fee)", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const twoEth = ethers.parseEther("2");

    {
      const userBalanceBefore = await getBalance(user.address);
      const contractBalanceBefore = await getBalance(addr);

      const tx = await staking.connect(user).deposit({ value: twoEth });
      const receipt = await tx.wait();
      const gasPrice = tx.gasPrice ?? 0n;
      const gasCost = receipt!.gasUsed * gasPrice;

      const userBalanceAfter = await getBalance(user.address);
      const contractBalanceAfter = await getBalance(addr);

      expect(contractBalanceAfter - contractBalanceBefore).to.equal(twoEth);
      expect(userBalanceBefore - gasCost - userBalanceAfter).to.equal(twoEth);
    }

    const userSharesBefore = await staking.shares(user.address);
    const totalSharesBefore = await staking.totalShares();
    const poolBalanceBefore = await getBalance(addr);

    const halfShares = userSharesBefore / 2n;

    await (await staking.connect(user).requestWithdraw(halfShares)).wait();

    const req = await staking.withdrawalRequests(user.address);
    expect(req.shares).to.equal(halfShares);

    await ethers.provider.send("evm_increaseTime", [WITHDRAWAL_DELAY + 1]);
    await ethers.provider.send("evm_mine", []);

    const userBalanceBeforeClaim = await getBalance(user.address);
    const contractBalanceBeforeClaim = await getBalance(addr);

    const txClaim = await staking.connect(user).claimWithdraw();
    const receiptClaim = await txClaim.wait();
    const gasPriceClaim = txClaim.gasPrice ?? 0n;
    const gasCostClaim = receiptClaim!.gasUsed * gasPriceClaim;

    const userBalanceAfterClaim = await getBalance(user.address);
    const contractBalanceAfterClaim = await getBalance(addr);

    const expectedEth =
      (halfShares * poolBalanceBefore) / totalSharesBefore;

    const userSharesAfter = await staking.shares(user.address);
    const totalSharesAfter = await staking.totalShares();

    expect(userSharesAfter).to.equal(userSharesBefore - halfShares);
    expect(totalSharesAfter).to.equal(totalSharesBefore - halfShares);
    expect(contractBalanceBeforeClaim - contractBalanceAfterClaim).to.equal(
      expectedEth,
    );
    expect(
      userBalanceAfterClaim + gasCostClaim - userBalanceBeforeClaim,
    ).to.equal(expectedEth);

    const reqAfter = await staking.withdrawalRequests(user.address);
    expect(reqAfter.shares).to.equal(0n);
  });


  it("RequestWithdraw validates share amount", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const oneEth = ethers.parseEther("1");

    await (await staking.connect(user).deposit({ value: oneEth })).wait();

    const contractBalanceBefore = await getBalance(addr);
    const sharesBefore = await staking.shares(user.address);

    await expect(
      staking.connect(user).requestWithdraw(0n),
    ).to.be.revertedWith("Zero shares");

    const contractBalanceAfterZero = await getBalance(addr);
    const sharesAfterZero = await staking.shares(user.address);

    expect(contractBalanceAfterZero).to.equal(contractBalanceBefore);
    expect(sharesAfterZero).to.equal(sharesBefore);

    const userShares = await staking.shares(user.address);
    await expect(
      staking.connect(user).requestWithdraw(userShares + 1n),
    ).to.be.revertedWith("Not enough shares");

    const contractBalanceAfterTooMuch = await getBalance(addr);
    const sharesAfterTooMuch = await staking.shares(user.address);

    expect(contractBalanceAfterTooMuch).to.equal(contractBalanceBefore);
    expect(sharesAfterTooMuch).to.equal(sharesBefore);
  });


  it("Revert second withdrawal request while first is pending", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const oneEth = ethers.parseEther("1");

    await (await staking.connect(user).deposit({ value: oneEth })).wait();

    const shares = await staking.shares(user.address);
    const half = shares / 2n;

    await (
      await staking.connect(user).requestWithdraw(half)
    ).wait();

    const contractBalanceBefore = await getBalance(addr);
    const sharesBefore = await staking.shares(user.address);

    await expect(
      staking.connect(user).requestWithdraw(half),
    ).to.be.revertedWith("Pending withdrawal");

    const contractBalanceAfter = await getBalance(addr);
    const sharesAfter = await staking.shares(user.address);

    expect(contractBalanceAfter).to.equal(contractBalanceBefore);
    expect(sharesAfter).to.equal(sharesBefore);
  });


  it("Revert claim without request", async function () {
    const [, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const contractBalanceBefore = await getBalance(addr);

    await expect(
      staking.connect(user).claimWithdraw(),
    ).to.be.revertedWith("No pending withdrawal");

    const contractBalanceAfter = await getBalance(addr);
    expect(contractBalanceAfter).to.equal(contractBalanceBefore);
  });


  it("Reward increases stake value via addRewards", async function () {
    const [deployer, user1, user2] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const oneEth = ethers.parseEther("1");

    await (await staking.connect(user1).deposit({ value: oneEth })).wait();
    await (await staking.connect(user2).deposit({ value: oneEth })).wait();

    const contractBalanceAfterDeposits = await getBalance(addr);
    expect(contractBalanceAfterDeposits).to.equal(oneEth * 2n);

    const value1Before = await staking.getUserStakeValue(user1.address);
    const value2Before = await staking.getUserStakeValue(user2.address);

    expect(value1Before).to.equal(oneEth);
    expect(value2Before).to.equal(oneEth);

    const deployerBalanceBefore = await getBalance(deployer.address);
    const contractBalanceBeforeReward = await getBalance(addr);

    const tx = await staking.connect(deployer).addRewards({ value: oneEth });
    const receipt = await tx.wait();
    const gasPrice = tx.gasPrice ?? 0n;
    const gasCost = receipt!.gasUsed * gasPrice;

    const deployerBalanceAfter = await getBalance(deployer.address);
    const contractBalanceAfterReward = await getBalance(addr);

    expect(
      deployerBalanceBefore - gasCost - deployerBalanceAfter,
    ).to.equal(oneEth);
    expect(
      contractBalanceAfterReward - contractBalanceBeforeReward,
    ).to.equal(oneEth);

    const value1After = await staking.getUserStakeValue(user1.address);
    const value2After = await staking.getUserStakeValue(user2.address);
    const onePointFive = ethers.parseEther("1.5");

    expect(value1After).to.equal(onePointFive);
    expect(value2After).to.equal(onePointFive);
  });


  it("Reward increases stake value via plain transfer", async function () {
    const [deployer, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const oneEth = ethers.parseEther("1");

    await (await staking.connect(user).deposit({ value: oneEth })).wait();

    const valueBefore = await staking.getUserStakeValue(user.address);
    expect(valueBefore).to.equal(oneEth);

    const deployerBalanceBefore = await getBalance(deployer.address);
    const contractBalanceBefore = await getBalance(addr);

    const tx = await deployer.sendTransaction({ to: addr, value: oneEth });
    const receipt = await tx.wait();
    const gasPrice = tx.gasPrice ?? 0n;
    const gasCost = receipt!.gasUsed * gasPrice;

    const deployerBalanceAfter = await getBalance(deployer.address);
    const contractBalanceAfter = await getBalance(addr);

    expect(
      deployerBalanceBefore - gasCost - deployerBalanceAfter,
    ).to.equal(oneEth);
    expect(contractBalanceAfter - contractBalanceBefore).to.equal(oneEth);

    const valueAfter = await staking.getUserStakeValue(user.address);
    const twoEth = ethers.parseEther("2");

    expect(valueAfter).to.equal(twoEth);
  });


  it("ChangeOwner updates owner", async function () {
    const [deployer, , newOwner] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const contractBalanceBefore = await getBalance(addr);

    expect(await staking.owner()).to.equal(deployer.address);

    await (await staking.connect(deployer).changeOwner(newOwner.address)).wait();

    expect(await staking.owner()).to.equal(newOwner.address);

    const contractBalanceAfter = await getBalance(addr);
    expect(contractBalanceAfter).to.equal(contractBalanceBefore);
  });


  it("Revert changeOwner from non-owner", async function () {
    const [deployer, user, newOwner] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    expect(await staking.owner()).to.equal(deployer.address);

    const contractBalanceBefore = await getBalance(addr);

    await expect(
      staking.connect(user).changeOwner(newOwner.address),
    ).to.be.revertedWith("Not owner");

    const contractBalanceAfter = await getBalance(addr);
    expect(contractBalanceAfter).to.equal(contractBalanceBefore);
  });


  it("Revert changeOwner to zero address", async function () {
    const [deployer] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const contractBalanceBefore = await getBalance(addr);

    await expect(
      staking
        .connect(deployer)
        .changeOwner("0x0000000000000000000000000000000000000000"),
    ).to.be.revertedWith("Zero address");

    const contractBalanceAfter = await getBalance(addr);
    expect(contractBalanceAfter).to.equal(contractBalanceBefore);
  });


  it("Withdraw with profit applies NORMAL fee", async function () {
    const [owner, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const oneEth = ethers.parseEther("1");

    await (await staking.connect(user).deposit({ value: oneEth })).wait();
    await (await owner.sendTransaction({ to: addr, value: oneEth })).wait();

    const shares = await staking.shares(user.address);

    await (await staking.connect(user).requestWithdraw(shares)).wait();

    await ethers.provider.send("evm_increaseTime", [WITHDRAWAL_DELAY + 1]);
    await ethers.provider.send("evm_mine", []);

    const ownerBalanceBefore = await getBalance(owner.address);
    const userBalanceBefore = await getBalance(user.address);
    const contractBalanceBefore = await getBalance(addr);

    const tx = await staking.connect(user).claimWithdraw();
    const receipt = await tx.wait();
    const gasPrice = tx.gasPrice ?? 0n;
    const gasCost = receipt!.gasUsed * gasPrice;

    const ownerBalanceAfter = await getBalance(owner.address);
    const userBalanceAfter = await getBalance(user.address);
    const contractBalanceAfter = await getBalance(addr);

    const gross = ethers.parseEther("2");
    const profit = ethers.parseEther("1");
    const fee = (profit * 500n) / 10_000n;
    const payout = gross - fee;

    expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(fee);
    expect(
      userBalanceAfter + gasCost - userBalanceBefore,
    ).to.equal(payout);
    expect(contractBalanceBefore - contractBalanceAfter).to.equal(gross);

    const userSharesAfter = await staking.shares(user.address);
    const totalSharesAfter = await staking.totalShares();
    const depositedAfter = await staking.deposited(user.address);

    expect(userSharesAfter).to.equal(0n);
    expect(totalSharesAfter).to.equal(0n);
    expect(depositedAfter).to.equal(0n);
  });


  it("Early withdraw applies EARLY fee", async function () {
    const [owner, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const oneEth = ethers.parseEther("1");

    await (await staking.connect(user).deposit({ value: oneEth })).wait();
    await (await owner.sendTransaction({ to: addr, value: oneEth })).wait();

    const shares = await staking.shares(user.address);

    await (await staking.connect(user).requestWithdraw(shares)).wait();

    const ownerBalanceBefore = await getBalance(owner.address);
    const userBalanceBefore = await getBalance(user.address);
    const contractBalanceBefore = await getBalance(addr);

    const tx = await staking.connect(user).claimWithdraw();
    const receipt = await tx.wait();
    const gasPrice = tx.gasPrice ?? 0n;
    const gasCost = receipt!.gasUsed * gasPrice;

    const ownerBalanceAfter = await getBalance(owner.address);
    const userBalanceAfter = await getBalance(user.address);
    const contractBalanceAfter = await getBalance(addr);

    const profit = ethers.parseEther("1");
    const fee = (profit * 1500n) / 10_000n;
    const gross = ethers.parseEther("2");
    const payout = gross - fee;

    expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(fee);
    expect(
      userBalanceAfter + gasCost - userBalanceBefore,
    ).to.equal(payout);
    expect(contractBalanceBefore - contractBalanceAfter).to.equal(gross);

    const userSharesAfter = await staking.shares(user.address);
    const totalSharesAfter = await staking.totalShares();
    const depositedAfter = await staking.deposited(user.address);

    expect(userSharesAfter).to.equal(0n);
    expect(totalSharesAfter).to.equal(0n);
    expect(depositedAfter).to.equal(0n);
  });


  it("Deposit after withdraw request adjusts principal and payout correctly", async function () {
    const [owner, user] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const oneEth = ethers.parseEther("1");

    await (await staking.connect(user).deposit({ value: oneEth })).wait();

    await (await staking.connect(owner).addRewards({ value: oneEth })).wait();

    const sharesBeforeReq = await staking.shares(user.address);
    const depositedBeforeReq = await staking.deposited(user.address);
    const totalSharesBeforeReq = await staking.totalShares();
    const poolBeforeReq = await getBalance(addr);

    expect(sharesBeforeReq).to.equal(oneEth);
    expect(depositedBeforeReq).to.equal(oneEth);
    expect(totalSharesBeforeReq).to.equal(oneEth);
    expect(poolBeforeReq).to.equal(ethers.parseEther("2"));

    const halfShares = sharesBeforeReq / 2n;
    await (await staking.connect(user).requestWithdraw(halfShares)).wait();

    const req = await staking.withdrawalRequests(user.address);
    expect(req.shares).to.equal(halfShares);

    await (await staking.connect(user).deposit({ value: oneEth })).wait();

    const userSharesBeforeClaim = await staking.shares(user.address);
    const userDepositedBeforeClaim = await staking.deposited(user.address);
    const totalSharesBeforeClaim = await staking.totalShares();
    const poolBeforeClaim = await getBalance(addr);

    expect(poolBeforeClaim).to.equal(ethers.parseEther("3"));
    expect(userDepositedBeforeClaim).to.equal(ethers.parseEther("2"));

    await ethers.provider.send("evm_increaseTime", [WITHDRAWAL_DELAY + 1]);
    await ethers.provider.send("evm_mine", []);

    const grossAmount =
      (req.shares * poolBeforeClaim) / totalSharesBeforeClaim;

    const principalPart =
      (userDepositedBeforeClaim * req.shares) / userSharesBeforeClaim;

    const profit =
      grossAmount > principalPart ? grossAmount - principalPart : 0n;

    const NORMAL_FEE_BPS = 500n;
    const fee = (profit * NORMAL_FEE_BPS) / 10_000n;
    const expectedPayout = grossAmount - fee;

    const userBalanceBefore = await getBalance(user.address);
    const ownerBalanceBefore = await getBalance(owner.address);
    const contractBalanceBefore = await getBalance(addr);

    const tx = await staking.connect(user).claimWithdraw();
    const receipt = await tx.wait();
    const gasPrice = tx.gasPrice ?? 0n;
    const gasCost = receipt!.gasUsed * gasPrice;

    const userBalanceAfter = await getBalance(user.address);
    const ownerBalanceAfter = await getBalance(owner.address);
    const contractBalanceAfter = await getBalance(addr);

    const actualPayout = userBalanceAfter + gasCost - userBalanceBefore;
    const actualFee = ownerBalanceAfter - ownerBalanceBefore;
    const contractDelta = contractBalanceBefore - contractBalanceAfter;

    expect(actualPayout).to.equal(expectedPayout);
    expect(actualFee).to.equal(fee);
    expect(contractDelta).to.equal(grossAmount);

    const userSharesAfter = await staking.shares(user.address);
    const totalSharesAfter = await staking.totalShares();
    const userDepositedAfter = await staking.deposited(user.address);
    const reqAfter = await staking.withdrawalRequests(user.address);

    expect(userSharesAfter).to.equal(userSharesBeforeClaim - req.shares);
    expect(totalSharesAfter).to.equal(totalSharesBeforeClaim - req.shares);
    expect(userDepositedAfter).to.equal(
      userDepositedBeforeClaim - principalPart,
    );
    expect(reqAfter.shares).to.equal(0n);
  });


  it("Multiple users deposit, get rewards and withdraw in random order", async function () {
    const [owner, u1, u2, u3, u4, u5] = await ethers.getSigners();
    const staking = await deployStaking();
    const addr = await staking.getAddress();

    const oneEth = ethers.parseEther("1");

    const users = [u1, u2, u3, u4, u5];
    const deposits = [
      oneEth * 1n,
      oneEth * 2n,
      oneEth * 3n,
      oneEth * 4n,
      oneEth * 5n,
    ];

    const totalDeposit = deposits.reduce((a, b) => a + b, 0n);
    expect(totalDeposit).to.equal(ethers.parseEther("15"));

    for (let i = 0; i < users.length; i++) {
      await (
        await staking.connect(users[i]).deposit({ value: deposits[i] })
      ).wait();
    }

    const contractBalanceAfterDeposits = await getBalance(addr);
    expect(contractBalanceAfterDeposits).to.equal(totalDeposit);

    const reward = ethers.parseEther("15");
    await (await owner.sendTransaction({ to: addr, value: reward })).wait();

    const contractBalanceAfterReward = await getBalance(addr);
    expect(contractBalanceAfterReward).to.equal(totalDeposit + reward);

    for (let i = 0; i < users.length; i++) {
      const userShares = await staking.shares(users[i].address);
      await (
        await staking.connect(users[i]).requestWithdraw(userShares)
      ).wait();
    }

    await ethers.provider.send("evm_increaseTime", [WITHDRAWAL_DELAY + 1]);
    await ethers.provider.send("evm_mine", []);

    const NORMAL_FEE_BPS = 500n;
    const expectedPayouts: bigint[] = [];
    const expectedFees: bigint[] = [];

    for (let i = 0; i < users.length; i++) {
      const dep = deposits[i];
      const profit = reward * dep / totalDeposit;
      const gross = dep + profit;
      const fee = (profit * NORMAL_FEE_BPS) / 10_000n;
      const payout = gross - fee;

      expectedPayouts.push(payout);
      expectedFees.push(fee);
    }

    const order = [2, 0, 4, 1, 3];

    for (const idx of order) {
      const user = users[idx];
      const expectedPayout = expectedPayouts[idx];
      const expectedFee = expectedFees[idx];

      const userBalanceBefore = await getBalance(user.address);
      const ownerBalanceBefore = await getBalance(owner.address);
      const contractBalanceBefore = await getBalance(addr);

      const tx = await staking.connect(user).claimWithdraw();
      const receipt = await tx.wait();
      const gasPrice = tx.gasPrice ?? 0n;
      const gasCost = receipt!.gasUsed * gasPrice;

      const userBalanceAfter = await getBalance(user.address);
      const ownerBalanceAfter = await getBalance(owner.address);
      const contractBalanceAfter = await getBalance(addr);

      const actualPayout = userBalanceAfter + gasCost - userBalanceBefore;
      const actualFee = ownerBalanceAfter - ownerBalanceBefore;
      const contractDelta = contractBalanceBefore - contractBalanceAfter;

      const grossExpected = expectedPayout + expectedFee;

      expect(actualPayout).to.equal(expectedPayout);
      expect(actualFee).to.equal(expectedFee);
      expect(contractDelta).to.equal(grossExpected);

      const userSharesAfter = await staking.shares(user.address);
      const userDepositedAfter = await staking.deposited(user.address);
      const reqAfter = await staking.withdrawalRequests(user.address);

      expect(userSharesAfter).to.equal(0n);
      expect(userDepositedAfter).to.equal(0n);
      expect(reqAfter.shares).to.equal(0n);
    }

    const finalContractBalance = await getBalance(addr);
    const finalTotalShares = await staking.totalShares();

    expect(finalContractBalance).to.equal(0n);
    expect(finalTotalShares).to.equal(0n);

    for (const user of users) {
      const sh = await staking.shares(user.address);
      const dep = await staking.deposited(user.address);
      expect(sh).to.equal(0n);
      expect(dep).to.equal(0n);
    }
  });

});
