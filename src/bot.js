import ethers from 'ethers';
import express from 'express';
import chalk from 'chalk';
import dotenv from 'dotenv';
import inquirer from 'inquirer';
import { calcBNBPrice, calcSell } from "./tokenPrice.js";



const app = express();
dotenv.config();

const data = {
  WBNB: process.env.WBNB_CONTRACT, //wbnb
  to_PURCHASE: process.env.TO_PURCHASE, // token that you will purchase = BUSD for test '0xe9e7cea3dedca5984780bafc599bd69add087d56'
  AMOUNT_OF_WBNB: process.env.AMOUNT_OF_WBNB, // how much you want to buy in WBNB
  factory: process.env.FACTORY,  //PancakeSwap V2 factory
  router: process.env.ROUTER, //PancakeSwap V2 router
  recipient: process.env.YOUR_ADDRESS, //your wallet address,
  Slippage: process.env.SLIPPAGE, //in Percentage
  gasPrice: ethers.utils.parseUnits(`${process.env.GWEI}`, 'gwei'), //in gwei
  gasLimit: process.env.GAS_LIMIT, //at least 21000
  minBnb: process.env.MIN_LIQUIDITY_ADDED //min liquidity added
}

let initialLiquidityDetected = false;
let jmlBnb = 0;

const wss = process.env.WSS_NODE;
const mnemonic = process.env.YOUR_MNEMONIC //your memonic;
const tokenIn = data.WBNB;
const tokenOut = data.to_PURCHASE;
// const provider = new ethers.providers.JsonRpcProvider(bscMainnetUrl)
const provider = new ethers.providers.WebSocketProvider(wss);
const wallet = new ethers.Wallet(mnemonic);
const account = wallet.connect(provider);



const factory = new ethers.Contract(
  data.factory,
  [
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
    'function getPair(address tokenA, address tokenB) external view returns (address pair)'
  ],
  account
);

const router = new ethers.Contract(
  data.router,
  [
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapETHForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline) external  payable returns (uint[] memory amounts)'
  ],
  account
);

const erc = new ethers.Contract(
  data.WBNB,
  [{ "constant": true, "inputs": [{ "name": "_owner", "type": "address" }], "name": "balanceOf", "outputs": [{ "name": "balance", "type": "uint256" }], "payable": false, "type": "function" }],
  account
);

// You can also use an ENS name for the contract address
const daiAddress = data.to_PURCHASE;

// The ERC-20 Contract ABI, which is a common contract interface
// for tokens (this is the Human-Readable ABI format)
const daiAbi = [
  // Some details about the token
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",

  // Get the account balance
  "function balanceOf(address) view returns (uint)",

  // Send some of your tokens to someone else
  "function transfer(address to, uint amount)",

  // An event triggered whenever anyone transfers to someone else
  "event Transfer(address indexed from, address indexed to, uint amount)"
];

// The Contract object
const targetContract = new ethers.Contract(daiAddress, daiAbi, provider);

const run = async () => {
  await checkLiq();
}

let tokenInfo = async () => {
  try {
    const bnbPrice = await calcBNBPrice();
    const priceInBnb = await calcSell(1, data.to_PURCHASE) / 1;
    const nameToken = await targetContract.name();
    const symbolToken = await targetContract.symbol();
    const decimalToken = await targetContract.decimals();
    const balanceToken = await targetContract.balanceOf(account.getAddress());
    const balance = (balanceToken / Math.pow(10, decimalToken));
    console.log(chalk.green(`\n------ Token Information ------`));
    console.log(chalk.green(`Name: ${nameToken}`));
    console.log(chalk.green(`Symbol: ${symbolToken}`));
    console.log(chalk.green(`Decimal: ${decimalToken}`));
    console.log(chalk.green(`Balance: ${(balanceToken / Math.pow(10, decimalToken))}`));
    console.log(chalk.green(`Price in BNB: ${priceInBnb}`));
    console.log(chalk.green(`Price in USD: ${priceInBnb * bnbPrice}`));
    console.log(chalk.green(`---------------------------------\n`));
    return JSON.stringify({
      "name": nameToken,
      "symbol": symbolToken,
      "decimal": decimalToken,
      "balance": balance,
      "priceInBnb": priceInBnb,
      "priceInUsd": priceInBnb * bnbPrice
    });
  } catch (err) {
    console.log(err);
  }
}

