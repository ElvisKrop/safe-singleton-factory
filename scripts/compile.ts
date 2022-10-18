import { promises as filesystem } from 'fs'
import * as path from 'path'
import { CompilerOutput, CompilerInput, compileStandardWrapper, CompilerOutputContract } from 'solc'
import { ethers } from 'ethers'
import dotenv from "dotenv";
import yargs from 'yargs/yargs';
import { compileContracts } from './utils';
import * as sapphire from '@oasisprotocol/sapphire-paratime';

dotenv.config()

export async function ensureDirectoryExists(absoluteDirectoryPath: string) {
	try {
		await filesystem.mkdir(absoluteDirectoryPath)
	} catch (error) {
		if (error.code === 'EEXIST') return
		throw error
	}
}

async function writeBytecode(bytecode: string) {
	const filePath = path.join(__dirname, '..', 'artifacts', `bytecode.txt`)
	await filesystem.writeFile(filePath, bytecode, { encoding: 'utf8', flag: 'w' })
}

async function writeFactoryDeployerTransaction(contract: CompilerOutputContract, chainId: number, overwrites?: { gasPrice?: number, gasLimit?: number, nonce?: number}) {
	const deploymentBytecode = contract.evm.bytecode.object

	const nonce = overwrites?.nonce || 0
	const gasPrice = overwrites?.gasPrice || 100*10**9
	// actual gas costs last measure: 59159; we don't want to run too close though because gas costs can change in forks and we want our address to be retained
	const gasLimit = overwrites?.gasLimit || 100000
	const value = 0
	const data = arrayFromHexString(deploymentBytecode)

	//if (!process.env.MNEMONIC) throw Error("MNEMONIC is required")
	//const signer = ethers.Wallet.fromMnemonic(process.env.MNEMONIC!!)

	//For generating from private key of 0x6DE4De587117b83c0a762e5D03BF1ecDdd68EBb1
 	let privateKey = process.env.PK!!;
	//let signer = new ethers.Wallet(privateKey);
	const signer = sapphire.wrap(new ethers.Wallet(privateKey).connect(ethers.getDefaultProvider('https://testnet.sapphire.oasis.dev')));

	console.log(chainId);
	const signedEncodedTransaction = await signer.signTransaction({
		nonce, gasPrice, gasLimit, value, data, chainId
	})
	console.log(signedEncodedTransaction);
	const signerAddress = await signer.getAddress()
	const contractAddress = ethers.utils.getContractAddress({ from: signerAddress, nonce } )

	const filePath = path.join(__dirname, "..", "artifacts", `${chainId}`, "deployment.json")
	const fileContents = `{
	"gasPrice": ${gasPrice},
	"gasLimit": ${gasLimit},
	"signerAddress": "${signerAddress}",
	"transaction": "${signedEncodedTransaction}",
	"address": "${contractAddress}"
}
`
	await filesystem.writeFile(filePath, fileContents, { encoding: 'utf8', flag: 'w' })
}

function arrayFromNumber(value: number): Uint8Array {
	return arrayFromHexString(value.toString(16))
}

function arrayFromHexString(value: string): Uint8Array {
	const normalized = (value.length % 2) ? `0${value}` : value
	const bytes = []
	for (let i = 0; i < normalized.length; i += 2) {
		bytes.push(Number.parseInt(`${normalized[i]}${normalized[i+1]}`, 16))
	}
	return new Uint8Array(bytes)
}

async function doStuff() {
	const chainId: number = parseInt(process.argv[2])
	const argv = yargs(process.argv.slice(3)).options({
		"gasPrice": { type: "number" },
		"gasLimit": { type: "number" },
		"nonce": { type: "number" }
	}).argv
	const compilerOutput = await compileContracts()
	const contract = compilerOutput.contracts['deterministic-deployment-proxy.yul']['Proxy']
	await ensureDirectoryExists(path.join(__dirname, '..', 'artifacts'))
	await ensureDirectoryExists(path.join(__dirname, '..', 'artifacts', `${chainId}`))
	await writeBytecode(contract.evm.bytecode.object)
	await writeFactoryDeployerTransaction(contract, chainId, argv)
}

doStuff().then(() => {
	process.exit(0)
}).catch(error => {
	console.error(error)
	process.exit(1)
})
