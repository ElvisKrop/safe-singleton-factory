import {promises as filesystem} from 'fs'
import * as path from 'path'
import {CompilerOutputContract} from 'solc'
import {ethers} from 'ethers'
import * as dotenv from 'dotenv'
import yargs from 'yargs'
import {compileContracts} from './utils'

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

  let signer: ethers.Wallet
	if (process.env.MNEMONIC !== '' && process.env.MNEMONIC !== undefined) {
    signer = ethers.Wallet.fromMnemonic(process.env.MNEMONIC)
  } else if (process.env.PRIVATE_KEY !== '' && process.env.PRIVATE_KEY !== undefined) {
    signer = new ethers.Wallet(process.env.PRIVATE_KEY)
  } else {
    throw new Error('You need a MNEMONIC or PRIVATE_KEY to proceed...')
  }
	const signedEncodedTransaction = await signer.signTransaction({
		nonce, gasPrice, gasLimit, value, data, chainId
	})
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