let checkLiq = async () => {


  const pairAddressx = await factory.getPair(tokenIn, tokenOut);
  console.log(chalk.blue(`pairAddress: ${pairAddressx}`));
  if (pairAddressx !== null && pairAddressx !== undefined) {
    // console.log("pairAddress.toString().indexOf('0x0000000000000')", pairAddress.toString().indexOf('0x0000000000000'));
    if (pairAddressx.toString().indexOf('0x0000000000000') > -1) {
      console.log(chalk.cyan(`pairAddress ${pairAddressx} not detected. Auto restart`));
      return await run();
    }
  }

  const pairBNBvalue = await erc.balanceOf(pairAddressx);
  let balance = await provider.getBalance(wallet.address)
  console.log(`Balance avaliable BNB : ${ethers.utils.formatEther(balance)}`);
  jmlBnb = await ethers.utils.formatEther(pairBNBvalue);
  console.log(`BNB pooled: ${jmlBnb}`);

  if (jmlBnb > data.minBnb) {
    setTimeout(() => buyAction(), 5000);
  }
  else {
    initialLiquidityDetected = false;
    console.log(' run again...');
    return await run();
  }
}

let buyAction = async () => {
  if (initialLiquidityDetected === true) {
    console.log('not buy cause already buy');
    return null;
  }

  console.log('ready to buy');

  try {

    initialLiquidityDetected = true;

    let amountOutMin = 0;
    //We buy x amount of the new token for our wbnb
    const amountIn = ethers.utils.parseUnits(`${data.AMOUNT_OF_WBNB}`, 'ether');
    if (parseInt(data.Slippage) !== 0) {
      const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      //Our execution price will be a bit different, we need some flexibility
      amountOutMin = amounts[1].sub(amounts[1].div(`${data.Slippage}`))
    }

    console.log(
      chalk.green.inverse(`Start to buy \n`)
      +
      `Buying Token
          =================
          tokenIn: ${(amountIn * 1e-18).toString()} ${tokenIn} (BNB)
          tokenOut: ${amountOutMin.toString()} ${tokenOut}
        `);

    console.log('Processing Transaction.....');
    console.log(chalk.yellow(`amountIn: ${(amountIn * 1e-18)} ${tokenIn} (BNB)`));
    console.log(chalk.yellow(`amountOutMin: ${amountOutMin}`));
    console.log(chalk.yellow(`tokenIn: ${tokenIn}`));
    console.log(chalk.yellow(`tokenOut: ${tokenOut}`));
    console.log(chalk.yellow(`data.recipient: ${data.recipient}`));
    console.log(chalk.yellow(`data.gasLimit: ${data.gasLimit}`));
    console.log(chalk.yellow(`data.gasPrice: ${data.gasPrice}`));

    // const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens( //uncomment this if you want to buy deflationary token
    const tx = await router.swapETHForExactTokens( //uncomment here if you want to buy token
      amountOutMin,
      [tokenIn, tokenOut],
      data.recipient,
      Date.now() + 1000 * 60 * 5, //5 minutes
      {
        'gasLimit': data.gasLimit,
        'gasPrice': data.gasPrice,
        'nonce': null, //set you want buy at where position in blocks
        'value': amountIn
      });

    const receipt = await tx.wait();
    console.log(`Transaction receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`);
    let tokenInfo = await tokenInfo();
    setTimeout(() => { process.exit() }, 2000);

  } catch (err) {
    let error = JSON.parse(JSON.stringify(err));
    console.log(`Error caused by : 
          {
          reason : ${error.reason},
          transactionHash : ${error.transactionHash}
          message : ${error}
          }`);
    console.log(error);

    inquirer.prompt([
      {
        type: 'confirm',
        name: 'runAgain',
        message: 'Do you want to run again thi bot?',
      },
    ])
      .then(answers => {
        if (answers.runAgain === true) {
          console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
          console.log('Run again');
          console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
          initialLiquidityDetected = false;
          run();
        } else {
          process.exit();
        }

      });

  }
}

tokenInfo();
// firstRun();
run();

// const PORT = 5001;

// app.listen(PORT, console.log(chalk.yellow(`Listening for Liquidity Addition to token ${data.to_PURCHASE}`)));
