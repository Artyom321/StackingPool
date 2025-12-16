// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract StakingPool {
    address public owner;
    uint256 public totalShares;
    mapping(address => uint256) public shares;
    uint256 private _status;

    modifier nonReentrant() {
        require(_status != 2, "ReentrancyGuard: reentrant call");
        _status = 2;
        _;
        _status = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    event Deposited(address indexed user, uint256 amount, uint256 sharesMinted);
    event Withdrawn(address indexed user, uint256 amount, uint256 sharesBurned);
    event RewardsAdded(address indexed from, uint256 amount);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    constructor() {
        owner = msg.sender;
        _status = 1;
    }

    function totalPooled() public view returns (uint256) {
        return address(this).balance;
    }

    function getUserStakeValue(address user) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares[user] * address(this).balance) / totalShares;
    }

    function deposit() external payable nonReentrant {
        require(msg.value > 0, "Zero deposit");

        uint256 sharesToMint;

        if (totalShares == 0) {
            sharesToMint = msg.value;
        } else {
            uint256 poolBefore = address(this).balance - msg.value;
            require(poolBefore > 0, "Pool before must be > 0");
            sharesToMint = (msg.value * totalShares) / poolBefore;
        }

        require(sharesToMint > 0, "Zero shares minted");

        shares[msg.sender] += sharesToMint;
        totalShares += sharesToMint;

        emit Deposited(msg.sender, msg.value, sharesToMint);
    }

    function withdraw(uint256 shareAmount) external nonReentrant {
        require(shareAmount > 0, "Zero shares");
        uint256 userShares = shares[msg.sender];
        require(shareAmount <= userShares, "Not enough shares");

        uint256 poolBalance = address(this).balance;
        require(poolBalance > 0, "Empty pool");

        uint256 ethAmount = (shareAmount * poolBalance) / totalShares;

        shares[msg.sender] = userShares - shareAmount;
        totalShares -= shareAmount;

        (bool ok, ) = msg.sender.call{value: ethAmount}("");
        require(ok, "ETH transfer failed");

        emit Withdrawn(msg.sender, ethAmount, shareAmount);
    }

    function addRewards() external payable {
        require(msg.value > 0, "Zero rewards");
        emit RewardsAdded(msg.sender, msg.value);
    }

    receive() external payable {
        require(msg.value > 0, "Zero rewards");
        emit RewardsAdded(msg.sender, msg.value);
    }

    function changeOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }
}
